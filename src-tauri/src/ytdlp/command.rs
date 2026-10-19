//! Commandes Tauri de yt-dlp. Chaque action est déclenchée par l'utilisateur.

use std::path::PathBuf;
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::plan::Request;
use super::run::{self, AnimationFormat, Env, Outcome2, Update};
use super::{info::MediaInfo, Source, Status};
use crate::files::FilesState;
use crate::internet::command::with_reporter;
use crate::internet::http::{self, agent, fetch, ClientOptions, ErrorKind, InternetError};
use crate::media::encode::{self, AnimationSettings};

fn env_for(app: &AppHandle) -> Result<Env, InternetError> {
    let root = crate::models::root(app);
    let (ytdlp, _) = super::resolve(&root).ok_or_else(|| {
        InternetError::new(ErrorKind::ToolMissing, "yt-dlp n'est pas installé : installez-le depuis cet outil.")
    })?;
    let ffmpeg = encode::locate(&crate::media::resolve_binary(app, "ffmpeg"), "ffmpeg");
    let ffprobe = encode::locate(&crate::media::resolve_binary(app, "ffprobe"), "ffprobe");
    let work_root = crate::media::temp_dir().map_err(|e| InternetError::new(ErrorKind::Destination, e.to_string()))?;
    Ok(Env { ytdlp, ffmpeg, ffprobe, cache_dir: super::cache_dir(&root), work_root })
}

#[tauri::command(async)]
pub fn ytdlp_status(app: AppHandle) -> Status {
    super::status(&crate::models::root(&app))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub ffmpeg: bool,
    /// Un encodeur WebP animé existe (`libwebp_anim` ou `libwebp`).
    pub webp_animated: bool,
    /// Encodeurs audio utilisables, pour n'offrir que des formats réels.
    pub audio_encoders: Vec<String>,
}

#[tauri::command(async)]
pub fn ytdlp_capabilities(app: AppHandle) -> Capabilities {
    let ffmpeg = encode::locate(&crate::media::resolve_binary(&app, "ffmpeg"), "ffmpeg");
    let encoders = ffmpeg.as_deref().map(encode::list_encoders).unwrap_or_default();
    let wanted = ["libmp3lame", "aac", "libopus", "libvorbis", "pcm_s16le", "flac"];
    Capabilities {
        ffmpeg: ffmpeg.is_some(),
        webp_animated: ["libwebp_anim", "libwebp"].iter().any(|w| encoders.iter().any(|e| e == w)),
        audio_encoders: wanted.iter().filter(|w| encoders.iter().any(|e| e == *w)).map(|s| s.to_string()).collect(),
    }
}

#[tauri::command(async)]
pub fn ytdlp_latest() -> Result<String, InternetError> {
    super::latest_tag(&Source::default(), &ClientOptions::default())
}

#[tauri::command(async)]
pub fn ytdlp_install(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
) -> Result<super::InstallSummary, InternetError> {
    let root = crate::models::root(&app);
    with_reporter(app, &state, &job_id.clone(), |reporter| {
        super::install(&root, &Source::default(), &ClientOptions::default(), &super::validate_by_running, reporter)
    })
}

#[tauri::command(async)]
pub fn ytdlp_remove(app: AppHandle) -> Result<(), InternetError> {
    super::remove(&crate::models::root(&app))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InfoWithThumbnail {
    #[serde(flatten)]
    pub info: MediaInfo,
    /// Vignette en `data:`, récupérée ici pour ne pas élargir la CSP.
    pub thumbnail_data: Option<String>,
}

fn thumbnail(url: &str) -> Option<String> {
    let url = http::parse_url(url).ok()?;
    let options = ClientOptions { connect_timeout: Duration::from_secs(8), read_timeout: Duration::from_secs(8) };
    let fetched = fetch(&agent(&options), "GET", &url, &[]).ok()?;
    let mime = fetched.response.header("Content-Type")?.split(';').next()?.trim().to_lowercase();
    if !matches!(mime.as_str(), "image/jpeg" | "image/png" | "image/webp" | "image/gif") {
        return None;
    }
    let bytes = http::read_limited(fetched.response, 3 * 1024 * 1024).ok()?;
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[tauri::command(async)]
pub fn ytdlp_info(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
    url: String,
) -> Result<InfoWithThumbnail, InternetError> {
    let env = env_for(&app)?;
    let info = with_reporter(app, &state, &job_id.clone(), |reporter| {
        let info = run::fetch_info(&env, &url, &|| reporter.cancelled())?;
        if info.is_live {
            return Err(InternetError::new(ErrorKind::Unsupported, "Les diffusions en direct ne sont pas prises en charge."));
        }
        Ok(info)
    })?;
    let thumbnail_data = info.thumbnail_url.as_deref().and_then(thumbnail);
    Ok(InfoWithThumbnail { info, thumbnail_data })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaEvent {
    job_id: String,
    #[serde(flatten)]
    update: Update,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadArgs {
    pub job_id: String,
    pub request: Request,
    pub title: String,
    pub destination: String,
}

#[tauri::command(async)]
pub fn ytdlp_download(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    params: DownloadArgs,
) -> Result<Outcome2, InternetError> {
    let env = env_for(&app)?;
    let emitter = app.clone();
    let id = params.job_id.clone();
    with_reporter(app, &state, &params.job_id.clone(), |reporter| {
        run::download(&env, &params.request, &params.title, &PathBuf::from(&params.destination), &|| reporter.cancelled(), &mut |update| {
            let _ = emitter.emit("internet://media", MediaEvent { job_id: id.clone(), update });
        })
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimateArgs {
    pub job_id: String,
    pub request: Request,
    pub title: String,
    pub destination: String,
    pub format: AnimationFormat,
    pub fps: u32,
    pub width: u32,
    pub quality: u32,
}

#[tauri::command(async)]
pub fn ytdlp_animate(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    params: AnimateArgs,
) -> Result<Outcome2, InternetError> {
    let env = env_for(&app)?;
    let section = params
        .request
        .section
        .ok_or_else(|| InternetError::new(ErrorKind::Other, "Indiquez le début et la fin de l'extrait."))?;
    section.validate(None)?;
    let settings = AnimationSettings {
        start: section.start,
        duration: section.duration(),
        fps: params.fps.clamp(1, 30),
        width: params.width.clamp(64, 1280),
        quality: params.quality.clamp(10, 100),
        colors: 256,
    };
    let emitter = app.clone();
    let id = params.job_id.clone();
    with_reporter(app, &state, &params.job_id.clone(), |reporter| {
        run::animate(
            &env, &params.request, &params.title, &PathBuf::from(&params.destination), params.format, &settings,
            &|| reporter.cancelled(),
            &mut |update| {
                let _ = emitter.emit("internet://media", MediaEvent { job_id: id.clone(), update });
            },
        )
    })
}

/// Vérifie la faisabilité d'une taille maximale pour une durée donnée.
#[tauri::command]
pub fn media_budget_plan(source: crate::media::budget::Source, target_bytes: u64) -> crate::media::budget::Plan {
    crate::media::budget::plan(&source, target_bytes)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    /// Hauteur réellement obtenue (jamais au-dessus de la source).
    pub resolved_height: Option<u32>,
    pub estimated_bytes: Option<u64>,
    pub video: Option<super::info::FormatInfo>,
    pub audio: Option<super::info::FormatInfo>,
}

/// Ce que donnerait une demande : résolution obtenue, flux retenus, taille estimée.
#[tauri::command]
pub fn ytdlp_preview(info: MediaInfo, request: Request) -> Preview {
    let (video, audio) = super::plan::choose_streams(&info, &request);
    Preview {
        resolved_height: super::plan::effective_height(&info, request.max_height),
        estimated_bytes: super::plan::estimate_bytes(&info, &request),
        video: video.cloned(),
        audio: audio.cloned(),
    }
}
