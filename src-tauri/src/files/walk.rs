//! Parcours d'arborescence commun à la comparaison, la synchronisation, la
//! recherche, la sauvegarde et les manifestes.
//!
//! Trois règles y sont centralisées, parce qu'une seule d'entre elles oubliée
//! quelque part suffirait à faire tourner une analyse à l'infini ou à écrire
//! hors du dossier choisi :
//!
//! 1. **Les liens symboliques ne sont pas suivis par défaut.** Ils sont
//!    inventoriés et rapportés ; les suivre est une option explicite, et même
//!    alors une cible *hors* du dossier de départ reste refusée.
//! 2. **Une clé logique, pas un chemin système.** Chaque entrée est identifiée
//!    par son chemin relatif normalisé avec des `/`, pour que `left/docs/a.txt`
//!    et `right\docs\a.txt` désignent bien la même entrée.
//! 3. **Les erreurs de lecture sont des avertissements**, pas des échecs : un
//!    dossier interdit ne doit pas faire perdre l'analyse des mille autres.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use super::Reporter;

/// Politique appliquée aux liens symboliques rencontrés.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SymlinkPolicy {
    /// Le lien est inventorié et signalé, jamais suivi. Valeur par défaut.
    #[default]
    Report,
    /// Le lien est ignoré en silence (il reste compté dans le rapport).
    Skip,
    /// Le lien est suivi **si et seulement si** sa cible reste sous la racine.
    FollowInside,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkOptions {
    #[serde(default = "yes")]
    pub recursive: bool,
    #[serde(default)]
    pub include_hidden: bool,
    #[serde(default)]
    pub symlinks: SymlinkPolicy,
}

fn yes() -> bool {
    true
}

impl Default for WalkOptions {
    fn default() -> Self {
        Self { recursive: true, include_hidden: false, symlinks: SymlinkPolicy::Report }
    }
}

/// Une entrée rencontrée pendant le parcours.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkEntry {
    /// Chemin relatif à la racine, séparateurs `/`. Clé logique de l'entrée.
    pub relative: String,
    /// Chemin absolu sur ce système.
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    /// Millisecondes depuis l'époque Unix, 0 si indisponible.
    pub modified: u64,
}

/// Ce que le parcours a rencontré d'anormal, à rapporter sans faire échouer.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkNotes {
    /// Liens symboliques rencontrés, chemin relatif et cible.
    pub symlinks: Vec<String>,
    /// Dossiers ou fichiers illisibles, avec la raison.
    pub unreadable: Vec<String>,
    pub files: usize,
    pub directories: usize,
    pub bytes: u64,
}

pub fn millis(time: Option<std::time::SystemTime>) -> u64 {
    time.and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Un nom est-il « caché » sur cette plateforme ?
fn is_hidden(path: &Path, meta: &fs::Metadata) -> bool {
    let dotted = path
        .file_name()
        .map(|name| name.to_string_lossy().starts_with('.'))
        .unwrap_or(false);
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        return dotted || (meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN) != 0;
    }
    #[cfg(not(windows))]
    {
        let _ = meta;
        dotted
    }
}

fn join_relative(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        name.to_string()
    } else {
        format!("{prefix}/{name}")
    }
}

/// Parcourt `root` et remet chaque entrée au visiteur, au fil de l'eau.
///
/// Le visiteur peut renvoyer `Err` pour interrompre (l'annulation passe par le
/// rapporteur, elle). Rien n'est accumulé ici : c'est ce qui permet à la
/// recherche d'afficher des résultats sans avoir d'abord chargé un million
/// d'entrées en mémoire.
pub fn walk<F>(
    root: &Path,
    options: &WalkOptions,
    reporter: &Reporter,
    mut visit: F,
) -> Result<WalkNotes, String>
where
    F: FnMut(&WalkEntry) -> Result<(), String>,
{
    if !root.is_dir() {
        return Err(format!("Dossier introuvable : {}", root.display()));
    }
    let mut notes = WalkNotes::default();
    let canonical_root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let mut visited: HashSet<PathBuf> = HashSet::new();
    visited.insert(canonical_root.clone());

    // Pile explicite : une arborescence profonde ne doit pas faire déborder la
    // pile d'exécution, et l'annulation reste vérifiable à chaque tour.
    let mut stack: Vec<(PathBuf, String)> = vec![(root.to_path_buf(), String::new())];

    while let Some((directory, prefix)) = stack.pop() {
        reporter.check()?;
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) => {
                notes.unreadable.push(format!("{} — {error}", directory.display()));
                continue;
            }
        };

        for entry in entries {
            reporter.check()?;
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    notes.unreadable.push(format!("{} — {error}", directory.display()));
                    continue;
                }
            };
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let meta = match fs::symlink_metadata(&path) {
                Ok(meta) => meta,
                Err(error) => {
                    notes.unreadable.push(format!("{} — {error}", path.display()));
                    continue;
                }
            };
            if !options.include_hidden && is_hidden(&path, &meta) {
                continue;
            }
            let relative = join_relative(&prefix, &name);

            if meta.file_type().is_symlink() {
                let target = fs::read_link(&path)
                    .map(|t| t.to_string_lossy().to_string())
                    .unwrap_or_else(|_| "cible illisible".into());
                notes.symlinks.push(format!("{relative} → {target}"));
                if options.symlinks != SymlinkPolicy::FollowInside {
                    continue;
                }
                // Suivre un lien n'est permis que vers l'intérieur de la
                // racine : sinon une sauvegarde de `~/photos` pourrait aspirer
                // tout le disque par un simple raccourci.
                let Ok(resolved) = fs::canonicalize(&path) else {
                    notes.unreadable.push(format!("{relative} — cible du lien illisible"));
                    continue;
                };
                if !resolved.starts_with(&canonical_root) {
                    notes.unreadable.push(format!(
                        "{relative} — lien vers l'extérieur du dossier, non suivi"
                    ));
                    continue;
                }
                if !visited.insert(resolved.clone()) {
                    // Déjà vu : c'est une boucle, on s'arrête là.
                    continue;
                }
                let resolved_meta = match fs::metadata(&path) {
                    Ok(meta) => meta,
                    Err(error) => {
                        notes.unreadable.push(format!("{} — {error}", path.display()));
                        continue;
                    }
                };
                if resolved_meta.is_dir() {
                    notes.directories += 1;
                    let record = WalkEntry {
                        relative: relative.clone(),
                        path: path.to_string_lossy().to_string(),
                        name,
                        is_dir: true,
                        size: 0,
                        modified: millis(resolved_meta.modified().ok()),
                    };
                    visit(&record)?;
                    if options.recursive {
                        stack.push((path, relative));
                    }
                    continue;
                }
                notes.files += 1;
                notes.bytes += resolved_meta.len();
                visit(&WalkEntry {
                    relative,
                    path: path.to_string_lossy().to_string(),
                    name,
                    is_dir: false,
                    size: resolved_meta.len(),
                    modified: millis(resolved_meta.modified().ok()),
                })?;
                continue;
            }

            if meta.is_dir() {
                notes.directories += 1;
                visit(&WalkEntry {
                    relative: relative.clone(),
                    path: path.to_string_lossy().to_string(),
                    name,
                    is_dir: true,
                    size: 0,
                    modified: millis(meta.modified().ok()),
                })?;
                if options.recursive {
                    stack.push((path, relative));
                }
            } else if meta.is_file() {
                notes.files += 1;
                notes.bytes += meta.len();
                visit(&WalkEntry {
                    relative,
                    path: path.to_string_lossy().to_string(),
                    name,
                    is_dir: false,
                    size: meta.len(),
                    modified: millis(meta.modified().ok()),
                })?;
            }
        }
    }

    Ok(notes)
}

/// Parcours complet, entrées collectées et triées par chemin relatif.
pub fn collect(
    root: &Path,
    options: &WalkOptions,
    reporter: &Reporter,
) -> Result<(Vec<WalkEntry>, WalkNotes), String> {
    let mut entries = Vec::new();
    let notes = walk(root, options, reporter, |entry| {
        entries.push(entry.clone());
        Ok(())
    })?;
    entries.sort_by(|a, b| a.relative.cmp(&b.relative));
    Ok((entries, notes))
}

/// Clé de rapprochement entre deux arborescences.
///
/// Sous Windows, deux fichiers dont les noms ne diffèrent que par la casse sont
/// le même fichier ; sous Linux, ce sont deux fichiers distincts. Forcer l'une
/// ou l'autre sémantique partout produirait des faux « identiques » d'un côté
/// et des faux « manquants » de l'autre : la clé suit donc la plateforme.
pub fn match_key(relative: &str) -> String {
    #[cfg(windows)]
    {
        relative.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        relative.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    pub fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("fourtout-walk-tests").join(name);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(root: &Path, relative: &str, content: &[u8]) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        File::create(&path).unwrap().write_all(content).unwrap();
    }

    #[test]
    fn walks_recursively_with_relative_keys() {
        let root = scratch("recursive");
        write(&root, "a.txt", b"a");
        write(&root, "nested/b.txt", b"bb");
        write(&root, "nested/deep/c.txt", b"ccc");

        let (entries, notes) = collect(&root, &WalkOptions::default(), &Reporter::silent()).unwrap();
        let files: Vec<&str> =
            entries.iter().filter(|e| !e.is_dir).map(|e| e.relative.as_str()).collect();
        assert_eq!(files, vec!["a.txt", "nested/b.txt", "nested/deep/c.txt"]);
        assert_eq!(notes.files, 3);
        assert_eq!(notes.directories, 2);
        assert_eq!(notes.bytes, 6);
    }

    #[test]
    fn non_recursive_stops_at_the_first_level() {
        let root = scratch("flat");
        write(&root, "a.txt", b"a");
        write(&root, "nested/b.txt", b"bb");

        let options = WalkOptions { recursive: false, ..Default::default() };
        let (entries, _) = collect(&root, &options, &Reporter::silent()).unwrap();
        let files: Vec<&str> =
            entries.iter().filter(|e| !e.is_dir).map(|e| e.relative.as_str()).collect();
        assert_eq!(files, vec!["a.txt"]);
    }

    #[test]
    fn hidden_entries_need_an_explicit_opt_in() {
        let root = scratch("hidden");
        write(&root, "visible.txt", b"a");
        write(&root, ".secret.txt", b"b");

        let (entries, _) = collect(&root, &WalkOptions::default(), &Reporter::silent()).unwrap();
        assert_eq!(entries.len(), 1);

        let options = WalkOptions { include_hidden: true, ..Default::default() };
        let (entries, _) = collect(&root, &options, &Reporter::silent()).unwrap();
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn cancellation_stops_the_walk() {
        let root = scratch("cancel");
        write(&root, "a.txt", b"a");
        let outcome = collect(&root, &WalkOptions::default(), &Reporter::silent_cancelled());
        assert_eq!(outcome.unwrap_err(), super::super::CANCELLED);
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_reported_and_never_followed_outside() {
        use std::os::unix::fs::symlink;
        let outside = scratch("symlink-outside");
        write(&outside, "secret.txt", b"secret");
        let root = scratch("symlink-root");
        write(&root, "a.txt", b"a");
        symlink(&outside, root.join("escape")).unwrap();

        // Politique par défaut : signalé, pas suivi.
        let (entries, notes) = collect(&root, &WalkOptions::default(), &Reporter::silent()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(notes.symlinks.len(), 1);
        assert!(notes.symlinks[0].starts_with("escape → "));

        // Même en suivant les liens, une cible hors du dossier reste refusée.
        let options =
            WalkOptions { symlinks: SymlinkPolicy::FollowInside, ..Default::default() };
        let (entries, notes) = collect(&root, &options, &Reporter::silent()).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(notes.unreadable.iter().any(|note| note.contains("extérieur")));
    }

    #[cfg(unix)]
    #[test]
    fn inside_symlink_loops_are_not_infinite() {
        use std::os::unix::fs::symlink;
        let root = scratch("symlink-loop");
        write(&root, "nested/a.txt", b"a");
        symlink(&root, root.join("nested/loop")).unwrap();

        let options =
            WalkOptions { symlinks: SymlinkPolicy::FollowInside, ..Default::default() };
        let (entries, _) = collect(&root, &options, &Reporter::silent()).unwrap();
        // Le parcours termine, et ne visite la boucle qu'une fois.
        assert!(entries.iter().any(|e| e.relative == "nested/a.txt"));
        assert!(entries.len() < 10);
    }
}
