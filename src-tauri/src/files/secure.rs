//! Effacement logiciel renforcé, et organisation d'un dossier.
//!
//! Deux opérations qui **modifient le disque**, donc deux opérations qui
//! doivent être prudentes, explicites et annulables tant que rien n'a bougé.

use std::fs::{self, File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{unique_path, Reporter};

/* ==================================================================== */
/* Effacement logiciel renforcé                                          */
/* ==================================================================== */

/// Ce que l'outil peut promettre, et ce qu'il ne peut pas.
///
/// Ce texte est affiché **avant** toute action, sans possibilité de le masquer.
/// Un outil nommé « suppression sécurisée » qui laisserait croire à un
/// effacement physique garanti tromperait l'utilisateur sur exactement le point
/// où il a besoin de vérité.
pub const LIMITS_NOTICE: &str = "Sur un SSD, une carte mémoire, un système de fichiers à copie sur \
écriture (Btrfs, ZFS, APFS), en présence d'instantanés, d'un journal, d'une corbeille ou d'une \
sauvegarde, aucun logiciel ne peut garantir la disparition physique de toutes les copies \
antérieures : le contrôleur ou le système de fichiers décide seul où les données ont été écrites. \
Cet outil écrase le contenu à l'emplacement actuel du fichier, force l'écriture sur le support, \
puis supprime l'entrée. C'est un effacement logiciel renforcé, pas un effacement physique.";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WipeMode {
    /// Une passe de données aléatoires. Suffisant face à une récupération
    /// logicielle sur un disque classique.
    Random,
    /// Trois passes (zéros, uns, aléatoire). Plus long, sans garantie
    /// supplémentaire sur un support moderne.
    ThreePass,
    /// Aucune réécriture : suppression simple, comme la corbeille vidée.
    None,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WipeRequest {
    pub paths: Vec<String>,
    pub mode: WipeMode,
    /// Doit valoir exactement `CONFIRMATION` : garde-fou contre un appel
    /// accidentel depuis l'interface.
    pub confirmation: String,
}

/// Phrase que l'utilisateur doit avoir validée. Elle voyage jusqu'ici pour que
/// la couche native ne puisse pas être déclenchée par un simple clic égaré.
pub const CONFIRMATION: &str = "SUPPRIMER DEFINITIVEMENT";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WipeOutcome {
    pub path: String,
    pub bytes: u64,
    pub passes: u32,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WipeSummary {
    pub deleted: usize,
    pub failed: usize,
    pub bytes: u64,
    pub results: Vec<WipeOutcome>,
    pub notice: String,
}

const WIPE_BLOCK: usize = 1024 * 1024;

fn passes_for(mode: WipeMode) -> u32 {
    match mode {
        WipeMode::None => 0,
        WipeMode::Random => 1,
        WipeMode::ThreePass => 3,
    }
}

/// Écrase le contenu d'un fichier, puis le supprime.
fn wipe_one(path: &Path, mode: WipeMode, reporter: &Reporter) -> Result<u64, String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| format!("Fichier introuvable : {e}"))?;
    if metadata.file_type().is_symlink() {
        // Écraser un lien symbolique écraserait sa cible : on retire le lien,
        // et lui seul.
        fs::remove_file(path).map_err(|e| format!("Suppression du lien impossible : {e}"))?;
        return Ok(0);
    }
    if !metadata.is_file() {
        return Err("Seuls les fichiers peuvent être effacés par cet outil.".into());
    }
    let size = metadata.len();
    let passes = passes_for(mode);

    if passes > 0 && size > 0 {
        let mut file = OpenOptions::new()
            .write(true)
            .open(path)
            .map_err(|e| format!("Écriture impossible : {e}"))?;
        let mut block = vec![0u8; WIPE_BLOCK.min(size.max(1) as usize)];

        for pass in 0..passes {
            reporter.check()?;
            match (mode, pass) {
                (WipeMode::ThreePass, 0) => block.fill(0x00),
                (WipeMode::ThreePass, 1) => block.fill(0xFF),
                _ => {
                    getrandom::fill(&mut block)
                        .map_err(|e| format!("Générateur aléatoire indisponible : {e}"))?;
                }
            }
            file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
            let mut written = 0u64;
            while written < size {
                reporter.check()?;
                let take = block.len().min((size - written) as usize);
                file.write_all(&block[..take]).map_err(|e| format!("Écriture impossible : {e}"))?;
                written += take as u64;
                reporter.report(
                    written,
                    size,
                    &format!("Passe {} sur {passes}…", pass + 1),
                );
            }
            // Sans cette synchronisation, les octets écrasés peuvent n'exister
            // que dans le cache du système au moment où le fichier disparaît.
            file.flush().map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| format!("Synchronisation impossible : {e}"))?;
        }
        drop(file);
    }

    // Renommer avant de supprimer retire le nom d'origine de l'entrée de
    // répertoire, qui pourrait sinon rester lisible dans le journal.
    let scrambled = path.with_file_name(format!("ft-{}", uuid_like()));
    let final_path = if fs::rename(path, &scrambled).is_ok() { scrambled } else { path.to_path_buf() };
    fs::remove_file(&final_path).map_err(|e| format!("Suppression impossible : {e}"))?;
    Ok(size)
}

fn uuid_like() -> String {
    let mut bytes = [0u8; 12];
    let _ = getrandom::fill(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn wipe(request: &WipeRequest, reporter: &Reporter) -> Result<WipeSummary, String> {
    if request.confirmation != CONFIRMATION {
        return Err(
            "Confirmation manquante : cette opération est irréversible et ne peut pas être \
             déclenchée sans validation explicite."
                .into(),
        );
    }
    if request.paths.is_empty() {
        return Err("Aucun fichier sélectionné.".into());
    }

    let mut results = Vec::with_capacity(request.paths.len());
    let mut bytes = 0u64;
    let mut deleted = 0usize;
    let mut failed = 0usize;

    for raw in &request.paths {
        reporter.check()?;
        let path = PathBuf::from(raw);
        match wipe_one(&path, request.mode, reporter) {
            Ok(size) => {
                bytes += size;
                deleted += 1;
                results.push(WipeOutcome {
                    path: raw.clone(),
                    bytes: size,
                    passes: passes_for(request.mode),
                    error: None,
                });
            }
            Err(error) if error == super::CANCELLED => return Err(error),
            Err(error) => {
                failed += 1;
                results.push(WipeOutcome {
                    path: raw.clone(),
                    bytes: 0,
                    passes: 0,
                    error: Some(error),
                });
            }
        }
    }

    Ok(WipeSummary {
        deleted,
        failed,
        bytes,
        results,
        notice: LIMITS_NOTICE.to_string(),
    })
}

/* ==================================================================== */
/* Organisation d'un dossier                                             */
/* ==================================================================== */

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeMove {
    pub name: String,
    pub from: String,
    pub category: String,
    /// Chemin relatif au dossier analysé, séparateurs `/`.
    pub to: String,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizePlan {
    pub root: String,
    pub moves: Vec<OrganizeMove>,
    /// Fichiers laissés en place, avec la raison.
    pub skipped: Vec<String>,
    pub categories: Vec<CategoryCount>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryCount {
    pub name: String,
    pub files: usize,
    pub bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeRequest {
    pub root: String,
    /// Descendre dans les sous-dossiers. Faux par défaut : ranger récursivement
    /// un dossier déjà organisé le désorganiserait.
    #[serde(default)]
    pub recursive: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeApplyRequest {
    pub root: String,
    pub moves: Vec<PlannedMove>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedMove {
    pub from: String,
    pub to: String,
}

/// Catégories de rangement, par extension.
///
/// Volontairement peu nombreuses : un rangement en vingt-cinq dossiers ne range
/// rien. « Autres » existe pour que rien ne disparaisse d'un plan.
const CATEGORIES: &[(&str, &[&str])] = &[
    (
        "Images",
        &["jpg", "jpeg", "png", "gif", "bmp", "tif", "tiff", "webp", "svg", "heic", "avif", "ico", "raw", "cr2", "nef"],
    ),
    ("Vidéos", &["mp4", "mkv", "mov", "avi", "webm", "wmv", "flv", "m4v", "mpg", "mpeg", "3gp"]),
    ("Audio", &["mp3", "wav", "flac", "ogg", "opus", "m4a", "aac", "wma", "aiff", "mid"]),
    (
        "Documents",
        &["pdf", "doc", "docx", "odt", "rtf", "txt", "md", "xls", "xlsx", "ods", "csv", "ppt", "pptx", "odp", "epub", "djvu"],
    ),
    ("Archives", &["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "iso", "ftenc"]),
    (
        "Code",
        &["js", "ts", "tsx", "jsx", "rs", "py", "java", "c", "h", "cpp", "hpp", "go", "rb", "php", "sh", "html", "css", "json", "xml", "yml", "yaml", "sql", "toml"],
    ),
];

fn category_for(extension: &str) -> &'static str {
    let lower = extension.to_lowercase();
    for (name, extensions) in CATEGORIES {
        if extensions.contains(&lower.as_str()) {
            return name;
        }
    }
    "Autres"
}

/// Les dossiers de rangement eux-mêmes : on ne range pas ce qui l'est déjà.
fn is_category_dir(name: &str) -> bool {
    CATEGORIES.iter().any(|(category, _)| *category == name) || name == "Autres"
}

/// Construit le plan. **Aucun fichier n'est déplacé ici.**
pub fn plan(request: &OrganizeRequest, reporter: &Reporter) -> Result<OrganizePlan, String> {
    let root = PathBuf::from(&request.root);
    if !root.is_dir() {
        return Err(format!("{} n'est pas un dossier.", root.display()));
    }

    let mut moves: Vec<OrganizeMove> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    collect(&root, &root, request.recursive, &mut moves, &mut skipped, reporter)?;

    moves.sort_by(|a, b| a.to.cmp(&b.to));

    let mut categories: Vec<CategoryCount> = Vec::new();
    for entry in &moves {
        match categories.iter_mut().find(|c| c.name == entry.category) {
            Some(found) => {
                found.files += 1;
                found.bytes += entry.size;
            }
            None => categories.push(CategoryCount {
                name: entry.category.clone(),
                files: 1,
                bytes: entry.size,
            }),
        }
    }
    categories.sort_by(|a, b| b.files.cmp(&a.files).then(a.name.cmp(&b.name)));

    Ok(OrganizePlan {
        root: root.to_string_lossy().to_string(),
        moves,
        skipped,
        categories,
    })
}

fn collect(
    directory: &Path,
    root: &Path,
    recursive: bool,
    moves: &mut Vec<OrganizeMove>,
    skipped: &mut Vec<String>,
    reporter: &Reporter,
) -> Result<(), String> {
    reporter.check()?;
    let entries = fs::read_dir(directory).map_err(|e| format!("{} : {e}", directory.display()))?;
    for entry in entries.flatten() {
        reporter.check()?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                skipped.push(format!("{name} — illisible ({error})"));
                continue;
            }
        };

        if metadata.file_type().is_symlink() {
            skipped.push(format!("{name} — lien symbolique laissé en place"));
            continue;
        }
        if metadata.is_dir() {
            if is_category_dir(&name) && directory == root {
                // Déjà un dossier de rangement : on n'y touche pas.
                continue;
            }
            if recursive {
                collect(&path, root, recursive, moves, skipped, reporter)?;
            } else {
                skipped.push(format!("{name}/ — dossier laissé en place"));
            }
            continue;
        }
        if !metadata.is_file() {
            skipped.push(format!("{name} — entrée spéciale laissée en place"));
            continue;
        }
        if name.starts_with('.') {
            skipped.push(format!("{name} — fichier caché laissé en place"));
            continue;
        }

        let extension = path.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
        let category = category_for(&extension);
        moves.push(OrganizeMove {
            name: name.clone(),
            from: path.to_string_lossy().to_string(),
            category: category.to_string(),
            to: format!("{category}/{name}"),
            size: metadata.len(),
        });
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeSummary {
    pub moved: usize,
    pub renamed: usize,
    pub failed: Vec<String>,
}

/// Applique un plan. Seuls les déplacements listés sont effectués.
pub fn apply(request: &OrganizeApplyRequest, reporter: &Reporter) -> Result<OrganizeSummary, String> {
    let root = fs::canonicalize(&request.root)
        .map_err(|e| format!("Dossier introuvable ({}) : {e}", request.root))?;
    let total = request.moves.len() as u64;
    let mut moved = 0usize;
    let mut renamed = 0usize;
    let mut failed: Vec<String> = Vec::new();

    for (index, planned) in request.moves.iter().enumerate() {
        reporter.check()?;
        let source = PathBuf::from(&planned.from);
        let name = source
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| planned.from.clone());
        reporter.report(index as u64, total, &name);

        // La source doit être sous le dossier choisi : le plan vient du
        // frontend, il ne fait pas autorité sur ce qu'on a le droit de toucher.
        let canonical_source = match fs::canonicalize(&source) {
            Ok(path) => path,
            Err(error) => {
                failed.push(format!("{name} — introuvable ({error})"));
                continue;
            }
        };
        if !canonical_source.starts_with(&root) {
            failed.push(format!("{name} — hors du dossier analysé, ignoré"));
            continue;
        }
        let target = match super::resolve_inside(&root, &planned.to) {
            Ok(target) => target,
            Err(message) => {
                failed.push(format!("{name} — {message}"));
                continue;
            }
        };
        if let Some(parent) = target.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                failed.push(format!("{name} — dossier non créé ({error})"));
                continue;
            }
        }
        // Jamais d'écrasement : une collision produit « nom (2).ext ».
        let final_target = unique_path(&target);
        if final_target != target {
            renamed += 1;
        }
        match move_file(&canonical_source, &final_target) {
            Ok(()) => moved += 1,
            Err(error) => failed.push(format!("{name} — {error}")),
        }
    }
    reporter.report(total, total, "Terminé");
    Ok(OrganizeSummary { moved, renamed, failed })
}

/// Déplace un fichier, avec repli sur copie puis suppression quand le
/// renommage traverse deux systèmes de fichiers.
fn move_file(source: &Path, target: &Path) -> Result<(), String> {
    match fs::rename(source, target) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(source, target).map_err(|e| format!("copie impossible ({e})"))?;
            fs::remove_file(source).map_err(|e| format!("original non supprimé ({e})"))?;
            Ok(())
        }
    }
}

/// Vérifie qu'un fichier peut être écrit : utilisé par les tests.
#[allow(dead_code)]
fn touch(path: &Path) -> std::io::Result<()> {
    File::create(path)?.write_all(b"x")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fourtout-secure-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn organize_plan_moves_nothing() {
        let dir = temp_dir("plan");
        fs::write(dir.join("photo.jpg"), b"image").unwrap();
        fs::write(dir.join("rapport.pdf"), b"document").unwrap();
        fs::write(dir.join("inconnu.zzz"), b"?").unwrap();

        let plan = plan(
            &OrganizeRequest { root: dir.to_string_lossy().to_string(), recursive: false },
            &Reporter::silent(),
        )
        .unwrap();

        assert_eq!(plan.moves.len(), 3);
        // Rien n'a bougé : le plan est une proposition.
        assert!(dir.join("photo.jpg").exists());
        assert!(!dir.join("Images").exists());

        let targets: Vec<_> = plan.moves.iter().map(|m| m.to.as_str()).collect();
        assert!(targets.contains(&"Images/photo.jpg"));
        assert!(targets.contains(&"Documents/rapport.pdf"));
        assert!(targets.contains(&"Autres/inconnu.zzz"));
    }

    #[test]
    fn organize_sorts_a_realistic_folder_and_respects_the_recursion_switch() {
        let dir = temp_dir("realistic");
        for (name, expected) in [
            ("photo.jpg", "Images/photo.jpg"),
            ("video.mp4", "Vidéos/video.mp4"),
            ("rapport.pdf", "Documents/rapport.pdf"),
            ("code.js", "Code/code.js"),
            ("archive.zip", "Archives/archive.zip"),
            ("inconnu.xyz", "Autres/inconnu.xyz"),
        ] {
            fs::write(dir.join(name), name.as_bytes()).unwrap();
            let _ = expected;
        }
        // Un fichier enfoui : il ne doit être vu que si la récursion est active.
        fs::create_dir_all(dir.join("sous/dossier")).unwrap();
        fs::write(dir.join("sous/dossier/enfoui.png"), b"png").unwrap();

        let shallow = plan(
            &OrganizeRequest { root: dir.to_string_lossy().to_string(), recursive: false },
            &Reporter::silent(),
        )
        .unwrap();
        let targets: Vec<_> = shallow.moves.iter().map(|m| m.to.as_str()).collect();
        for expected in [
            "Images/photo.jpg",
            "Vidéos/video.mp4",
            "Documents/rapport.pdf",
            "Code/code.js",
            "Archives/archive.zip",
            "Autres/inconnu.xyz",
        ] {
            assert!(targets.contains(&expected), "catégorie manquante : {expected} dans {targets:?}");
        }
        assert!(
            !targets.iter().any(|t| t.ends_with("enfoui.png")),
            "la récursion est désactivée : le fichier enfoui ne doit pas être proposé",
        );

        let deep = plan(
            &OrganizeRequest { root: dir.to_string_lossy().to_string(), recursive: true },
            &Reporter::silent(),
        )
        .unwrap();
        assert!(
            deep.moves.iter().any(|m| m.to.ends_with("enfoui.png")),
            "la récursion est activée : le fichier enfoui doit être proposé",
        );

        // Application du plan de surface : chaque fichier existe une fois, au bon
        // endroit, et aucun original ne s'est évaporé.
        let summary = apply(
            &OrganizeApplyRequest {
                root: dir.to_string_lossy().to_string(),
                moves: shallow
                    .moves
                    .iter()
                    .map(|m| PlannedMove { from: m.from.clone(), to: m.to.clone() })
                    .collect(),
            },
            &Reporter::silent(),
        )
        .unwrap();
        assert_eq!(summary.moved, 6);
        assert!(summary.failed.is_empty(), "{:?}", summary.failed);
        for expected in [
            "Images/photo.jpg",
            "Vidéos/video.mp4",
            "Documents/rapport.pdf",
            "Code/code.js",
            "Archives/archive.zip",
            "Autres/inconnu.xyz",
        ] {
            let moved = dir.join(expected);
            assert!(moved.exists(), "{expected} n'a pas été déplacé");
            let name = moved.file_name().unwrap().to_string_lossy().to_string();
            assert_eq!(fs::read(&moved).unwrap(), name.as_bytes(), "{expected} altéré");
            assert!(!dir.join(&name).exists(), "{name} est resté à la racine");
        }
        // Le sous-dossier n'a pas été touché par le plan de surface.
        assert!(dir.join("sous/dossier/enfoui.png").exists());
    }

    #[test]
    fn organize_apply_moves_and_never_overwrites() {
        let dir = temp_dir("apply");
        fs::write(dir.join("a.jpg"), b"un").unwrap();
        fs::create_dir_all(dir.join("Images")).unwrap();
        fs::write(dir.join("Images/a.jpg"), b"deja la").unwrap();

        let plan = plan(
            &OrganizeRequest { root: dir.to_string_lossy().to_string(), recursive: false },
            &Reporter::silent(),
        )
        .unwrap();
        let summary = apply(
            &OrganizeApplyRequest {
                root: dir.to_string_lossy().to_string(),
                moves: plan
                    .moves
                    .iter()
                    .map(|m| PlannedMove { from: m.from.clone(), to: m.to.clone() })
                    .collect(),
            },
            &Reporter::silent(),
        )
        .unwrap();

        assert_eq!(summary.moved, 1);
        assert_eq!(summary.renamed, 1);
        // Le fichier déjà présent est intact.
        assert_eq!(fs::read(dir.join("Images/a.jpg")).unwrap(), b"deja la");
        assert_eq!(fs::read(dir.join("Images/a (2).jpg")).unwrap(), b"un");
    }

    #[test]
    fn organize_leaves_hidden_files_and_symlinks_alone() {
        let dir = temp_dir("skip");
        fs::write(dir.join(".cache"), b"x").unwrap();
        fs::create_dir_all(dir.join("sous-dossier")).unwrap();

        let plan = plan(
            &OrganizeRequest { root: dir.to_string_lossy().to_string(), recursive: false },
            &Reporter::silent(),
        )
        .unwrap();
        assert!(plan.moves.is_empty());
        assert_eq!(plan.skipped.len(), 2);
    }

    #[test]
    fn organize_refuses_a_move_out_of_the_root() {
        let dir = temp_dir("escape");
        fs::write(dir.join("a.jpg"), b"x").unwrap();
        let summary = apply(
            &OrganizeApplyRequest {
                root: dir.to_string_lossy().to_string(),
                moves: vec![PlannedMove {
                    from: dir.join("a.jpg").to_string_lossy().to_string(),
                    to: "../evade.jpg".into(),
                }],
            },
            &Reporter::silent(),
        )
        .unwrap();
        assert_eq!(summary.moved, 0);
        assert_eq!(summary.failed.len(), 1);
        assert!(dir.join("a.jpg").exists());
    }

    #[test]
    fn wipe_requires_the_exact_confirmation() {
        let dir = temp_dir("confirm");
        let file = dir.join("secret.txt");
        fs::write(&file, b"contenu").unwrap();

        let error = wipe(
            &WipeRequest {
                paths: vec![file.to_string_lossy().to_string()],
                mode: WipeMode::Random,
                confirmation: "oui".into(),
            },
            &Reporter::silent(),
        )
        .unwrap_err();
        assert!(error.contains("Confirmation"));
        // Le fichier est toujours là : rien ne s'exécute sans confirmation.
        assert!(file.exists());
    }

    #[test]
    fn wipe_overwrites_then_deletes() {
        let dir = temp_dir("wipe");
        let file = dir.join("secret.txt");
        fs::write(&file, vec![b'A'; 8192]).unwrap();

        let summary = wipe(
            &WipeRequest {
                paths: vec![file.to_string_lossy().to_string()],
                mode: WipeMode::ThreePass,
                confirmation: CONFIRMATION.into(),
            },
            &Reporter::silent(),
        )
        .unwrap();

        assert_eq!(summary.deleted, 1);
        assert_eq!(summary.failed, 0);
        assert_eq!(summary.bytes, 8192);
        assert!(!file.exists());
        // Le nom d'origine ne doit plus apparaître dans le dossier.
        let remaining: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert!(remaining.is_empty(), "reste : {remaining:?}");
        assert!(summary.notice.contains("SSD"));
    }

    #[test]
    fn wipe_reports_a_missing_file_without_stopping() {
        let dir = temp_dir("missing");
        let present = dir.join("a.txt");
        fs::write(&present, b"x").unwrap();

        let summary = wipe(
            &WipeRequest {
                paths: vec![
                    dir.join("absent.txt").to_string_lossy().to_string(),
                    present.to_string_lossy().to_string(),
                ],
                mode: WipeMode::Random,
                confirmation: CONFIRMATION.into(),
            },
            &Reporter::silent(),
        )
        .unwrap();

        assert_eq!(summary.deleted, 1);
        assert_eq!(summary.failed, 1);
        assert!(!present.exists());
    }

    #[test]
    fn wipe_refuses_a_directory() {
        let dir = temp_dir("dir");
        let sub = dir.join("sous");
        fs::create_dir_all(&sub).unwrap();
        let summary = wipe(
            &WipeRequest {
                paths: vec![sub.to_string_lossy().to_string()],
                mode: WipeMode::Random,
                confirmation: CONFIRMATION.into(),
            },
            &Reporter::silent(),
        )
        .unwrap();
        assert_eq!(summary.failed, 1);
        assert!(sub.exists());
    }
}
