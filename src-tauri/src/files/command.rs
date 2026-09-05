//! Commandes Tauri du socle « Fichiers ».
//!
//! Le frontend ne manipule que des **chemins** choisis par l'utilisateur via
//! les boîtes de dialogue natives : aucun octet ne transite par la WebView pour
//! ces outils, ce qui rend un fichier de 20 Go aussi peu coûteux qu'un fichier
//! de 20 Ko. Chaque opération longue reçoit un `jobId` : elle publie son
//! avancement sur `files://progress` et s'interrompt réellement sur
//! `files_cancel`.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::archive::{self, Format};
use super::docx;
use super::hash::{self, Algorithm};
use super::rename::{self, RenameRules};
use super::scan::{self, DuplicateOptions, TreeOptions};
use super::split;
use super::{FilesState, Reporter};

/// Prépare un rapporteur enregistré, et garantit sa libération.
fn with_reporter<T>(
    app: AppHandle,
    state: &tauri::State<'_, FilesState>,
    job_id: &str,
    body: impl FnOnce(&Reporter) -> Result<T, String>,
) -> Result<T, String> {
    let cancel = state.register(job_id);
    let reporter = Reporter::new(app, job_id.to_string(), cancel);
    let result = body(&reporter);
    state.release(job_id);
    result
}

/// Demande l'arrêt d'une opération longue.
#[tauri::command]
pub fn files_cancel(state: tauri::State<'_, FilesState>, job_id: String) {
    state.cancel(&job_id);
}

/* ------------------------------------------------------------ empreintes */

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HashParams {
    pub job_id: String,
    pub paths: Vec<String>,
    pub algorithms: Vec<Algorithm>,
}

#[tauri::command]
pub fn files_hash(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    params: HashParams,
) -> Result<Vec<hash::FileHashes>, String> {
    if params.algorithms.is_empty() {
        return Err("Choisissez au moins un algorithme.".into());
    }
    with_reporter(app, &state, &params.job_id, |reporter| {
        let mut out = Vec::new();
        for path in &params.paths {
            reporter.check()?;
            out.push(hash::hash_file(Path::new(path), &params.algorithms, reporter)?);
        }
        Ok(out)
    })
}

/* ------------------------------------------------------- comparaison */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareResult {
    pub identical: bool,
    pub size_a: u64,
    pub size_b: u64,
    /// Position du premier octet différent, si les fichiers diffèrent.
    pub first_difference: Option<u64>,
    /// Les deux fichiers semblent-ils être du texte ?
    pub both_text: bool,
    pub sha256_a: String,
    pub sha256_b: String,
}

/// Les 8 premiers Kio contiennent-ils un octet nul ou trop de contrôles ?
fn looks_like_text(path: &Path) -> bool {
    let Ok(mut file) = fs::File::open(path) else { return false };
    let mut buffer = vec![0_u8; 8192];
    let Ok(read) = file.read(&mut buffer) else { return false };
    let sample = &buffer[..read];
    if sample.contains(&0) {
        return false;
    }
    let suspicious = sample
        .iter()
        .filter(|b| **b < 9 || (**b > 13 && **b < 32))
        .count();
    read == 0 || suspicious * 100 / read.max(1) < 5
}

#[tauri::command]
pub fn files_compare(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    path_a: String,
    path_b: String,
) -> Result<CompareResult, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        let a = Path::new(&path_a);
        let b = Path::new(&path_b);
        let size_a = fs::metadata(a).map_err(|e| format!("{path_a} : {e}"))?.len();
        let size_b = fs::metadata(b).map_err(|e| format!("{path_b} : {e}"))?.len();

        let mut file_a = fs::File::open(a).map_err(|e| e.to_string())?;
        let mut file_b = fs::File::open(b).map_err(|e| e.to_string())?;
        let mut buffer_a = vec![0_u8; 256 * 1024];
        let mut buffer_b = vec![0_u8; 256 * 1024];
        let mut offset = 0_u64;
        let mut first_difference = None;
        let total = size_a.min(size_b);

        loop {
            reporter.check()?;
            let read_a = file_a.read(&mut buffer_a).map_err(|e| e.to_string())?;
            let read_b = file_b.read(&mut buffer_b).map_err(|e| e.to_string())?;
            let common = read_a.min(read_b);
            for index in 0..common {
                if buffer_a[index] != buffer_b[index] {
                    first_difference = Some(offset + index as u64);
                    break;
                }
            }
            if first_difference.is_some() {
                break;
            }
            if read_a != read_b {
                first_difference = Some(offset + common as u64);
                break;
            }
            if read_a == 0 {
                break;
            }
            offset += read_a as u64;
            reporter.report(offset, total, "Comparaison octet par octet…");
        }

        let identical = size_a == size_b && first_difference.is_none();
        Ok(CompareResult {
            identical,
            size_a,
            size_b,
            first_difference,
            both_text: looks_like_text(a) && looks_like_text(b),
            sha256_a: hash::sha256_file(a)?,
            sha256_b: hash::sha256_file(b)?,
        })
    })
}

/* ------------------------------------------------------ informations */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub read_only: bool,
    /// Dates en millisecondes depuis l'époque Unix (0 si indisponible).
    pub modified: u64,
    pub created: u64,
    pub accessed: u64,
    /// Type MIME déduit de l'extension.
    pub mime: String,
    /// Type réel déduit des premiers octets ; « inconnu » si non reconnu.
    pub magic: String,
    /// L'extension correspond-elle au contenu réel ?
    pub extension_matches: bool,
    pub looks_like_text: bool,
}

fn mime_of(extension: &str) -> &'static str {
    match extension {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "svg" => "image/svg+xml",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "ogg" | "opus" => "audio/ogg",
        "m4a" | "aac" => "audio/mp4",
        "mp4" | "m4v" => "video/mp4",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "zip" => "application/zip",
        "gz" | "tgz" => "application/gzip",
        "tar" => "application/x-tar",
        "7z" => "application/x-7z-compressed",
        "rar" => "application/vnd.rar",
        "txt" | "log" => "text/plain",
        "md" => "text/markdown",
        "csv" => "text/csv",
        "html" | "htm" => "text/html",
        "json" => "application/json",
        "xml" => "application/xml",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "doc" => "application/msword",
        "odt" => "application/vnd.oasis.opendocument.text",
        "epub" => "application/epub+zip",
        "srt" => "application/x-subrip",
        "vtt" => "text/vtt",
        _ => "application/octet-stream",
    }
}

/// Reconnaissance par signature : ce que le fichier **est**, pas ce que son
/// nom prétend. C'est ce qui permet de dire « ce .jpg est en fait un PNG ».
fn magic_of(head: &[u8]) -> &'static str {
    let starts = |prefix: &[u8]| head.len() >= prefix.len() && &head[..prefix.len()] == prefix;
    if starts(b"%PDF-") {
        "pdf"
    } else if starts(&[0x89, b'P', b'N', b'G']) {
        "png"
    } else if starts(&[0xFF, 0xD8, 0xFF]) {
        "jpg"
    } else if starts(b"GIF87a") || starts(b"GIF89a") {
        "gif"
    } else if head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WEBP" {
        "webp"
    } else if head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WAVE" {
        "wav"
    } else if starts(b"OggS") {
        "ogg"
    } else if starts(b"fLaC") {
        "flac"
    } else if starts(b"ID3") || (head.len() >= 2 && head[0] == 0xFF && (head[1] & 0xE0) == 0xE0) {
        "mp3"
    } else if head.len() >= 12 && &head[4..8] == b"ftyp" {
        "mp4"
    } else if starts(&[0x1A, 0x45, 0xDF, 0xA3]) {
        "mkv"
    } else if starts(&[0x50, 0x4B, 0x03, 0x04]) {
        // ZIP : conteneur des formats Office et OpenDocument.
        "zip"
    } else if starts(&[0x1F, 0x8B]) {
        "gz"
    } else if starts(&[0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]) {
        "7z"
    } else if starts(b"Rar!") {
        "rar"
    } else if starts(b"BM") {
        "bmp"
    } else if starts(&[0x49, 0x49, 0x2A, 0x00]) || starts(&[0x4D, 0x4D, 0x00, 0x2A]) {
        "tiff"
    } else {
        "inconnu"
    }
}

/// Les formats fondés sur ZIP : leur signature est celle du ZIP.
fn zip_based(extension: &str) -> bool {
    matches!(extension, "zip" | "docx" | "xlsx" | "pptx" | "odt" | "ods" | "odp" | "epub" | "jar")
}

fn millis(time: Option<std::time::SystemTime>) -> u64 {
    time.and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn files_info(path: String) -> Result<FileInfo, String> {
    let target = Path::new(&path);
    let meta = fs::symlink_metadata(target).map_err(|e| format!("Fichier introuvable : {e}"))?;
    let extension = target
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let mut head = vec![0_u8; 32];
    let mut read = 0;
    if meta.is_file() {
        if let Ok(mut file) = fs::File::open(target) {
            read = file.read(&mut head).unwrap_or(0);
        }
    }
    let magic = magic_of(&head[..read]);
    let extension_matches = magic == "inconnu"
        || magic == extension
        || (magic == "jpg" && extension == "jpeg")
        || (magic == "mp4" && matches!(extension.as_str(), "m4a" | "m4v" | "mov" | "aac"))
        || (magic == "gz" && matches!(extension.as_str(), "tgz" | "gz"))
        || (magic == "zip" && zip_based(&extension))
        || (magic == "ogg" && extension == "opus")
        || (magic == "tiff" && extension == "tif");

    Ok(FileInfo {
        name: target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        size: meta.len(),
        is_dir: meta.is_dir(),
        is_symlink: meta.file_type().is_symlink(),
        read_only: meta.permissions().readonly(),
        modified: millis(meta.modified().ok()),
        created: millis(meta.created().ok()),
        accessed: millis(meta.accessed().ok()),
        mime: mime_of(&extension).to_string(),
        magic: magic.to_string(),
        extension_matches,
        looks_like_text: meta.is_file() && looks_like_text(target),
        extension,
        path,
    })
}

/* ---------------------------------------------------------- archives */

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveCreateParams {
    pub job_id: String,
    pub paths: Vec<String>,
    pub output: String,
    pub format: Format,
    /// 0 = stocké sans compression, 1 à 9 = compression croissante.
    pub level: u32,
}

#[tauri::command]
pub fn files_archive_create(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    params: ArchiveCreateParams,
) -> Result<archive::ArchiveSummary, String> {
    with_reporter(app, &state, &params.job_id, |reporter| {
        let sources: Vec<PathBuf> = params.paths.iter().map(PathBuf::from).collect();
        let members = archive::collect_members(&sources, reporter)?;
        archive::create(&members, Path::new(&params.output), params.format, params.level, reporter)
    })
}

#[tauri::command]
pub fn files_archive_list(path: String) -> Result<archive::ArchiveListing, String> {
    archive::list(Path::new(&path))
}

#[tauri::command]
pub fn files_archive_extract(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    path: String,
    destination: String,
    overwrite: bool,
) -> Result<archive::ExtractSummary, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        archive::extract(Path::new(&path), Path::new(&destination), overwrite, reporter)
    })
}

/* ----------------------------------------------------------- dossiers */

#[tauri::command]
pub fn files_folder_stats(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    path: String,
) -> Result<scan::FolderStats, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        scan::folder_stats(Path::new(&path), reporter)
    })
}

#[tauri::command]
pub fn files_tree(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    path: String,
    options: TreeOptions,
) -> Result<scan::TreeResult, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        scan::tree(Path::new(&path), &options, reporter)
    })
}

#[tauri::command]
pub fn files_duplicates(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    path: String,
    options: DuplicateOptions,
) -> Result<scan::DuplicateReport, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        scan::find_duplicates(Path::new(&path), &options, reporter)
    })
}

/* ------------------------------------------------- découpe / fusion */

#[tauri::command]
pub fn files_split(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    path: String,
    destination: String,
    part_size: u64,
) -> Result<split::SplitSummary, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        split::split_file(Path::new(&path), Path::new(&destination), part_size, reporter)
    })
}

#[tauri::command]
pub fn files_join(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    path: String,
    destination: String,
) -> Result<split::JoinSummary, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        split::join_parts(Path::new(&path), Path::new(&destination), reporter)
    })
}

/* --------------------------------------------------------- renommage */

#[tauri::command]
pub fn files_rename_plan(paths: Vec<String>, rules: RenameRules) -> rename::RenamePlan {
    let targets: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    rename::plan(&targets, &rules)
}

#[tauri::command]
pub fn files_rename_apply(
    paths: Vec<String>,
    rules: RenameRules,
) -> Result<rename::RenameOutcome, String> {
    let targets: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    rename::apply(&targets, &rules)
}

/* -------------------------------------------------------------- DOCX */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocxResult {
    pub text: String,
    pub html: String,
    pub markdown: String,
    pub metadata: docx::DocxMetadata,
    pub blocks: usize,
    pub tables: usize,
    pub images: usize,
    pub dropped: Vec<String>,
}

#[tauri::command]
pub fn files_docx_read(path: String) -> Result<DocxResult, String> {
    let document = docx::read(Path::new(&path))?;
    Ok(DocxResult {
        text: docx::to_text(&document),
        html: docx::to_html(&document),
        markdown: docx::to_markdown(&document),
        metadata: document.metadata.clone(),
        blocks: document.blocks.len(),
        tables: document.tables,
        images: document.images,
        dropped: document.dropped.clone(),
    })
}

/// Lit un fichier texte (avec garde-fou de taille), pour les outils Texte qui
/// travaillent sur un fichier choisi dans l'explorateur natif.
#[tauri::command]
pub fn files_read_text(path: String, max_bytes: u64) -> Result<String, String> {
    let target = Path::new(&path);
    let size = fs::metadata(target).map_err(|e| format!("Fichier introuvable : {e}"))?.len();
    let limit = if max_bytes == 0 { 32 * 1024 * 1024 } else { max_bytes };
    if size > limit {
        return Err(format!(
            "Fichier trop volumineux pour être ouvert ici ({} Mo).",
            size / (1024 * 1024)
        ));
    }
    if !looks_like_text(target) {
        return Err("Ce fichier ne semble pas être un fichier texte.".into());
    }
    let bytes = fs::read(target).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

/// Écrit un fichier texte à l'emplacement choisi par l'utilisateur.
#[tauri::command]
pub fn files_write_text(path: String, content: String) -> Result<(), String> {
    fs::write(Path::new(&path), content.as_bytes()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_signatures() {
        assert_eq!(magic_of(b"%PDF-1.7"), "pdf");
        assert_eq!(magic_of(&[0x89, b'P', b'N', b'G', 13, 10, 26, 10]), "png");
        assert_eq!(magic_of(&[0xFF, 0xD8, 0xFF, 0xE0]), "jpg");
        assert_eq!(magic_of(b"PK\x03\x04rest"), "zip");
        assert_eq!(magic_of(b"quelconque"), "inconnu");
    }

    #[test]
    fn maps_extensions_to_mime() {
        assert_eq!(mime_of("pdf"), "application/pdf");
        assert_eq!(mime_of("md"), "text/markdown");
        assert_eq!(mime_of("inconnue"), "application/octet-stream");
    }

    #[test]
    fn accepts_zip_based_office_formats() {
        assert!(zip_based("docx"));
        assert!(zip_based("epub"));
        assert!(!zip_based("pdf"));
    }
}
