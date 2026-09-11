//! Manifestes d'empreintes et HMAC.
//!
//! Un manifeste de checksums répond à une question précise : « ce dossier est-il
//! encore exactement celui que j'ai gravé / envoyé / archivé il y a six mois ? »
//! Il doit donc être lisible par autre chose que FourTout : le format texte
//! produit ici est celui de `sha256sum`, `shasum` et de tous leurs équivalents.
//!
//! Deux règles de sûreté y sont non négociables.
//!
//! **Un manifeste est une donnée, pas une instruction.** Un chemin `../../` ou
//! `/etc/passwd` dans un fichier `.sha256` reçu de l'extérieur ne doit jamais
//! faire lire hors du dossier choisi : de telles entrées sont refusées et
//! listées, elles ne sont pas suivies.
//!
//! **MD5 et SHA-1 restent proposés, jamais recommandés.** On les trouve encore
//! sur des pages de téléchargement anciennes, et vérifier un fichier avec eux a
//! du sens ; s'en servir pour prouver qu'un fichier n'a pas été modifié
//! *volontairement* n'en a plus depuis longtemps.

use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Sha256, Sha512};

use super::hash::{self, Algorithm};
use super::walk::{self, WalkOptions};
use super::{safe_relative_path, Reporter};

/* ------------------------------------------------------------- manifestes */

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ManifestFormat {
    /// `<empreinte>  <chemin>` — le format de `sha256sum`, lisible partout.
    #[default]
    Text,
    /// JSON FourTout : mêmes données, plus les tailles et la date.
    Json,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestRequest {
    /// Dossier dont les chemins relatifs seront écrits dans le manifeste.
    pub root: String,
    /// Fichiers à couvrir. Vide = tout le contenu de `root`.
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default = "default_algorithm")]
    pub algorithm: Algorithm,
    #[serde(default)]
    pub format: ManifestFormat,
    pub output: String,
    #[serde(default)]
    pub walk: WalkOptions,
}

fn default_algorithm() -> Algorithm {
    Algorithm::Sha256
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    pub relative: String,
    pub digest: String,
    pub size: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestSummary {
    pub output: String,
    pub algorithm: String,
    pub entries: Vec<ManifestEntry>,
    pub files: usize,
    pub bytes: u64,
    pub errors: Vec<String>,
    /// Rappel affiché quand l'algorithme n'est plus adapté à la sécurité.
    pub legacy_warning: Option<String>,
}

/// L'algorithme convient-il encore à autre chose qu'à un contrôle d'intégrité
/// accidentelle ?
pub fn legacy_warning(algorithm: Algorithm) -> Option<String> {
    match algorithm {
        Algorithm::Md5 => Some(
            "MD5 est cassé depuis 2004 : deux fichiers différents peuvent avoir la même empreinte. Utile pour vérifier un checksum publié autrefois, inadapté à prouver qu'un fichier n'a pas été modifié volontairement."
                .into(),
        ),
        Algorithm::Sha1 => Some(
            "SHA-1 est cassé depuis 2017 (collision SHAttered). Utile pour vérifier un checksum historique, inadapté à un usage de sécurité."
                .into(),
        ),
        _ => None,
    }
}

/// Échappement GNU : un chemin contenant `\` ou un saut de ligne est préfixé
/// d'une barre oblique inverse, comme le fait `sha256sum`.
fn escape_path(path: &str) -> (bool, String) {
    if path.contains('\\') || path.contains('\n') || path.contains('\r') {
        (true, path.replace('\\', "\\\\").replace('\n', "\\n").replace('\r', "\\r"))
    } else {
        (false, path.to_string())
    }
}

fn unescape_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    let mut chars = path.chars();
    while let Some(character) = chars.next() {
        if character != '\\' {
            out.push(character);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('\\') => out.push('\\'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

/// Rend le texte d'un manifeste au format `sha256sum`.
pub fn render_text(entries: &[ManifestEntry]) -> String {
    let mut out = String::new();
    for entry in entries {
        let (escaped, path) = escape_path(&entry.relative);
        if escaped {
            out.push('\\');
        }
        out.push_str(&entry.digest);
        out.push_str("  ");
        out.push_str(&path);
        out.push('\n');
    }
    out
}

/// Calcule les empreintes et écrit le manifeste.
pub fn create(request: &ManifestRequest, reporter: &Reporter) -> Result<ManifestSummary, String> {
    let root = Path::new(&request.root);
    if !root.is_dir() {
        return Err(format!("Dossier introuvable : {}", request.root));
    }

    let mut targets: Vec<(String, std::path::PathBuf, u64)> = Vec::new();
    if request.files.is_empty() {
        let (entries, _) = walk::collect(root, &request.walk, reporter)?;
        for entry in entries.into_iter().filter(|entry| !entry.is_dir) {
            targets.push((entry.relative, std::path::PathBuf::from(entry.path), entry.size));
        }
    } else {
        for file in &request.files {
            let path = std::path::PathBuf::from(file);
            let relative = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| {
                    path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
                });
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            targets.push((relative, path, size));
        }
    }
    targets.sort_by(|a, b| a.0.cmp(&b.0));

    let total = targets.len() as u64;
    let mut entries = Vec::with_capacity(targets.len());
    let mut errors = Vec::new();
    let mut bytes = 0_u64;

    for (position, (relative, path, size)) in targets.iter().enumerate() {
        reporter.check()?;
        reporter.report(position as u64, total, relative);
        match hash::hash_file(path, &[request.algorithm], reporter) {
            Ok(result) => {
                bytes += *size;
                entries.push(ManifestEntry {
                    relative: relative.clone(),
                    digest: result.digests[0].1.clone(),
                    size: *size,
                });
            }
            Err(error) if error == super::CANCELLED => return Err(error),
            Err(error) => errors.push(format!("{relative} — {error}")),
        }
    }

    let text = match request.format {
        ManifestFormat::Text => render_text(&entries),
        ManifestFormat::Json => {
            let document = serde_json::json!({
                "format": "fourtout-checksums",
                "version": 1,
                "algorithm": request.algorithm.label(),
                "root": root.file_name().map(|n| n.to_string_lossy().to_string()),
                "entries": entries.iter().map(|entry| serde_json::json!({
                    "path": entry.relative,
                    "size": entry.size,
                    "digest": entry.digest,
                })).collect::<Vec<_>>(),
            });
            serde_json::to_string_pretty(&document).map_err(|e| e.to_string())? + "\n"
        }
    };
    fs::write(Path::new(&request.output), text.as_bytes())
        .map_err(|e| format!("{} : {e}", request.output))?;

    Ok(ManifestSummary {
        output: request.output.clone(),
        algorithm: request.algorithm.label().to_string(),
        files: entries.len(),
        bytes,
        errors,
        legacy_warning: legacy_warning(request.algorithm),
        entries,
    })
}

/* ----------------------------------------------------------- vérification */

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CheckStatus {
    Ok,
    /// Le fichier existe mais son empreinte a changé.
    Mismatch,
    Missing,
    Unreadable,
    /// Entrée refusée : elle sortirait du dossier vérifié.
    Refused,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub relative: String,
    pub status: CheckStatus,
    pub expected: String,
    pub actual: Option<String>,
    pub size: u64,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyReport {
    pub manifest: String,
    pub root: String,
    pub algorithm: String,
    pub results: Vec<CheckResult>,
    pub ok: usize,
    pub mismatched: usize,
    pub missing: usize,
    pub unreadable: usize,
    pub refused: usize,
    pub legacy_warning: Option<String>,
}

impl VerifyReport {
    pub fn valid(&self) -> bool {
        self.mismatched == 0 && self.missing == 0 && self.unreadable == 0 && self.refused == 0
    }
}

/// Algorithme déduit de la longueur de l'empreinte.
fn algorithm_from_length(length: usize) -> Option<Algorithm> {
    match length {
        32 => Some(Algorithm::Md5),
        40 => Some(Algorithm::Sha1),
        64 => Some(Algorithm::Sha256),
        128 => Some(Algorithm::Sha512),
        _ => None,
    }
}

/// Une ligne de manifeste analysée.
struct ParsedLine {
    digest: String,
    path: String,
}

fn parse_line(raw: &str) -> Option<ParsedLine> {
    let line = raw.trim_end_matches(['\r', '\n']);
    if line.trim().is_empty() || line.trim_start().starts_with('#') {
        return None;
    }
    let (escaped, line) = match line.strip_prefix('\\') {
        Some(rest) => (true, rest),
        None => (false, line),
    };
    let mut parts = line.splitn(2, ' ');
    let digest = parts.next()?.trim().to_lowercase();
    if digest.is_empty() || !digest.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    // Le séparateur est « deux espaces » (texte) ou « espace-étoile » (binaire).
    let rest = parts.next()?;
    let path = rest.trim_start_matches([' ', '*']);
    if path.is_empty() {
        return None;
    }
    let path = if escaped { unescape_path(path) } else { path.to_string() };
    Some(ParsedLine { digest, path })
}

/// Analyse un manifeste, texte ou JSON.
pub fn parse(content: &str) -> Result<(Vec<ParsedEntry>, Option<Algorithm>), String> {
    let trimmed = content.trim_start();
    if trimmed.starts_with('{') {
        let document: serde_json::Value =
            serde_json::from_str(trimmed).map_err(|e| format!("Manifeste JSON illisible : {e}"))?;
        let entries = document
            .get("entries")
            .and_then(|value| value.as_array())
            .ok_or_else(|| "Manifeste JSON sans liste « entries ».".to_string())?;
        let mut parsed = Vec::with_capacity(entries.len());
        for entry in entries {
            let path = entry.get("path").and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let digest =
                entry.get("digest").and_then(|v| v.as_str()).unwrap_or_default().to_lowercase();
            if path.is_empty() || digest.is_empty() {
                continue;
            }
            parsed.push(ParsedEntry { path, digest });
        }
        if parsed.is_empty() {
            return Err("Le manifeste ne contient aucune entrée exploitable.".into());
        }
        let algorithm = algorithm_from_length(parsed[0].digest.len());
        return Ok((parsed, algorithm));
    }

    let parsed: Vec<ParsedEntry> = content
        .lines()
        .filter_map(parse_line)
        .map(|line| ParsedEntry { path: line.path, digest: line.digest })
        .collect();
    if parsed.is_empty() {
        return Err(
            "Ce fichier ne ressemble pas à un manifeste d'empreintes : aucune ligne « empreinte  chemin » n'a pu être lue."
                .into(),
        );
    }
    let algorithm = algorithm_from_length(parsed[0].digest.len());
    Ok((parsed, algorithm))
}

#[derive(Clone, Debug)]
pub struct ParsedEntry {
    pub path: String,
    pub digest: String,
}

/// Vérifie un manifeste contre le contenu réel d'un dossier.
pub fn verify(
    manifest_path: &Path,
    root: &Path,
    reporter: &Reporter,
) -> Result<VerifyReport, String> {
    let content = fs::read_to_string(manifest_path)
        .map_err(|e| format!("Manifeste illisible : {e}"))?;
    let (entries, algorithm) = parse(&content)?;
    let algorithm = algorithm.ok_or_else(|| {
        "Longueur d'empreinte inconnue : ce manifeste n'emploie ni MD5, ni SHA-1, ni SHA-256, ni SHA-512."
            .to_string()
    })?;

    let total = entries.len() as u64;
    let mut results = Vec::with_capacity(entries.len());

    for (position, entry) in entries.iter().enumerate() {
        reporter.check()?;
        reporter.report(position as u64, total, &entry.path);

        // Une entrée qui sortirait du dossier n'est pas lue, elle est refusée.
        let relative = match safe_relative_path(&entry.path) {
            Ok(relative) => relative,
            Err(detail) => {
                results.push(CheckResult {
                    relative: entry.path.clone(),
                    status: CheckStatus::Refused,
                    expected: entry.digest.clone(),
                    actual: None,
                    size: 0,
                    detail: Some(detail),
                });
                continue;
            }
        };
        let target = root.join(&relative);
        let Ok(meta) = fs::metadata(&target) else {
            results.push(CheckResult {
                relative: entry.path.clone(),
                status: CheckStatus::Missing,
                expected: entry.digest.clone(),
                actual: None,
                size: 0,
                detail: None,
            });
            continue;
        };
        match hash::hash_file(&target, &[algorithm], reporter) {
            Ok(computed) => {
                let actual = computed.digests[0].1.clone();
                let matches = actual == entry.digest;
                results.push(CheckResult {
                    relative: entry.path.clone(),
                    status: if matches { CheckStatus::Ok } else { CheckStatus::Mismatch },
                    expected: entry.digest.clone(),
                    actual: Some(actual),
                    size: meta.len(),
                    detail: None,
                });
            }
            Err(error) if error == super::CANCELLED => return Err(error),
            Err(error) => results.push(CheckResult {
                relative: entry.path.clone(),
                status: CheckStatus::Unreadable,
                expected: entry.digest.clone(),
                actual: None,
                size: meta.len(),
                detail: Some(error),
            }),
        }
    }

    let count = |status: CheckStatus| results.iter().filter(|r| r.status == status).count();
    Ok(VerifyReport {
        manifest: manifest_path.to_string_lossy().to_string(),
        root: root.to_string_lossy().to_string(),
        algorithm: algorithm.label().to_string(),
        ok: count(CheckStatus::Ok),
        mismatched: count(CheckStatus::Mismatch),
        missing: count(CheckStatus::Missing),
        unreadable: count(CheckStatus::Unreadable),
        refused: count(CheckStatus::Refused),
        legacy_warning: legacy_warning(algorithm),
        results,
    })
}

/* -------------------------------------------------------------------- HMAC */

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HmacAlgorithm {
    Sha1,
    Sha256,
    Sha512,
}

impl HmacAlgorithm {
    pub fn label(self) -> &'static str {
        match self {
            HmacAlgorithm::Sha1 => "HMAC-SHA-1",
            HmacAlgorithm::Sha256 => "HMAC-SHA-256",
            HmacAlgorithm::Sha512 => "HMAC-SHA-512",
        }
    }
}

/// Encodage Base64 standard (RFC 4648), avec remplissage.
///
/// Écrit ici plutôt qu'emprunté : trente lignes, aucune dépendance de plus dans
/// un binaire distribué, et un jeu de vecteurs de test pour s'en assurer.
pub fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[(triple >> 18) as usize & 63] as char);
        out.push(ALPHABET[(triple >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(triple >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 { ALPHABET[triple as usize & 63] as char } else { '=' });
    }
    out
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HmacResult {
    pub algorithm: String,
    pub hex: String,
    pub base64: String,
    /// Octets couverts par le calcul.
    pub bytes: u64,
}

/// Calcule un HMAC sur des octets déjà en mémoire (saisie de l'utilisateur).
pub fn hmac_bytes(algorithm: HmacAlgorithm, key: &[u8], data: &[u8]) -> Result<HmacResult, String> {
    hmac_stream(algorithm, key, &mut std::io::Cursor::new(data), &Reporter::silent(), 0)
}

/// Calcule un HMAC en flux : un fichier de plusieurs gigaoctets ne passe jamais
/// en mémoire.
fn hmac_stream<R: Read>(
    algorithm: HmacAlgorithm,
    key: &[u8],
    source: &mut R,
    reporter: &Reporter,
    total: u64,
) -> Result<HmacResult, String> {
    macro_rules! compute {
        ($hash:ty) => {{
            let mut mac = <Hmac<$hash>>::new_from_slice(key)
                .map_err(|_| "Clé HMAC invalide.".to_string())?;
            let mut buffer = vec![0_u8; 1024 * 1024];
            let mut done = 0_u64;
            loop {
                reporter.check()?;
                let read = source.read(&mut buffer).map_err(|e| e.to_string())?;
                if read == 0 {
                    break;
                }
                mac.update(&buffer[..read]);
                done += read as u64;
                reporter.report(done, total, "Calcul du HMAC…");
            }
            (mac.finalize().into_bytes().to_vec(), done)
        }};
    }
    let (digest, bytes) = match algorithm {
        HmacAlgorithm::Sha1 => compute!(Sha1),
        HmacAlgorithm::Sha256 => compute!(Sha256),
        HmacAlgorithm::Sha512 => compute!(Sha512),
    };
    Ok(HmacResult {
        algorithm: algorithm.label().to_string(),
        hex: to_hex(&digest),
        base64: base64(&digest),
        bytes,
    })
}

/// Calcule le HMAC d'un fichier.
pub fn hmac_file(
    algorithm: HmacAlgorithm,
    key: &[u8],
    path: &Path,
    reporter: &Reporter,
) -> Result<HmacResult, String> {
    let file = fs::File::open(path).map_err(|e| format!("Lecture impossible : {e}"))?;
    let total = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    hmac_stream(algorithm, key, &mut reader, reporter, total)
}

/// Nombre de lignes d'un manifeste, sans tout charger : utilisé par l'interface
/// pour annoncer l'ampleur d'une vérification avant de la lancer.
pub fn count_entries(manifest_path: &Path) -> Result<usize, String> {
    let file = fs::File::open(manifest_path).map_err(|e| format!("Manifeste illisible : {e}"))?;
    Ok(BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter(|line| parse_line(line).is_some())
        .count())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("fourtout-manifest-tests").join(name);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(root: &Path, relative: &str, content: &[u8]) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::File::create(&path).unwrap().write_all(content).unwrap();
    }

    fn set(name: &str) -> PathBuf {
        let root = scratch(name);
        write(&root, "readme.txt", b"abc");
        write(&root, "sous-dossier/fichier accentué é.txt", b"contenu accentue");
        write(&root, "avec espace.bin", &[0_u8, 1, 2, 3]);
        root
    }

    fn request(root: &Path, algorithm: Algorithm, format: ManifestFormat) -> ManifestRequest {
        ManifestRequest {
            root: root.to_string_lossy().to_string(),
            files: Vec::new(),
            algorithm,
            format,
            output: root
                .parent()
                .unwrap()
                .join(format!("{}.manifest", root.file_name().unwrap().to_string_lossy()))
                .to_string_lossy()
                .to_string(),
            walk: WalkOptions::default(),
        }
    }

    #[test]
    fn writes_the_standard_text_format() {
        let root = set("text-format");
        let summary =
            create(&request(&root, Algorithm::Sha256, ManifestFormat::Text), &Reporter::silent())
                .unwrap();
        assert_eq!(summary.files, 3);
        let text = fs::read_to_string(&summary.output).unwrap();
        // SHA-256 de « abc », vecteur de référence.
        assert!(text.contains(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  readme.txt"
        ));
        assert!(text.contains("sous-dossier/fichier accentué é.txt"));
        assert!(summary.legacy_warning.is_none());
    }

    #[test]
    fn legacy_algorithms_are_usable_but_flagged() {
        let root = set("legacy");
        for algorithm in [Algorithm::Md5, Algorithm::Sha1] {
            let summary =
                create(&request(&root, algorithm, ManifestFormat::Text), &Reporter::silent())
                    .unwrap();
            assert!(summary.legacy_warning.is_some(), "{algorithm:?} doit être signalé");
        }
        let summary =
            create(&request(&root, Algorithm::Sha512, ManifestFormat::Text), &Reporter::silent())
                .unwrap();
        assert!(summary.legacy_warning.is_none());
    }

    #[test]
    fn verifies_a_valid_manifest() {
        let root = set("verify-ok");
        let summary =
            create(&request(&root, Algorithm::Sha256, ManifestFormat::Text), &Reporter::silent())
                .unwrap();
        let report =
            verify(Path::new(&summary.output), &root, &Reporter::silent()).unwrap();
        assert!(report.valid());
        assert_eq!(report.ok, 3);
        assert_eq!(report.algorithm, "SHA-256");
    }

    #[test]
    fn detects_modified_missing_and_refused_entries() {
        let root = set("verify-bad");
        let summary =
            create(&request(&root, Algorithm::Sha256, ManifestFormat::Text), &Reporter::silent())
                .unwrap();
        // Un fichier modifié, un fichier disparu, une entrée hostile ajoutée.
        write(&root, "readme.txt", b"abcd");
        fs::remove_file(root.join("avec espace.bin")).unwrap();
        let mut content = fs::read_to_string(&summary.output).unwrap();
        content.push_str(
            "0000000000000000000000000000000000000000000000000000000000000000  ../../etc/passwd\n",
        );
        fs::write(&summary.output, content).unwrap();

        let report = verify(Path::new(&summary.output), &root, &Reporter::silent()).unwrap();
        assert!(!report.valid());
        assert_eq!(report.mismatched, 1);
        assert_eq!(report.missing, 1);
        assert_eq!(report.refused, 1);
        let refused = report.results.iter().find(|r| r.status == CheckStatus::Refused).unwrap();
        assert_eq!(refused.relative, "../../etc/passwd");
        let mismatch = report.results.iter().find(|r| r.status == CheckStatus::Mismatch).unwrap();
        assert_eq!(mismatch.relative, "readme.txt");
    }

    #[test]
    fn reads_the_json_format_too() {
        let root = set("json");
        let summary =
            create(&request(&root, Algorithm::Sha512, ManifestFormat::Json), &Reporter::silent())
                .unwrap();
        let text = fs::read_to_string(&summary.output).unwrap();
        assert!(text.contains("\"fourtout-checksums\""));
        let report = verify(Path::new(&summary.output), &root, &Reporter::silent()).unwrap();
        assert!(report.valid());
        assert_eq!(report.algorithm, "SHA-512");
    }

    #[test]
    fn parses_paths_with_spaces_and_escapes() {
        let (entries, algorithm) = parse(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  avec espace.txt\n",
        )
        .unwrap();
        assert_eq!(entries[0].path, "avec espace.txt");
        assert_eq!(algorithm, Some(Algorithm::Sha256));

        // Format « binaire » de shasum : espace puis étoile.
        let (entries, _) =
            parse("900150983cd24fb0d6963f7d28e17f72 *données/é à ü.bin\n").unwrap();
        assert_eq!(entries[0].path, "données/é à ü.bin");

        // Chemin échappé à la GNU.
        let (entries, _) = parse(
            "\\ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  dossier\\\\avec.txt\n",
        )
        .unwrap();
        assert_eq!(entries[0].path, "dossier\\avec.txt");
    }

    #[test]
    fn a_file_that_is_not_a_manifest_is_refused_clearly() {
        assert!(parse("ceci n'est pas un manifeste\n").is_err());
    }

    #[test]
    fn hmac_matches_the_rfc_4231_vectors() {
        // RFC 4231, cas de test 1.
        let key = vec![0x0b_u8; 20];
        let data = b"Hi There";
        let sha256 = hmac_bytes(HmacAlgorithm::Sha256, &key, data).unwrap();
        assert_eq!(
            sha256.hex,
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
        let sha512 = hmac_bytes(HmacAlgorithm::Sha512, &key, data).unwrap();
        assert_eq!(
            sha512.hex,
            "87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854"
        );

        // RFC 2202, cas de test 2 pour HMAC-SHA-1.
        let sha1 = hmac_bytes(HmacAlgorithm::Sha1, b"Jefe", b"what do ya want for nothing?")
            .unwrap();
        assert_eq!(sha1.hex, "effcdf6ae5eb2fa2d27416d5f184df9c259a7c79");
    }

    #[test]
    fn base64_matches_rfc_4648() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foob"), "Zm9vYg==");
        assert_eq!(base64(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn hmac_of_a_file_equals_hmac_of_its_bytes() {
        let root = scratch("hmac-file");
        write(&root, "data.bin", b"Hi There");
        let key = vec![0x0b_u8; 20];
        let from_file =
            hmac_file(HmacAlgorithm::Sha256, &key, &root.join("data.bin"), &Reporter::silent())
                .unwrap();
        let from_memory = hmac_bytes(HmacAlgorithm::Sha256, &key, b"Hi There").unwrap();
        assert_eq!(from_file.hex, from_memory.hex);
        assert_eq!(from_file.base64, from_memory.base64);
        assert_eq!(from_file.bytes, 8);
    }
}
