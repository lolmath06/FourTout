//! Exécutions FFmpeg annulables et constructeurs d'arguments, côté natif.
//!
//! Les outils Internet (extrait d'une vidéo en ligne, GIF, taille maximale)
//! enchaînent un téléchargement et un traitement FFmpeg sans repasser par la
//! WebView. Le traitement s'appuie sur l'infrastructure existante — le même
//! binaire (`resolve_binary`), le même test d'encodeurs (`encoder_works`) — et
//! sur `proc` pour que l'annulation tue FFmpeg et ses enfants.
//!
//! Tout est structuré : un argument est une valeur, jamais un morceau de
//! ligne de commande.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use super::budget::Plan;
use super::encoder_works;
use crate::internet::http::{ErrorKind, InternetError};
use crate::proc::{run_streaming, Outcome, Stream};

/// Conteneurs vidéo de sortie que ce module sait produire.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Container {
    Mp4,
    Webm,
}

impl Container {
    pub fn extension(self) -> &'static str {
        match self {
            Container::Mp4 => "mp4",
            Container::Webm => "webm",
        }
    }
}

/// Chemin **absolu** de FFmpeg, ou `None` s'il n'est pas lançable.
///
/// `resolve_binary` peut rendre un simple nom (« ffmpeg ») : bon pour
/// `Command`, insuffisant pour `yt-dlp --ffmpeg-location`.
pub fn locate(candidate: &Path, name: &str) -> Option<PathBuf> {
    let path = if candidate.is_absolute() { candidate.to_path_buf() } else { crate::exec::find_in_path(name)? };
    let ok = Command::new(&path)
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    ok.then_some(path)
}

/// Premier encodeur vidéo **qui fonctionne vraiment** pour ce conteneur.
///
/// Le nom dans `ffmpeg -encoders` ne prouve rien (voir `encoder_works`) : on
/// essaie dans l'ordre de préférence et on garde le premier qui s'ouvre.
pub fn pick_video_encoder(ffmpeg: &Path, container: Container) -> Option<&'static str> {
    let candidates: &[&str] = match container {
        Container::Mp4 => &["libx264", "libopenh264"],
        Container::Webm => &["libvpx-vp9", "libsvtav1", "libaom-av1"],
    };
    candidates.iter().copied().find(|name| encoder_works(ffmpeg, name))
}

pub fn pick_audio_encoder(ffmpeg: &Path, container: Container) -> Option<&'static str> {
    let candidates: &[&str] = match container {
        Container::Mp4 => &["aac"],
        Container::Webm => &["libopus", "libvorbis"],
    };
    candidates.iter().copied().find(|name| audio_encoder_listed(ffmpeg, name))
}

/// Encodeurs listés par `ffmpeg -encoders`, pour un test de présence.
pub fn list_encoders(ffmpeg: &Path) -> Vec<String> {
    let Ok(output) = Command::new(ffmpeg).args(["-hide_banner", "-encoders"]).output() else { return Vec::new() };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut parts = line.trim_start().split_whitespace();
            let flags = parts.next()?;
            (flags.len() == 6 && flags.chars().all(|c| "AVSFXBDL.".contains(c))).then(|| parts.next().map(str::to_string))?
        })
        .collect()
}

fn audio_encoder_listed(ffmpeg: &Path, name: &str) -> bool {
    list_encoders(ffmpeg).iter().any(|e| e == name)
}

/// Exécute FFmpeg. `total_ms` alimente la progression (0 = indéterminée).
pub fn run(
    ffmpeg: &Path,
    args: &[String],
    total_ms: u64,
    cancelled: &dyn Fn() -> bool,
    progress: &mut dyn FnMut(f64),
) -> Result<(), InternetError> {
    let mut command = Command::new(ffmpeg);
    command
        .args(["-hide_banner", "-nostdin", "-y"])
        .args(args)
        .args(["-progress", "pipe:1", "-nostats"]);
    let mut tail: Vec<String> = Vec::new();
    let outcome = run_streaming(&mut command, None, cancelled, &mut |stream, line| match stream {
        Stream::Stdout => {
            if let Some(value) = line.strip_prefix("out_time_us=") {
                if let (Ok(us), true) = (value.trim().parse::<u64>(), total_ms > 0) {
                    progress((us as f64 / 1000.0 / total_ms as f64).clamp(0.0, 1.0));
                }
            }
        }
        Stream::Stderr => {
            tail.push(line.to_string());
            if tail.len() > 8 {
                tail.remove(0);
            }
        }
    })
    .map_err(|e| InternetError::new(ErrorKind::Other, format!("FFmpeg introuvable : {e}")))?;

    match outcome {
        Outcome::Cancelled => Err(InternetError::cancelled()),
        Outcome::TimedOut => Err(InternetError::new(ErrorKind::Timeout, "Délai dépassé.")),
        Outcome::Exited(status) if status.success() => Ok(()),
        Outcome::Exited(_) => {
            let detail = tail.iter().rev().take(3).rev().cloned().collect::<Vec<_>>().join(" ");
            Err(InternetError::new(
                ErrorKind::Other,
                if detail.is_empty() { "Le traitement FFmpeg a échoué.".to_string() } else { format!("Le traitement FFmpeg a échoué : {detail}") },
            ))
        }
    }
}

/// Durée d'un média en secondes, par ffprobe.
pub fn duration_secs(ffprobe: &Path, input: &Path) -> Option<f64> {
    let output = Command::new(ffprobe)
        .args(["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1"])
        .arg(input)
        .output()
        .ok()?;
    String::from_utf8_lossy(&output.stdout).trim().parse().ok()
}

/// Un flux utile à la planification d'un budget.
#[derive(Debug, Clone, Default)]
pub struct Probed {
    pub duration_secs: f64,
    pub has_video: bool,
    pub has_audio: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub video_kbps: Option<f64>,
    pub audio_kbps: Option<f64>,
}

pub fn probe_streams(ffprobe: &Path, input: &Path) -> Option<Probed> {
    let output = Command::new(ffprobe)
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams"])
        .arg(input)
        .output()
        .ok()?;
    parse_probe(&String::from_utf8_lossy(&output.stdout))
}

pub fn parse_probe(json: &str) -> Option<Probed> {
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    let mut probed = Probed {
        duration_secs: value["format"]["duration"].as_str().and_then(|d| d.parse().ok()).unwrap_or(0.0),
        ..Probed::default()
    };
    let total_kbps = value["format"]["bit_rate"].as_str().and_then(|b| b.parse::<f64>().ok()).map(|b| b / 1000.0);
    for stream in value["streams"].as_array()? {
        let kbps = stream["bit_rate"].as_str().and_then(|b| b.parse::<f64>().ok()).map(|b| b / 1000.0);
        match stream["codec_type"].as_str() {
            Some("video") if !probed.has_video && stream["disposition"]["attached_pic"].as_i64() != Some(1) => {
                probed.has_video = true;
                probed.width = stream["width"].as_u64().map(|w| w as u32);
                probed.height = stream["height"].as_u64().map(|h| h as u32);
                probed.video_kbps = kbps;
                probed.fps = stream["avg_frame_rate"].as_str().and_then(parse_rate);
                if probed.duration_secs <= 0.0 {
                    probed.duration_secs = stream["duration"].as_str().and_then(|d| d.parse().ok()).unwrap_or(0.0);
                }
            }
            Some("audio") if !probed.has_audio => {
                probed.has_audio = true;
                probed.audio_kbps = kbps;
            }
            _ => {}
        }
    }
    // Un débit vidéo absent se déduit du total moins l'audio.
    if probed.video_kbps.is_none() {
        probed.video_kbps = total_kbps.map(|t| (t - probed.audio_kbps.unwrap_or(0.0)).max(0.0));
    }
    Some(probed)
}

fn parse_rate(text: &str) -> Option<f64> {
    let (n, d) = text.split_once('/')?;
    let (n, d): (f64, f64) = (n.parse().ok()?, d.parse().ok()?);
    (d > 0.0 && n > 0.0).then_some(n / d)
}

/* ------------------------------------------------- constructeurs d'arguments */

fn s(value: impl Into<String>) -> String {
    value.into()
}

/// Secondes au format que FFmpeg lit sans ambiguïté (point décimal).
pub fn seconds(value: f64) -> String {
    format!("{:.3}", value.max(0.0))
}

/// Découpe `[start, start+duration]`. `reencode` : sans lui, copie des flux
/// (instantané, mais calé sur les images clés).
pub fn trim_args(
    input: &Path,
    output: &Path,
    start: f64,
    duration: f64,
    reencode: Option<(&str, Option<&str>)>,
) -> Vec<String> {
    let mut args = vec![s("-ss"), seconds(start), s("-i"), input.to_string_lossy().to_string(), s("-t"), seconds(duration)];
    match reencode {
        Some((video, audio)) => {
            args.extend([s("-c:v"), s(video)]);
            args.extend([s("-c:a"), s(audio.unwrap_or("aac"))]);
        }
        None => args.extend([s("-c"), s("copy"), s("-avoid_negative_ts"), s("make_zero")]),
    }
    args.push(output.to_string_lossy().to_string());
    args
}

/// Encodage à débit cible, d'après un plan de budget.
pub fn compress_args(
    input: &Path,
    output: &Path,
    plan: &Plan,
    video_encoder: &str,
    audio_encoder: Option<&str>,
    container: Container,
) -> Vec<String> {
    let v = plan.video_kbps;
    let mut args = vec![s("-i"), input.to_string_lossy().to_string(), s("-map"), s("0:v:0"), s("-map"), s("0:a:0?")];
    if let Some(height) = plan.scale_height {
        // `-2` garde la largeur paire ; `min` ne grossit jamais.
        args.extend([s("-vf"), format!("scale=-2:'min({height},ih)'")]);
    }
    args.extend([s("-c:v"), s(video_encoder), s("-b:v"), format!("{v}k")]);
    match video_encoder {
        "libx264" => args.extend([
            s("-maxrate"), format!("{}k", v * 3 / 2), s("-bufsize"), format!("{}k", v * 2),
            s("-preset"), s("medium"), s("-pix_fmt"), s("yuv420p"),
        ]),
        "libopenh264" => args.extend([s("-pix_fmt"), s("yuv420p")]),
        "libvpx-vp9" => args.extend([
            s("-maxrate"), format!("{}k", v * 3 / 2), s("-deadline"), s("good"), s("-cpu-used"), s("2"),
            s("-row-mt"), s("1"), s("-pix_fmt"), s("yuv420p"),
        ]),
        "libsvtav1" => args.extend([s("-preset"), s("8"), s("-pix_fmt"), s("yuv420p")]),
        _ => {}
    }
    match audio_encoder {
        Some(encoder) if plan.audio_kbps > 0 => {
            args.extend([s("-c:a"), s(encoder), s("-b:a"), format!("{}k", plan.audio_kbps), s("-ac"), s("2")]);
        }
        _ => args.push(s("-an")),
    }
    if container == Container::Mp4 {
        args.extend([s("-movflags"), s("+faststart")]);
    }
    args.push(output.to_string_lossy().to_string());
    args
}

/// Réglages d'une animation (GIF ou WebP animé).
#[derive(Debug, Clone, PartialEq)]
pub struct AnimationSettings {
    pub start: f64,
    pub duration: f64,
    pub fps: u32,
    pub width: u32,
    /// Qualité WebP (0-100) ; ignorée pour le GIF.
    pub quality: u32,
    /// Couleurs du GIF (2-256) ; ignorées pour le WebP.
    pub colors: u32,
}

pub fn gif_args(input: &Path, output: &Path, settings: &AnimationSettings) -> Vec<String> {
    let filter = format!(
        "fps={fps},scale='min({width},iw)':-2:flags=lanczos,split[a][b];[a]palettegen=max_colors={colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
        fps = settings.fps,
        width = settings.width,
        colors = settings.colors.clamp(2, 256),
    );
    vec![
        s("-ss"), seconds(settings.start), s("-t"), seconds(settings.duration),
        s("-i"), input.to_string_lossy().to_string(),
        s("-vf"), filter, s("-an"), s("-loop"), s("0"),
        output.to_string_lossy().to_string(),
    ]
}

pub fn webp_args(input: &Path, output: &Path, settings: &AnimationSettings, encoder: &str) -> Vec<String> {
    vec![
        s("-ss"), seconds(settings.start), s("-t"), seconds(settings.duration),
        s("-i"), input.to_string_lossy().to_string(),
        s("-vf"), format!("fps={},scale='min({},iw)':-2:flags=lanczos", settings.fps, settings.width),
        s("-an"), s("-c:v"), s(encoder), s("-lossless"), s("0"),
        s("-q:v"), settings.quality.clamp(1, 100).to_string(),
        s("-compression_level"), s("4"), s("-loop"), s("0"),
        output.to_string_lossy().to_string(),
    ]
}

/// Réglages de l'essai `attempt` (0 = premier) vers une animation plus légère :
/// largeur et cadence diminuent, la qualité aussi.
pub fn lighter(settings: &AnimationSettings, attempt: u32) -> AnimationSettings {
    let steps = [(1.0, 1.0, 1.0), (0.85, 0.85, 0.85), (0.7, 0.7, 0.7), (0.55, 0.6, 0.55), (0.4, 0.5, 0.4)];
    let (width, fps, quality) = steps[(attempt as usize).min(steps.len() - 1)];
    AnimationSettings {
        width: ((f64::from(settings.width) * width).round() as u32).max(64) & !1,
        fps: ((f64::from(settings.fps) * fps).round() as u32).max(4),
        quality: ((f64::from(settings.quality) * quality).round() as u32).max(10),
        colors: ((f64::from(settings.colors) * quality).round() as u32).clamp(16, 256),
        ..settings.clone()
    }
}

/* ------------------------------------------------- taille maximale visée */

use super::budget::{self, Source};

fn fail(message: impl Into<String>) -> InternetError {
    InternetError::new(ErrorKind::Other, message)
}

/// Taille minimale réaliste pour une durée donnée (débits plancher).
pub fn minimum_bytes(duration: f64) -> u64 {
    ((budget::MIN_VIDEO_KBPS + budget::MIN_AUDIO_KBPS) * 1000.0 / 8.0 * duration * 1.07 + 25_000.0) as u64
}

pub fn impossible_target(duration: f64) -> InternetError {
    fail(format!(
        "La taille demandée est trop petite pour cette durée : il faudrait au moins {} Mo environ.",
        (minimum_bytes(duration) as f64 / 1_000_000.0).ceil()
    ))
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SizeReport {
    pub attempts: u32,
    pub bytes: u64,
    pub video_kbps: u32,
    pub audio_kbps: u32,
    pub scale_height: Option<u32>,
    pub warnings: Vec<budget::Warning>,
}

/// Réencode `input` vers `output` sous `max_bytes`, avec jusqu'à
/// `MAX_ATTEMPTS` essais à débit décroissant. Ne produit rien si la cible est
/// irréaliste ou hors d'atteinte.
pub fn compress_video_to_size(
    ffmpeg: &Path,
    ffprobe: &Path,
    input: &Path,
    output: &Path,
    max_bytes: u64,
    container: Container,
    cancelled: &dyn Fn() -> bool,
    progress: &mut dyn FnMut(f64),
) -> Result<SizeReport, InternetError> {
    let probed = probe_streams(ffprobe, input).ok_or_else(|| fail("Média illisible."))?;
    if !probed.has_video {
        return Err(fail("Ce fichier ne contient pas de piste vidéo."));
    }
    let video = pick_video_encoder(ffmpeg, container)
        .ok_or_else(|| InternetError::new(ErrorKind::FfmpegMissing, "Aucun encodeur vidéo utilisable dans ce FFmpeg."))?;
    let audio = pick_audio_encoder(ffmpeg, container);
    let mut plan = budget::plan(
        &Source {
            duration_secs: probed.duration_secs,
            has_audio: probed.has_audio && audio.is_some(),
            video_kbps: probed.video_kbps,
            audio_kbps: probed.audio_kbps,
            width: probed.width,
            height: probed.height,
            fps: probed.fps,
        },
        max_bytes,
    );
    if !plan.feasible {
        return Err(impossible_target(probed.duration_secs));
    }
    let total_ms = (probed.duration_secs * 1000.0) as u64;
    let mut attempt = 0;
    loop {
        let args = compress_args(input, output, &plan, video, audio, container);
        run(ffmpeg, &args, total_ms, cancelled, progress)?;
        attempt += 1;
        let produced = std::fs::metadata(output).map(|m| m.len()).unwrap_or(0);
        match budget::retry(&plan, produced, max_bytes, attempt) {
            Some(next) => plan = next,
            None if produced > max_bytes => {
                let _ = std::fs::remove_file(output);
                return Err(fail("Impossible de passer sous la taille demandée sans dégrader le média au-delà du raisonnable."));
            }
            None => {
                return Ok(SizeReport {
                    attempts: attempt,
                    bytes: produced,
                    video_kbps: plan.video_kbps,
                    audio_kbps: plan.audio_kbps,
                    scale_height: plan.scale_height,
                    warnings: plan.warnings,
                })
            }
        }
    }
}

/// Encodeur FFmpeg d'une extension audio « avec perte » ; `None` pour le sans perte.
pub fn lossy_audio_encoder(extension: &str) -> Option<&'static str> {
    match extension {
        "mp3" => Some("libmp3lame"),
        "m4a" | "aac" => Some("aac"),
        "opus" => Some("libopus"),
        "ogg" => Some("libvorbis"),
        _ => None,
    }
}

/// Réencode un audio vers `output` (même extension) sous `max_bytes`.
pub fn compress_audio_to_size(
    ffmpeg: &Path,
    ffprobe: &Path,
    input: &Path,
    output: &Path,
    max_bytes: u64,
    extension: &str,
    cancelled: &dyn Fn() -> bool,
    progress: &mut dyn FnMut(f64),
) -> Result<SizeReport, InternetError> {
    let encoder = lossy_audio_encoder(extension)
        .ok_or_else(|| fail("Un format sans perte ne peut pas viser une taille maximale : choisissez MP3, M4A, Opus ou Ogg."))?;
    if !list_encoders(ffmpeg).iter().any(|e| e == encoder) {
        return Err(InternetError::new(ErrorKind::FfmpegMissing, format!("Ce FFmpeg ne sait pas encoder ce format (encodeur {encoder} absent).")));
    }
    let duration = duration_secs(ffprobe, input).filter(|d| *d > 0.0).ok_or_else(|| fail("Durée inconnue : impossible de calculer un débit."))?;
    let mut kbps = (budget::stream_budget(max_bytes) * 8.0 / duration / 1000.0).floor();
    if kbps < budget::MIN_AUDIO_KBPS {
        return Err(impossible_target(duration));
    }
    let total_ms = (duration * 1000.0) as u64;
    for attempt in 1..=budget::MAX_ATTEMPTS {
        let args = vec![
            "-i".to_string(), input.to_string_lossy().to_string(), "-vn".into(), "-map".into(), "0:a:0".into(),
            "-c:a".into(), encoder.into(), "-b:a".into(), format!("{}k", kbps.clamp(budget::MIN_AUDIO_KBPS, 320.0) as u32),
            output.to_string_lossy().to_string(),
        ];
        run(ffmpeg, &args, total_ms, cancelled, progress)?;
        let produced = std::fs::metadata(output).map(|m| m.len()).unwrap_or(0);
        if produced <= max_bytes {
            return Ok(SizeReport { attempts: attempt, bytes: produced, video_kbps: 0, audio_kbps: kbps as u32, scale_height: None, warnings: Vec::new() });
        }
        kbps = (kbps * (max_bytes as f64 / produced as f64) * 0.95).floor();
        if kbps < budget::MIN_AUDIO_KBPS {
            break;
        }
    }
    let _ = std::fs::remove_file(output);
    Err(fail("Impossible de passer sous la taille demandée sans dégrader le son au-delà du raisonnable."))
}

/// Une durée, pour les délais.
pub const fn minutes(n: u64) -> Duration {
    Duration::from_secs(n * 60)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::budget::{plan as budget_plan, Source};

    fn plan() -> Plan {
        budget_plan(
            &Source {
                duration_secs: 30.0,
                has_audio: true,
                video_kbps: Some(4000.0),
                audio_kbps: Some(128.0),
                width: Some(1280),
                height: Some(720),
                fps: Some(30.0),
            },
            10_000_000,
        )
    }

    #[test]
    fn builds_structured_compress_arguments() {
        let args = compress_args(Path::new("/tmp/in put.mp4"), Path::new("/tmp/out.mp4"), &plan(), "libx264", Some("aac"), Container::Mp4);
        assert!(args.windows(2).any(|w| w == ["-c:v", "libx264"]));
        assert!(args.iter().any(|a| a.ends_with('k') && a.starts_with(&plan().video_kbps.to_string())));
        // Un chemin avec espace reste UN argument.
        assert!(args.contains(&"/tmp/in put.mp4".to_string()));
        assert!(args.windows(2).any(|w| w == ["-movflags", "+faststart"]));
        assert_eq!(args.last().unwrap(), "/tmp/out.mp4");
        // Un seul flux vidéo et audio retenus : pas de sous-titres ni de pièces jointes.
        assert!(args.windows(2).any(|w| w == ["-map", "0:v:0"]));
    }

    #[test]
    fn scaling_never_enlarges_and_audio_can_be_absent() {
        let mut reduced = plan();
        reduced.scale_height = Some(480);
        let args = compress_args(Path::new("a.mp4"), Path::new("b.webm"), &reduced, "libvpx-vp9", None, Container::Webm);
        let filter = args.iter().position(|a| a == "-vf").map(|i| args[i + 1].clone()).unwrap();
        assert_eq!(filter, "scale=-2:'min(480,ih)'");
        assert!(args.contains(&"-an".to_string()));
        assert!(!args.contains(&"+faststart".to_string()), "faststart est propre au MP4");
    }

    #[test]
    fn unsafe_looking_paths_remain_single_arguments() {
        let hostile = "a; rm -rf ~ $(id) `x` \"q\" 'r' & |.mp4";
        let args = trim_args(Path::new(hostile), Path::new("out.mp4"), 1.5, 2.0, None);
        assert_eq!(args.iter().filter(|a| a.as_str() == hostile).count(), 1);
        assert!(args.windows(2).any(|w| w == ["-c", "copy"]));
        let reencoded = trim_args(Path::new("in.mp4"), Path::new("out.mp4"), 0.0, 3.0, Some(("libx264", Some("aac"))));
        assert!(reencoded.windows(2).any(|w| w == ["-c:v", "libx264"]));
        assert!(!reencoded.contains(&"copy".to_string()));
    }

    #[test]
    fn gif_filter_uses_a_palette_and_never_upscales() {
        let settings = AnimationSettings { start: 2.0, duration: 4.0, fps: 12, width: 480, quality: 70, colors: 256 };
        let args = gif_args(Path::new("in.mp4"), Path::new("out.gif"), &settings);
        let filter = args.iter().position(|a| a == "-vf").map(|i| args[i + 1].clone()).unwrap();
        assert!(filter.contains("palettegen") && filter.contains("paletteuse"));
        assert!(filter.contains("min(480,iw)"));
        assert!(filter.starts_with("fps=12,"));
        assert!(args.windows(2).any(|w| w == ["-loop", "0"]), "boucle infinie");
        assert!(args.contains(&"-an".to_string()));
        let webp = webp_args(Path::new("in.mp4"), Path::new("out.webp"), &settings, "libwebp_anim");
        assert!(webp.windows(2).any(|w| w == ["-c:v", "libwebp_anim"]));
        assert!(webp.windows(2).any(|w| w == ["-loop", "0"]));
    }

    #[test]
    fn lighter_settings_shrink_monotonically_within_sane_bounds() {
        let base = AnimationSettings { start: 0.0, duration: 5.0, fps: 15, width: 640, quality: 80, colors: 256 };
        let mut previous = base.clone();
        for attempt in 1..8 {
            let next = lighter(&base, attempt);
            assert!(next.width <= previous.width && next.fps <= previous.fps && next.quality <= previous.quality, "{attempt}");
            assert!(next.width >= 64 && next.width % 2 == 0 && next.fps >= 4 && next.quality >= 10);
            assert!(next.colors >= 16 && next.colors <= 256);
            previous = next;
        }
        assert_eq!(lighter(&base, 0).width, 640, "le premier essai est tel que demandé");
    }

    #[test]
    fn parses_ffprobe_output() {
        let json = r#"{"streams":[
            {"codec_type":"video","width":1280,"height":720,"avg_frame_rate":"30000/1001","bit_rate":"2500000","duration":"10.0"},
            {"codec_type":"audio","bit_rate":"128000"}],
            "format":{"duration":"10.5","bit_rate":"2700000"}}"#;
        let probed = parse_probe(json).unwrap();
        assert_eq!(probed.duration_secs, 10.5);
        assert_eq!((probed.width, probed.height), (Some(1280), Some(720)));
        assert!((probed.fps.unwrap() - 29.97).abs() < 0.01);
        assert_eq!(probed.video_kbps, Some(2500.0));
        assert_eq!(probed.audio_kbps, Some(128.0));
        assert!(probed.has_video && probed.has_audio);
        // Sans débit par flux, on le déduit du total.
        let derived = parse_probe(r#"{"streams":[{"codec_type":"video","width":10,"height":10},{"codec_type":"audio","bit_rate":"100000"}],"format":{"duration":"4","bit_rate":"1100000"}}"#).unwrap();
        assert_eq!(derived.video_kbps, Some(1000.0));
        assert!(parse_probe("pas du json").is_none());
        // Une pochette d'album n'est pas une vidéo.
        let cover = parse_probe(r#"{"streams":[{"codec_type":"video","width":500,"height":500,"disposition":{"attached_pic":1}},{"codec_type":"audio"}],"format":{"duration":"3"}}"#).unwrap();
        assert!(!cover.has_video && cover.has_audio);
    }
}
