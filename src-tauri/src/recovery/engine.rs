//! Moteur de recherche : parcourt les graines, les décline en candidats et
//! teste chaque candidat contre le document, en parallèle.
//!
//! La recherche est découpée en lots pour publier l'avancement, mais
//! l'annulation n'est **pas** liée à la granularité des lots : le drapeau
//! d'annulation est consulté **à l'intérieur** de la vérification parallèle
//! d'un lot. Ainsi, même avec l'AES-256 (volontairement lent, ~20 000 essais/s
//! → un lot de 60 000 prendrait ~3 s), une demande d'arrêt court-circuite la
//! recherche en cours de lot en quelques millisecondes, sans attendre la fin du
//! lot. À l'intérieur d'un lot, les candidats sont vérifiés sur tous les cœurs,
//! et la recherche s'arrête dès qu'un mot de passe fonctionne ou dès qu'une
//! annulation est demandée.

use std::collections::HashSet;
use std::time::Instant;

use rayon::prelude::*;

use super::rules::{expand_into, Tier};
use super::verifier::PasswordVerifier;

/// Nombre de candidats visés par lot. Compromis entre parallélisme (assez de
/// travail pour tous les cœurs) et cadence d'avancement. La réactivité de
/// l'annulation ne dépend **pas** de cette valeur : elle est vérifiée au sein
/// même du lot (voir `run_batch`).
const BATCH_TARGET: usize = 60_000;

/// Instantané d'avancement transmis à l'appelant.
#[derive(Clone, Copy)]
pub struct Progress {
    /// Candidats déjà testés.
    pub tested: u64,
    /// Total prévisionnel (peut être légèrement supérieur au réel : voir dedup).
    pub total: u64,
    /// Débit instantané, candidats par seconde.
    pub rate: f64,
    /// Temps écoulé depuis le début, en millisecondes.
    pub elapsed_ms: u128,
}

/// Issue d'une recherche.
pub enum Outcome {
    /// Mot de passe trouvé.
    Found { password: String, tested: u64, elapsed_ms: u128 },
    /// Corpus parcouru sans succès.
    Exhausted { tested: u64, elapsed_ms: u128 },
    /// Interrompu par l'utilisateur.
    Cancelled { tested: u64, elapsed_ms: u128 },
}

/// Issue de la vérification parallèle d'un seul lot.
enum BatchOutcome {
    /// Un candidat valide a été trouvé.
    Found(String),
    /// Le lot a été entièrement testé sans succès.
    Done,
    /// L'annulation a court-circuité le lot avant sa fin.
    Cancelled,
}

/// Lance la recherche.
///
/// - `seeds` : itérateur de mots-graines (déjà limité au niveau si besoin).
/// - `verifier` : vérificateur préparé pour ce document.
/// - `total` : total prévisionnel de candidats, pour l'avancement.
/// - `on_progress` : appelé au plus une fois par lot.
/// - `should_cancel` : consulté **entre** les lots **et au sein** de chaque lot
///   (depuis les fils rayon), d'où la borne `Sync`.
pub fn search<S, P, C>(
    seeds: S,
    verifier: &PasswordVerifier,
    tier: Tier,
    total: u64,
    mut on_progress: P,
    should_cancel: C,
) -> Outcome
where
    S: Iterator<Item = String>,
    P: FnMut(Progress),
    C: Fn() -> bool + Sync,
{
    let started = Instant::now();
    let mut tested: u64 = 0;

    let mut batch: Vec<String> = Vec::with_capacity(BATCH_TARGET + 64);
    let mut scratch: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    // Vérifie un lot sur tous les cœurs. Le drapeau d'annulation est consulté
    // *dans* le prédicat parallèle : dès qu'il passe à vrai, `find_any` s'arrête
    // au prochain candidat de chaque fil, sans attendre la fin du lot. On
    // re-vérifie le candidat renvoyé pour distinguer une vraie trouvaille d'un
    // court-circuit d'annulation (une seule vérification supplémentaire).
    let run_batch = |batch: &mut Vec<String>, tested: &mut u64| -> BatchOutcome {
        if batch.is_empty() {
            return BatchOutcome::Done;
        }
        let size = batch.len() as u64;
        let hit = batch
            .par_iter()
            .find_any(|candidate| should_cancel() || verifier.verify(candidate));
        let outcome = match hit {
            Some(candidate) if verifier.verify(candidate) => {
                *tested += size;
                BatchOutcome::Found(candidate.clone())
            }
            // `find_any` a rendu un candidat qui ne se vérifie pas : c'est donc
            // le court-circuit d'annulation. On ne comptabilise pas ce lot.
            Some(_) => BatchOutcome::Cancelled,
            None => {
                *tested += size;
                BatchOutcome::Done
            }
        };
        batch.clear();
        outcome
    };

    for seed in seeds {
        if should_cancel() {
            return Outcome::Cancelled { tested, elapsed_ms: started.elapsed().as_millis() };
        }

        expand_into(&seed, tier, &mut scratch, &mut seen);
        batch.append(&mut scratch);

        if batch.len() >= BATCH_TARGET {
            match run_batch(&mut batch, &mut tested) {
                BatchOutcome::Found(password) => {
                    return Outcome::Found { password, tested, elapsed_ms: started.elapsed().as_millis() };
                }
                BatchOutcome::Cancelled => {
                    return Outcome::Cancelled { tested, elapsed_ms: started.elapsed().as_millis() };
                }
                BatchOutcome::Done => {}
            }
            let elapsed = started.elapsed();
            on_progress(Progress {
                tested,
                total,
                rate: tested as f64 / elapsed.as_secs_f64().max(1e-6),
                elapsed_ms: elapsed.as_millis(),
            });
            if should_cancel() {
                return Outcome::Cancelled { tested, elapsed_ms: started.elapsed().as_millis() };
            }
        }
    }

    // Dernier lot partiel.
    match run_batch(&mut batch, &mut tested) {
        BatchOutcome::Found(password) => {
            Outcome::Found { password, tested, elapsed_ms: started.elapsed().as_millis() }
        }
        BatchOutcome::Cancelled => {
            Outcome::Cancelled { tested, elapsed_ms: started.elapsed().as_millis() }
        }
        BatchOutcome::Done => Outcome::Exhausted { tested, elapsed_ms: started.elapsed().as_millis() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recovery::verifier::EncryptionParams;

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    // Document réel R4/AES-128, mot de passe utilisateur « topsecret ».
    fn verifier() -> PasswordVerifier {
        PasswordVerifier::new(EncryptionParams {
            revision: 4,
            key_length: 16,
            o: hex("0abf965ec5253fb3dd1361577b6bf5c8957edf62be6129c09ea6653808a9a7b1"),
            u: hex("5d945ae5c176025d0eb16f9b81ee65c400000000000000000000000000000000"),
            p: -3904,
            id0: hex("50fe383d8226bcf3e1881528dbc415b8"),
            encrypt_metadata: true,
        })
    }

    #[test]
    fn finds_a_password_present_in_the_seeds() {
        // « topsecret » n'est pas une graine : il est atteint par la règle
        // « topsecre » + … non. On l'inclut donc directement comme graine
        // parmi d'autres, après plusieurs graines inutiles, pour prouver que la
        // recherche avance sur plusieurs entrées avant de trouver.
        let seeds: Vec<String> = (0..500)
            .map(|i| format!("leurre{i}"))
            .chain(std::iter::once("topsecret".to_string()))
            .collect();

        let outcome = search(seeds.into_iter(), &verifier(), Tier::Quick, 1002, |_| {}, || false);
        match outcome {
            Outcome::Found { password, tested, .. } => {
                assert_eq!(password, "topsecret");
                assert!(tested > 0);
            }
            _ => panic!("le mot de passe aurait dû être trouvé"),
        }
    }

    #[test]
    fn finds_a_password_reached_through_expansion() {
        // La graine seule est déclinée par les règles ; on vérifie que la cible
        // est bien atteinte quand elle figure parmi les variantes produites.
        let seeds = vec!["topsecret".to_string()];
        let outcome = search(seeds.into_iter(), &verifier(), Tier::Full, 40, |_| {}, || false);
        assert!(matches!(outcome, Outcome::Found { .. }));
    }

    #[test]
    fn reports_exhaustion_when_absent() {
        let seeds: Vec<String> = (0..200).map(|i| format!("absent{i}")).collect();
        let outcome = search(seeds.into_iter(), &verifier(), Tier::Quick, 400, |_| {}, || false);
        assert!(matches!(outcome, Outcome::Exhausted { .. }));
    }

    #[test]
    fn stops_when_cancelled() {
        let seeds: Vec<String> = (0..1_000_000).map(|i| format!("word{i}")).collect();
        // Annulation immédiate : la recherche doit s'arrêter très vite.
        let outcome = search(seeds.into_iter(), &verifier(), Tier::Full, 40_000_000, |_| {}, || true);
        match outcome {
            Outcome::Cancelled { tested, .. } => assert!(tested < 1_000_000),
            _ => panic!("la recherche aurait dû être annulée"),
        }
    }

    #[test]
    fn cancels_within_a_batch_not_only_between_batches() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        // Corpus largement supérieur à un lot, mot de passe absent : sans
        // vérification interne au lot, la recherche parcourrait des dizaines de
        // millions de candidats avant de voir l'annulation.
        let seeds: Vec<String> = (0..1_000_000).map(|i| format!("absent{i}")).collect();
        let calls = AtomicUsize::new(0);
        // Bascule à « annulé » après quelques milliers de vérifications, soit
        // bien avant la fin du premier lot (60 000 candidats).
        let should_cancel = || calls.fetch_add(1, Ordering::Relaxed) >= 3_000;

        let outcome = search(seeds.into_iter(), &verifier(), Tier::Full, u64::MAX, |_| {}, should_cancel);

        match outcome {
            Outcome::Cancelled { .. } => {
                // Preuve que le lot a été court-circuité : on n'a pas approché le
                // corpus complet (des dizaines de millions de candidats).
                assert!(
                    calls.load(Ordering::Relaxed) < 200_000,
                    "l'annulation aurait dû court-circuiter le lot ({} appels)",
                    calls.load(Ordering::Relaxed)
                );
            }
            _ => panic!("la recherche aurait dû être annulée en cours de lot"),
        }
    }

    #[test]
    fn a_running_search_stops_on_a_shared_flag_and_the_system_recovers() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        use std::thread;
        use std::time::Duration;

        // Une vraie recherche longue lancée sur un fil, annulée depuis l'extérieur.
        let cancel = Arc::new(AtomicBool::new(false));
        let seeds: Vec<String> = (0..2_000_000).map(|i| format!("absent{i}")).collect();
        let flag = cancel.clone();
        let handle = thread::spawn(move || {
            let verifier = verifier();
            search(
                seeds.into_iter(),
                &verifier,
                Tier::Full,
                u64::MAX,
                |_| {},
                move || flag.load(Ordering::SeqCst),
            )
        });

        thread::sleep(Duration::from_millis(50));
        let asked_at = Instant::now();
        cancel.store(true, Ordering::SeqCst);
        let outcome = handle.join().expect("le fil de recherche se termine");
        let stop_latency = asked_at.elapsed();

        assert!(matches!(outcome, Outcome::Cancelled { .. }), "arrêt attendu");
        // Le corpus (2 M graines × 40 variantes = 80 M candidats) mettrait
        // plusieurs minutes à être parcouru : un arrêt en une poignée de
        // centaines de ms prouve que l'on n'attend pas la fin de la recherche.
        // La cible « < 500 ms » vise le mode release réel (vérificateur ~50× plus
        // rapide qu'en debug) ; ici on borde large pour rester fiable en debug.
        assert!(
            stop_latency < Duration::from_secs(3),
            "arrêt trop lent : {stop_latency:?}"
        );

        // Le système reste fonctionnel : une seconde recherche retrouve un mot
        // de passe atteignable, sans état résiduel de la première.
        let verifier = verifier();
        let outcome2 = search(
            std::iter::once("topsecret".to_string()),
            &verifier,
            Tier::Full,
            40,
            |_| {},
            || false,
        );
        assert!(matches!(outcome2, Outcome::Found { .. }), "relance fonctionnelle");
    }

    #[test]
    fn an_immediate_cancel_is_never_missed() {
        // Course « démarrage → annulation immédiate » : le drapeau est déjà vrai
        // avant le premier lot. La recherche doit rendre « annulé », jamais
        // « épuisé », même si le corpus est petit.
        let seeds: Vec<String> = (0..500_000).map(|i| format!("word{i}")).collect();
        let outcome = search(seeds.into_iter(), &verifier(), Tier::Full, u64::MAX, |_| {}, || true);
        assert!(matches!(outcome, Outcome::Cancelled { .. }));
    }

    #[test]
    fn emits_progress_across_batches() {
        let seeds: Vec<String> = (0..5000).map(|i| format!("word{i}")).collect();
        let mut ticks = 0;
        let _ = search(seeds.into_iter(), &verifier(), Tier::Full, 200_000, |_p| ticks += 1, || false);
        assert!(ticks >= 1, "l'avancement doit être publié au moins une fois");
    }
}
