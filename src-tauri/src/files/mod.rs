//! Socle « Fichiers » : archives, empreintes, doublons, découpage, analyse de
//! dossiers et renommage par lot.
//!
//! Tout ce qui touche au disque vit ici, pour trois raisons :
//!
//! 1. **Volume** — un hachage ou une archive se fait en flux, par blocs. Lire
//!    20 Go en mémoire dans la WebView serait la seule façon de le faire depuis
//!    le frontend, et c'est exactement ce qu'il ne faut pas faire.
//! 2. **Sécurité** — extraire une archive demande de valider chaque chemin
//!    produit (traversée, chemins absolus, liens symboliques). Cette validation
//!    doit être unique, testée, et impossible à contourner depuis l'interface.
//! 3. **Annulation** — une opération longue doit pouvoir être réellement
//!    interrompue, pas seulement ignorée à son retour.

pub mod archive;
pub mod command;
pub mod docx;
pub mod hash;
pub mod rename;
pub mod scan;
pub mod split;

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Registre des opérations annulables, indexées par identifiant de travail.
#[derive(Default)]
pub struct FilesState {
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl FilesState {
    pub fn register(&self, job_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.jobs.lock().unwrap().insert(job_id.to_string(), flag.clone());
        flag
    }

    pub fn release(&self, job_id: &str) {
        self.jobs.lock().unwrap().remove(job_id);
    }

    pub fn cancel(&self, job_id: &str) {
        if let Some(flag) = self.jobs.lock().unwrap().get(job_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

/// Message porté par une opération interrompue par l'utilisateur.
pub const CANCELLED: &str = "cancelled";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub job_id: String,
    /// Avancement de 0 à 1 ; négatif si la quantité totale est inconnue.
    pub ratio: f64,
    /// Étape en cours, affichable telle quelle.
    pub label: String,
    /// Octets ou éléments déjà traités.
    pub done: u64,
    /// Total attendu (0 si inconnu).
    pub total: u64,
}

/// Rapporteur d'avancement : annulation et progression au même endroit.
pub struct Reporter {
    app: Option<AppHandle>,
    job_id: String,
    cancel: Arc<AtomicBool>,
}

impl Reporter {
    pub fn new(app: AppHandle, job_id: String, cancel: Arc<AtomicBool>) -> Self {
        Self { app: Some(app), job_id, cancel }
    }

    /// Rapporteur muet, pour les tests et les appels sans interface.
    pub fn silent() -> Self {
        Self { app: None, job_id: String::new(), cancel: Arc::new(AtomicBool::new(false)) }
    }

    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    /// Renvoie `Err(CANCELLED)` si l'utilisateur a demandé l'arrêt.
    pub fn check(&self) -> Result<(), String> {
        if self.cancelled() {
            Err(CANCELLED.to_string())
        } else {
            Ok(())
        }
    }

    pub fn report(&self, done: u64, total: u64, label: &str) {
        if let Some(app) = &self.app {
            let ratio = if total > 0 { (done as f64 / total as f64).clamp(0.0, 1.0) } else { -1.0 };
            let _ = app.emit(
                "files://progress",
                ProgressEvent {
                    job_id: self.job_id.clone(),
                    ratio,
                    label: label.to_string(),
                    done,
                    total,
                },
            );
        }
    }
}

/* --------------------------------------------------------------- chemins */

/// Un chemin d'archive est-il sûr à extraire ?
///
/// Refuse : chemins absolus, racines Windows (`C:\`), UNC, remontées `..`, et
/// toute composante vide ou anormale. C'est la seule porte d'entrée : aucune
/// extraction ne construit un chemin sans passer par ici.
pub fn safe_relative_path(raw: &str) -> Result<PathBuf, String> {
    if raw.is_empty() {
        return Err("Entrée sans nom dans l'archive.".into());
    }
    // Les archives utilisent `/` ; certaines, produites sous Windows, `\`.
    let normalized = raw.replace('\\', "/");

    if normalized.starts_with('/') || normalized.starts_with("//") {
        return Err(format!("Chemin absolu refusé : {raw}"));
    }
    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        return Err(format!("Chemin absolu refusé : {raw}"));
    }

    let mut out = PathBuf::new();
    for part in normalized.split('/') {
        match part {
            "" | "." => continue,
            ".." => return Err(format!("Remontée de dossier refusée : {raw}")),
            other => {
                if other.contains('\0') {
                    return Err(format!("Nom de fichier invalide : {raw}"));
                }
                out.push(other);
            }
        }
    }
    if out.as_os_str().is_empty() {
        return Err(format!("Chemin vide après normalisation : {raw}"));
    }
    Ok(out)
}

/// Chemin de destination final, garanti à l'intérieur du dossier choisi.
pub fn resolve_inside(destination: &Path, entry: &str) -> Result<PathBuf, String> {
    let relative = safe_relative_path(entry)?;
    let target = destination.join(&relative);

    // Double garde : même après normalisation, le résultat doit rester sous la
    // destination (protège des cas exotiques de composants de chemin).
    let mut probe = PathBuf::new();
    for component in target.components() {
        match component {
            Component::ParentDir => return Err(format!("Chemin non autorisé : {entry}")),
            other => probe.push(other.as_os_str()),
        }
    }
    if !probe.starts_with(destination) {
        return Err(format!("Chemin hors du dossier de destination : {entry}"));
    }
    Ok(probe)
}

/// Nom de fichier libre : ajoute « (2) », « (3) »… plutôt que d'écraser.
pub fn unique_path(candidate: &Path) -> PathBuf {
    if !candidate.exists() {
        return candidate.to_path_buf();
    }
    let parent = candidate.parent().unwrap_or_else(|| Path::new("."));
    let stem = candidate.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let extension = candidate.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    for counter in 2..10_000 {
        let next = parent.join(format!("{stem} ({counter}){extension}"));
        if !next.exists() {
            return next;
        }
    }
    candidate.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_ordinary_relative_paths() {
        assert_eq!(safe_relative_path("a.txt").unwrap(), PathBuf::from("a.txt"));
        assert_eq!(safe_relative_path("nested/b.txt").unwrap(), PathBuf::from("nested/b.txt"));
        assert_eq!(safe_relative_path("./nested/./b.txt").unwrap(), PathBuf::from("nested/b.txt"));
        assert_eq!(safe_relative_path("unicode-é.txt").unwrap(), PathBuf::from("unicode-é.txt"));
    }

    #[test]
    fn refuses_zip_slip() {
        for evil in [
            "../evil.txt",
            "../../evil.txt",
            "a/../../evil.txt",
            "/etc/passwd",
            "//server/share/x",
            "C:\\Windows\\system32\\evil.dll",
            "..\\..\\evil.txt",
        ] {
            assert!(safe_relative_path(evil).is_err(), "accepté à tort : {evil}");
        }
    }

    #[test]
    fn resolves_inside_destination_only() {
        let dest = Path::new("/tmp/fourtout-dest");
        assert_eq!(
            resolve_inside(dest, "docs/a.txt").unwrap(),
            PathBuf::from("/tmp/fourtout-dest/docs/a.txt")
        );
        assert!(resolve_inside(dest, "../a.txt").is_err());
        assert!(resolve_inside(dest, "/etc/passwd").is_err());
    }
}
