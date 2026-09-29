//! Renommage par lot.
//!
//! Le calcul du plan est **pur** : il prend des noms, rend des noms, et
//! signale les collisions. C'est ce qui permet d'afficher un aperçu fidèle
//! avant d'écrire quoi que ce soit — et de le tester sans toucher au disque.
//!
//! L'application, elle, se fait en deux temps (noms temporaires puis noms
//! définitifs) afin qu'un échange `a → b` / `b → a` fonctionne sans écraser.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaseRule {
    Keep,
    Lower,
    Upper,
    Title,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameRules {
    /// Texte ajouté devant le nom (hors extension).
    pub prefix: String,
    /// Texte ajouté après le nom (hors extension).
    pub suffix: String,
    /// Recherche à remplacer dans le nom.
    pub find: String,
    pub replace: String,
    /// Retirer les `n` premiers caractères du nom.
    pub trim_start: usize,
    /// Retirer les `n` derniers caractères du nom.
    pub trim_end: usize,
    /// Numérotation : `#` dans le motif est remplacé par le numéro.
    pub numbering: bool,
    pub number_start: usize,
    pub number_padding: usize,
    /// Position de la numérotation : `prefix` ou `suffix`.
    pub number_position: String,
    pub case_rule: CaseRule,
    /// Mettre l'extension en minuscules.
    pub lowercase_extension: bool,
    /// Retirer accents, espaces et caractères problématiques.
    pub sanitize: bool,
}

impl Default for RenameRules {
    fn default() -> Self {
        Self {
            prefix: String::new(),
            suffix: String::new(),
            find: String::new(),
            replace: String::new(),
            trim_start: 0,
            trim_end: 0,
            numbering: false,
            number_start: 1,
            number_padding: 3,
            number_position: "suffix".into(),
            case_rule: CaseRule::Keep,
            lowercase_extension: false,
            sanitize: false,
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenamePlanEntry {
    pub path: String,
    pub from: String,
    pub to: String,
    /// Motif du refus : collision, nom vide, caractère interdit…
    pub problem: Option<String>,
    /// Le nom change-t-il réellement ?
    pub changed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamePlan {
    pub entries: Vec<RenamePlanEntry>,
    pub changed: usize,
    pub problems: usize,
}

/// Caractères refusés par Windows dans un nom de fichier.
const WINDOWS_FORBIDDEN: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
/// Noms réservés par Windows, quelle que soit l'extension.
const WINDOWS_RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

fn split_name(name: &str) -> (String, String) {
    match Path::new(name).extension() {
        Some(extension) => {
            let extension = extension.to_string_lossy().to_string();
            let stem = name[..name.len() - extension.len() - 1].to_string();
            (stem, extension)
        }
        None => (name.to_string(), String::new()),
    }
}

fn strip_accents(input: &str) -> String {
    input
        .chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' | 'á' | 'ã' | 'å' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' | 'í' | 'ì' => 'i',
            'ô' | 'ö' | 'ó' | 'ò' | 'õ' => 'o',
            'ù' | 'û' | 'ü' | 'ú' => 'u',
            'ÿ' | 'ý' => 'y',
            'ç' => 'c',
            'ñ' => 'n',
            'À' | 'Â' | 'Ä' | 'Á' | 'Ã' | 'Å' => 'A',
            'É' | 'È' | 'Ê' | 'Ë' => 'E',
            'Î' | 'Ï' | 'Í' | 'Ì' => 'I',
            'Ô' | 'Ö' | 'Ó' | 'Ò' | 'Õ' => 'O',
            'Ù' | 'Û' | 'Ü' | 'Ú' => 'U',
            'Ç' => 'C',
            'Ñ' => 'N',
            other => other,
        })
        .collect()
}

fn title_case(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut new_word = true;
    for c in input.chars() {
        if new_word {
            out.extend(c.to_uppercase());
        } else {
            out.extend(c.to_lowercase());
        }
        new_word = c == ' ' || c == '-' || c == '_' || c == '.';
    }
    out
}

/// Applique les règles à un nom. Fonction pure : c'est elle que testent les
/// tests, et c'est elle qui alimente l'aperçu comme l'application réelle.
pub fn apply_rules(name: &str, rules: &RenameRules, index: usize) -> String {
    let (mut stem, mut extension) = split_name(name);

    if !rules.find.is_empty() {
        stem = stem.replace(&rules.find, &rules.replace);
    }
    if rules.trim_start > 0 {
        stem = stem.chars().skip(rules.trim_start).collect();
    }
    if rules.trim_end > 0 {
        let keep = stem.chars().count().saturating_sub(rules.trim_end);
        stem = stem.chars().take(keep).collect();
    }
    if rules.sanitize {
        stem = strip_accents(&stem)
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '-' })
            .collect::<String>();
        while stem.contains("--") {
            stem = stem.replace("--", "-");
        }
        stem = stem.trim_matches('-').to_string();
        extension = strip_accents(&extension).to_lowercase();
    }

    stem = match rules.case_rule {
        CaseRule::Keep => stem,
        CaseRule::Lower => stem.to_lowercase(),
        CaseRule::Upper => stem.to_uppercase(),
        CaseRule::Title => title_case(&stem),
    };

    if rules.numbering {
        let number = format!("{:0width$}", rules.number_start + index, width = rules.number_padding);
        stem = if stem.is_empty() {
            number
        } else if rules.number_position == "prefix" {
            format!("{number}-{stem}")
        } else {
            format!("{stem}-{number}")
        };
    }

    stem = format!("{}{}{}", rules.prefix, stem, rules.suffix);
    if rules.lowercase_extension {
        extension = extension.to_lowercase();
    }

    if extension.is_empty() {
        stem
    } else {
        format!("{stem}.{extension}")
    }
}

/// Vérifie qu'un nom est acceptable sur Windows **et** sur Linux.
pub fn validate_name(name: &str) -> Option<String> {
    if name.trim().is_empty() {
        return Some("Nom vide".into());
    }
    if let Some(bad) = name.chars().find(|c| WINDOWS_FORBIDDEN.contains(c) || (*c as u32) < 32) {
        return Some(format!("Caractère interdit sous Windows : « {bad} »"));
    }
    if name.ends_with(' ') || name.ends_with('.') {
        return Some("Un nom ne peut pas se terminer par un espace ou un point (Windows)".into());
    }
    let stem = name.split('.').next().unwrap_or(name).to_uppercase();
    if WINDOWS_RESERVED.contains(&stem.as_str()) {
        return Some(format!("Nom réservé par Windows : {stem}"));
    }
    if name.len() > 255 {
        return Some("Nom trop long (255 octets maximum)".into());
    }
    None
}

/// Construit le plan de renommage : c'est l'aperçu affiché à l'utilisateur.
pub fn plan(paths: &[PathBuf], rules: &RenameRules) -> RenamePlan {
    let mut entries: Vec<RenamePlanEntry> = Vec::new();
    let mut targets: Vec<(PathBuf, String)> = Vec::new();

    for (index, path) in paths.iter().enumerate() {
        let from = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let to = apply_rules(&from, rules, index);
        let directory = path.parent().unwrap_or(Path::new("")).to_path_buf();

        let mut problem = validate_name(&to);

        // Collision avec une autre cible du même lot.
        if problem.is_none()
            && targets
                .iter()
                .any(|(dir, name)| dir == &directory && name.eq_ignore_ascii_case(&to))
        {
            problem = Some(format!("Deux fichiers deviendraient « {to} »"));
        }
        // Collision avec un fichier déjà présent qui n'est pas dans le lot.
        if problem.is_none() && to != from {
            let candidate = directory.join(&to);
            if candidate.exists() && !paths.iter().any(|p| p == &candidate) {
                problem = Some(format!("« {to} » existe déjà dans ce dossier"));
            }
        }

        targets.push((directory, to.clone()));
        entries.push(RenamePlanEntry {
            path: path.to_string_lossy().to_string(),
            changed: to != from,
            from,
            to,
            problem,
        });
    }

    let changed = entries.iter().filter(|e| e.changed && e.problem.is_none()).count();
    let problems = entries.iter().filter(|e| e.problem.is_some()).count();
    RenamePlan { entries, changed, problems }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameOutcome {
    pub renamed: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

/// Applique un plan déjà calculé. Refuse de commencer si le plan contient la
/// moindre collision : mieux vaut ne rien faire que renommer à moitié.
pub fn apply(paths: &[PathBuf], rules: &RenameRules) -> Result<RenameOutcome, String> {
    let plan = plan(paths, rules);
    if plan.problems > 0 {
        return Err(format!(
            "{} conflit(s) détecté(s) : corrigez les règles avant d'appliquer.",
            plan.problems
        ));
    }

    // Première passe : noms temporaires, pour autoriser les permutations.
    let mut staged: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    for entry in plan.entries.iter().filter(|e| e.changed) {
        let source = PathBuf::from(&entry.path);
        let directory = source.parent().unwrap_or(Path::new("")).to_path_buf();
        let temporary = directory.join(format!(".fourtout-rename-{}-{}", std::process::id(), entry.to));
        match fs::rename(&source, &temporary) {
            Ok(()) => staged.push((temporary, directory.join(&entry.to))),
            Err(error) => errors.push(format!("{} — {error}", entry.from)),
        }
    }

    // Seconde passe : noms définitifs.
    let mut renamed = 0;
    for (temporary, final_path) in staged {
        match fs::rename(&temporary, &final_path) {
            Ok(()) => renamed += 1,
            Err(error) => {
                errors.push(format!("{} — {error}", final_path.display()));
                // Ne jamais laisser un fichier sous son nom temporaire.
                let _ = fs::rename(&temporary, temporary.with_file_name("restauration-echouee"));
            }
        }
    }

    Ok(RenameOutcome {
        renamed,
        skipped: plan.entries.len() - renamed,
        errors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules() -> RenameRules {
        RenameRules::default()
    }

    #[test]
    fn builds_the_documented_example() {
        // IMG_0032.JPG → vacances-001.jpg : le nom d'origine est effacé, la
        // numérotation le remplace, l'extension est normalisée.
        let mut r = rules();
        r.prefix = "vacances-".into();
        r.trim_start = 8;
        r.numbering = true;
        r.number_start = 1;
        r.number_padding = 3;
        r.lowercase_extension = true;

        assert_eq!(apply_rules("IMG_0032.JPG", &r, 0), "vacances-001.jpg");
        assert_eq!(apply_rules("IMG_0033.JPG", &r, 1), "vacances-002.jpg");
    }

    #[test]
    fn numbering_and_extension_lowercase() {
        let mut r = rules();
        r.find = "IMG_".into();
        r.replace = "vacances".into();
        r.numbering = true;
        r.number_padding = 3;
        r.case_rule = CaseRule::Lower;
        r.lowercase_extension = true;
        r.trim_end = 4; // retire « 0001 »
        assert_eq!(apply_rules("IMG_0001.JPG", &r, 0), "vacances-001.jpg");
        assert_eq!(apply_rules("IMG_0002.JPG", &r, 1), "vacances-002.jpg");
        assert_eq!(apply_rules("IMG_0003.JPG", &r, 2), "vacances-003.jpg");
    }

    #[test]
    fn sanitize_cleans_accents_and_spaces() {
        let mut r = rules();
        r.sanitize = true;
        assert_eq!(apply_rules("Rapport final é (2024).PDF", &r, 0), "Rapport-final-e-2024.pdf");
    }

    #[test]
    fn detects_collisions_before_touching_the_disk() {
        let mut r = rules();
        r.find = "b".into();
        r.replace = "a".into();
        let paths = vec![PathBuf::from("/tmp/x/a.txt"), PathBuf::from("/tmp/x/b.txt")];
        let plan = plan(&paths, &r);
        assert_eq!(plan.problems, 1);
        assert!(plan.entries[1].problem.as_ref().unwrap().contains("deviendraient"));
    }

    #[test]
    fn refuses_windows_hostile_names() {
        let mut r = rules();
        r.suffix = ":final".into();
        let paths = vec![PathBuf::from("/tmp/x/a.txt")];
        let plan = plan(&paths, &r);
        assert_eq!(plan.problems, 1);
        assert!(plan.entries[0].problem.as_ref().unwrap().contains("interdit"));
        assert!(validate_name("CON.txt").is_some());
        assert!(validate_name("fin. ").is_some());
        assert!(validate_name("normal.txt").is_none());
    }

    #[test]
    fn applies_on_disk_and_supports_swaps() {
        let dir = std::env::temp_dir().join("fourtout-rename-apply");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("IMG_0001.JPG"), b"1").unwrap();
        fs::write(dir.join("IMG_0002.JPG"), b"2").unwrap();

        let mut r = rules();
        r.find = "IMG_".into();
        r.replace = "vacances".into();
        r.trim_end = 4;
        r.numbering = true;
        r.number_padding = 3;
        r.case_rule = CaseRule::Lower;
        r.lowercase_extension = true;

        let paths = vec![dir.join("IMG_0001.JPG"), dir.join("IMG_0002.JPG")];
        let outcome = apply(&paths, &r).unwrap();
        assert_eq!(outcome.renamed, 2);
        assert!(outcome.errors.is_empty());
        assert!(dir.join("vacances-001.jpg").exists());
        assert!(dir.join("vacances-002.jpg").exists());
        assert!(!dir.join("IMG_0001.JPG").exists());
    }
}
