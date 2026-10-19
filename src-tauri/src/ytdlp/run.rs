//! Orchestration d'un téléchargement de média : yt-dlp, puis FFmpeg si besoin.
//!
//! Enchaînement : métadonnées → téléchargement dans un dossier privé →
//! (découpe locale) → (réencodage vers une taille maximale ou une animation) →
//! livraison sous un nom assaini, sans écraser. Le dossier privé est supprimé
//! dans tous les cas : succès, erreur, annulation.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::Serialize;

use super::info::{parse_info, MediaInfo};
use super::plan::{self, classify_error, AudioFormat, Mode, Request, VideoContainer};
use crate::files::unique_path;
use crate::internet::http::{sanitize_filename, ErrorKind, InternetError};
use crate::media::encode::{self, AnimationSettings, Container};
use crate::proc::{run_collect, run_streaming, Outcome, Stream};

/// Environnement d'exécution résolu une fois par l'appelant.
#[derive(Debug, Clone)]
pub struct Env {
    pub ytdlp: PathBuf,
    pub ffmpeg: Option<PathBuf>,
    pub ffprobe: Option<PathBuf>,
    pub cache_dir: PathBuf,
    pub work_root: PathBuf,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Stage {
    Inspect,
    Download,
    Merge,
    Audio,
    Trim,
    Encode,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub stage: Stage,
    pub ratio: Option<f64>,
    pub speed: Option<f64>,
    pub eta: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Method {
    /// Téléchargé en entier, tel quel.
    Full,
    /// Seul l'extrait a été téléchargé (yt-dlp).
    SectionRemote,
    /// Source téléchargée en entier puis découpée ici.
    SectionLocal,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome2 {
    pub path: String,
    pub bytes: u64,
    pub container: String,
    pub method: Method,
    pub reencoded: bool,
    pub warnings: Vec<String>,
}

/// Dossier de travail supprimé à la destruction.
struct Scratch(PathBuf);

impl Scratch {
    fn new(root: &Path) -> Result<Self, InternetError> {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let dir = root.join(format!("ytdlp-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&dir)
            .map_err(|e| InternetError::new(ErrorKind::Destination, format!("Dossier de travail inaccessible : {e}")))?;
        Ok(Scratch(dir))
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn cancelled_error() -> InternetError {
    InternetError::cancelled()
}

/// Métadonnées d'une adresse (aucun téléchargement).
pub fn fetch_info(env: &Env, url: &str, cancelled: &dyn Fn() -> bool) -> Result<MediaInfo, InternetError> {
    crate::internet::http::parse_url(url)?;
    let mut command = Command::new(&env.ytdlp);
    command.args(plan::info_args(url, &env.cache_dir));
    let collected = run_collect(&mut command, Some(Duration::from_secs(90)), cancelled, 32 * 1024 * 1024)
        .map_err(|e| InternetError::new(ErrorKind::ToolMissing, format!("yt-dlp ne démarre pas : {e}")))?;
    match collected.outcome {
        Outcome::Cancelled => Err(cancelled_error()),
        Outcome::TimedOut => Err(InternetError::new(ErrorKind::Timeout, "Délai dépassé : le service ne répond pas.")),
        Outcome::Exited(status) if status.success() => parse_info(&String::from_utf8_lossy(&collected.stdout)),
        Outcome::Exited(_) => {
            let lines: Vec<String> = collected.stderr.lines().map(str::to_string).collect();
            Err(classify_error(&lines))
        }
    }
}

struct Fetched {
    path: PathBuf,
    method: Method,
}

fn require_ffmpeg(env: &Env) -> Result<&Path, InternetError> {
    env.ffmpeg.as_deref().ok_or_else(|| {
        InternetError::new(ErrorKind::FfmpegMissing, "FFmpeg est introuvable : il est nécessaire pour assembler, convertir ou découper ce média.")
    })
}

/// Vérifie que FFmpeg sait réellement produire le format audio demandé.
pub fn check_audio_encoder(env: &Env, format: AudioFormat) -> Result<(), InternetError> {
    let ffmpeg = require_ffmpeg(env)?;
    if let Some(encoder) = format.encoder() {
        if !encode::list_encoders(ffmpeg).iter().any(|e| e == encoder) {
            return Err(InternetError::new(
                ErrorKind::FfmpegMissing,
                format!("Ce FFmpeg ne sait pas produire ce format audio (encodeur {encoder} absent)."),
            ));
        }
    }
    Ok(())
}

/// Télécharge dans `dir` (un dossier privé) et rend le fichier principal.
fn download_to(
    env: &Env,
    request: &Request,
    dir: &Path,
    cancelled: &dyn Fn() -> bool,
    on_update: &mut dyn FnMut(Update),
) -> Result<Fetched, InternetError> {
    crate::internet::http::parse_url(&request.url)?;
    let ffmpeg = require_ffmpeg(env)?;
    if request.mode == Mode::Audio {
        check_audio_encoder(env, request.audio_format)?;
    }
    if let Some(h) = request.max_height {
        if !plan::HEIGHT_CHOICES.contains(&h) {
            return Err(InternetError::new(ErrorKind::Other, "Résolution maximale non prise en charge."));
        }
    }

    let attempt = |with_section: bool, on_update: &mut dyn FnMut(Update)| -> Result<(), InternetError> {
        let mut command = Command::new(&env.ytdlp);
        command.args(plan::download_args(request, ffmpeg, dir, &env.cache_dir, with_section));
        let mut streams = 1usize;
        let mut index = 0usize;
        let mut last = 0u64;
        let mut stage = Stage::Download;
        let mut errors: Vec<String> = Vec::new();
        on_update(Update { stage, ratio: None, speed: None, eta: None });
        let outcome = run_streaming(&mut command, None, cancelled, &mut |stream, line| {
            if let Some(n) = plan::parse_stream_count(line) {
                streams = n.max(1);
            }
            if let Some(p) = plan::parse_progress(line) {
                if p.downloaded + 4096 < last {
                    index += 1;
                }
                last = p.downloaded;
                let part = p.total.map(|t| p.downloaded as f64 / t as f64).unwrap_or(0.0);
                let ratio = ((index.min(streams - 1) as f64 + part) / streams as f64).min(0.97);
                on_update(Update { stage, ratio: Some(ratio), speed: p.speed, eta: p.eta });
            } else if let Some(s) = plan::parse_stage(line) {
                stage = match s {
                    "merge" => Stage::Merge,
                    "audio" => Stage::Audio,
                    _ => Stage::Download,
                };
                on_update(Update { stage, ratio: None, speed: None, eta: None });
            }
            if stream == Stream::Stderr || line.contains("ERROR") {
                errors.push(line.to_string());
                if errors.len() > 40 {
                    errors.remove(0);
                }
            }
        })
        .map_err(|e| InternetError::new(ErrorKind::ToolMissing, format!("yt-dlp ne démarre pas : {e}")))?;
        match outcome {
            Outcome::Cancelled => Err(cancelled_error()),
            Outcome::TimedOut => Err(InternetError::new(ErrorKind::Timeout, "Délai dépassé.")),
            Outcome::Exited(status) if status.success() => Ok(()),
            Outcome::Exited(_) => Err(classify_error(&errors)),
        }
    };

    let mut method = Method::Full;
    if request.section.is_some() {
        match attempt(true, on_update) {
            Ok(()) => method = Method::SectionRemote,
            Err(e) if e.is_cancelled() => return Err(e),
            // Un refus lié au contenu ne se contourne pas en changeant de méthode.
            Err(e) if matches!(e.kind, ErrorKind::Drm | ErrorKind::LoginRequired | ErrorKind::Unavailable | ErrorKind::Unsupported | ErrorKind::FfmpegMissing) => {
                return Err(e)
            }
            Err(_) => {
                // Le site ne permet pas l'extrait à distance : source entière, découpe locale.
                clear(dir);
                attempt(false, on_update)?;
                method = Method::SectionLocal;
            }
        }
    } else {
        attempt(false, on_update)?;
    }
    Ok(Fetched { path: main_file(dir)?, method })
}

fn clear(dir: &Path) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Le fichier final : le plus gros qui ne soit ni partiel ni intermédiaire.
fn main_file(dir: &Path) -> Result<PathBuf, InternetError> {
    let mut best: Option<(u64, PathBuf)> = None;
    for entry in fs::read_dir(dir).map_err(|e| InternetError::new(ErrorKind::Destination, e.to_string()))?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let intermediate = name.ends_with(".part") || name.ends_with(".ytdl") || name.ends_with(".temp") || {
            // ft.f137.mp4 : flux intermédiaire d'un assemblage.
            name.strip_prefix("ft.f").is_some_and(|r| r.chars().next().is_some_and(|c| c.is_ascii_digit()))
        };
        if !name.starts_with("ft.") || intermediate {
            continue;
        }
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        if size > 0 && best.as_ref().is_none_or(|b| size > b.0) {
            best = Some((size, entry.path()));
        }
    }
    best.map(|b| b.1).ok_or_else(|| InternetError::new(ErrorKind::Other, "Aucun fichier n'a été produit par yt-dlp."))
}

fn extension_of(path: &Path) -> String {
    path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// Livre `file` dans `destination` sous un nom assaini et libre.
fn deliver(file: &Path, destination: &Path, title: &str, extension: &str) -> Result<PathBuf, InternetError> {
    if !destination.is_dir() {
        return Err(InternetError::new(ErrorKind::Destination, format!("Dossier de destination introuvable : {}", destination.display())));
    }
    let stem = sanitize_filename(title, "media");
    let target = unique_path(&destination.join(format!("{stem}.{extension}")));
    if fs::rename(file, &target).is_err() {
        fs::copy(file, &target).map_err(|e| InternetError::new(ErrorKind::Write, format!("Écriture impossible (disque plein ?) : {e}")))?;
        let _ = fs::remove_file(file);
    }
    Ok(target)
}

/// Téléchargement complet d'un média (vidéo ou audio), livré dans `destination`.
pub fn download(
    env: &Env,
    request: &Request,
    title: &str,
    destination: &Path,
    cancelled: &dyn Fn() -> bool,
    on_update: &mut dyn FnMut(Update),
) -> Result<Outcome2, InternetError> {
    if let Some(section) = request.section {
        section.validate(None)?;
    }
    let scratch = Scratch::new(&env.work_root)?;
    let fetched = download_to(env, request, &scratch.0, cancelled, on_update)?;
    let mut file = fetched.path.clone();
    let mut reencoded = false;
    let mut warnings = Vec::new();
    let ffmpeg = env.ffmpeg.as_deref();

    // Découpe locale si le site n'a pas permis l'extrait à distance.
    if let (Method::SectionLocal, Some(section), Some(ffmpeg)) = (&fetched.method, request.section, ffmpeg) {
        let ext = extension_of(&file);
        let cut = scratch.0.join(format!("cut.{ext}"));
        let container = if ext == "webm" { Container::Webm } else { Container::Mp4 };
        // Copier les flux ne coupe qu'aux images clés : la découpe locale
        // d'une vidéo réencode, pour que l'extrait ait la durée demandée.
        let reencode = if request.mode == Mode::Video {
            encode::pick_video_encoder(ffmpeg, container).map(|v| (v, encode::pick_audio_encoder(ffmpeg, container)))
        } else {
            None
        };
        let args = encode::trim_args(&file, &cut, section.start, section.duration(), reencode);
        encode::run(ffmpeg, &args, (section.duration() * 1000.0) as u64, cancelled, &mut |r| {
            on_update(Update { stage: Stage::Trim, ratio: Some(r), speed: None, eta: None })
        })?;
        let _ = fs::remove_file(&file);
        file = cut;
        reencoded = reencode.is_some();
    }

    // Taille maximale.
    if let Some(max) = request.max_bytes {
        let size = fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
        if size > max {
            let ffmpeg = require_ffmpeg(env)?;
            if request.mode == Mode::Audio {
                let ext = extension_of(&file);
                let ffprobe = env.ffprobe.as_deref().ok_or_else(|| InternetError::new(ErrorKind::FfmpegMissing, "ffprobe est introuvable."))?;
                let out = scratch.0.join(format!("small.{ext}"));
                encode::compress_audio_to_size(ffmpeg, ffprobe, &file, &out, max, &ext, cancelled, &mut |r| {
                    on_update(Update { stage: Stage::Encode, ratio: Some(r), speed: None, eta: None })
                })?;
                let _ = fs::remove_file(&file);
                file = out;
            } else {
                let container = if request.container == VideoContainer::Webm { Container::Webm } else { Container::Mp4 };
                let out = scratch.0.join(format!("small.{}", container.extension()));
                let ffprobe = env.ffprobe.as_deref().ok_or_else(|| InternetError::new(ErrorKind::FfmpegMissing, "ffprobe est introuvable."))?;
                encode::compress_video_to_size(ffmpeg, ffprobe, &file, &out, max, container, cancelled, &mut |r| {
                    on_update(Update { stage: Stage::Encode, ratio: Some(r), speed: None, eta: None })
                })?;
                let _ = fs::remove_file(&file);
                file = out;
            }
            reencoded = true;
            warnings.push("reencoded-for-size".to_string());
        }
    }

    let extension = extension_of(&file);
    let bytes = fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
    let delivered = deliver(&file, destination, title, &extension)?;
    Ok(Outcome2 {
        path: delivered.to_string_lossy().to_string(),
        bytes,
        container: extension,
        method: fetched.method,
        reencoded,
        warnings,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AnimationFormat {
    Gif,
    Webp,
}

/// Vidéo en ligne → GIF ou WebP animé.
pub fn animate(
    env: &Env,
    request: &Request,
    title: &str,
    destination: &Path,
    format: AnimationFormat,
    settings: &AnimationSettings,
    cancelled: &dyn Fn() -> bool,
    on_update: &mut dyn FnMut(Update),
) -> Result<Outcome2, InternetError> {
    let ffmpeg = require_ffmpeg(env)?;
    if settings.duration <= 0.0 || settings.duration > 60.0 {
        return Err(InternetError::new(ErrorKind::Other, "Une animation dure de quelques instants à 60 secondes au plus."));
    }
    let webp_encoder = if format == AnimationFormat::Webp {
        let encoders = encode::list_encoders(ffmpeg);
        Some(
            ["libwebp_anim", "libwebp"]
                .into_iter()
                .find(|e| encoders.iter().any(|x| x == e))
                .ok_or_else(|| InternetError::new(ErrorKind::FfmpegMissing, "Ce FFmpeg ne sait pas produire de WebP animé."))?,
        )
    } else {
        None
    };

    // L'extrait source : 720 p au plus, une animation n'a pas besoin de plus.
    let mut source = request.clone();
    source.mode = Mode::Video;
    source.container = VideoContainer::Mp4;
    source.max_height = Some(request.max_height.unwrap_or(720).min(720));
    source.max_bytes = None;
    source.section = Some(plan::Section { start: settings.start, end: settings.start + settings.duration });

    let scratch = Scratch::new(&env.work_root)?;
    let fetched = download_to(env, &source, &scratch.0, cancelled, on_update)?;
    // Si la découpe s'est faite à distance, le fichier commence à 0.
    let offset = if matches!(fetched.method, Method::SectionRemote) { 0.0 } else { settings.start };
    let extension = if format == AnimationFormat::Gif { "gif" } else { "webp" };
    let out = scratch.0.join(format!("anim.{extension}"));
    let mut attempt = 0;
    loop {
        let current = encode::lighter(settings, attempt);
        let current = AnimationSettings { start: offset, ..current };
        let args = match format {
            AnimationFormat::Gif => encode::gif_args(&fetched.path, &out, &current),
            AnimationFormat::Webp => encode::webp_args(&fetched.path, &out, &current, webp_encoder.unwrap_or("libwebp")),
        };
        encode::run(ffmpeg, &args, (settings.duration * 1000.0) as u64, cancelled, &mut |r| {
            on_update(Update { stage: Stage::Encode, ratio: Some(r), speed: None, eta: None })
        })?;
        let size = fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
        match request.max_bytes {
            Some(max) if size > max => {
                attempt += 1;
                if attempt >= 5 {
                    return Err(InternetError::new(
                        ErrorKind::Other,
                        "Impossible de passer sous la taille demandée : réduisez la durée, la largeur ou la cadence.",
                    ));
                }
            }
            _ => break,
        }
    }
    let bytes = fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
    let delivered = deliver(&out, destination, title, extension)?;
    Ok(Outcome2 {
        path: delivered.to_string_lossy().to_string(),
        bytes,
        container: extension.to_string(),
        method: fetched.method,
        reencoded: true,
        warnings: Vec::new(),
    })
}

#[cfg(all(test, unix))]
mod tests {
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    use super::super::info::SAMPLE;
    use super::*;

    fn work(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fourtout-ytrun-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn ffmpeg() -> Option<PathBuf> {
        encode::locate(Path::new("ffmpeg"), "ffmpeg")
    }

    /// Faux yt-dlp : un script qui rejoue le comportement voulu et consigne ses arguments.
    fn fake(dir: &Path, media: Option<&Path>, behaviour: &str) -> PathBuf {
        let script = dir.join("fake-yt-dlp");
        let media = media.map(|m| m.to_string_lossy().to_string()).unwrap_or_default();
        let body = format!(
            r#"#!/bin/sh
printf '%s\n' "$@" > "{dir}/args-$$.txt"
for a in "$@"; do [ "$a" = "-J" ] && {{ cat <<'JSON'
{json}
JSON
exit 0; }}; done
out=""; prev=""
for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done
d=$(dirname "$out")
{behaviour}
echo "[info] abc: Downloading 1 format(s): 137+140"
echo "FTPROG 500 1000 NA 100.0 5"
echo "FTPROG 1000 1000 NA 100.0 0"
cp "{media}" "$d/ft.mp4"
exit 0
"#,
            dir = dir.display(),
            json = SAMPLE,
            media = media,
            behaviour = behaviour,
        );
        fs::write(&script, body).unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        script
    }

    fn clip(dir: &Path, seconds: u32) -> Option<PathBuf> {
        let ffmpeg = ffmpeg()?;
        let out = dir.join("clip.mp4");
        let encoder = encode::pick_video_encoder(&ffmpeg, Container::Mp4)?;
        let status = Command::new(&ffmpeg)
            .args(["-v", "error", "-y", "-f", "lavfi", "-i"])
            .arg(format!("testsrc2=size=640x360:rate=25:duration={seconds}"))
            .args(["-f", "lavfi", "-i"])
            .arg(format!("sine=duration={seconds}"))
            .args(["-c:v", encoder, "-b:v", "2500k", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"])
            .arg(&out)
            .status()
            .ok()?;
        status.success().then_some(out)
    }

    fn env(dir: &Path, ytdlp: PathBuf) -> Env {
        Env {
            ytdlp,
            ffmpeg: ffmpeg(),
            ffprobe: crate::exec::find_in_path("ffprobe"),
            cache_dir: dir.join("cache"),
            work_root: dir.join("scratch"),
        }
    }

    fn request(url: &str) -> Request {
        Request {
            url: url.into(),
            mode: Mode::Video,
            container: VideoContainer::Mp4,
            max_height: Some(1080),
            audio_format: AudioFormat::Mp3,
            audio_kbps: None,
            section: None,
            exact_cuts: false,
            max_bytes: None,
        }
    }

    fn args_recorded(dir: &Path) -> Vec<String> {
        let mut all = Vec::new();
        for entry in fs::read_dir(dir).unwrap().flatten() {
            if entry.file_name().to_string_lossy().starts_with("args-") {
                all.extend(fs::read_to_string(entry.path()).unwrap().lines().map(str::to_string));
            }
        }
        all
    }

    #[test]
    fn inspects_and_downloads_with_a_safe_name_and_cleans_up() {
        let Some(_) = ffmpeg() else { return };
        let dir = work("download");
        let media = clip(&dir, 4).unwrap();
        let env = env(&dir, fake(&dir, Some(&media), ""));
        let info = fetch_info(&env, "https://www.youtube.com/watch?v=abc123XYZ_-", &|| false).unwrap();
        assert_eq!(info.id, "abc123XYZ_-");

        let destination = dir.join("sortie");
        fs::create_dir_all(&destination).unwrap();
        let mut updates = Vec::new();
        let outcome = download(&env, &request("https://www.youtube.com/watch?v=abc123XYZ_-"), &info.title, &destination, &|| false, &mut |u| updates.push(u)).unwrap();

        // Le titre hostile est devenu un nom de fichier inoffensif, dans le dossier choisi.
        let produced = PathBuf::from(&outcome.path);
        assert_eq!(produced.parent().unwrap(), destination);
        let name = produced.file_name().unwrap().to_string_lossy().to_string();
        assert!(name.ends_with(".mp4") && !name.contains('/') && !name.contains(".."), "{name}");
        assert!(updates.iter().any(|u| u.ratio.is_some()));
        // Le dossier privé a disparu.
        assert_eq!(fs::read_dir(dir.join("scratch")).unwrap().count(), 0);
        // L'adresse est passée telle quelle, après le séparateur.
        let args = args_recorded(&dir);
        assert!(args.contains(&"--ignore-config".to_string()));
        assert_eq!(args.last().unwrap(), "https://www.youtube.com/watch?v=abc123XYZ_-");
        // Un second téléchargement n'écrase pas le premier.
        let second = download(&env, &request("https://www.youtube.com/watch?v=abc123XYZ_-"), &info.title, &destination, &|| false, &mut |_| {}).unwrap();
        assert_ne!(second.path, outcome.path);
        assert_eq!(fs::read_dir(&destination).unwrap().count(), 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_target_size_triggers_a_real_reencode_under_the_ceiling() {
        let Some(_) = ffmpeg() else { return };
        let dir = work("size");
        let media = clip(&dir, 8).unwrap();
        let original = fs::metadata(&media).unwrap().len();
        let env = env(&dir, fake(&dir, Some(&media), ""));
        let destination = dir.join("out");
        fs::create_dir_all(&destination).unwrap();
        let mut r = request("https://x.org/v");
        r.max_bytes = Some(original / 3);
        let outcome = download(&env, &r, "Petit", &destination, &|| false, &mut |_| {}).unwrap();
        assert!(outcome.reencoded);
        assert!(outcome.bytes <= original / 3, "{} > {}", outcome.bytes, original / 3);

        // Une cible déjà respectée ne réencode pas.
        let mut easy = request("https://x.org/v");
        easy.max_bytes = Some(original * 2);
        assert!(!download(&env, &easy, "Facile", &destination, &|| false, &mut |_| {}).unwrap().reencoded);
        // Une cible absurde est refusée avec une explication.
        let mut absurd = request("https://x.org/v");
        absurd.max_bytes = Some(2_000);
        let error = download(&env, &absurd, "Absurde", &destination, &|| false, &mut |_| {}).unwrap_err();
        assert!(error.message.contains("trop petite"), "{error}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_site_without_remote_sections_falls_back_to_a_local_trim() {
        let Some(_) = ffmpeg() else { return };
        let dir = work("section");
        let media = clip(&dir, 10).unwrap();
        // Le faux yt-dlp refuse --download-sections.
        let behaviour = r#"for a in "$@"; do [ "$a" = "--download-sections" ] && { echo "ERROR: sections not supported" >&2; exit 1; }; done"#;
        let env = env(&dir, fake(&dir, Some(&media), behaviour));
        let destination = dir.join("out");
        fs::create_dir_all(&destination).unwrap();
        let mut r = request("https://x.org/v");
        r.section = Some(plan::Section { start: 2.0, end: 5.0 });
        let outcome = download(&env, &r, "Extrait", &destination, &|| false, &mut |_| {}).unwrap();
        assert!(matches!(outcome.method, Method::SectionLocal));
        let duration = encode::duration_secs(env.ffprobe.as_deref().unwrap(), Path::new(&outcome.path)).unwrap();
        assert!((duration - 3.0).abs() < 1.5, "{duration}");
        // Les deux tentatives sont visibles dans les arguments consignés.
        assert!(args_recorded(&dir).contains(&"--download-sections".to_string()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn content_refusals_are_reported_not_worked_around() {
        let Some(_) = ffmpeg() else { return };
        let dir = work("drm");
        let behaviour = r#"echo "ERROR: [youtube] abc: This video is DRM protected" >&2; exit 1"#;
        let env = env(&dir, fake(&dir, None, behaviour));
        let destination = dir.join("out");
        fs::create_dir_all(&destination).unwrap();
        let mut r = request("https://x.org/v");
        r.section = Some(plan::Section { start: 0.0, end: 5.0 });
        let error = download(&env, &r, "x", &destination, &|| false, &mut |_| {}).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Drm);
        assert_eq!(fs::read_dir(&destination).unwrap().count(), 0);
        // Aucune seconde tentative « sans section » pour un refus de contenu.
        assert_eq!(args_recorded(&dir).iter().filter(|a| *a == "--ignore-config").count(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn cancellation_kills_yt_dlp_and_leaves_nothing() {
        let Some(_) = ffmpeg() else { return };
        let dir = work("cancel");
        let behaviour = "echo FTPROG 1 1000 NA 1 1; sleep 30";
        let env = env(&dir, fake(&dir, None, behaviour));
        let destination = dir.join("out");
        fs::create_dir_all(&destination).unwrap();
        let flag = Arc::new(AtomicBool::new(false));
        let remote = flag.clone();
        let started = std::time::Instant::now();
        let error = download(&env, &request("https://x.org/v"), "x", &destination, &|| flag.load(Ordering::SeqCst), &mut |u| {
            if u.ratio.is_some() {
                remote.store(true, Ordering::SeqCst);
            }
        })
        .unwrap_err();
        assert!(error.is_cancelled(), "{error}");
        assert!(started.elapsed() < Duration::from_secs(10));
        assert_eq!(fs::read_dir(&destination).unwrap().count(), 0);
        assert_eq!(fs::read_dir(dir.join("scratch")).unwrap().count(), 0, "dossier privé supprimé");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn makes_an_animated_gif_from_a_fake_download() {
        let Some(_) = ffmpeg() else { return };
        let dir = work("gif");
        let media = clip(&dir, 6).unwrap();
        let env = env(&dir, fake(&dir, Some(&media), ""));
        let destination = dir.join("out");
        fs::create_dir_all(&destination).unwrap();
        let settings = AnimationSettings { start: 1.0, duration: 2.0, fps: 10, width: 240, quality: 70, colors: 128 };
        let outcome = animate(&env, &request("https://x.org/v"), "Boucle", &destination, AnimationFormat::Gif, &settings, &|| false, &mut |_| {}).unwrap();
        assert!(fs::read(&outcome.path).unwrap().starts_with(b"GIF89a"));

        let mut limited = request("https://x.org/v");
        limited.max_bytes = Some(1_000);
        let error = animate(&env, &limited, "Trop gros", &destination, AnimationFormat::Gif, &settings, &|| false, &mut |_| {}).unwrap_err();
        assert!(error.message.contains("taille"), "{error}");
        let _ = fs::remove_dir_all(&dir);
    }
}
