//! Commandes Tauri du décodage d'images.

use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::AppHandle;

use super::anim::{self, Options, Summary, Target};
use super::{heic, AVIF_PROBE};
use crate::files::{magic, FilesState};
use crate::internet::command::with_reporter;
use crate::internet::http::{ErrorKind, InternetError};
use crate::media::encode;

fn ffmpeg(app: &AppHandle) -> Option<PathBuf> {
    encode::locate(&crate::media::resolve_binary(app, "ffmpeg"), "ffmpeg")
}

/// Décode un AVIF (octets) vers un PNG avec FFmpeg.
fn avif_to_png(ffmpeg: &std::path::Path, bytes: &[u8]) -> Result<Vec<u8>, InternetError> {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("fourtout-avif-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| InternetError::new(ErrorKind::Destination, e.to_string()))?;
    let result = (|| {
        let input = dir.join("in.avif");
        let output = dir.join("out.png");
        std::fs::write(&input, bytes).map_err(|e| InternetError::new(ErrorKind::Write, e.to_string()))?;
        let status = Command::new(ffmpeg)
            .args(["-v", "error", "-nostdin", "-y", "-i"])
            .arg(&input)
            .args(["-frames:v", "1"])
            .arg(&output)
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| InternetError::new(ErrorKind::FfmpegMissing, format!("FFmpeg introuvable : {e}")))?;
        if !status.status.success() {
            return Err(InternetError::new(ErrorKind::Unsupported, "Ce FFmpeg ne sait pas décoder cette image AVIF."));
        }
        std::fs::read(&output).map_err(|e| InternetError::new(ErrorKind::Other, e.to_string()))
    })();
    let _ = std::fs::remove_dir_all(&dir);
    result
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFormats {
    pub heic: bool,
    /// Vérifié en décodant un échantillon, pas supposé d'après la liste des décodeurs.
    pub avif: bool,
    pub animated_webp: bool,
    pub apng: bool,
    pub ffmpeg: bool,
}

#[tauri::command(async)]
pub fn image_native_formats(app: AppHandle) -> NativeFormats {
    static AVIF: OnceLock<bool> = OnceLock::new();
    let ffmpeg = ffmpeg(&app);
    let avif = *AVIF.get_or_init(|| {
        ffmpeg.as_deref().is_some_and(|f| avif_to_png(f, AVIF_PROBE).map(|png| png.starts_with(&[0x89, b'P', b'N', b'G'])).unwrap_or(false))
    });
    NativeFormats { heic: true, avif, animated_webp: true, apng: true, ffmpeg: ffmpeg.is_some() }
}

/// Décode HEIC/HEIF ou AVIF vers un PNG. Les octets arrivent bruts (pas de JSON).
#[tauri::command(async)]
pub fn image_decode_native(app: AppHandle, request: Request<'_>) -> Result<Response, InternetError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(InternetError::new(ErrorKind::Other, "Corps binaire attendu."));
    };
    let signature = magic::identify(&bytes[..bytes.len().min(magic::HEAD_BYTES)]);
    let png = match signature.id {
        "heic" | "heif" => heic::to_png(bytes)?,
        "avif" => {
            if signature.animated {
                return Err(InternetError::new(ErrorKind::Unsupported, "Cet AVIF est une séquence animée : seule une image fixe peut être décodée ici."));
            }
            let ffmpeg = ffmpeg(&app).ok_or_else(|| InternetError::new(ErrorKind::FfmpegMissing, "FFmpeg est nécessaire pour décoder l'AVIF."))?;
            avif_to_png(&ffmpeg, bytes)?
        }
        _ => return Err(InternetError::new(ErrorKind::Unsupported, "Format non pris en charge par le décodeur natif.")),
    };
    Ok(Response::new(png))
}

#[tauri::command(async)]
pub fn image_anim_info(path: String) -> Result<anim::Info, InternetError> {
    anim::info(std::path::Path::new(&path))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertArgs {
    pub job_id: String,
    pub source: String,
    pub target: Target,
    /// Fichier de sortie, ou dossier parent pour `frames`.
    pub output: String,
    pub overwrite: bool,
    pub options: Options,
}

#[tauri::command(async)]
pub fn image_anim_convert(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    params: ConvertArgs,
) -> Result<Summary, InternetError> {
    // L'export en images ne passe pas par FFmpeg ; toute autre destination, si.
    let ffmpeg = match ffmpeg(&app) {
        Some(path) => path,
        None if params.target == Target::Frames => PathBuf::new(),
        None => return Err(InternetError::new(ErrorKind::FfmpegMissing, "FFmpeg est nécessaire pour cette conversion.")),
    };
    with_reporter(app.clone(), &state, &params.job_id.clone(), |reporter| {
        let id = params.job_id.clone();
        let emitter = app.clone();
        anim::convert(
            &ffmpeg,
            std::path::Path::new(&params.source),
            params.target,
            std::path::Path::new(&params.output),
            params.overwrite,
            &params.options,
            &|| reporter.cancelled(),
            &mut |ratio| {
                use tauri::Emitter;
                let _ = emitter.emit("files://progress", crate::files::ProgressEvent { job_id: id.clone(), ratio, label: "convert".into(), done: 0, total: 0 });
            },
        )
    })
}
