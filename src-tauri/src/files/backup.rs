//! Sauvegarde et restauration d'un dossier.
//!
//! Le format est volontairement **transparent**, pas propriétaire :
//!
//! ```text
//! ma-sauvegarde/
//!   donnees/            ← copie fidèle de l'arborescence, lisible sans FourTout
//!   manifeste.json      ← inventaire, tailles, dates et SHA-256
//! ```
//!
//! Ce choix a un coût — la sauvegarde occupe autant que la source — et une
//! contrepartie qui le vaut largement : si FourTout disparaît demain, les
//! fichiers restent accessibles avec un explorateur de fichiers. Aucun
//! conteneur à rétro-ingénierer, aucune base d'index à réparer.
//!
//! Ce n'est **pas** un système de versions. Pas d'instantanés incrémentaux, pas
//! de déduplication par blocs, pas d'historique : une sauvegarde est une photo
//! complète, datée, vérifiable. Ce qu'elle promet, elle le tient entièrement.

use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::walk::{self, WalkOptions};
use super::{resolve_inside, Reporter};

/// Nom du sous-dossier contenant la copie des fichiers.
pub const DATA_DIRECTORY: &str = "donnees";
/// Nom du manifeste, à la racine de la sauvegarde.
pub const MANIFEST_NAME: &str = "manifeste.json";
/// Marque de format, pour refuser proprement un dossier qui n'en est pas une.
pub const FORMAT: &str = "fourtout-backup";
pub const FORMAT_VERSION: u32 = 1;

const CHUNK: usize = 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    /// Chemin relatif à la racine sauvegardée, séparateurs `/`.
    pub path: String,
    /// `"file"` ou `"directory"`.
    pub kind: String,
    pub size: u64,
    /// Date de modification de la source, en millisecondes.
    pub modified: u64,
    /// SHA-256 du contenu ; vide pour un dossier.
    #[serde(default)]
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: String,
    pub version: u32,
    /// Date de la sauvegarde, en millisecondes depuis l'époque Unix.
    pub created_at: u64,
    /// Nom du dossier d'origine. Aucun chemin absolu : une sauvegarde faite
    /// sous `C:\Users\…` se restaure sous `/home/…` sans rien réécrire.
    pub source_name: String,
    pub entries: Vec<BackupEntry>,
    pub files: usize,
    pub directories: usize,
    pub bytes: u64,
    /// Ce que la sauvegarde n'a pas pu inclure, dit plutôt que tu.
    pub warnings: Vec<String>,
}

impl Manifest {
    pub fn files_only(&self) -> impl Iterator<Item = &BackupEntry> {
        self.entries.iter().filter(|entry| entry.kind == "file")
    }
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Copie un fichier en calculant son empreinte **au passage**.
///
/// Lire le fichier deux fois — une pour copier, une pour hacher — doublerait le
/// temps d'une sauvegarde sans rien apporter.
fn copy_hashing(source: &Path, target: &Path, reporter: &Reporter) -> Result<String, String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{} : {e}", parent.display()))?;
    }
    let temporary = target.with_file_name(format!(
        ".fourtout-backup-{}",
        target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
    ));
    let _ = fs::remove_file(&temporary);

    let outcome = (|| -> Result<String, String> {
        let mut input = BufReader::with_capacity(
            CHUNK,
            File::open(source).map_err(|e| format!("{} : {e}", source.display()))?,
        );
        let mut output = BufWriter::new(
            File::create(&temporary).map_err(|e| format!("{} : {e}", temporary.display()))?,
        );
        let mut hasher = Sha256::new();
        let mut buffer = vec![0_u8; CHUNK];
        loop {
            reporter.check()?;
            let read = input.read(&mut buffer).map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
            output.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
        }
        output.flush().map_err(|e| e.to_string())?;
        output.into_inner().map_err(|e| e.to_string())?.sync_all().map_err(|e| e.to_string())?;
        Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
    })();

    match outcome {
        Ok(digest) => {
            fs::rename(&temporary, target).map_err(|error| {
                let _ = fs::remove_file(&temporary);
                format!("{} : {error}", target.display())
            })?;
            Ok(digest)
        }
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            Err(error)
        }
    }
}

fn sha256_of(path: &Path, reporter: &Reporter) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| format!("{} : {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; CHUNK];
    loop {
        reporter.check()?;
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

/* ---------------------------------------------------------- sauvegarde */

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRequest {
    pub source: String,
    /// Dossier **vide ou inexistant** qui recevra la sauvegarde.
    pub destination: String,
    #[serde(default)]
    pub walk: WalkOptions,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub destination: String,
    pub manifest_path: String,
    pub files: usize,
    pub directories: usize,
    pub bytes: u64,
    pub warnings: Vec<String>,
    /// Fichiers que la sauvegarde n'a pas pu copier.
    pub failed: Vec<String>,
    pub interrupted: bool,
}

impl BackupSummary {
    pub fn complete(&self) -> bool {
        !self.interrupted && self.failed.is_empty()
    }
}

/// Crée une sauvegarde complète d'un dossier.
pub fn create(request: &BackupRequest, reporter: &Reporter) -> Result<BackupSummary, String> {
    let source = Path::new(&request.source);
    let destination = Path::new(&request.destination);
    if !source.is_dir() {
        return Err(format!("Dossier source introuvable : {}", request.source));
    }
    let canonical_source = fs::canonicalize(source).unwrap_or_else(|_| source.to_path_buf());
    if destination.exists() {
        let canonical_destination =
            fs::canonicalize(destination).unwrap_or_else(|_| destination.to_path_buf());
        if canonical_destination.starts_with(&canonical_source) {
            return Err(
                "La sauvegarde ne peut pas être écrite à l'intérieur du dossier sauvegardé."
                    .into(),
            );
        }
        // Refuser un dossier déjà occupé évite d'écraser une sauvegarde
        // précédente — ou pire, le dossier personnel de l'utilisateur.
        let occupied = fs::read_dir(destination)
            .map(|entries| entries.flatten().next().is_some())
            .unwrap_or(false);
        let already_backup = destination.join(MANIFEST_NAME).exists();
        if occupied && !already_backup {
            return Err(format!(
                "Le dossier de destination n'est pas vide et ne contient pas de sauvegarde FourTout : {}",
                destination.display()
            ));
        }
    }

    let data_root = destination.join(DATA_DIRECTORY);
    fs::create_dir_all(&data_root).map_err(|e| format!("{} : {e}", data_root.display()))?;

    let (entries, notes) = walk::collect(source, &request.walk, reporter)?;
    let total_bytes: u64 = entries.iter().filter(|e| !e.is_dir).map(|e| e.size).sum();
    let total = entries.len() as u64;

    let mut manifest_entries = Vec::with_capacity(entries.len());
    let mut failed = Vec::new();
    let mut copied_bytes = 0_u64;
    let mut files = 0_usize;
    let mut directories = 0_usize;
    let mut interrupted = false;

    for (position, entry) in entries.iter().enumerate() {
        if reporter.cancelled() {
            interrupted = true;
            break;
        }
        reporter.report(
            copied_bytes,
            total_bytes,
            &format!("{} / {} — {}", position + 1, total, entry.relative),
        );
        let target = resolve_inside(&data_root, &entry.relative)?;

        if entry.is_dir {
            match fs::create_dir_all(&target) {
                Ok(()) => {
                    directories += 1;
                    manifest_entries.push(BackupEntry {
                        path: entry.relative.clone(),
                        kind: "directory".into(),
                        size: 0,
                        modified: entry.modified,
                        sha256: String::new(),
                    });
                }
                Err(error) => failed.push(format!("{} — {error}", entry.relative)),
            }
            continue;
        }

        match copy_hashing(Path::new(&entry.path), &target, reporter) {
            Ok(digest) => {
                files += 1;
                copied_bytes += entry.size;
                manifest_entries.push(BackupEntry {
                    path: entry.relative.clone(),
                    kind: "file".into(),
                    size: entry.size,
                    modified: entry.modified,
                    sha256: digest,
                });
            }
            Err(error) if error == super::CANCELLED => {
                interrupted = true;
                break;
            }
            Err(error) => failed.push(format!("{} — {error}", entry.relative)),
        }
    }

    let mut warnings = notes.unreadable.clone();
    if !notes.symlinks.is_empty() {
        warnings.push(format!(
            "{} lien(s) symbolique(s) non suivis : leur cible n'est pas sauvegardée.",
            notes.symlinks.len()
        ));
    }
    if interrupted {
        warnings.push(
            "Sauvegarde interrompue : le manifeste ne décrit que les fichiers réellement copiés."
                .into(),
        );
    }

    let manifest = Manifest {
        format: FORMAT.into(),
        version: FORMAT_VERSION,
        created_at: now_millis(),
        source_name: source
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "sauvegarde".into()),
        files,
        directories,
        bytes: copied_bytes,
        warnings: warnings.clone(),
        entries: manifest_entries,
    };
    let manifest_path = destination.join(MANIFEST_NAME);
    fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("{} : {e}", manifest_path.display()))?;

    Ok(BackupSummary {
        destination: destination.to_string_lossy().to_string(),
        manifest_path: manifest_path.to_string_lossy().to_string(),
        files,
        directories,
        bytes: copied_bytes,
        warnings,
        failed,
        interrupted,
    })
}

/// Lit et valide le manifeste d'une sauvegarde.
pub fn read_manifest(backup_root: &Path) -> Result<Manifest, String> {
    let path = backup_root.join(MANIFEST_NAME);
    let content = fs::read_to_string(&path).map_err(|_| {
        format!(
            "Ce dossier ne contient pas de sauvegarde FourTout : aucun « {MANIFEST_NAME} » à la racine de {}.",
            backup_root.display()
        )
    })?;
    let manifest: Manifest = serde_json::from_str(&content)
        .map_err(|e| format!("Manifeste de sauvegarde illisible : {e}"))?;
    if manifest.format != FORMAT {
        return Err(format!(
            "Ce manifeste n'est pas celui d'une sauvegarde FourTout (« {} »).",
            manifest.format
        ));
    }
    if manifest.version > FORMAT_VERSION {
        return Err(format!(
            "Cette sauvegarde a été créée par une version plus récente de FourTout (format {}).",
            manifest.version
        ));
    }
    Ok(manifest)
}

/* ----------------------------------------------------------- intégrité */

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EntryState {
    Ok,
    Missing,
    Modified,
    Unreadable,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryCheck {
    pub path: String,
    pub state: EntryState,
    pub expected: String,
    pub actual: Option<String>,
    pub size: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyReport {
    pub backup: String,
    pub created_at: u64,
    pub source_name: String,
    pub checks: Vec<EntryCheck>,
    pub ok: usize,
    pub missing: usize,
    pub modified: usize,
    pub unreadable: usize,
    /// Fichiers présents dans la copie mais absents du manifeste.
    pub unexpected: Vec<String>,
    pub bytes: u64,
}

impl VerifyReport {
    pub fn intact(&self) -> bool {
        self.missing == 0 && self.modified == 0 && self.unreadable == 0
    }
}

/// Vérifie qu'une sauvegarde est encore fidèle à son manifeste.
pub fn verify(backup_root: &Path, reporter: &Reporter) -> Result<VerifyReport, String> {
    let manifest = read_manifest(backup_root)?;
    let data_root = backup_root.join(DATA_DIRECTORY);
    let expected: Vec<&BackupEntry> = manifest.files_only().collect();
    let total = expected.len() as u64;

    let mut checks = Vec::with_capacity(expected.len());
    let mut bytes = 0_u64;

    for (position, entry) in expected.iter().enumerate() {
        reporter.check()?;
        reporter.report(position as u64, total, &entry.path);
        let target = resolve_inside(&data_root, &entry.path)?;
        if !target.is_file() {
            checks.push(EntryCheck {
                path: entry.path.clone(),
                state: EntryState::Missing,
                expected: entry.sha256.clone(),
                actual: None,
                size: entry.size,
            });
            continue;
        }
        match sha256_of(&target, reporter) {
            Ok(digest) => {
                bytes += fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
                let intact = digest == entry.sha256;
                checks.push(EntryCheck {
                    path: entry.path.clone(),
                    state: if intact { EntryState::Ok } else { EntryState::Modified },
                    expected: entry.sha256.clone(),
                    actual: Some(digest),
                    size: entry.size,
                });
            }
            Err(error) if error == super::CANCELLED => return Err(error),
            Err(_) => checks.push(EntryCheck {
                path: entry.path.clone(),
                state: EntryState::Unreadable,
                expected: entry.sha256.clone(),
                actual: None,
                size: entry.size,
            }),
        }
    }

    // Un fichier présent dans la copie mais absent du manifeste n'est pas une
    // corruption, mais l'utilisateur a le droit de le savoir.
    let mut unexpected = Vec::new();
    if data_root.is_dir() {
        let known: std::collections::HashSet<&str> =
            manifest.files_only().map(|entry| entry.path.as_str()).collect();
        let (present, _) =
            walk::collect(&data_root, &WalkOptions::default(), reporter)?;
        for entry in present.iter().filter(|entry| !entry.is_dir) {
            if !known.contains(entry.relative.as_str()) {
                unexpected.push(entry.relative.clone());
            }
        }
    }

    let count = |state: EntryState| checks.iter().filter(|c| c.state == state).count();
    Ok(VerifyReport {
        backup: backup_root.to_string_lossy().to_string(),
        created_at: manifest.created_at,
        source_name: manifest.source_name.clone(),
        ok: count(EntryState::Ok),
        missing: count(EntryState::Missing),
        modified: count(EntryState::Modified),
        unreadable: count(EntryState::Unreadable),
        unexpected,
        bytes,
        checks,
    })
}

/* --------------------------------------------------------- restauration */

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RestoreMode {
    /// Les fichiers déjà présents dans la destination sont conservés.
    #[default]
    Skip,
    /// Les fichiers déjà présents sont remplacés par ceux de la sauvegarde.
    Overwrite,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePreview {
    pub backup: String,
    pub source_name: String,
    pub created_at: u64,
    pub files: usize,
    pub directories: usize,
    pub bytes: u64,
    /// Fichiers de la sauvegarde qui existent déjà dans la destination.
    pub collisions: Vec<String>,
    pub warnings: Vec<String>,
}

/// Décrit ce qu'une restauration ferait, sans rien écrire.
pub fn preview(
    backup_root: &Path,
    destination: &Path,
    reporter: &Reporter,
) -> Result<RestorePreview, String> {
    let manifest = read_manifest(backup_root)?;
    let mut collisions = Vec::new();
    for entry in manifest.files_only() {
        reporter.check()?;
        let target = resolve_inside(destination, &entry.path)?;
        if target.exists() {
            collisions.push(entry.path.clone());
        }
    }
    Ok(RestorePreview {
        backup: backup_root.to_string_lossy().to_string(),
        source_name: manifest.source_name.clone(),
        created_at: manifest.created_at,
        files: manifest.files,
        directories: manifest.directories,
        bytes: manifest.bytes,
        collisions,
        warnings: manifest.warnings.clone(),
    })
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSummary {
    pub destination: String,
    pub restored: usize,
    pub skipped: Vec<String>,
    pub failed: Vec<String>,
    pub bytes: u64,
    pub interrupted: bool,
    /// Fichiers restaurés dont l'empreinte ne correspondait pas au manifeste.
    pub corrupted: Vec<String>,
}

impl RestoreSummary {
    pub fn complete(&self) -> bool {
        !self.interrupted && self.failed.is_empty() && self.corrupted.is_empty()
    }
}

/// Restaure une sauvegarde dans un dossier.
///
/// Chaque fichier est vérifié pendant sa copie : s'il ne correspond plus à son
/// empreinte, il est restauré **et signalé**. Restaurer en silence un fichier
/// qu'on sait abîmé serait la pire des politesses.
///
/// Aucune suppression n'a lieu : restaurer n'est pas synchroniser. Ce que la
/// destination contient en plus, elle le garde.
pub fn restore(
    backup_root: &Path,
    destination: &Path,
    mode: RestoreMode,
    reporter: &Reporter,
) -> Result<RestoreSummary, String> {
    let manifest = read_manifest(backup_root)?;
    let data_root = backup_root.join(DATA_DIRECTORY);
    fs::create_dir_all(destination).map_err(|e| format!("{} : {e}", destination.display()))?;

    let mut summary = RestoreSummary {
        destination: destination.to_string_lossy().to_string(),
        restored: 0,
        skipped: Vec::new(),
        failed: Vec::new(),
        bytes: 0,
        interrupted: false,
        corrupted: Vec::new(),
    };

    // Les dossiers d'abord : un fichier ne peut pas précéder son dossier.
    let mut directories: Vec<&BackupEntry> =
        manifest.entries.iter().filter(|entry| entry.kind == "directory").collect();
    directories.sort_by_key(|entry| entry.path.len());
    for entry in directories {
        reporter.check()?;
        let target = resolve_inside(destination, &entry.path)?;
        if let Err(error) = fs::create_dir_all(&target) {
            summary.failed.push(format!("{} — {error}", entry.path));
        }
    }

    let files: Vec<&BackupEntry> = manifest.files_only().collect();
    let total = manifest.bytes.max(1);
    for (position, entry) in files.iter().enumerate() {
        if reporter.cancelled() {
            summary.interrupted = true;
            break;
        }
        reporter.report(
            summary.bytes,
            total,
            &format!("{} / {} — {}", position + 1, files.len(), entry.path),
        );

        let source = match resolve_inside(&data_root, &entry.path) {
            Ok(path) => path,
            Err(error) => {
                summary.failed.push(format!("{} — {error}", entry.path));
                continue;
            }
        };
        let target = match resolve_inside(destination, &entry.path) {
            Ok(path) => path,
            Err(error) => {
                summary.failed.push(format!("{} — {error}", entry.path));
                continue;
            }
        };
        if !source.is_file() {
            summary.failed.push(format!("{} — absent de la sauvegarde", entry.path));
            continue;
        }
        if target.exists() && mode == RestoreMode::Skip {
            summary.skipped.push(entry.path.clone());
            continue;
        }

        match copy_hashing(&source, &target, reporter) {
            Ok(digest) => {
                summary.restored += 1;
                summary.bytes += entry.size;
                if digest != entry.sha256 {
                    summary.corrupted.push(entry.path.clone());
                }
            }
            Err(error) if error == super::CANCELLED => {
                summary.interrupted = true;
                break;
            }
            Err(error) => summary.failed.push(format!("{} — {error}", entry.path)),
        }
    }

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("fourtout-backup-tests").join(name);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(root: &Path, relative: &str, content: &[u8]) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        File::create(&path).unwrap().write_all(content).unwrap();
    }

    fn source_tree(name: &str) -> PathBuf {
        let root = scratch(name);
        write(&root, "notes.txt", b"des notes");
        write(&root, "vide.txt", b"");
        write(&root, "binaire.bin", &(0..=255_u8).collect::<Vec<_>>());
        write(&root, "sous-dossier/accentué é à ü.txt", "contenu accentué\n".as_bytes());
        root
    }

    fn request(source: &Path, destination: &Path) -> BackupRequest {
        BackupRequest {
            source: source.to_string_lossy().to_string(),
            destination: destination.to_string_lossy().to_string(),
            walk: WalkOptions::default(),
        }
    }

    #[test]
    fn backup_verify_restore_round_trip() {
        let source = source_tree("round-source");
        let backup = scratch("round-backup");
        let restored = scratch("round-restored");

        let summary = create(&request(&source, &backup), &Reporter::silent()).unwrap();
        assert!(summary.complete());
        assert_eq!(summary.files, 4);
        assert!(backup.join(MANIFEST_NAME).exists());
        assert!(backup.join(DATA_DIRECTORY).join("notes.txt").exists());

        let report = verify(&backup, &Reporter::silent()).unwrap();
        assert!(report.intact());
        assert_eq!(report.ok, 4);
        assert!(report.unexpected.is_empty());

        let restore_summary =
            restore(&backup, &restored, RestoreMode::Overwrite, &Reporter::silent()).unwrap();
        assert!(restore_summary.complete());
        assert_eq!(restore_summary.restored, 4);

        // Comparaison octet pour octet de la source et du restauré.
        let (originals, _) =
            walk::collect(&source, &WalkOptions::default(), &Reporter::silent()).unwrap();
        for entry in originals.iter().filter(|entry| !entry.is_dir) {
            assert_eq!(
                fs::read(source.join(&entry.relative)).unwrap(),
                fs::read(restored.join(&entry.relative)).unwrap(),
                "contenu différent pour {}",
                entry.relative
            );
        }
    }

    #[test]
    fn verify_points_at_the_exact_altered_file() {
        let source = source_tree("altered-source");
        let backup = scratch("altered-backup");
        create(&request(&source, &backup), &Reporter::silent()).unwrap();

        // Un octet change dans la copie sauvegardée.
        let victim = backup.join(DATA_DIRECTORY).join("notes.txt");
        fs::write(&victim, b"des notes!").unwrap();
        // Et un autre fichier disparaît.
        fs::remove_file(backup.join(DATA_DIRECTORY).join("binaire.bin")).unwrap();

        let report = verify(&backup, &Reporter::silent()).unwrap();
        assert!(!report.intact());
        assert_eq!(report.modified, 1);
        assert_eq!(report.missing, 1);
        let modified =
            report.checks.iter().find(|c| c.state == EntryState::Modified).unwrap();
        assert_eq!(modified.path, "notes.txt");
        let missing = report.checks.iter().find(|c| c.state == EntryState::Missing).unwrap();
        assert_eq!(missing.path, "binaire.bin");
    }

    #[test]
    fn restoring_a_corrupted_backup_says_so() {
        let source = source_tree("corrupt-source");
        let backup = scratch("corrupt-backup");
        let destination = scratch("corrupt-restored");
        create(&request(&source, &backup), &Reporter::silent()).unwrap();
        fs::write(backup.join(DATA_DIRECTORY).join("notes.txt"), b"contenu falsifie").unwrap();

        let summary =
            restore(&backup, &destination, RestoreMode::Overwrite, &Reporter::silent()).unwrap();
        assert!(!summary.complete());
        assert_eq!(summary.corrupted, vec!["notes.txt".to_string()]);
    }

    #[test]
    fn restore_preview_lists_collisions_without_writing() {
        let source = source_tree("preview-source");
        let backup = scratch("preview-backup");
        let destination = scratch("preview-destination");
        create(&request(&source, &backup), &Reporter::silent()).unwrap();
        write(&destination, "notes.txt", b"deja la");

        let preview = preview(&backup, &destination, &Reporter::silent()).unwrap();
        assert_eq!(preview.collisions, vec!["notes.txt".to_string()]);
        assert_eq!(preview.files, 4);
        assert_eq!(fs::read(destination.join("notes.txt")).unwrap(), b"deja la");
    }

    #[test]
    fn skip_mode_never_overwrites() {
        let source = source_tree("skip-source");
        let backup = scratch("skip-backup");
        let destination = scratch("skip-destination");
        create(&request(&source, &backup), &Reporter::silent()).unwrap();
        write(&destination, "notes.txt", b"contenu de l'utilisateur");

        let summary =
            restore(&backup, &destination, RestoreMode::Skip, &Reporter::silent()).unwrap();
        assert_eq!(summary.skipped, vec!["notes.txt".to_string()]);
        assert_eq!(
            fs::read(destination.join("notes.txt")).unwrap(),
            b"contenu de l'utilisateur"
        );

        let summary =
            restore(&backup, &destination, RestoreMode::Overwrite, &Reporter::silent()).unwrap();
        assert!(summary.skipped.is_empty());
        assert_eq!(fs::read(destination.join("notes.txt")).unwrap(), b"des notes");
    }

    #[test]
    fn a_folder_that_is_not_a_backup_is_refused_clearly() {
        let random = scratch("not-a-backup");
        write(&random, "quelconque.txt", b"x");
        let error = read_manifest(&random).unwrap_err();
        assert!(error.contains("ne contient pas de sauvegarde"));
    }

    #[test]
    fn refuses_a_non_empty_destination() {
        let source = source_tree("occupied-source");
        let destination = scratch("occupied-destination");
        write(&destination, "important.txt", b"ne pas ecraser");
        let error = create(&request(&source, &destination), &Reporter::silent()).unwrap_err();
        assert!(error.contains("n'est pas vide"));
        assert!(destination.join("important.txt").exists());
    }

    #[test]
    fn refuses_to_back_up_into_the_source() {
        let source = source_tree("inside-source");
        let destination = source.join("sauvegarde");
        fs::create_dir_all(&destination).unwrap();
        assert!(create(&request(&source, &destination), &Reporter::silent()).is_err());
    }

    #[test]
    fn cancelling_before_any_copy_writes_nothing() {
        let source = source_tree("cancel-early-source");
        let backup = scratch("cancel-early-backup");
        let outcome = create(&request(&source, &backup), &Reporter::silent_cancelled());
        assert_eq!(outcome.unwrap_err(), crate::files::CANCELLED);
        assert!(!backup.join(MANIFEST_NAME).exists(), "aucun manifeste ne doit être écrit");
    }

    #[test]
    fn cancelling_mid_copy_produces_an_honest_manifest() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;

        // Une arborescence assez fournie pour que la copie dure plus qu'un
        // battement de cil : sans cela, l'annulation arriverait après la fin.
        let source = scratch("cancel-source");
        for index in 0..800 {
            write(&source, &format!("lot{}/fichier-{index}.txt", index % 8), &vec![b'x'; 4096]);
        }
        let backup = scratch("cancel-backup");
        // L'annulation tombe pendant la copie : la sauvegarde doit s'arrêter,
        // le dire, et décrire exactement ce qu'elle a réellement copié.
        let flag = Arc::new(AtomicBool::new(false));
        let reporter = Reporter::silent_with_flag(flag.clone());
        let watcher = {
            let flag = flag.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(5));
                flag.store(true, Ordering::SeqCst);
            })
        };
        let summary = create(&request(&source, &backup), &reporter);
        watcher.join().unwrap();

        match summary {
            // Annulation détectée en cours de copie : bilan partiel honnête.
            Ok(summary) => {
                assert!(summary.interrupted);
                assert!(!summary.complete());
                let manifest = read_manifest(&backup).unwrap();
                assert_eq!(manifest.files, summary.files);
                assert!(manifest.warnings.iter().any(|w| w.contains("interrompue")));
                // Tout ce que le manifeste annonce existe réellement.
                for entry in manifest.files_only() {
                    assert!(backup.join(DATA_DIRECTORY).join(&entry.path).exists());
                }
            }
            // Annulation détectée pendant l'inventaire : rien n'est écrit.
            Err(error) => assert_eq!(error, crate::files::CANCELLED),
        }
    }

    #[test]
    fn manifest_holds_no_absolute_path() {
        let source = source_tree("relative-source");
        let backup = scratch("relative-backup");
        create(&request(&source, &backup), &Reporter::silent()).unwrap();
        let content = fs::read_to_string(backup.join(MANIFEST_NAME)).unwrap();
        assert!(
            !content.contains(&source.to_string_lossy().to_string()),
            "le manifeste ne doit contenir aucun chemin absolu"
        );
        for entry in read_manifest(&backup).unwrap().entries {
            assert!(!entry.path.starts_with('/'));
            assert!(!entry.path.contains(".."));
        }
    }
}
