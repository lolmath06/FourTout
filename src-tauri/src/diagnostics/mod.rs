//! Diagnostic de fichiers et récupération **prudente**.
//!
//! Trois règles gouvernent tout ce module, et aucune n'est négociable.
//!
//! 1. **La source n'est jamais modifiée.** Une réparation lit un fichier et en
//!    écrit un autre. Il n'existe pas une seule écriture en place ici, et un
//!    test recalcule l'empreinte de chaque fixture avant et après chaque
//!    opération pour s'en assurer.
//! 2. **Rien n'est inventé.** On ne fabrique pas les octets manquants, on ne
//!    recalcule pas une somme de contrôle pour faire passer des données
//!    abîmées pour intactes, et on ne déclare pas un fichier sain au seul motif
//!    qu'un lecteur tolérant accepte de l'ouvrir. Chaque réparation proposée
//!    repose sur une transformation que l'on sait justifier octet par octet.
//! 3. **Réparé, récupéré et perdu sont trois mots différents.** Retirer des
//!    données parasites après la fin d'un fichier le *répare*. Extraire dix-huit
//!    entrées sur vingt-et-une en *récupère* une partie. Réencoder des pixels
//!    décodés produit une image *visuellement* récupérée, pas le fichier
//!    d'origine. L'interface emploie ces mots au sens strict.
//!
//! Le format des résultats est structuré (`Finding`, `Severity`,
//! `Repairability`) : l'interface ne lit jamais une phrase pour décider quoi
//! afficher.

pub mod command;
pub mod generic;
pub mod image;
pub mod pdf;
pub mod zip;

use serde::{Deserialize, Serialize};

/// Gravité d'un constat. Tout n'est pas rouge : une extension trompeuse mérite
/// qu'on la signale, pas qu'on crie à la perte de données.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    /// Constat neutre ou rassurant.
    Info,
    /// Anomalie réelle, sans perte de contenu démontrée.
    Warning,
    /// Perte de structure ou de données.
    Error,
}

/// Ce que FourTout sait faire d'un problème donné.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Repairability {
    /// Aucune correction automatique défendable.
    None,
    /// Correction déterministe, sans perte : on sait exactement ce qui change.
    SafeRepair,
    /// Une partie du contenu peut être extraite ; le reste est perdu.
    RecoverPartial,
    /// Seule l'apparence peut être sauvée (pixels réencodés, pages rasterisées).
    RecoverVisual,
}

/// Un constat de diagnostic.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub severity: Severity,
    /// Identifiant stable, pour que l'interface et les tests s'y réfèrent sans
    /// dépendre du libellé français.
    pub code: String,
    pub title: String,
    /// Explication complète, affichable telle quelle.
    pub detail: String,
    pub repairability: Repairability,
}

impl Finding {
    pub fn new(
        severity: Severity,
        code: &str,
        title: &str,
        detail: impl Into<String>,
        repairability: Repairability,
    ) -> Self {
        Self {
            severity,
            code: code.to_string(),
            title: title.to_string(),
            detail: detail.into(),
            repairability,
        }
    }

    pub fn info(code: &str, title: &str, detail: impl Into<String>) -> Self {
        Self::new(Severity::Info, code, title, detail, Repairability::None)
    }

    pub fn warning(code: &str, title: &str, detail: impl Into<String>, fix: Repairability) -> Self {
        Self::new(Severity::Warning, code, title, detail, fix)
    }

    pub fn error(code: &str, title: &str, detail: impl Into<String>, fix: Repairability) -> Self {
        Self::new(Severity::Error, code, title, detail, fix)
    }
}

/// Verdict d'ensemble d'un diagnostic.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Health {
    /// Aucune anomalie relevée.
    Healthy,
    /// Anomalies sans perte de contenu démontrée.
    Suspicious,
    /// Structure ou contenu abîmés.
    Damaged,
    /// Rien d'exploitable n'a pu être lu.
    Unreadable,
}

impl Health {
    /// Déduit le verdict des constats : le plus grave l'emporte.
    pub fn from_findings(findings: &[Finding]) -> Self {
        if findings.iter().any(|f| f.severity == Severity::Error) {
            Health::Damaged
        } else if findings.iter().any(|f| f.severity == Severity::Warning) {
            Health::Suspicious
        } else {
            Health::Healthy
        }
    }
}

/// Ce que FourTout propose de faire, une fois le diagnostic posé.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairAction {
    /// Identifiant de l'action, passé tel quel à la commande de réparation.
    pub id: String,
    pub title: String,
    /// Ce que l'action fait, en une phrase.
    pub detail: String,
    /// Ce qui sera perdu ou modifié. Vide quand rien ne l'est.
    pub costs: Vec<String>,
    pub repairability: Repairability,
    /// Extension proposée pour le fichier produit.
    pub output_extension: String,
}

/// Résultat d'un diagnostic, quel que soit le format.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
    pub path: String,
    pub name: String,
    pub size: u64,
    /// Extension du nom, sans point.
    pub extension: String,
    /// Format réellement reconnu à la signature.
    pub detected: String,
    pub detected_label: String,
    /// L'extension correspond-elle au contenu ?
    pub extension_matches: bool,
    pub health: Health,
    pub findings: Vec<Finding>,
    pub actions: Vec<RepairAction>,
    /// Empreinte de la source, avant toute opération.
    pub sha256: String,
    /// Détail propre au format, sérialisé tel quel pour l'interface.
    pub details: serde_json::Value,
}

/// Résultat d'une réparation ou d'une récupération.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairOutcome {
    /// Chemin du fichier (ou dossier) produit.
    pub output: String,
    /// Action réellement appliquée.
    pub action: String,
    pub repairability: Repairability,
    /// Résumé affichable, au sens strict : « réparé », « partiellement
    /// récupéré », jamais « réparation réussie » pour une récupération.
    pub summary: String,
    /// Ce qui a été conservé, mesuré.
    pub kept: Vec<String>,
    /// Ce qui a été perdu, mesuré.
    pub lost: Vec<String>,
    /// Empreinte de la source **après** l'opération : elle doit être inchangée.
    pub source_sha256: String,
    pub output_size: u64,
}

/// Taille au-delà de laquelle on refuse de charger un fichier entier en mémoire.
///
/// Les diagnostics structurels travaillent par fenêtres (tête, queue, balayage
/// séquentiel) ; seules les opérations qui en ont besoin lisent tout, et elles
/// s'arrêtent ici plutôt que de faire tomber l'application.
pub const MAX_IN_MEMORY: u64 = 512 * 1024 * 1024;

/// Nombre d'octets lus en queue de fichier pour chercher une fin de structure.
pub const TAIL_BYTES: usize = 64 * 1024;

/// Lit un fichier entier, en refusant au-delà de [`MAX_IN_MEMORY`].
pub fn read_all(path: &std::path::Path) -> Result<Vec<u8>, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("Fichier illisible : {e}"))?;
    if meta.len() > MAX_IN_MEMORY {
        return Err(format!(
            "Fichier de {} octets : au-delà de {} octets, FourTout refuse de le charger \
             entièrement en mémoire plutôt que de faire tomber l'application.",
            meta.len(),
            MAX_IN_MEMORY
        ));
    }
    std::fs::read(path).map_err(|e| format!("Lecture impossible : {e}"))
}

/// Empreinte SHA-256 d'un fichier, calculée en flux.
pub fn sha256_of(path: &std::path::Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let mut file = std::fs::File::open(path).map_err(|e| format!("Lecture impossible : {e}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 256 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|e| format!("Lecture impossible : {e}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Construit un chemin de sortie à côté de la source, sans jamais l'écraser.
///
/// `photo.jpg` + `recuperee` + `png` → `photo-recuperee.png`, puis
/// `photo-recuperee-2.png` si le premier existe déjà. Écraser un fichier
/// existant serait la seule façon pour un outil de réparation de détruire des
/// données — il ne le fera pas.
pub fn output_path(source: &std::path::Path, suffix: &str, extension: &str) -> std::path::PathBuf {
    let directory = source.parent().unwrap_or_else(|| std::path::Path::new("."));
    let stem = source.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();

    let mut candidate = directory.join(if extension.is_empty() {
        format!("{stem}-{suffix}")
    } else {
        format!("{stem}-{suffix}.{extension}")
    });
    let mut index = 2;
    while candidate.exists() {
        candidate = directory.join(if extension.is_empty() {
            format!("{stem}-{suffix}-{index}")
        } else {
            format!("{stem}-{suffix}-{index}.{extension}")
        });
        index += 1;
        if index > 999 {
            break;
        }
    }
    candidate
}

/// Cherche un motif dans un tampon, de la fin vers le début.
pub fn rfind(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    (0..=haystack.len() - needle.len()).rev().find(|&start| &haystack[start..start + needle.len()] == needle)
}

/// Cherche un motif dans un tampon, du début vers la fin.
pub fn find_from(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() || from >= haystack.len() {
        return None;
    }
    (from..=haystack.len() - needle.len()).find(|&start| &haystack[start..start + needle.len()] == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_worst_finding_decides_the_verdict() {
        let info = Finding::info("x", "x", "x");
        let warning = Finding::warning("x", "x", "x", Repairability::SafeRepair);
        let error = Finding::error("x", "x", "x", Repairability::RecoverPartial);

        assert_eq!(Health::from_findings(&[]), Health::Healthy);
        assert_eq!(Health::from_findings(std::slice::from_ref(&info)), Health::Healthy);
        assert_eq!(Health::from_findings(&[info.clone(), warning.clone()]), Health::Suspicious);
        assert_eq!(Health::from_findings(&[warning, error]), Health::Damaged);
    }

    #[test]
    fn finds_patterns_from_both_ends() {
        let data = b"aaXXbbXXcc";
        assert_eq!(find_from(data, b"XX", 0), Some(2));
        assert_eq!(find_from(data, b"XX", 3), Some(6));
        assert_eq!(rfind(data, b"XX"), Some(6));
        assert_eq!(rfind(data, b"ZZ"), None);
        assert_eq!(find_from(data, b"", 0), None);
    }

    #[test]
    fn never_proposes_an_output_that_would_erase_something() {
        let dir = std::env::temp_dir().join("fourtout-diag-output");
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join("photo.jpg");
        std::fs::write(&source, b"x").unwrap();

        let first = output_path(&source, "recuperee", "png");
        assert_eq!(first.file_name().unwrap(), "photo-recuperee.png");

        std::fs::write(&first, b"x").unwrap();
        let second = output_path(&source, "recuperee", "png");
        assert_eq!(second.file_name().unwrap(), "photo-recuperee-2.png");

        std::fs::remove_dir_all(&dir).ok();
    }
}
