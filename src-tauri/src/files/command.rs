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
use super::crypto;
use super::docx;
use super::backup;
use super::compare;
use super::compress;
use super::hash::{self, Algorithm};
use super::hex;
use super::magic;
use super::manifest;
use super::search;
use super::sync;
use super::rename::{self, RenameRules};
use super::scan::{self, DuplicateOptions, TreeOptions};
use super::secure;
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

/// Ce fichier ressemble-t-il à du texte ?
///
/// La question est déléguée à `textscan`, qui porte la même décision que le
/// moteur d'encodage de la phase 8. L'ancienne heuristique locale — « contient
/// un octet nul, donc binaire » — déclarait binaire tout fichier en UTF-16,
/// dont un octet sur deux est nul par construction.
fn looks_like_text(path: &Path) -> bool {
    let Ok(mut file) = fs::File::open(path) else { return false };
    let mut buffer = vec![0_u8; 8192];
    let Ok(read) = file.read(&mut buffer) else { return false };
    super::textscan::looks_like_text(&buffer[..read])
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


/// Plage d'octets qui diffère entre deux fichiers.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRange {
    pub offset: u64,
    pub length: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryDiff {
    pub size_a: u64,
    pub size_b: u64,
    /// Premières plages divergentes, dans l'ordre.
    pub ranges: Vec<DiffRange>,
    /// Y avait-il encore des différences au-delà de la dernière plage listée ?
    pub truncated: bool,
    /// Nombre total d'octets différents parcourus (sur la partie commune).
    pub differing_bytes: u64,
}

/// Localise les premières plages divergentes entre deux fichiers.
///
/// Lecture en flux par blocs de 256 Kio : comparer deux images disque ne coûte
/// rien de plus en mémoire que comparer deux notes. Seules les `max_ranges`
/// premières plages sont retenues — au-delà, l'information utile n'est plus
/// « où », mais « partout », et le rapport le dit.
#[tauri::command]
pub fn files_binary_diff(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    path_a: String,
    path_b: String,
    max_ranges: usize,
) -> Result<BinaryDiff, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        binary_diff(Path::new(&path_a), Path::new(&path_b), max_ranges, reporter)
    })
}

/// Cœur de `files_binary_diff`, appelable sans Tauri — donc testable.
pub fn binary_diff(
    a: &Path,
    b: &Path,
    max_ranges: usize,
    reporter: &Reporter,
) -> Result<BinaryDiff, String> {
    {
        let size_a = fs::metadata(a).map_err(|e| format!("{} : {e}", a.display()))?.len();
        let size_b = fs::metadata(b).map_err(|e| format!("{} : {e}", b.display()))?.len();

        let mut file_a = std::io::BufReader::new(fs::File::open(a).map_err(|e| e.to_string())?);
        let mut file_b = std::io::BufReader::new(fs::File::open(b).map_err(|e| e.to_string())?);
        let mut buffer_a = vec![0_u8; 256 * 1024];
        let mut buffer_b = vec![0_u8; 256 * 1024];

        let limit = max_ranges.clamp(1, 1000);
        let mut ranges: Vec<DiffRange> = Vec::new();
        let mut differing_bytes = 0_u64;
        let mut truncated = false;
        let mut offset = 0_u64;
        let common = size_a.min(size_b);
        // Plage ouverte : `Some(début)` tant que les octets continuent de différer.
        let mut open: Option<u64> = None;

        loop {
            reporter.check()?;
            let read_a = read_full(&mut file_a, &mut buffer_a)?;
            let read_b = read_full(&mut file_b, &mut buffer_b)?;
            let shared = read_a.min(read_b);
            if shared == 0 {
                break;
            }
            for index in 0..shared {
                let position = offset + index as u64;
                if buffer_a[index] == buffer_b[index] {
                    if let Some(start) = open.take() {
                        if ranges.len() < limit {
                            ranges.push(DiffRange { offset: start, length: position - start });
                        } else {
                            truncated = true;
                        }
                    }
                } else {
                    differing_bytes += 1;
                    if open.is_none() {
                        open = Some(position);
                    }
                }
            }
            offset += shared as u64;
            reporter.report(offset, common, "Recherche des différences…");
            if read_a != read_b {
                break;
            }
        }

        if let Some(start) = open {
            if ranges.len() < limit {
                ranges.push(DiffRange { offset: start, length: offset - start });
            } else {
                truncated = true;
            }
        }
        // Une longueur différente est une divergence à part entière : elle
        // commence là où le plus court s'arrête.
        if size_a != size_b {
            if ranges.len() < limit {
                ranges.push(DiffRange { offset: common, length: size_a.max(size_b) - common });
            } else {
                truncated = true;
            }
        }

        Ok(BinaryDiff { size_a, size_b, ranges, truncated, differing_bytes })
    }
}

/// Remplit le tampon autant que possible : un `read` court ne doit pas
/// décaler la comparaison des deux flux l'un par rapport à l'autre.
fn read_full(reader: &mut impl Read, buffer: &mut [u8]) -> Result<usize, String> {
    let mut filled = 0;
    while filled < buffer.len() {
        match reader.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(read) => filled += read,
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(filled)
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
    /// Libellé français du type détecté.
    pub magic_label: String,
    /// Famille du contenu : oriente l'aperçu proposé.
    pub family: magic::Family,
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

    let mut head = vec![0_u8; magic::HEAD_BYTES];
    let mut read = 0;
    if meta.is_file() {
        if let Ok(mut file) = fs::File::open(target) {
            read = file.read(&mut head).unwrap_or(0);
        }
    }
    let signature = magic::identify(&head[..read]);

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
        magic: signature.id.to_string(),
        magic_label: signature.label.to_string(),
        family: signature.family,
        extension_matches: magic::extension_matches(&signature, &extension),
        looks_like_text: meta.is_file() && looks_like_text(target),
        extension,
        path,
    })
}


/* ------------------------------------------------------------- aperçu */

/// Limite de ce qu'un aperçu accepte de charger en mémoire.
///
/// L'aperçu construit un objet binaire dans la WebView : au-delà, on refuse
/// plutôt que de faire gonfler la mémoire de l'application jusqu'à la faire
/// tomber. Les outils dédiés (lecteur vidéo, visionneuse PDF) restent la bonne
/// réponse pour les fichiers vraiment lourds.
pub const PREVIEW_LIMIT: u64 = 256 * 1024 * 1024;

/// Lit un fichier (ou son début) et renvoie ses octets **bruts**.
///
/// Le retour passe par `tauri::ipc::Response` : les octets traversent l'IPC
/// tels quels, au lieu d'être encodés en tableau JSON — sur un MP4 de 40 Mo,
/// la différence est celle entre un aperçu instantané et une interface figée.
#[tauri::command]
pub fn files_read_bytes(path: String, max_bytes: u64) -> Result<tauri::ipc::Response, String> {
    let target = Path::new(&path);
    let size = fs::metadata(target).map_err(|e| format!("Fichier introuvable : {e}"))?.len();
    let limit = if max_bytes == 0 { PREVIEW_LIMIT } else { max_bytes.min(PREVIEW_LIMIT) };
    if size > limit {
        return Err(format!(
            "Fichier trop volumineux pour un aperçu ({}). Limite : {} Mo.",
            size,
            limit / (1024 * 1024)
        ));
    }
    let bytes = fs::read(target).map_err(|e| format!("Lecture impossible : {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
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

/// Création d'une archive protégée par mot de passe.
///
/// Le mot de passe traverse l'IPC une seule fois, n'est jamais journalisé et
/// n'est stocké nulle part : il sert à dériver la clé, puis disparaît avec la
/// fin de l'appel.
#[tauri::command]
pub fn files_archive_create_encrypted(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    params: ArchiveEncryptParams,
) -> Result<archive::ArchiveSummary, String> {
    with_reporter(app, &state, &params.job_id, |reporter| {
        let sources: Vec<PathBuf> = params.paths.iter().map(PathBuf::from).collect();
        let members = archive::collect_members(&sources, reporter)?;
        archive::create_encrypted(
            &members,
            Path::new(&params.output),
            params.level,
            &params.password,
            reporter,
        )
    })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEncryptParams {
    pub job_id: String,
    pub paths: Vec<String>,
    pub output: String,
    pub level: u32,
    pub password: String,
}

#[tauri::command]
pub fn files_archive_extract_encrypted(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    path: String,
    destination: String,
    overwrite: bool,
    password: String,
) -> Result<archive::ExtractSummary, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        archive::extract_with_password(
            Path::new(&path),
            Path::new(&destination),
            overwrite,
            Some(password.as_str()),
            reporter,
        )
    })
}


/* ------------------------------------------------- comparaison de dossiers */

#[tauri::command]
pub fn files_folder_compare(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    request: compare::CompareRequest,
) -> Result<compare::CompareReport, String> {
    with_reporter(app, &state, &job_id, |reporter| compare::compare(&request, reporter))
}

/* ------------------------------------------------------- synchronisation */

/// Calcule le plan. **N'écrit rien.**
#[tauri::command]
pub fn files_sync_plan(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    request: sync::SyncRequest,
) -> Result<sync::SyncPlan, String> {
    with_reporter(app, &state, &job_id, |reporter| sync::build_plan(&request, reporter))
}

/// Exécute **exactement** le plan reçu, et rien d'autre.
///
/// Le plan voyage de l'interface au processus natif plutôt que d'être recalculé
/// ici : ce que l'utilisateur a vu et confirmé est ce qui sera fait.
#[tauri::command]
pub fn files_sync_apply(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    source: String,
    destination: String,
    operations: Vec<sync::SyncOperation>,
) -> Result<sync::SyncOutcome, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        sync::execute(Path::new(&source), Path::new(&destination), &operations, reporter)
    })
}

/* -------------------------------------------------------------- recherche */

#[tauri::command]
pub fn files_search(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    query: search::SearchQuery,
) -> Result<search::SearchReport, String> {
    with_reporter(app, &state, &job_id, |reporter| search::search(&query, reporter))
}

/* ------------------------------------------------------------ hexadécimal */

#[tauri::command]
pub fn files_hex_read(path: String, offset: u64, length: usize) -> Result<hex::HexWindow, String> {
    hex::read_window(Path::new(&path), offset, length)
}

#[tauri::command]
pub fn files_hex_find(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    path: String,
    pattern: Vec<u8>,
    from: u64,
) -> Result<Option<u64>, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        hex::find(Path::new(&path), &pattern, from, reporter)
    })
}

/// Toutes les occurrences d'une séquence, en une seule traversée du fichier.
#[tauri::command]
pub fn files_hex_find_all(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    path: String,
    pattern: Vec<u8>,
    limit: usize,
) -> Result<Vec<u64>, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        hex::find_all(Path::new(&path), &pattern, limit, reporter)
    })
}

/// Applique des modifications d'octets.
///
/// `destination` différent de `source` = « Enregistrer sous » ; l'original
/// n'est pas touché. L'écrasement de l'original suppose que l'interface l'ait
/// explicitement demandé.
#[tauri::command]
pub fn files_hex_write(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    source: String,
    destination: String,
    patches: Vec<hex::HexPatch>,
) -> Result<hex::HexWriteSummary, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        hex::write_patched(Path::new(&source), Path::new(&destination), &patches, reporter)
    })
}

/* ------------------------------------------------------------ sauvegarde */

#[tauri::command]
pub fn files_backup_create(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    request: backup::BackupRequest,
) -> Result<backup::BackupSummary, String> {
    with_reporter(app, &state, &job_id, |reporter| backup::create(&request, reporter))
}

#[tauri::command]
pub fn files_backup_verify(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    path: String,
) -> Result<backup::VerifyReport, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        backup::verify(Path::new(&path), reporter)
    })
}

#[tauri::command]
pub fn files_backup_preview(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    path: String,
    destination: String,
) -> Result<backup::RestorePreview, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        backup::preview(Path::new(&path), Path::new(&destination), reporter)
    })
}

#[tauri::command]
pub fn files_backup_restore(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    path: String,
    destination: String,
    mode: backup::RestoreMode,
) -> Result<backup::RestoreSummary, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        backup::restore(Path::new(&path), Path::new(&destination), mode, reporter)
    })
}

/* --------------------------------------------------- manifestes et HMAC */

#[tauri::command]
pub fn files_manifest_create(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    request: manifest::ManifestRequest,
) -> Result<manifest::ManifestSummary, String> {
    with_reporter(app, &state, &job_id, |reporter| manifest::create(&request, reporter))
}

#[tauri::command]
pub fn files_manifest_verify(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    manifest_path: String,
    root: String,
) -> Result<manifest::VerifyReport, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        manifest::verify(Path::new(&manifest_path), Path::new(&root), reporter)
    })
}

/// HMAC d'un texte saisi dans l'interface.
///
/// La clé traverse l'IPC une seule fois, sert au calcul, et disparaît avec la
/// fin de l'appel : elle n'est ni journalisée, ni conservée, ni renvoyée.
#[tauri::command]
pub fn files_hmac_text(
    algorithm: manifest::HmacAlgorithm,
    key: String,
    text: String,
) -> Result<manifest::HmacResult, String> {
    manifest::hmac_bytes(algorithm, key.as_bytes(), text.as_bytes())
}

#[tauri::command]
pub fn files_hmac_file(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    algorithm: manifest::HmacAlgorithm,
    key: String,
    path: String,
) -> Result<manifest::HmacResult, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        manifest::hmac_file(algorithm, key.as_bytes(), Path::new(&path), reporter)
    })
}

/* ---------------------------------------------- compression d'un fichier */

#[tauri::command]
pub fn files_stream_compress(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    input: String,
    output: String,
    format: compress::StreamFormat,
    level: u32,
) -> Result<compress::StreamSummary, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        compress::compress(Path::new(&input), Path::new(&output), format, level, reporter)
    })
}

#[tauri::command]
pub fn files_stream_decompress(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    input: String,
    output: String,
    format: compress::StreamFormat,
) -> Result<compress::StreamSummary, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        compress::decompress(Path::new(&input), Path::new(&output), format, reporter)
    })
}

/// Vérifie qu'un `.gz` ou un `.xz` se décompresse entièrement, sans rien écrire.
#[tauri::command]
pub fn files_stream_test(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    input: String,
    format: compress::StreamFormat,
) -> Result<u64, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        compress::test_stream(Path::new(&input), format, reporter)
    })
}

/// Nom de sortie naturel pour une compression ou une décompression.
#[tauri::command]
pub fn files_stream_suggest(
    input: String,
    format: compress::StreamFormat,
    compressing: bool,
) -> String {
    compress::suggested_output(Path::new(&input), format, compressing)
        .to_string_lossy()
        .to_string()
}

/* --------------------------------------------------- intégrité d'archive */

#[tauri::command]
pub fn files_archive_test(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    path: String,
    password: Option<String>,
) -> Result<archive::IntegrityReport, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        archive::test(Path::new(&path), password.as_deref(), reporter)
    })
}

/* --------------------------------------------------------- chiffrement */

#[tauri::command]
pub fn files_encrypt(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    request: crypto::EncryptRequest,
) -> Result<Vec<crypto::CryptoSummary>, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        let mut results = Vec::with_capacity(request.sources.len());
        for source in &request.sources {
            reporter.check()?;
            results.push(crypto::encrypt_file(
                Path::new(source),
                request.destination.as_deref(),
                &request.password,
                reporter,
            )?);
        }
        Ok(results)
    })
}

#[tauri::command]
pub fn files_decrypt(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    request: crypto::DecryptRequest,
) -> Result<Vec<crypto::CryptoSummary>, String> {
    with_reporter(app, &state, &job_id, |reporter| {
        let mut results = Vec::with_capacity(request.sources.len());
        for source in &request.sources {
            reporter.check()?;
            results.push(crypto::decrypt_file(
                Path::new(source),
                request.destination.as_deref(),
                &request.password,
                reporter,
            )?);
        }
        Ok(results)
    })
}

/* ------------------------------------------------- rangement et effacement */

#[tauri::command]
pub fn files_organize_plan(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    request: secure::OrganizeRequest,
) -> Result<secure::OrganizePlan, String> {
    with_reporter(app, &state, &job_id, |reporter| secure::plan(&request, reporter))
}

#[tauri::command]
pub fn files_organize_apply(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    request: secure::OrganizeApplyRequest,
) -> Result<secure::OrganizeSummary, String> {
    with_reporter(app, &state, &job_id, |reporter| secure::apply(&request, reporter))
}

#[tauri::command]
pub fn files_secure_delete(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    request: secure::WipeRequest,
) -> Result<secure::WipeSummary, String> {
    with_reporter(app, &state, &job_id, |reporter| secure::wipe(&request, reporter))
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
    fn maps_extensions_to_mime() {
        assert_eq!(mime_of("pdf"), "application/pdf");
        assert_eq!(mime_of("md"), "text/markdown");
        assert_eq!(mime_of("inconnue"), "application/octet-stream");
    }
}
