//! Comparaison de deux arborescences.
//!
//! Deux modes, et la différence entre eux est une question d'honnêteté plus que
//! de vitesse :
//!
//! - **Rapide** compare le type et la taille. Deux fichiers de même taille y
//!   sont déclarés « probablement identiques » — et l'interface dit
//!   « probablement », parce que rien n'a été lu.
//! - **Fiable** relit le contenu des seuls fichiers de même taille et conclut
//!   par empreinte. Une taille différente suffit à conclure sans rien lire :
//!   aucune empreinte n'est jamais calculée inutilement.
//!
//! Les dates ne décident jamais rien : elles sont rapportées comme indice, pas
//! utilisées comme preuve. Un `cp` sans `-p` change la date sans changer un
//! octet, et une restauration d'archive fait l'inverse.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::hash::sha256_file;
use super::walk::{self, match_key, WalkEntry, WalkOptions};
use super::Reporter;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CompareMode {
    /// Type et taille seulement : aucun octet n'est lu.
    #[default]
    Quick,
    /// Empreinte du contenu pour les candidats de même taille.
    Reliable,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareRequest {
    pub left: String,
    pub right: String,
    #[serde(default)]
    pub mode: CompareMode,
    #[serde(default)]
    pub walk: WalkOptions,
}

/// Verdict porté sur une entrée logique (un chemin relatif).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EntryStatus {
    /// Présente des deux côtés, contenu réputé identique.
    Same,
    /// Présente des deux côtés, contenu différent.
    Different,
    /// Uniquement à gauche.
    LeftOnly,
    /// Uniquement à droite.
    RightOnly,
    /// Même chemin, mais fichier d'un côté et dossier de l'autre.
    TypeConflict,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareEntry {
    pub relative: String,
    pub status: EntryStatus,
    pub is_dir: bool,
    pub left_size: Option<u64>,
    pub right_size: Option<u64>,
    pub left_modified: Option<u64>,
    pub right_modified: Option<u64>,
    /// Ce qui a emporté la décision, affichable tel quel.
    pub reason: String,
    /// Le contenu a-t-il réellement été lu pour conclure ?
    pub content_checked: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareReport {
    pub left: String,
    pub right: String,
    pub mode: CompareMode,
    pub entries: Vec<CompareEntry>,
    pub same: usize,
    pub different: usize,
    pub left_only: usize,
    pub right_only: usize,
    pub type_conflicts: usize,
    /// Octets lus pour départager les candidats (0 en mode rapide).
    pub hashed_bytes: u64,
    pub left_notes: walk::WalkNotes,
    pub right_notes: walk::WalkNotes,
    /// Chemins qui ne diffèrent que par la casse : ambigus entre plateformes.
    pub case_collisions: Vec<String>,
}

/// Arborescence indexée par clé de rapprochement, avec ses avertissements et
/// les collisions de casse rencontrées.
type Index = (BTreeMap<String, WalkEntry>, walk::WalkNotes, Vec<String>);

fn index(
    root: &Path,
    options: &WalkOptions,
    reporter: &Reporter,
    label: &str,
) -> Result<Index, String> {
    let mut map: BTreeMap<String, WalkEntry> = BTreeMap::new();
    let mut collisions = Vec::new();
    let mut seen = 0_usize;
    let notes = walk::walk(root, options, reporter, |entry| {
        seen += 1;
        if seen % 200 == 0 {
            reporter.report(seen as u64, 0, &format!("{label} : {seen} entrées"));
        }
        let key = match_key(&entry.relative);
        if let Some(previous) = map.insert(key, entry.clone()) {
            if previous.relative != entry.relative {
                collisions.push(format!("{} / {}", previous.relative, entry.relative));
            }
        }
        Ok(())
    })?;
    Ok((map, notes, collisions))
}

/// Compare deux dossiers et renvoie le verdict entrée par entrée.
pub fn compare(request: &CompareRequest, reporter: &Reporter) -> Result<CompareReport, String> {
    let left_root = Path::new(&request.left);
    let right_root = Path::new(&request.right);
    if left_root == right_root {
        return Err("Les deux dossiers sont le même : il n'y a rien à comparer.".into());
    }

    let (left, left_notes, mut collisions) =
        index(left_root, &request.walk, reporter, "Dossier de gauche")?;
    let (right, right_notes, right_collisions) =
        index(right_root, &request.walk, reporter, "Dossier de droite")?;
    collisions.extend(right_collisions);

    // Les candidats à départager : mêmes chemin, tous deux fichiers, même
    // taille. Eux seuls justifient de lire des octets.
    let mut keys: Vec<&String> = left.keys().chain(right.keys()).collect();
    keys.sort();
    keys.dedup();

    let total = keys.len() as u64;
    let mut entries = Vec::with_capacity(keys.len());
    let mut hashed_bytes = 0_u64;

    for (position, key) in keys.iter().enumerate() {
        reporter.check()?;
        let a = left.get(*key);
        let b = right.get(*key);
        reporter.report(position as u64, total, "Comparaison…");

        let entry = match (a, b) {
            (Some(a), None) => CompareEntry {
                relative: a.relative.clone(),
                status: EntryStatus::LeftOnly,
                is_dir: a.is_dir,
                left_size: Some(a.size),
                right_size: None,
                left_modified: Some(a.modified),
                right_modified: None,
                reason: "Présent uniquement à gauche.".into(),
                content_checked: false,
            },
            (None, Some(b)) => CompareEntry {
                relative: b.relative.clone(),
                status: EntryStatus::RightOnly,
                is_dir: b.is_dir,
                left_size: None,
                right_size: Some(b.size),
                left_modified: None,
                right_modified: Some(b.modified),
                reason: "Présent uniquement à droite.".into(),
                content_checked: false,
            },
            (Some(a), Some(b)) => {
                if a.is_dir != b.is_dir {
                    CompareEntry {
                        relative: a.relative.clone(),
                        status: EntryStatus::TypeConflict,
                        is_dir: a.is_dir,
                        left_size: Some(a.size),
                        right_size: Some(b.size),
                        left_modified: Some(a.modified),
                        right_modified: Some(b.modified),
                        reason: if a.is_dir {
                            "Dossier à gauche, fichier à droite.".into()
                        } else {
                            "Fichier à gauche, dossier à droite.".into()
                        },
                        content_checked: false,
                    }
                } else if a.is_dir {
                    CompareEntry {
                        relative: a.relative.clone(),
                        status: EntryStatus::Same,
                        is_dir: true,
                        left_size: None,
                        right_size: None,
                        left_modified: Some(a.modified),
                        right_modified: Some(b.modified),
                        reason: "Dossier présent des deux côtés.".into(),
                        content_checked: false,
                    }
                } else if a.size != b.size {
                    CompareEntry {
                        relative: a.relative.clone(),
                        status: EntryStatus::Different,
                        is_dir: false,
                        left_size: Some(a.size),
                        right_size: Some(b.size),
                        left_modified: Some(a.modified),
                        right_modified: Some(b.modified),
                        reason: "Tailles différentes — aucune lecture nécessaire.".into(),
                        content_checked: false,
                    }
                } else if request.mode == CompareMode::Reliable {
                    let digest_a = sha256_file(Path::new(&a.path))?;
                    let digest_b = sha256_file(Path::new(&b.path))?;
                    hashed_bytes += a.size * 2;
                    let identical = digest_a == digest_b;
                    CompareEntry {
                        relative: a.relative.clone(),
                        status: if identical {
                            EntryStatus::Same
                        } else {
                            EntryStatus::Different
                        },
                        is_dir: false,
                        left_size: Some(a.size),
                        right_size: Some(b.size),
                        left_modified: Some(a.modified),
                        right_modified: Some(b.modified),
                        reason: if identical {
                            "Contenu confirmé identique (SHA-256).".into()
                        } else {
                            "Même taille, contenu différent (SHA-256).".into()
                        },
                        content_checked: true,
                    }
                } else {
                    CompareEntry {
                        relative: a.relative.clone(),
                        status: EntryStatus::Same,
                        is_dir: false,
                        left_size: Some(a.size),
                        right_size: Some(b.size),
                        left_modified: Some(a.modified),
                        right_modified: Some(b.modified),
                        reason: "Même taille — contenu non vérifié en mode rapide.".into(),
                        content_checked: false,
                    }
                }
            }
            (None, None) => unreachable!("une clé vient forcément d'un des deux côtés"),
        };
        entries.push(entry);
    }

    let count = |status: EntryStatus| entries.iter().filter(|e| e.status == status).count();
    Ok(CompareReport {
        left: request.left.clone(),
        right: request.right.clone(),
        mode: request.mode,
        same: count(EntryStatus::Same),
        different: count(EntryStatus::Different),
        left_only: count(EntryStatus::LeftOnly),
        right_only: count(EntryStatus::RightOnly),
        type_conflicts: count(EntryStatus::TypeConflict),
        hashed_bytes,
        left_notes,
        right_notes,
        case_collisions: collisions,
        entries,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("fourtout-compare-tests").join(name);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(root: &Path, relative: &str, content: &[u8]) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        File::create(&path).unwrap().write_all(content).unwrap();
    }

    fn pair(name: &str) -> (PathBuf, PathBuf) {
        let left = scratch(&format!("{name}-left"));
        let right = scratch(&format!("{name}-right"));
        write(&left, "same.txt", b"identique");
        write(&right, "same.txt", b"identique");
        // Même taille, contenu différent : le piège que le mode rapide rate.
        write(&left, "changed.txt", b"AAAAAAAA");
        write(&right, "changed.txt", b"BBBBBBBB");
        // Taille différente : conclu sans lire.
        write(&left, "nested/resized.bin", b"12345");
        write(&right, "nested/resized.bin", b"1234567890");
        write(&left, "only-left.txt", b"gauche");
        write(&right, "only-right.txt", b"droite");
        (left, right)
    }

    fn request(left: &Path, right: &Path, mode: CompareMode) -> CompareRequest {
        CompareRequest {
            left: left.to_string_lossy().to_string(),
            right: right.to_string_lossy().to_string(),
            mode,
            walk: WalkOptions::default(),
        }
    }

    #[test]
    fn quick_mode_cannot_see_equal_sized_differences() {
        let (left, right) = pair("quick");
        let report =
            compare(&request(&left, &right, CompareMode::Quick), &Reporter::silent()).unwrap();
        assert_eq!(report.left_only, 1);
        assert_eq!(report.right_only, 1);
        assert_eq!(report.hashed_bytes, 0);
        let changed = report.entries.iter().find(|e| e.relative == "changed.txt").unwrap();
        assert_eq!(changed.status, EntryStatus::Same);
        assert!(!changed.content_checked);
        // La taille différente, elle, se voit sans rien lire.
        let resized =
            report.entries.iter().find(|e| e.relative == "nested/resized.bin").unwrap();
        assert_eq!(resized.status, EntryStatus::Different);
    }

    #[test]
    fn reliable_mode_confirms_equality_by_content() {
        let (left, right) = pair("reliable");
        let report =
            compare(&request(&left, &right, CompareMode::Reliable), &Reporter::silent()).unwrap();
        let changed = report.entries.iter().find(|e| e.relative == "changed.txt").unwrap();
        assert_eq!(changed.status, EntryStatus::Different);
        assert!(changed.content_checked);

        let same = report.entries.iter().find(|e| e.relative == "same.txt").unwrap();
        assert_eq!(same.status, EntryStatus::Same);
        assert!(same.content_checked);

        // Seuls les candidats de même taille ont été lus : 9 + 8 octets, deux fois.
        assert_eq!(report.hashed_bytes, (9 + 8) * 2);
        assert_eq!(report.different, 2);
        assert_eq!(report.left_only, 1);
        assert_eq!(report.right_only, 1);
    }

    #[test]
    fn unicode_and_spaces_are_ordinary_entries() {
        let left = scratch("unicode-left");
        let right = scratch("unicode-right");
        write(&left, "dossier accentué/fichier é à ü.txt", b"contenu");
        write(&right, "dossier accentué/fichier é à ü.txt", b"contenu");
        let report =
            compare(&request(&left, &right, CompareMode::Reliable), &Reporter::silent()).unwrap();
        let entry = report
            .entries
            .iter()
            .find(|e| e.relative == "dossier accentué/fichier é à ü.txt")
            .unwrap();
        assert_eq!(entry.status, EntryStatus::Same);
    }

    #[test]
    fn type_conflicts_are_reported_not_hidden() {
        let left = scratch("conflict-left");
        let right = scratch("conflict-right");
        write(&left, "thing", b"c'est un fichier");
        write(&right, "thing/inside.txt", b"c'est un dossier");
        let report =
            compare(&request(&left, &right, CompareMode::Reliable), &Reporter::silent()).unwrap();
        let conflict = report.entries.iter().find(|e| e.relative == "thing").unwrap();
        assert_eq!(conflict.status, EntryStatus::TypeConflict);
        assert_eq!(report.type_conflicts, 1);
    }

    #[test]
    fn comparing_a_folder_with_itself_is_refused() {
        let root = scratch("same-root");
        let request = request(&root, &root, CompareMode::Quick);
        assert!(compare(&request, &Reporter::silent()).is_err());
    }

    #[test]
    fn cancellation_interrupts_the_comparison() {
        let (left, right) = pair("cancel");
        let outcome = compare(
            &request(&left, &right, CompareMode::Reliable),
            &Reporter::silent_cancelled(),
        );
        assert_eq!(outcome.unwrap_err(), super::super::CANCELLED);
    }
}
