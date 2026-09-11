//! Synchronisation d'un dossier source vers un dossier destination.
//!
//! Ce n'est **pas** une synchronisation bidirectionnelle : la source fait foi,
//! la destination la suit. Deux modes seulement, et la différence entre eux est
//! exactement une chose — le mode miroir supprime.
//!
//! Trois principes gouvernent ce module.
//!
//! **Le plan est un objet, pas une intention.** `build_plan` produit la liste
//! exacte des opérations ; `execute` n'exécute que cette liste. Rien n'est
//! recalculé entre l'affichage et la confirmation : c'est ce qui permet à
//! l'interface — et demain à un appel automatisé — de montrer précisément ce
//! qui va se produire, puis de faire précisément cela.
//!
//! **Ce qui a bougé entre-temps n'est pas écrasé en silence.** Chaque opération
//! retient la taille et la date de la source au moment du plan. Si le fichier a
//! changé depuis, l'opération est refusée et signalée, pas appliquée à
//! l'aveugle.
//!
//! **Une écriture interrompue ne laisse pas un fichier à moitié écrit.** Toute
//! copie passe par un fichier temporaire dans le dossier de destination, puis
//! par un renommage atomique. Une annulation ou une panne laisse donc l'ancien
//! fichier intact, jamais un tronçon.

use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::walk::{self, match_key, millis, WalkEntry, WalkOptions};
use super::{hash::sha256_file, Reporter, CANCELLED};

const COPY_CHUNK: usize = 1024 * 1024;
/// Préfixe des fichiers temporaires de copie. Reconnaissable, et nettoyé.
const TEMP_PREFIX: &str = ".fourtout-sync-";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SyncMode {
    /// Copie et remplace ; ce que la destination a en plus est conservé.
    #[default]
    Update,
    /// Copie, remplace **et supprime** ce qui n'existe plus dans la source.
    Mirror,
}

impl SyncMode {
    pub fn deletes(self) -> bool {
        self == SyncMode::Mirror
    }
}

/// Ce qui décide qu'un fichier présent des deux côtés doit être remplacé.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChangeTest {
    /// Taille différente, ou source plus récente d'au moins deux secondes.
    #[default]
    SizeAndDate,
    /// Empreinte du contenu quand la taille coïncide. Plus lent, sans ambiguïté.
    Content,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRequest {
    pub source: String,
    pub destination: String,
    #[serde(default)]
    pub mode: SyncMode,
    #[serde(default)]
    pub test: ChangeTest,
    #[serde(default)]
    pub walk: WalkOptions,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SyncAction {
    CreateDirectory,
    Copy,
    Replace,
    Delete,
    DeleteDirectory,
}

impl SyncAction {
    pub fn destructive(self) -> bool {
        matches!(self, SyncAction::Delete | SyncAction::DeleteDirectory | SyncAction::Replace)
    }
}

/// Une opération du plan. Elle porte de quoi vérifier, au moment de
/// l'exécution, que la source n'a pas changé depuis le calcul.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOperation {
    pub action: SyncAction,
    /// Chemin relatif, séparateurs `/`, commun aux deux côtés.
    pub relative: String,
    /// Taille de la source au moment du plan (0 pour une suppression).
    pub size: u64,
    /// Date de la source au moment du plan, en millisecondes.
    pub source_modified: u64,
    /// Ce qui a motivé l'opération, affichable tel quel.
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlan {
    pub source: String,
    pub destination: String,
    pub mode: SyncMode,
    pub operations: Vec<SyncOperation>,
    pub directories: usize,
    pub copies: usize,
    pub replacements: usize,
    pub deletions: usize,
    pub unchanged: usize,
    /// Octets qui seront écrits si le plan est exécuté.
    pub bytes: u64,
    /// Octets libérés par les suppressions du mode miroir.
    pub freed_bytes: u64,
    pub source_notes: walk::WalkNotes,
    pub destination_notes: walk::WalkNotes,
    pub warnings: Vec<String>,
}

impl SyncPlan {
    pub fn is_empty(&self) -> bool {
        self.operations.is_empty()
    }
}

fn index(
    root: &Path,
    options: &WalkOptions,
    reporter: &Reporter,
    label: &str,
) -> Result<(std::collections::BTreeMap<String, WalkEntry>, walk::WalkNotes), String> {
    let mut map = std::collections::BTreeMap::new();
    let mut seen = 0_usize;
    let notes = walk::walk(root, options, reporter, |entry| {
        seen += 1;
        if seen % 200 == 0 {
            reporter.report(seen as u64, 0, &format!("{label} : {seen} entrées"));
        }
        map.insert(match_key(&entry.relative), entry.clone());
        Ok(())
    })?;
    Ok((map, notes))
}

/// Le chemin `child` est-il réellement à l'intérieur de `root` ?
fn is_inside(root: &Path, child: &Path) -> bool {
    let root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let child = fs::canonicalize(child).unwrap_or_else(|_| child.to_path_buf());
    child.starts_with(&root)
}

/// Calcule le plan de synchronisation. **Ne modifie rien.**
pub fn build_plan(request: &SyncRequest, reporter: &Reporter) -> Result<SyncPlan, String> {
    let source_root = Path::new(&request.source);
    let destination_root = Path::new(&request.destination);
    if !source_root.is_dir() {
        return Err(format!("Dossier source introuvable : {}", request.source));
    }
    if source_root == destination_root {
        return Err("La source et la destination sont le même dossier.".into());
    }
    // Un miroir dont la destination contient la source effacerait la source
    // elle-même. Le cas se refuse, il ne s'avertit pas.
    if destination_root.exists() && is_inside(destination_root, source_root) {
        return Err(
            "La source est à l'intérieur de la destination : cette synchronisation détruirait la source."
                .into(),
        );
    }
    if is_inside(source_root, destination_root) {
        return Err(
            "La destination est à l'intérieur de la source : la synchronisation se copierait elle-même sans fin."
                .into(),
        );
    }

    let mut warnings = Vec::new();
    let (source, source_notes) = index(source_root, &request.walk, reporter, "Source")?;
    let (destination, destination_notes) = if destination_root.is_dir() {
        index(destination_root, &request.walk, reporter, "Destination")?
    } else {
        warnings.push(format!(
            "Le dossier de destination n'existe pas encore : {}",
            destination_root.display()
        ));
        (std::collections::BTreeMap::new(), walk::WalkNotes::default())
    };

    let mut operations: Vec<SyncOperation> = Vec::new();
    let mut unchanged = 0_usize;
    let mut bytes = 0_u64;
    let mut freed_bytes = 0_u64;

    // 1. Dossiers manquants, puis fichiers : l'ordre du plan est l'ordre
    //    d'exécution, et un fichier ne peut pas précéder son dossier.
    for (key, entry) in &source {
        reporter.check()?;
        if !entry.is_dir {
            continue;
        }
        if !destination.contains_key(key) {
            operations.push(SyncOperation {
                action: SyncAction::CreateDirectory,
                relative: entry.relative.clone(),
                size: 0,
                source_modified: entry.modified,
                reason: "Dossier absent de la destination.".into(),
            });
        }
    }
    operations.sort_by_key(|operation| operation.relative.len());
    let directories = operations.len();

    for (key, entry) in &source {
        reporter.check()?;
        if entry.is_dir {
            continue;
        }
        match destination.get(key) {
            None => {
                operations.push(SyncOperation {
                    action: SyncAction::Copy,
                    relative: entry.relative.clone(),
                    size: entry.size,
                    source_modified: entry.modified,
                    reason: "Nouveau fichier.".into(),
                });
                bytes += entry.size;
            }
            Some(existing) if existing.is_dir => {
                warnings.push(format!(
                    "{} : fichier dans la source, dossier dans la destination — ignoré.",
                    entry.relative
                ));
            }
            Some(existing) => {
                let reason = match request.test {
                    ChangeTest::SizeAndDate => {
                        if existing.size != entry.size {
                            Some("Taille différente.".to_string())
                        } else if entry.modified > existing.modified.saturating_add(2000) {
                            Some("Source plus récente.".to_string())
                        } else {
                            None
                        }
                    }
                    ChangeTest::Content => {
                        if existing.size != entry.size {
                            Some("Taille différente.".to_string())
                        } else {
                            let a = sha256_file(Path::new(&entry.path))?;
                            let b = sha256_file(Path::new(&existing.path))?;
                            if a == b {
                                None
                            } else {
                                Some("Même taille, contenu différent.".to_string())
                            }
                        }
                    }
                };
                match reason {
                    Some(reason) => {
                        operations.push(SyncOperation {
                            action: SyncAction::Replace,
                            relative: entry.relative.clone(),
                            size: entry.size,
                            source_modified: entry.modified,
                            reason,
                        });
                        bytes += entry.size;
                    }
                    None => unchanged += 1,
                }
            }
        }
    }

    // 2. Suppressions : fichiers d'abord, dossiers ensuite et du plus profond
    //    au moins profond, pour ne jamais tenter de vider un dossier occupé.
    if request.mode.deletes() {
        let mut doomed_files: Vec<&WalkEntry> = Vec::new();
        let mut doomed_dirs: Vec<&WalkEntry> = Vec::new();
        for (key, entry) in &destination {
            if source.contains_key(key) {
                continue;
            }
            if entry.is_dir {
                doomed_dirs.push(entry);
            } else {
                doomed_files.push(entry);
            }
        }
        doomed_files.sort_by(|a, b| a.relative.cmp(&b.relative));
        doomed_dirs.sort_by_key(|entry| std::cmp::Reverse(entry.relative.len()));

        for entry in doomed_files {
            freed_bytes += entry.size;
            operations.push(SyncOperation {
                action: SyncAction::Delete,
                relative: entry.relative.clone(),
                size: entry.size,
                source_modified: entry.modified,
                reason: "Absent de la source (mode miroir).".into(),
            });
        }
        for entry in doomed_dirs {
            operations.push(SyncOperation {
                action: SyncAction::DeleteDirectory,
                relative: entry.relative.clone(),
                size: 0,
                source_modified: entry.modified,
                reason: "Dossier absent de la source (mode miroir).".into(),
            });
        }
    }

    if !source_notes.symlinks.is_empty() {
        warnings.push(format!(
            "{} lien(s) symbolique(s) dans la source : ils ne sont ni suivis ni copiés.",
            source_notes.symlinks.len()
        ));
    }
    if !destination_notes.symlinks.is_empty() && request.mode.deletes() {
        warnings.push(format!(
            "{} lien(s) symbolique(s) dans la destination : le mode miroir ne les supprime pas.",
            destination_notes.symlinks.len()
        ));
    }

    let count = |action: SyncAction| operations.iter().filter(|op| op.action == action).count();
    Ok(SyncPlan {
        source: request.source.clone(),
        destination: request.destination.clone(),
        mode: request.mode,
        directories,
        copies: count(SyncAction::Copy),
        replacements: count(SyncAction::Replace),
        deletions: count(SyncAction::Delete) + count(SyncAction::DeleteDirectory),
        unchanged,
        bytes,
        freed_bytes,
        source_notes,
        destination_notes,
        warnings,
        operations,
    })
}

/* ------------------------------------------------------------- exécution */

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutcome {
    pub completed: usize,
    pub total: usize,
    pub copied: usize,
    pub replaced: usize,
    pub deleted: usize,
    pub directories_created: usize,
    pub bytes: u64,
    /// Opérations refusées ou en échec, avec leur raison.
    pub failed: Vec<String>,
    /// Sources modifiées depuis le calcul du plan : jamais écrasées.
    pub changed_since_plan: Vec<String>,
    /// L'utilisateur a-t-il interrompu l'opération ?
    pub interrupted: bool,
}

impl SyncOutcome {
    /// La destination reflète-t-elle vraiment le plan demandé ?
    pub fn complete(&self) -> bool {
        !self.interrupted && self.failed.is_empty() && self.changed_since_plan.is_empty()
    }
}

/// Chemin système correspondant à un chemin relatif du plan.
///
/// Passe par la même garde que l'extraction d'archive : un plan trafiqué ne
/// doit pas pouvoir écrire hors de la destination choisie.
fn resolve(root: &Path, relative: &str) -> Result<PathBuf, String> {
    super::resolve_inside(root, relative)
}

/// Copie un fichier via un temporaire, puis renomme : la destination n'existe
/// jamais à moitié écrite.
fn copy_atomically(
    source: &Path,
    target: &Path,
    reporter: &Reporter,
    label: &str,
) -> Result<u64, String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("Destination sans dossier parent : {}", target.display()))?;
    fs::create_dir_all(parent).map_err(|e| format!("{} : {e}", parent.display()))?;

    let name = target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let temporary = parent.join(format!("{TEMP_PREFIX}{name}"));
    // Un temporaire laissé par une exécution précédemment interrompue.
    let _ = fs::remove_file(&temporary);

    let result = (|| -> Result<u64, String> {
        let mut input = BufReader::new(
            File::open(source).map_err(|e| format!("{} : {e}", source.display()))?,
        );
        let mut output = BufWriter::new(
            File::create(&temporary).map_err(|e| format!("{} : {e}", temporary.display()))?,
        );
        let mut buffer = vec![0_u8; COPY_CHUNK];
        let mut written = 0_u64;
        loop {
            reporter.check()?;
            let read = input.read(&mut buffer).map_err(|e| format!("{} : {e}", source.display()))?;
            if read == 0 {
                break;
            }
            output
                .write_all(&buffer[..read])
                .map_err(|e| format!("{} : {e}", temporary.display()))?;
            written += read as u64;
            reporter.report(written, 0, label);
        }
        // Vider les tampons **avant** le renommage : sans cela, le fichier
        // « renommé » pourrait être incomplet sur le disque.
        output.flush().map_err(|e| format!("{} : {e}", temporary.display()))?;
        let file = output.into_inner().map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| format!("{} : {e}", temporary.display()))?;
        drop(file);
        Ok(written)
    })();

    match result {
        Ok(written) => {
            // `rename` remplace l'existant sur Unix comme sur Windows (std y
            // passe MOVEFILE_REPLACE_EXISTING) : le fichier de destination
            // n'est jamais tronqué entre les deux.
            fs::rename(&temporary, target).map_err(|error| {
                let _ = fs::remove_file(&temporary);
                format!("{} : {error}", target.display())
            })?;
            Ok(written)
        }
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            Err(error)
        }
    }
}

/// Exécute **exactement** le plan reçu.
///
/// Renvoie toujours un bilan, y compris après annulation : présenter une
/// synchronisation partielle comme réussie serait le pire mensonge de cet
/// outil.
pub fn execute(
    source_root: &Path,
    destination_root: &Path,
    plan: &[SyncOperation],
    reporter: &Reporter,
) -> Result<SyncOutcome, String> {
    fs::create_dir_all(destination_root)
        .map_err(|e| format!("{} : {e}", destination_root.display()))?;

    let mut outcome = SyncOutcome {
        completed: 0,
        total: plan.len(),
        copied: 0,
        replaced: 0,
        deleted: 0,
        directories_created: 0,
        bytes: 0,
        failed: Vec::new(),
        changed_since_plan: Vec::new(),
        interrupted: false,
    };

    for (position, operation) in plan.iter().enumerate() {
        if reporter.cancelled() {
            outcome.interrupted = true;
            break;
        }
        reporter.report(
            position as u64,
            plan.len() as u64,
            &format!("{} / {} — {}", position + 1, plan.len(), operation.relative),
        );

        let target = match resolve(destination_root, &operation.relative) {
            Ok(path) => path,
            Err(error) => {
                outcome.failed.push(format!("{} — {error}", operation.relative));
                continue;
            }
        };

        let step = match operation.action {
            SyncAction::CreateDirectory => fs::create_dir_all(&target)
                .map(|_| 0_u64)
                .map_err(|e| format!("{} : {e}", target.display())),

            SyncAction::Copy | SyncAction::Replace => {
                let source = match resolve(source_root, &operation.relative) {
                    Ok(path) => path,
                    Err(error) => {
                        outcome.failed.push(format!("{} — {error}", operation.relative));
                        continue;
                    }
                };
                // La source a-t-elle bougé depuis le calcul du plan ?
                match fs::symlink_metadata(&source) {
                    Err(error) => {
                        outcome
                            .failed
                            .push(format!("{} — source introuvable ({error})", operation.relative));
                        continue;
                    }
                    Ok(meta) => {
                        let modified = millis(meta.modified().ok());
                        if meta.len() != operation.size || modified != operation.source_modified {
                            outcome.changed_since_plan.push(operation.relative.clone());
                            continue;
                        }
                    }
                }
                copy_atomically(
                    &source,
                    &target,
                    reporter,
                    &format!("Copie : {}", operation.relative),
                )
            }

            SyncAction::Delete => {
                // Un lien symbolique se retire, il ne se suit pas.
                match fs::symlink_metadata(&target) {
                    Ok(_) => fs::remove_file(&target)
                        .map(|_| 0_u64)
                        .map_err(|e| format!("{} : {e}", target.display())),
                    Err(_) => Ok(0), // déjà disparu : le résultat voulu est atteint
                }
            }

            SyncAction::DeleteDirectory => match fs::remove_dir(&target) {
                Ok(()) => Ok(0),
                // Un dossier encore occupé n'est jamais vidé de force : c'est
                // le seul garde-fou contre un miroir qui déraperait.
                Err(error) if target.exists() => {
                    Err(format!("{} : {error}", target.display()))
                }
                Err(_) => Ok(0),
            },
        };

        match step {
            Ok(written) => {
                outcome.completed += 1;
                outcome.bytes += written;
                match operation.action {
                    SyncAction::Copy => outcome.copied += 1,
                    SyncAction::Replace => outcome.replaced += 1,
                    SyncAction::Delete | SyncAction::DeleteDirectory => outcome.deleted += 1,
                    SyncAction::CreateDirectory => outcome.directories_created += 1,
                }
            }
            Err(error) if error == CANCELLED => {
                outcome.interrupted = true;
                break;
            }
            Err(error) => outcome.failed.push(format!("{} — {error}", operation.relative)),
        }
    }

    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("fourtout-sync-tests").join(name);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(root: &Path, relative: &str, content: &[u8]) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        File::create(&path).unwrap().write_all(content).unwrap();
    }

    fn read(root: &Path, relative: &str) -> Vec<u8> {
        fs::read(root.join(relative)).unwrap()
    }

    /// Source et destination couvrant les cinq cas du plan.
    fn fixture(name: &str) -> (PathBuf, PathBuf) {
        let source = scratch(&format!("{name}-source"));
        let destination = scratch(&format!("{name}-destination"));
        write(&source, "nouveau.txt", b"tout neuf");
        write(&source, "modifie.txt", b"version source, plus longue");
        write(&destination, "modifie.txt", b"vieille");
        write(&source, "identique.txt", b"inchange");
        write(&destination, "identique.txt", b"inchange");
        write(&source, "sous-dossier/accentué é.txt", b"unicode");
        write(&destination, "en trop.txt", b"seulement a destination");
        (source, destination)
    }

    fn request(source: &Path, destination: &Path, mode: SyncMode) -> SyncRequest {
        SyncRequest {
            source: source.to_string_lossy().to_string(),
            destination: destination.to_string_lossy().to_string(),
            mode,
            test: ChangeTest::Content,
            walk: WalkOptions::default(),
        }
    }

    #[test]
    fn update_plan_copies_replaces_and_never_deletes() {
        let (source, destination) = fixture("update-plan");
        let plan =
            build_plan(&request(&source, &destination, SyncMode::Update), &Reporter::silent())
                .unwrap();
        assert_eq!(plan.copies, 2, "nouveau.txt et sous-dossier/accentué é.txt");
        assert_eq!(plan.replacements, 1);
        assert_eq!(plan.deletions, 0);
        assert_eq!(plan.unchanged, 1);
        assert_eq!(plan.directories, 1);
        assert!(plan.operations.iter().all(|op| op.action != SyncAction::Delete));
    }

    #[test]
    fn building_a_plan_modifies_nothing() {
        let (source, destination) = fixture("dry-run");
        let before = fs::read_dir(&destination).unwrap().count();
        let plan =
            build_plan(&request(&source, &destination, SyncMode::Mirror), &Reporter::silent())
                .unwrap();
        assert!(!plan.is_empty());
        assert_eq!(fs::read_dir(&destination).unwrap().count(), before);
        assert_eq!(read(&destination, "modifie.txt"), b"vieille");
        assert!(destination.join("en trop.txt").exists());
        assert!(!destination.join("nouveau.txt").exists());
    }

    #[test]
    fn update_execution_keeps_extra_destination_files() {
        let (source, destination) = fixture("update-exec");
        let plan =
            build_plan(&request(&source, &destination, SyncMode::Update), &Reporter::silent())
                .unwrap();
        let outcome =
            execute(&source, &destination, &plan.operations, &Reporter::silent()).unwrap();
        assert!(outcome.complete());
        assert_eq!(outcome.copied, 2);
        assert_eq!(outcome.replaced, 1);
        assert_eq!(outcome.deleted, 0);
        assert_eq!(read(&destination, "modifie.txt"), b"version source, plus longue");
        assert_eq!(read(&destination, "nouveau.txt"), b"tout neuf");
        assert_eq!(read(&destination, "sous-dossier/accentué é.txt"), b"unicode");
        assert!(destination.join("en trop.txt").exists(), "le mode mise à jour ne supprime rien");
    }

    #[test]
    fn mirror_execution_makes_destination_identical() {
        let (source, destination) = fixture("mirror-exec");
        write(&destination, "vieux dossier/reste.txt", b"a supprimer");
        let plan =
            build_plan(&request(&source, &destination, SyncMode::Mirror), &Reporter::silent())
                .unwrap();
        assert!(plan.deletions >= 2);
        let outcome =
            execute(&source, &destination, &plan.operations, &Reporter::silent()).unwrap();
        assert!(outcome.complete(), "{:?}", outcome.failed);
        assert!(!destination.join("en trop.txt").exists());
        assert!(!destination.join("vieux dossier").exists());

        // Comparaison octet pour octet des deux arborescences.
        let (left, _) =
            walk::collect(&source, &WalkOptions::default(), &Reporter::silent()).unwrap();
        let (right, _) =
            walk::collect(&destination, &WalkOptions::default(), &Reporter::silent()).unwrap();
        assert_eq!(
            left.iter().map(|e| e.relative.clone()).collect::<Vec<_>>(),
            right.iter().map(|e| e.relative.clone()).collect::<Vec<_>>()
        );
        for entry in left.iter().filter(|e| !e.is_dir) {
            assert_eq!(read(&source, &entry.relative), read(&destination, &entry.relative));
        }
    }

    #[test]
    fn a_source_changed_after_the_plan_is_never_overwritten() {
        let (source, destination) = fixture("changed-source");
        let plan =
            build_plan(&request(&source, &destination, SyncMode::Update), &Reporter::silent())
                .unwrap();
        // La source bouge entre la confirmation et l'exécution.
        write(&source, "nouveau.txt", b"contenu completement different et plus long");

        let outcome =
            execute(&source, &destination, &plan.operations, &Reporter::silent()).unwrap();
        assert!(!outcome.complete());
        assert_eq!(outcome.changed_since_plan, vec!["nouveau.txt".to_string()]);
        assert!(!destination.join("nouveau.txt").exists());
    }

    #[test]
    fn cancellation_leaves_no_temporary_and_reports_partial_work() {
        let (source, destination) = fixture("cancel");
        let plan =
            build_plan(&request(&source, &destination, SyncMode::Update), &Reporter::silent())
                .unwrap();
        let outcome =
            execute(&source, &destination, &plan.operations, &Reporter::silent_cancelled())
                .unwrap();
        assert!(outcome.interrupted);
        assert!(!outcome.complete());
        assert_eq!(outcome.completed, 0);
        let leftovers: Vec<_> = walk::collect(
            &destination,
            &WalkOptions { include_hidden: true, ..Default::default() },
            &Reporter::silent(),
        )
        .unwrap()
        .0
        .into_iter()
        .filter(|entry| entry.name.starts_with(TEMP_PREFIX))
        .collect();
        assert!(leftovers.is_empty(), "aucun fichier temporaire ne doit subsister");
    }

    #[test]
    fn a_plan_path_cannot_escape_the_destination() {
        let (source, destination) = fixture("traversal");
        let evil = vec![SyncOperation {
            action: SyncAction::Copy,
            relative: "../evade.txt".into(),
            size: 9,
            source_modified: 0,
            reason: "test".into(),
        }];
        let outcome = execute(&source, &destination, &evil, &Reporter::silent()).unwrap();
        assert_eq!(outcome.completed, 0);
        assert_eq!(outcome.failed.len(), 1);
        assert!(!destination.parent().unwrap().join("evade.txt").exists());
    }

    #[test]
    fn nested_source_and_destination_are_refused() {
        let source = scratch("nested-source");
        write(&source, "a.txt", b"a");
        let inside = source.join("copie");
        fs::create_dir_all(&inside).unwrap();
        assert!(build_plan(&request(&source, &inside, SyncMode::Mirror), &Reporter::silent())
            .is_err());
        assert!(build_plan(&request(&inside, &source, SyncMode::Mirror), &Reporter::silent())
            .is_err());
    }

    #[test]
    fn content_test_sees_an_equal_sized_difference() {
        let source = scratch("content-source");
        let destination = scratch("content-destination");
        write(&source, "a.bin", b"AAAAAAAA");
        write(&destination, "a.bin", b"BBBBBBBB");

        let mut request = request(&source, &destination, SyncMode::Update);
        request.test = ChangeTest::SizeAndDate;
        // À taille et date égales, le test rapide conclut « inchangé ».
        let quick = build_plan(&request, &Reporter::silent()).unwrap();
        request.test = ChangeTest::Content;
        let thorough = build_plan(&request, &Reporter::silent()).unwrap();
        assert_eq!(thorough.replacements, 1);
        assert!(thorough.replacements >= quick.replacements);
    }
}
