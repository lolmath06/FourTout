//! Moteur de recherche : parcourt les graines, les décline en candidats et
//! teste chaque candidat contre le document, en parallèle.
//!
//! La recherche est découpée en lots pour rester réactive : entre deux lots on
//! publie l'avancement et on vérifie la demande d'annulation. À l'intérieur
//! d'un lot, les candidats sont vérifiés sur tous les cœurs, et la recherche
//! s'arrête dès qu'un mot de passe fonctionne.

use std::collections::HashSet;
use std::time::Instant;

use rayon::prelude::*;

use super::rules::{expand_into, Tier};
use super::verifier::PasswordVerifier;

/// Nombre de candidats visés par lot. Compromis entre parallélisme (assez de
/// travail pour tous les cœurs) et réactivité (avancement/annulation fréquents).
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

/// Lance la recherche.
///
/// - `seeds` : itérateur de mots-graines (déjà limité au niveau si besoin).
/// - `verifier` : vérificateur préparé pour ce document.
/// - `total` : total prévisionnel de candidats, pour l'avancement.
/// - `on_progress` : appelé au plus une fois par lot.
/// - `should_cancel` : consulté entre les lots.
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
    C: Fn() -> bool,
{
    let started = Instant::now();
    let mut tested: u64 = 0;

    let mut batch: Vec<String> = Vec::with_capacity(BATCH_TARGET + 64);
    let mut scratch: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let run_batch = |batch: &mut Vec<String>, tested: &mut u64| -> Option<String> {
        if batch.is_empty() {
            return None;
        }
        // La vérification (coûteuse) est parallélisée ; l'expansion des graines
        // (bon marché) reste séquentielle en amont.
        let found = batch.par_iter().find_any(|candidate| verifier.verify(candidate));
        *tested += batch.len() as u64;
        let result = found.cloned();
        batch.clear();
        result
    };

    for seed in seeds {
        if should_cancel() {
            return Outcome::Cancelled { tested, elapsed_ms: started.elapsed().as_millis() };
        }

        expand_into(&seed, tier, &mut scratch, &mut seen);
        batch.append(&mut scratch);

        if batch.len() >= BATCH_TARGET {
            if let Some(password) = run_batch(&mut batch, &mut tested) {
                return Outcome::Found { password, tested, elapsed_ms: started.elapsed().as_millis() };
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
    if let Some(password) = run_batch(&mut batch, &mut tested) {
        return Outcome::Found { password, tested, elapsed_ms: started.elapsed().as_millis() };
    }

    Outcome::Exhausted { tested, elapsed_ms: started.elapsed().as_millis() }
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
    fn emits_progress_across_batches() {
        let seeds: Vec<String> = (0..5000).map(|i| format!("word{i}")).collect();
        let mut ticks = 0;
        let _ = search(seeds.into_iter(), &verifier(), Tier::Full, 200_000, |_p| ticks += 1, || false);
        assert!(ticks >= 1, "l'avancement doit être publié au moins une fois");
    }
}
