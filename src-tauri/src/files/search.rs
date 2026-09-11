//! Recherche de fichiers à la demande.
//!
//! Ce n'est **pas** un indexeur : rien n'est mémorisé entre deux recherches,
//! aucun service ne tourne en fond, aucune base ne grossit dans le dossier de
//! l'utilisateur. Chaque recherche part du dossier choisi et s'arrête quand on
//! le lui demande.
//!
//! Les critères se cumulent : un fichier doit satisfaire **tous** ceux qui sont
//! renseignés. La recherche de contenu, elle, n'est tentée que sur ce qui
//! ressemble vraiment à du texte — interpréter un binaire comme du texte
//! produirait des correspondances qui n'existent pas.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::textscan;
use super::walk::{self, WalkOptions};
use super::Reporter;

/// Au-delà, un fichier n'est plus lu pour la recherche de contenu : on le
/// signale plutôt que de charger 800 Mo de journal en mémoire.
const CONTENT_LIMIT: u64 = 64 * 1024 * 1024;
/// Fenêtre lue pour décider « texte ou binaire ».
const SNIFF: usize = 8192;
/// Caractères montrés de part et d'autre d'une correspondance.
const EXCERPT_MARGIN: usize = 48;
/// Résultats groupés avant publication à l'interface.
const BATCH: usize = 25;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub root: String,
    /// Fragment recherché dans le nom du fichier (insensible à la casse).
    #[serde(default)]
    pub name: String,
    /// Extensions acceptées, sans point. Vide = toutes.
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub min_size: Option<u64>,
    #[serde(default)]
    pub max_size: Option<u64>,
    /// Bornes de date de modification, en millisecondes depuis l'époque Unix.
    #[serde(default)]
    pub modified_after: Option<u64>,
    #[serde(default)]
    pub modified_before: Option<u64>,
    /// Texte recherché dans le contenu. Vide = pas de lecture de contenu.
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default)]
    pub walk: WalkOptions,
    /// Garde-fou : au-delà, la recherche s'arrête et le dit.
    #[serde(default)]
    pub max_results: Option<usize>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub relative: String,
    pub name: String,
    pub size: u64,
    pub modified: u64,
    pub extension: String,
    /// Ce qui a fait correspondre ce fichier, affichable tel quel.
    pub reason: String,
    /// Numéro de ligne de la première correspondance de contenu.
    pub line: Option<usize>,
    /// Extrait autour de la correspondance, avec son contexte.
    pub excerpt: Option<String>,
    /// Nombre total de correspondances dans le fichier.
    pub matches: usize,
    /// Encodage employé pour lire le contenu, quand il a été lu.
    pub encoding: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchReport {
    pub root: String,
    pub hits: Vec<SearchHit>,
    pub scanned_files: usize,
    pub scanned_directories: usize,
    /// Fichiers effectivement ouverts pour la recherche de contenu.
    pub read_files: usize,
    /// Fichiers écartés du contenu parce qu'ils sont binaires.
    pub binary_skipped: usize,
    /// Fichiers écartés du contenu parce qu'ils sont trop volumineux.
    pub too_large: usize,
    /// La limite de résultats a-t-elle été atteinte ?
    pub truncated: bool,
    pub warnings: Vec<String>,
}

fn extension_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn is_word_boundary(text: &str, start: usize, end: usize) -> bool {
    let before = text[..start].chars().next_back();
    let after = text[end..].chars().next();
    let boundary = |c: Option<char>| match c {
        None => true,
        Some(c) => !c.is_alphanumeric() && c != '_',
    };
    boundary(before) && boundary(after)
}

/// Position de toutes les correspondances, en indices d'octets du texte décodé.
fn find_matches(text: &str, needle: &str, case_sensitive: bool, whole_word: bool) -> Vec<usize> {
    if needle.is_empty() {
        return Vec::new();
    }
    let (haystack, needle) = if case_sensitive {
        (text.to_string(), needle.to_string())
    } else {
        (text.to_lowercase(), needle.to_lowercase())
    };
    // Le passage en minuscules peut changer la longueur en octets (ex. « İ ») ;
    // on ne s'en sert donc que lorsque les deux chaînes coïncident en longueur,
    // et on retombe sinon sur une recherche sensible à la casse.
    if haystack.len() != text.len() {
        return find_matches(text, &needle, true, whole_word);
    }

    let mut positions = Vec::new();
    let mut from = 0_usize;
    while let Some(offset) = haystack[from..].find(&needle) {
        let start = from + offset;
        let end = start + needle.len();
        if !whole_word || is_word_boundary(&haystack, start, end) {
            positions.push(start);
        }
        from = end.max(start + 1);
        if from >= haystack.len() {
            break;
        }
    }
    positions
}

/// Extrait lisible autour d'une correspondance, coupé sur des frontières de
/// caractères (jamais au milieu d'un caractère accentué).
fn excerpt_around(text: &str, position: usize, length: usize) -> String {
    let start = text[..position]
        .char_indices()
        .rev()
        .take(EXCERPT_MARGIN)
        .last()
        .map(|(index, _)| index)
        .unwrap_or(position);
    let tail = position + length;
    let end = text[tail.min(text.len())..]
        .char_indices()
        .take(EXCERPT_MARGIN)
        .last()
        .map(|(index, character)| tail + index + character.len_utf8())
        .unwrap_or_else(|| text.len());
    let mut excerpt = String::new();
    if start > 0 {
        excerpt.push('…');
    }
    excerpt.push_str(text[start..end].trim_end_matches(['\r', '\n']));
    if end < text.len() {
        excerpt.push('…');
    }
    excerpt.replace(['\r', '\n'], " ")
}

fn line_of(text: &str, position: usize) -> usize {
    text[..position].bytes().filter(|byte| *byte == b'\n').count() + 1
}

/// Lance la recherche. Les résultats sont publiés par lots au fil de l'eau.
pub fn search(query: &SearchQuery, reporter: &Reporter) -> Result<SearchReport, String> {
    let root = Path::new(&query.root);
    let needle_name = query.name.to_lowercase();
    let extensions: Vec<String> =
        query.extensions.iter().map(|e| e.trim_start_matches('.').to_lowercase()).collect();
    let wants_content = !query.content.is_empty();
    let limit = query.max_results.unwrap_or(usize::MAX);

    let mut report = SearchReport { root: query.root.clone(), ..Default::default() };
    let mut pending: Vec<SearchHit> = Vec::new();
    let mut buffer = vec![0_u8; SNIFF];

    let notes = walk::walk(root, &query.walk, reporter, |entry| {
        if entry.is_dir {
            report.scanned_directories += 1;
            return Ok(());
        }
        report.scanned_files += 1;
        if report.scanned_files % 50 == 0 {
            reporter.report(
                report.scanned_files as u64,
                0,
                &format!(
                    "{} dossier(s), {} fichier(s), {} résultat(s)",
                    report.scanned_directories,
                    report.scanned_files,
                    report.hits.len() + pending.len()
                ),
            );
        }
        if report.hits.len() + pending.len() >= limit {
            report.truncated = true;
            return Err(super::CANCELLED.to_string());
        }

        // --- critères qui ne coûtent rien --------------------------------
        if !needle_name.is_empty() && !entry.name.to_lowercase().contains(&needle_name) {
            return Ok(());
        }
        let extension = extension_of(&entry.name);
        if !extensions.is_empty() && !extensions.contains(&extension) {
            return Ok(());
        }
        if let Some(min) = query.min_size {
            if entry.size < min {
                return Ok(());
            }
        }
        if let Some(max) = query.max_size {
            if entry.size > max {
                return Ok(());
            }
        }
        if let Some(after) = query.modified_after {
            if entry.modified < after {
                return Ok(());
            }
        }
        if let Some(before) = query.modified_before {
            if entry.modified > before {
                return Ok(());
            }
        }

        let mut reason = String::new();
        let mut line = None;
        let mut excerpt = None;
        let mut matches = 0_usize;
        let mut encoding = None;

        // --- contenu : seulement si demandé, et seulement si c'est du texte
        if wants_content {
            if entry.size > CONTENT_LIMIT {
                report.too_large += 1;
                return Ok(());
            }
            let path = Path::new(&entry.path);
            let mut file = match File::open(path) {
                Ok(file) => file,
                Err(error) => {
                    report.warnings.push(format!("{} — {error}", entry.relative));
                    return Ok(());
                }
            };
            let read = file.read(&mut buffer).unwrap_or(0);
            if !textscan::looks_like_text(&buffer[..read]) {
                report.binary_skipped += 1;
                return Ok(());
            }
            let mut bytes = Vec::with_capacity(entry.size as usize + 16);
            bytes.extend_from_slice(&buffer[..read]);
            if let Err(error) = file.read_to_end(&mut bytes) {
                report.warnings.push(format!("{} — {error}", entry.relative));
                return Ok(());
            }
            report.read_files += 1;

            let detection = textscan::detect(&bytes);
            if detection.binary {
                report.binary_skipped += 1;
                return Ok(());
            }
            let text = textscan::decode(&bytes, detection.encoding);
            let positions =
                find_matches(&text, &query.content, query.case_sensitive, query.whole_word);
            if positions.is_empty() {
                return Ok(());
            }
            matches = positions.len();
            line = Some(line_of(&text, positions[0]));
            excerpt = Some(excerpt_around(&text, positions[0], query.content.len()));
            encoding = Some(detection.encoding.id().to_string());
            reason = format!(
                "{matches} occurrence(s) de « {} », ligne {}",
                query.content,
                line.unwrap_or(1)
            );
        }

        if reason.is_empty() {
            let mut parts = Vec::new();
            if !needle_name.is_empty() {
                parts.push("nom".to_string());
            }
            if !extensions.is_empty() {
                parts.push(format!("extension .{extension}"));
            }
            if query.min_size.is_some() || query.max_size.is_some() {
                parts.push("taille".to_string());
            }
            if query.modified_after.is_some() || query.modified_before.is_some() {
                parts.push("date".to_string());
            }
            reason = if parts.is_empty() {
                "Tous les fichiers du dossier.".to_string()
            } else {
                format!("Correspond : {}.", parts.join(", "))
            };
        }

        pending.push(SearchHit {
            path: entry.path.clone(),
            relative: entry.relative.clone(),
            name: entry.name.clone(),
            size: entry.size,
            modified: entry.modified,
            extension,
            reason,
            line,
            excerpt,
            matches,
            encoding,
        });
        if pending.len() >= BATCH {
            reporter.partial(&pending);
            report.hits.append(&mut pending);
        }
        Ok(())
    });

    match notes {
        Ok(notes) => {
            report.warnings.extend(notes.unreadable);
            if !notes.symlinks.is_empty() {
                report.warnings.push(format!(
                    "{} lien(s) symbolique(s) rencontré(s), non suivis.",
                    notes.symlinks.len()
                ));
            }
        }
        // La limite de résultats interrompt le parcours par le même chemin que
        // l'annulation : il faut les distinguer avant de conclure.
        Err(error) if error == super::CANCELLED && report.truncated => {}
        Err(error) => return Err(error),
    }

    if !pending.is_empty() {
        reporter.partial(&pending);
        report.hits.append(&mut pending);
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;

    /// Chaque test a son arborescence : les tests tournent en parallèle, et
    /// une racine partagée les ferait s'effacer mutuellement.
    fn tree(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join("fourtout-search-tests").join(name);
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let write = |relative: &str, content: &[u8]| {
            let path = root.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::File::create(&path).unwrap().write_all(content).unwrap();
        };
        write("notes.txt", "FourTout range les fichiers.\nDeuxieme ligne.\n".as_bytes());
        write("facture-2024.md", "# Facture\nMontant : 42 EUR\nfourtout\n".as_bytes());
        write("data.json", br#"{"outil":"FourTout","version":9}"#);
        write("sous-dossier/rapport accentué.txt", "Une facture détaillée.\n".as_bytes());
        write("sous-dossier/gros.bin", &vec![b'x'; 200_000]);
        // Binaire : contient des octets de contrôle, et le mot cherché.
        let mut binaire = vec![0x00, 0x01, 0x02, 0x03, 0x1B, 0x7F];
        binaire.extend_from_slice(b"FourTout");
        binaire.extend_from_slice(&[0x00, 0x01, 0x02, 0x03, 0x1B, 0x7F]);
        write("image.bin", &binaire);
        // UTF-16 LE sans BOM.
        let mut utf16 = Vec::new();
        for byte in "FourTout en UTF-16".as_bytes() {
            utf16.push(*byte);
            utf16.push(0);
        }
        write("utf16.txt", &utf16);
        // Windows-1252.
        write("win1252.txt", b"Une facture cr\xe9\xe9e l\x92an dernier.\n");
        root
    }

    fn query(root: &Path) -> SearchQuery {
        SearchQuery { root: root.to_string_lossy().to_string(), ..Default::default() }
    }

    fn names(report: &SearchReport) -> Vec<String> {
        let mut names: Vec<String> = report.hits.iter().map(|h| h.relative.clone()).collect();
        names.sort();
        names
    }

    #[test]
    fn filters_by_name_and_extension() {
        let root = tree("name-ext");
        let mut q = query(&root);
        q.name = "facture".into();
        let report = search(&q, &Reporter::silent()).unwrap();
        assert_eq!(names(&report), vec!["facture-2024.md"]);

        let mut q = query(&root);
        q.extensions = vec!["txt".into()];
        let report = search(&q, &Reporter::silent()).unwrap();
        assert_eq!(
            names(&report),
            vec!["notes.txt", "sous-dossier/rapport accentué.txt", "utf16.txt", "win1252.txt"]
        );
    }

    #[test]
    fn filters_by_size_and_date() {
        let root = tree("size-date");
        let mut q = query(&root);
        q.min_size = Some(100_000);
        let report = search(&q, &Reporter::silent()).unwrap();
        assert_eq!(names(&report), vec!["sous-dossier/gros.bin"]);

        let mut q = query(&root);
        q.max_size = Some(10);
        let report = search(&q, &Reporter::silent()).unwrap();
        assert!(report.hits.is_empty());

        let mut q = query(&root);
        q.modified_after = Some(1);
        let report = search(&q, &Reporter::silent()).unwrap();
        assert_eq!(report.hits.len(), 8);
        let mut q = query(&root);
        q.modified_before = Some(1);
        assert!(search(&q, &Reporter::silent()).unwrap().hits.is_empty());
    }

    #[test]
    fn content_search_ignores_binaries() {
        let root = tree("binary");
        let mut q = query(&root);
        q.content = "FourTout".into();
        let report = search(&q, &Reporter::silent()).unwrap();
        assert!(names(&report).contains(&"notes.txt".to_string()));
        assert!(names(&report).contains(&"data.json".to_string()));
        assert!(
            !names(&report).contains(&"image.bin".to_string()),
            "un binaire ne doit jamais être lu comme du texte"
        );
        assert_eq!(report.binary_skipped, 1, "seul image.bin est réellement binaire");
    }

    #[test]
    fn content_search_is_case_insensitive_by_default() {
        let root = tree("case");
        let mut q = query(&root);
        q.content = "fourtout".into();
        let insensitive = search(&q, &Reporter::silent()).unwrap();
        assert!(names(&insensitive).contains(&"notes.txt".to_string()));

        q.case_sensitive = true;
        let sensitive = search(&q, &Reporter::silent()).unwrap();
        assert_eq!(names(&sensitive), vec!["facture-2024.md"]);
    }

    #[test]
    fn content_search_reads_utf16_and_windows_1252() {
        let root = tree("encodings");
        let mut q = query(&root);
        q.content = "UTF-16".into();
        let report = search(&q, &Reporter::silent()).unwrap();
        let hit = report.hits.iter().find(|h| h.relative == "utf16.txt").unwrap();
        assert_eq!(hit.encoding.as_deref(), Some("utf-16le"));

        let mut q = query(&root);
        q.content = "créée".into();
        let report = search(&q, &Reporter::silent()).unwrap();
        let hit = report.hits.iter().find(|h| h.relative == "win1252.txt").unwrap();
        assert_eq!(hit.encoding.as_deref(), Some("windows-1252"));
        assert_eq!(hit.line, Some(1));
        assert!(hit.excerpt.as_deref().unwrap().contains("facture"));
    }

    #[test]
    fn criteria_combine() {
        let root = tree("combined");
        let mut q = query(&root);
        q.extensions = vec!["md".into()];
        q.content = "fourtout".into();
        let report = search(&q, &Reporter::silent()).unwrap();
        assert_eq!(names(&report), vec!["facture-2024.md"]);
    }

    #[test]
    fn non_recursive_search_stays_at_the_top_level() {
        let root = tree("recursive");
        let mut q = query(&root);
        q.name = "rapport".into();
        assert_eq!(search(&q, &Reporter::silent()).unwrap().hits.len(), 1);
        q.walk.recursive = false;
        assert!(search(&q, &Reporter::silent()).unwrap().hits.is_empty());
    }

    #[test]
    fn result_limit_is_announced_not_silent() {
        let root = tree("limit");
        let mut q = query(&root);
        q.max_results = Some(2);
        let report = search(&q, &Reporter::silent()).unwrap();
        assert!(report.truncated);
        assert_eq!(report.hits.len(), 2);
    }

    #[test]
    fn cancellation_stops_the_search() {
        let root = tree("cancel");
        let outcome = search(&query(&root), &Reporter::silent_cancelled());
        assert_eq!(outcome.unwrap_err(), super::super::CANCELLED);
    }
}
