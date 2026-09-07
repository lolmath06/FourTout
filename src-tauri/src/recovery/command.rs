//! Pont Tauri de la récupération de mot de passe.
//!
//! Le frontend extrait les paramètres de chiffrement (il dispose déjà de
//! pdf-lib) et lance la recherche via une commande. Celle-ci s'exécute sur un
//! fil dédié pour ne pas bloquer l'interface, publie l'avancement par
//! événements, et s'interrompt sur demande. Rien ne quitte la machine : ni le
//! document, ni les candidats, ni le mot de passe trouvé.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::engine::{search, Outcome, Progress};
use super::rules::Tier;
use super::verifier::{EncryptionParams, PasswordVerifier};
use super::wordlist::{read_meta, read_seeds};

/// Paramètres de chiffrement transmis depuis le frontend (octets en hexa).
///
/// Le contrat de sérialisation est **explicite** : le frontend envoie du
/// camelCase (`keyLength`, `encryptMetadata`), ce que `rename_all` fait
/// correspondre aux champs snake_case de Rust. Sans cela, serde rejetait le
/// payload avec « missing field `key_length` ». Un test verrouille ce contrat.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EncryptionParamsDto {
    pub revision: u8,
    /// Longueur de clé en octets (envoyée sous `keyLength`).
    pub key_length: usize,
    /// /O en hexadécimal.
    pub o: String,
    /// /U en hexadécimal.
    pub u: String,
    pub p: i32,
    /// Premier élément de /ID en hexadécimal.
    pub id0: String,
    /// /EncryptMetadata (envoyé sous `encryptMetadata`).
    pub encrypt_metadata: bool,
}

fn hex_to_bytes(hex: &str) -> Result<Vec<u8>, String> {
    if hex.len() % 2 != 0 {
        return Err("longueur hexadécimale impaire".into());
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).map_err(|_| "hexadécimal invalide".to_string()))
        .collect()
}

impl EncryptionParamsDto {
    fn into_params(self) -> Result<EncryptionParams, String> {
        Ok(EncryptionParams {
            revision: self.revision,
            key_length: self.key_length,
            o: hex_to_bytes(&self.o)?,
            u: hex_to_bytes(&self.u)?,
            p: self.p,
            id0: hex_to_bytes(&self.id0)?,
            encrypt_metadata: self.encrypt_metadata,
        })
    }
}

/// État partagé : drapeau d'annulation de la recherche en cours.
#[derive(Default)]
pub struct RecoveryState {
    cancel: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
}

/// Événement d'avancement.
#[derive(Clone, Serialize)]
struct ProgressEvent {
    tested: u64,
    total: u64,
    rate: f64,
    elapsed_ms: u128,
}

/// Événement de fin.
#[derive(Clone, Serialize)]
struct DoneEvent {
    status: String,
    password: Option<String>,
    tested: u64,
    elapsed_ms: u128,
    message: Option<String>,
}

/// Localise le corpus, en couvrant l'application empaquetée et le mode dev.
fn resolve_wordlist(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // Application empaquetée : dossier des ressources.
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("resources/wordlists/seeds.txt.gz"));
        candidates.push(dir.join("wordlists/seeds.txt.gz"));
    }
    // Développement (`tauri dev`) : dossier du projet.
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/wordlists/seeds.txt.gz"));

    for gz in candidates {
        if gz.exists() {
            let meta = gz.with_file_name("seeds.meta");
            return Ok((gz, meta));
        }
    }
    Err("Corpus de mots de passe introuvable dans l'application.".into())
}

/// Total prévisionnel de candidats pour un niveau donné.
fn estimate_total(seed_count: u64, tier: Tier) -> u64 {
    let seeds = match tier.seed_limit() {
        Some(limit) => seed_count.min(limit as u64),
        None => seed_count,
    };
    seeds * tier.variant_budget() as u64
}

/// Démarre une recherche. Renvoie immédiatement ; les résultats arrivent par
/// les événements `recovery://progress` et `recovery://done`.
#[tauri::command]
pub fn recover_password(
    app: AppHandle,
    state: tauri::State<'_, RecoveryState>,
    params: EncryptionParamsDto,
    tier: String,
) -> Result<u64, String> {
    // Une seule recherche à la fois : `swap` renvoie l'état précédent.
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("Une recherche est déjà en cours.".into());
    }

    // Préparation faillible : toute erreur ici doit relâcher le drapeau, sinon
    // le verrou resterait bloqué et empêcherait toute recherche ultérieure.
    let prepared = (|| {
        let tier = Tier::parse(&tier).ok_or_else(|| "Niveau de recherche inconnu.".to_string())?;
        let verifier = PasswordVerifier::new(params.into_params()?);
        let (gz_path, meta_path) = resolve_wordlist(&app)?;
        let seed_count = read_meta(&meta_path).map(|m| m.seed_count).unwrap_or(0);
        let total = estimate_total(seed_count, tier);
        Ok::<_, String>((tier, verifier, gz_path, total))
    })();

    let (tier, verifier, gz_path, total) = match prepared {
        Ok(value) => value,
        Err(error) => {
            state.running.store(false, Ordering::SeqCst);
            return Err(error);
        }
    };

    state.cancel.store(false, Ordering::SeqCst);
    let cancel = state.cancel.clone();
    let running = state.running.clone();

    std::thread::spawn(move || {
        let seeds = match read_seeds(&gz_path, tier.seed_limit()) {
            Ok(iter) => iter,
            Err(err) => {
                running.store(false, Ordering::SeqCst);
                let _ = app.emit(
                    "recovery://done",
                    DoneEvent {
                        status: "error".into(),
                        password: None,
                        tested: 0,
                        elapsed_ms: 0,
                        message: Some(format!("Lecture du corpus impossible : {err}")),
                    },
                );
                return;
            }
        };

        let app_progress = app.clone();
        let outcome = search(
            seeds,
            &verifier,
            tier,
            total,
            |p: Progress| {
                let _ = app_progress.emit(
                    "recovery://progress",
                    ProgressEvent {
                        tested: p.tested,
                        total: p.total,
                        rate: p.rate,
                        elapsed_ms: p.elapsed_ms,
                    },
                );
            },
            || cancel.load(Ordering::SeqCst),
        );

        running.store(false, Ordering::SeqCst);
        let done = match outcome {
            Outcome::Found { password, tested, elapsed_ms } => DoneEvent {
                status: "found".into(),
                password: Some(password),
                tested,
                elapsed_ms,
                message: None,
            },
            Outcome::Exhausted { tested, elapsed_ms } => DoneEvent {
                status: "exhausted".into(),
                password: None,
                tested,
                elapsed_ms,
                message: None,
            },
            Outcome::Cancelled { tested, elapsed_ms } => DoneEvent {
                status: "cancelled".into(),
                password: None,
                tested,
                elapsed_ms,
                message: None,
            },
        };
        let _ = app.emit("recovery://done", done);
    });

    Ok(total)
}

/// Demande l'arrêt de la recherche en cours.
#[tauri::command]
pub fn recover_cancel(state: tauri::State<'_, RecoveryState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_round_trips() {
        assert_eq!(hex_to_bytes("00ff10").unwrap(), vec![0x00, 0xff, 0x10]);
        assert!(hex_to_bytes("abc").is_err());
        assert!(hex_to_bytes("zz").is_err());
    }

    /// Contrat de sérialisation IPC : le JSON exact produit par le frontend
    /// (camelCase) doit se désérialiser dans le DTO Rust. Reproduit la panne
    /// « missing field `key_length` » si le `rename_all` disparaît.
    #[test]
    fn deserializes_the_exact_frontend_payload() {
        let payload = r#"{
            "revision": 4,
            "keyLength": 16,
            "o": "0abf965e",
            "u": "5d945ae5",
            "p": -3904,
            "id0": "50fe383d",
            "encryptMetadata": true
        }"#;

        let dto: EncryptionParamsDto = serde_json::from_str(payload).expect("payload frontend accepté");
        assert_eq!(dto.revision, 4);
        assert_eq!(dto.key_length, 16);
        assert_eq!(dto.p, -3904);
        assert!(dto.encrypt_metadata);
        let params = dto.into_params().expect("conversion en octets");
        assert_eq!(params.o, vec![0x0a, 0xbf, 0x96, 0x5e]);
        assert_eq!(params.id0, vec![0x50, 0xfe, 0x38, 0x3d]);
    }

    /// Le snake_case (ancien contrat) doit désormais être refusé : preuve que
    /// le contrat est bien le camelCase et non un hasard.
    #[test]
    fn rejects_snake_case_payload() {
        let payload = r#"{"revision":4,"key_length":16,"o":"00","u":"00","p":0,"id0":"00","encrypt_metadata":true}"#;
        assert!(serde_json::from_str::<EncryptionParamsDto>(payload).is_err());
    }

    #[test]
    fn estimates_totals_per_tier() {
        assert_eq!(estimate_total(400_000, Tier::Quick), 30_000 * 2);
        assert_eq!(estimate_total(400_000, Tier::Extended), 400_000 * 4);
        assert_eq!(estimate_total(400_000, Tier::Full), 400_000 * 40);
        // Corpus plus petit que la limite « rapide ».
        assert_eq!(estimate_total(10_000, Tier::Quick), 10_000 * 2);
    }
}
