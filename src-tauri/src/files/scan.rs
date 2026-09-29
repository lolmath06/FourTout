//! Parcours de dossiers : taille occupée, arborescence, doublons.
//!
//! Les trois outils partagent le même parcours prudent : les liens symboliques
//! ne sont jamais suivis (un lien vers `/` ferait tourner l'analyse à l'infini)
//! et chaque étape vérifie l'annulation.

use std::cmp::Reverse;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::hash::{partial_sha256, sha256_file};
use super::Reporter;

/// Fenêtre lue pour l'empreinte partielle du détecteur de doublons.
const PARTIAL_WINDOW: usize = 64 * 1024;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionStat {
    pub extension: String,
    pub files: usize,
    pub bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderStats {
    pub path: String,
    pub total_bytes: u64,
    pub files: usize,
    pub directories: usize,
    pub symlinks: usize,
    /// Fichiers les plus volumineux, du plus gros au plus petit.
    pub largest: Vec<FileEntry>,
    /// Répartition par extension, de la plus volumineuse à la plus légère.
    pub by_extension: Vec<ExtensionStat>,
    /// Sous-dossiers de premier niveau, avec leur poids cumulé.
    pub children: Vec<FileEntry>,
    /// Dossiers illisibles (permissions), signalés plutôt que masqués.
    pub unreadable: Vec<String>,
}

struct Accumulator {
    total: u64,
    files: usize,
    directories: usize,
    symlinks: usize,
    largest: Vec<FileEntry>,
    by_extension: HashMap<String, (usize, u64)>,
    unreadable: Vec<String>,
}

const LARGEST_KEPT: usize = 20;

fn extension_of(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .filter(|e| !e.is_empty())
        .unwrap_or_else(|| "(sans extension)".to_string())
}

fn walk(path: &Path, accumulator: &mut Accumulator, reporter: &Reporter) -> Result<u64, String> {
    reporter.check()?;
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) => {
            accumulator.unreadable.push(format!("{} — {error}", path.display()));
            return Ok(0);
        }
    };

    let mut subtotal = 0_u64;
    for entry in entries.flatten() {
        reporter.check()?;
        let child = entry.path();
        let meta = match fs::symlink_metadata(&child) {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() {
            accumulator.symlinks += 1;
            continue;
        }
        if meta.is_dir() {
            accumulator.directories += 1;
            subtotal += walk(&child, accumulator, reporter)?;
        } else if meta.is_file() {
            let size = meta.len();
            subtotal += size;
            accumulator.files += 1;
            accumulator.total += size;
            let stat = accumulator.by_extension.entry(extension_of(&child)).or_insert((0, 0));
            stat.0 += 1;
            stat.1 += size;

            accumulator.largest.push(FileEntry {
                path: child.to_string_lossy().to_string(),
                name: child.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                size,
            });
            if accumulator.largest.len() > LARGEST_KEPT * 4 {
                accumulator.largest.sort_by_key(|entry| Reverse(entry.size));
                accumulator.largest.truncate(LARGEST_KEPT);
            }
            if accumulator.files % 200 == 0 {
                reporter.report(accumulator.total, 0, &format!("{} fichiers", accumulator.files));
            }
        }
    }
    Ok(subtotal)
}

/// Analyse la taille d'un dossier, récursivement.
pub fn folder_stats(root: &Path, reporter: &Reporter) -> Result<FolderStats, String> {
    if !root.is_dir() {
        return Err("Le chemin choisi n'est pas un dossier.".into());
    }
    let mut accumulator = Accumulator {
        total: 0,
        files: 0,
        directories: 0,
        symlinks: 0,
        largest: Vec::new(),
        by_extension: HashMap::new(),
        unreadable: Vec::new(),
    };

    // Poids de chaque sous-dossier de premier niveau : c'est la vue qui
    // répond réellement à « qu'est-ce qui prend de la place ? ».
    let mut children: Vec<FileEntry> = Vec::new();
    let entries = fs::read_dir(root).map_err(|e| format!("Dossier illisible : {e}"))?;
    for entry in entries.flatten() {
        reporter.check()?;
        let path = entry.path();
        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() {
            accumulator.symlinks += 1;
            continue;
        }
        if meta.is_dir() {
            accumulator.directories += 1;
            let size = walk(&path, &mut accumulator, reporter)?;
            children.push(FileEntry {
                path: path.to_string_lossy().to_string(),
                name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                size,
            });
        } else if meta.is_file() {
            let size = meta.len();
            accumulator.files += 1;
            accumulator.total += size;
            let stat = accumulator.by_extension.entry(extension_of(&path)).or_insert((0, 0));
            stat.0 += 1;
            stat.1 += size;
            accumulator.largest.push(FileEntry {
                path: path.to_string_lossy().to_string(),
                name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                size,
            });
        }
    }

    accumulator.largest.sort_by_key(|entry| Reverse(entry.size));
    accumulator.largest.truncate(LARGEST_KEPT);
    children.sort_by_key(|child| Reverse(child.size));

    let mut by_extension: Vec<ExtensionStat> = accumulator
        .by_extension
        .into_iter()
        .map(|(extension, (files, bytes))| ExtensionStat { extension, files, bytes })
        .collect();
    by_extension.sort_by_key(|stat| Reverse(stat.bytes));
    by_extension.truncate(30);

    Ok(FolderStats {
        path: root.to_string_lossy().to_string(),
        total_bytes: accumulator.total,
        files: accumulator.files,
        directories: accumulator.directories,
        symlinks: accumulator.symlinks,
        largest: accumulator.largest,
        by_extension,
        children,
        unreadable: accumulator.unreadable,
    })
}

/* ---------------------------------------------------------- arborescence */

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TreeOptions {
    /// Profondeur maximale (1 = contenu direct du dossier).
    pub max_depth: usize,
    pub include_hidden: bool,
    pub directories_only: bool,
    /// Noms de dossiers ignorés (`node_modules`, `.git`…).
    pub ignore: Vec<String>,
    /// Afficher la taille des fichiers.
    pub show_sizes: bool,
}

impl Default for TreeOptions {
    fn default() -> Self {
        Self {
            max_depth: 4,
            include_hidden: false,
            directories_only: false,
            ignore: vec!["node_modules".into(), ".git".into(), "target".into(), "dist".into()],
            show_sizes: false,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeResult {
    pub text: String,
    pub files: usize,
    pub directories: usize,
    /// La profondeur maximale a-t-elle tronqué l'affichage ?
    pub truncated: bool,
}

pub fn tree(root: &Path, options: &TreeOptions, reporter: &Reporter) -> Result<TreeResult, String> {
    if !root.is_dir() {
        return Err("Le chemin choisi n'est pas un dossier.".into());
    }
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| root.to_string_lossy().to_string());

    let mut lines = vec![format!("{name}/")];
    let mut files = 0_usize;
    let mut directories = 0_usize;
    let mut truncated = false;

    render(root, "", 1, options, &mut lines, &mut files, &mut directories, &mut truncated, reporter)?;

    Ok(TreeResult { text: lines.join("\n") + "\n", files, directories, truncated })
}

#[allow(clippy::too_many_arguments)]
fn render(
    directory: &Path,
    prefix: &str,
    depth: usize,
    options: &TreeOptions,
    lines: &mut Vec<String>,
    files: &mut usize,
    directories: &mut usize,
    truncated: &mut bool,
    reporter: &Reporter,
) -> Result<(), String> {
    reporter.check()?;
    let mut entries: Vec<PathBuf> = match fs::read_dir(directory) {
        Ok(iterator) => iterator.flatten().map(|e| e.path()).collect(),
        Err(_) => {
            lines.push(format!("{prefix}└── (dossier illisible)"));
            return Ok(());
        }
    };

    entries.retain(|path| {
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if !options.include_hidden && name.starts_with('.') {
            return false;
        }
        if options.ignore.iter().any(|ignored| ignored == &name) {
            return false;
        }
        if options.directories_only && !path.is_dir() {
            return false;
        }
        true
    });

    // Dossiers d'abord, puis ordre alphabétique : une arborescence se lit.
    entries.sort_by(|a, b| {
        let a_dir = a.is_dir();
        let b_dir = b.is_dir();
        b_dir.cmp(&a_dir).then_with(|| {
            a.file_name().unwrap_or_default().cmp(b.file_name().unwrap_or_default())
        })
    });

    let count = entries.len();
    for (index, path) in entries.into_iter().enumerate() {
        reporter.check()?;
        let last = index + 1 == count;
        let branch = if last { "└── " } else { "├── " };
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let meta = fs::symlink_metadata(&path).ok();
        let is_symlink = meta.as_ref().map(|m| m.file_type().is_symlink()).unwrap_or(false);
        let is_dir = !is_symlink && path.is_dir();

        if is_dir {
            *directories += 1;
            lines.push(format!("{prefix}{branch}{name}/"));
            if depth >= options.max_depth {
                if fs::read_dir(&path).map(|mut d| d.next().is_some()).unwrap_or(false) {
                    *truncated = true;
                    let child_prefix = format!("{prefix}{}", if last { "    " } else { "│   " });
                    lines.push(format!("{child_prefix}└── …"));
                }
                continue;
            }
            let child_prefix = format!("{prefix}{}", if last { "    " } else { "│   " });
            render(&path, &child_prefix, depth + 1, options, lines, files, directories, truncated, reporter)?;
        } else {
            *files += 1;
            let suffix = if is_symlink {
                " → (lien symbolique)".to_string()
            } else if options.show_sizes {
                format!(" ({} o)", meta.map(|m| m.len()).unwrap_or(0))
            } else {
                String::new()
            };
            lines.push(format!("{prefix}{branch}{name}{suffix}"));
        }
    }
    Ok(())
}

/* -------------------------------------------------------------- doublons */

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateOptions {
    /// Taille minimale prise en compte (les fichiers vides sont du bruit).
    pub min_size: u64,
    pub include_hidden: bool,
}

impl Default for DuplicateOptions {
    fn default() -> Self {
        Self { min_size: 1, include_hidden: false }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub hash: String,
    pub size: u64,
    pub files: Vec<FileEntry>,
    /// Espace récupérable si l'on ne garde qu'un exemplaire.
    pub reclaimable: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateReport {
    pub root: String,
    pub scanned: usize,
    pub groups: Vec<DuplicateGroup>,
    pub duplicate_files: usize,
    pub reclaimable: u64,
}

fn collect_files(
    directory: &Path,
    options: &DuplicateOptions,
    out: &mut Vec<(PathBuf, u64)>,
    reporter: &Reporter,
) -> Result<(), String> {
    reporter.check()?;
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        reporter.check()?;
        let path = entry.path();
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if !options.include_hidden && name.starts_with('.') {
            continue;
        }
        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            collect_files(&path, options, out, reporter)?;
        } else if meta.is_file() && meta.len() >= options.min_size {
            out.push((path, meta.len()));
        }
    }
    Ok(())
}

/// Détecte les fichiers identiques par **contenu**.
///
/// Trois passes, de la moins chère à la plus chère : taille, empreinte
/// partielle (64 Kio en trois points), puis SHA-256 complet. Rien n'est
/// supprimé ni déplacé : l'outil rend un rapport, l'utilisateur décide.
pub fn find_duplicates(
    root: &Path,
    options: &DuplicateOptions,
    reporter: &Reporter,
) -> Result<DuplicateReport, String> {
    if !root.is_dir() {
        return Err("Le chemin choisi n'est pas un dossier.".into());
    }
    let mut all: Vec<(PathBuf, u64)> = Vec::new();
    reporter.report(0, 0, "Inventaire des fichiers…");
    collect_files(root, options, &mut all, reporter)?;
    let scanned = all.len();

    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    for (path, size) in all {
        by_size.entry(size).or_default().push(path);
    }

    let candidates: Vec<(u64, Vec<PathBuf>)> =
        by_size.into_iter().filter(|(_, paths)| paths.len() > 1).collect();
    let total_candidates: usize = candidates.iter().map(|(_, p)| p.len()).sum();
    let mut processed = 0_usize;

    let mut groups: Vec<DuplicateGroup> = Vec::new();
    for (size, paths) in candidates {
        reporter.check()?;

        // Deuxième passe : empreinte partielle.
        let mut by_partial: HashMap<String, Vec<PathBuf>> = HashMap::new();
        for path in paths {
            reporter.check()?;
            processed += 1;
            reporter.report(processed as u64, total_candidates as u64, "Comparaison des contenus…");
            if let Ok(digest) = partial_sha256(&path, PARTIAL_WINDOW) {
                by_partial.entry(digest).or_default().push(path);
            }
        }

        // Troisième passe : SHA-256 complet, uniquement sur ce qui reste.
        for (_, group) in by_partial.into_iter().filter(|(_, g)| g.len() > 1) {
            let mut by_full: HashMap<String, Vec<PathBuf>> = HashMap::new();
            for path in group {
                reporter.check()?;
                if let Ok(digest) = sha256_file(&path) {
                    by_full.entry(digest).or_default().push(path);
                }
            }
            for (hash, mut identical) in by_full.into_iter().filter(|(_, g)| g.len() > 1) {
                identical.sort();
                let files: Vec<FileEntry> = identical
                    .iter()
                    .map(|path| FileEntry {
                        path: path.to_string_lossy().to_string(),
                        name: path
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default(),
                        size,
                    })
                    .collect();
                let reclaimable = size * (files.len() as u64 - 1);
                groups.push(DuplicateGroup { hash, size, files, reclaimable });
            }
        }
    }

    groups.sort_by_key(|group| Reverse(group.reclaimable));
    let duplicate_files = groups.iter().map(|g| g.files.len() - 1).sum();
    let reclaimable = groups.iter().map(|g| g.reclaimable).sum();

    Ok(DuplicateReport {
        root: root.to_string_lossy().to_string(),
        scanned,
        groups,
        duplicate_files,
        reclaimable,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fourtout-scan-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn groups_identical_files_only() {
        let root = workspace("dupes");
        fs::create_dir_all(root.join("nested")).unwrap();
        let content = vec![42_u8; 4096];
        fs::write(root.join("original.bin"), &content).unwrap();
        fs::write(root.join("copy.bin"), &content).unwrap();
        fs::write(root.join("nested/copy2.bin"), &content).unwrap();
        fs::write(root.join("different.bin"), vec![7_u8; 4096]).unwrap();

        let report =
            find_duplicates(&root, &DuplicateOptions::default(), &Reporter::silent()).unwrap();
        assert_eq!(report.scanned, 4);
        assert_eq!(report.groups.len(), 1);
        let names: Vec<&str> = report.groups[0].files.iter().map(|f| f.name.as_str()).collect();
        assert!(names.contains(&"original.bin"));
        assert!(names.contains(&"copy.bin"));
        assert!(names.contains(&"copy2.bin"));
        assert!(!names.contains(&"different.bin"));
        assert_eq!(report.duplicate_files, 2);
        assert_eq!(report.reclaimable, 4096 * 2);
    }

    #[test]
    fn folder_stats_counts_everything() {
        let root = workspace("stats");
        fs::create_dir_all(root.join("sub/deep")).unwrap();
        fs::write(root.join("a.txt"), vec![1_u8; 100]).unwrap();
        fs::write(root.join("sub/b.txt"), vec![1_u8; 200]).unwrap();
        fs::write(root.join("sub/deep/c.bin"), vec![1_u8; 300]).unwrap();

        let stats = folder_stats(&root, &Reporter::silent()).unwrap();
        assert_eq!(stats.files, 3);
        assert_eq!(stats.directories, 2);
        assert_eq!(stats.total_bytes, 600);
        assert_eq!(stats.largest[0].name, "c.bin");
        assert_eq!(stats.children[0].name, "sub");
        assert_eq!(stats.children[0].size, 500);
        let txt = stats.by_extension.iter().find(|e| e.extension == "txt").unwrap();
        assert_eq!(txt.files, 2);
        assert_eq!(txt.bytes, 300);
    }

    #[test]
    fn tree_respects_depth_and_ignores() {
        let root = workspace("tree");
        fs::create_dir_all(root.join("src/deep/deeper")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join("package.json"), b"{}").unwrap();
        fs::write(root.join("src/main.ts"), b"x").unwrap();
        fs::write(root.join("src/deep/deeper/z.ts"), b"x").unwrap();
        fs::write(root.join("node_modules/pkg/index.js"), b"x").unwrap();

        let options = TreeOptions { max_depth: 2, ..Default::default() };
        let result = tree(&root, &options, &Reporter::silent()).unwrap();
        assert!(result.text.contains("src/"));
        assert!(result.text.contains("main.ts"));
        assert!(result.text.contains("package.json"));
        assert!(!result.text.contains("node_modules"));
        assert!(result.truncated);
    }
}
