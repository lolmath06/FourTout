//! Commande Tauri : compresser un média vers une taille maximale.
//!
//! L'entrée est un fichier déjà préparé par `media_stage` (dossier temporaire
//! de FourTout, jamais un chemin libre) ; la sortie est un autre fichier
//! temporaire, relu ensuite par `media_read` comme pour toute opération média.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::encode::{self, Container, SizeReport};
use super::{resolve_binary, temp_dir, temp_path};
use crate::files::FilesState;
use crate::internet::command::with_reporter;
use crate::internet::http::{ErrorKind, InternetError};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SizeArgs {
    pub job_id: String,
    pub input: String,
    /// `video` ou `audio`.
    pub kind: String,
    /// Extension de sortie : `mp4`/`webm` (vidéo), `mp3`/`m4a`/`opus`/`ogg` (audio).
    pub extension: String,
    pub max_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SizeOutput {
    pub path: String,
    pub report: SizeReport,
}

#[tauri::command(async)]
pub fn media_compress_size(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    params: SizeArgs,
) -> Result<SizeOutput, InternetError> {
    let dir = temp_dir().map_err(|e| InternetError::new(ErrorKind::Destination, e.to_string()))?;
    let input = std::path::PathBuf::from(&params.input);
    if !input.starts_with(&dir) {
        return Err(InternetError::new(ErrorKind::Destination, "Chemin hors du dossier temporaire."));
    }
    let ffmpeg = encode::locate(&resolve_binary(&app, "ffmpeg"), "ffmpeg")
        .ok_or_else(|| InternetError::new(ErrorKind::FfmpegMissing, "FFmpeg est introuvable."))?;
    let ffprobe = encode::locate(&resolve_binary(&app, "ffprobe"), "ffprobe")
        .ok_or_else(|| InternetError::new(ErrorKind::FfmpegMissing, "ffprobe est introuvable."))?;
    let extension = params.extension.trim_start_matches('.').to_ascii_lowercase();
    let output = temp_path(&extension).map_err(|e| InternetError::new(ErrorKind::Destination, e.to_string()))?;

    with_reporter(app, &state, &params.job_id.clone(), |reporter| {
        let mut progress = |ratio: f64| reporter.report((ratio * 1000.0) as u64, 1000, "encode");
        let report = match params.kind.as_str() {
            "video" => {
                let container = match extension.as_str() {
                    "webm" => Container::Webm,
                    "mp4" => Container::Mp4,
                    _ => return Err(InternetError::new(ErrorKind::Other, "Conteneur vidéo non pris en charge.")),
                };
                encode::compress_video_to_size(&ffmpeg, &ffprobe, &input, &output, params.max_bytes, container, &|| reporter.cancelled(), &mut progress)
            }
            "audio" => encode::compress_audio_to_size(&ffmpeg, &ffprobe, &input, &output, params.max_bytes, &extension, &|| reporter.cancelled(), &mut progress),
            _ => Err(InternetError::new(ErrorKind::Other, "Type de média non pris en charge.")),
        };
        match report {
            Ok(report) => Ok(SizeOutput { path: output.to_string_lossy().to_string(), report }),
            Err(error) => {
                let _ = std::fs::remove_file(&output);
                Err(error)
            }
        }
    })
}
