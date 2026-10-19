//! Du choix de l'utilisateur à la ligne de commande de yt-dlp.
//!
//! Trois responsabilités, toutes pures et testées sans réseau :
//!
//! * **Choisir les flux** — hauteur plafonnée, jamais d'agrandissement, MP4 ou
//!   WebM de préférence quand le site le permet ;
//! * **Construire les arguments** — un tableau de valeurs, jamais une chaîne :
//!   ni l'adresse, ni le titre, ni un nom de fichier ne peut devenir une option ;
//! * **Comprendre ce que yt-dlp répond** — lignes de progression et erreurs.

use std::path::Path;

use serde::Deserialize;

use super::info::{FormatInfo, MediaInfo};
use crate::internet::http::{ErrorKind, InternetError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VideoContainer {
    /// Le meilleur conteneur que yt-dlp trouve (souvent MKV ou WebM).
    Best,
    Mp4,
    Webm,
    /// Conserver les flux d'origine tels quels.
    Source,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AudioFormat {
    /// Le flux audio d'origine, sans réencodage.
    Source,
    Mp3,
    M4a,
    Opus,
    Ogg,
    Wav,
    Flac,
}

impl AudioFormat {
    /// Nom de l'encodeur FFmpeg dont ce format dépend (`None` = aucun).
    pub fn encoder(self) -> Option<&'static str> {
        match self {
            AudioFormat::Source => None,
            AudioFormat::Mp3 => Some("libmp3lame"),
            AudioFormat::M4a => Some("aac"),
            AudioFormat::Opus => Some("libopus"),
            AudioFormat::Ogg => Some("libvorbis"),
            AudioFormat::Wav => Some("pcm_s16le"),
            AudioFormat::Flac => Some("flac"),
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            AudioFormat::Source => "m4a",
            AudioFormat::Mp3 => "mp3",
            AudioFormat::M4a => "m4a",
            AudioFormat::Opus => "opus",
            AudioFormat::Ogg => "ogg",
            AudioFormat::Wav => "wav",
            AudioFormat::Flac => "flac",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub start: f64,
    pub end: f64,
}

impl Section {
    pub fn duration(&self) -> f64 {
        self.end - self.start
    }

    pub fn validate(&self, total: Option<f64>) -> Result<(), InternetError> {
        let finite = self.start.is_finite() && self.end.is_finite();
        if !finite || self.start < 0.0 || self.end <= self.start {
            return Err(InternetError::new(ErrorKind::Other, "L'extrait demandé est invalide : la fin doit suivre le début."));
        }
        if self.duration() < 0.5 {
            return Err(InternetError::new(ErrorKind::Other, "L'extrait doit durer au moins une demi-seconde."));
        }
        if let Some(total) = total {
            if self.start >= total {
                return Err(InternetError::new(ErrorKind::Other, "Le début de l'extrait dépasse la durée de la vidéo."));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub url: String,
    /// `video` ou `audio`.
    pub mode: Mode,
    pub container: VideoContainer,
    /// Hauteur maximale ; `None` = la meilleure disponible.
    pub max_height: Option<u32>,
    pub audio_format: AudioFormat,
    pub audio_kbps: Option<u32>,
    pub section: Option<Section>,
    /// Couper exactement aux bornes (réencode les bords) plutôt qu'aux images clés.
    #[serde(default)]
    pub exact_cuts: bool,
    pub max_bytes: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    Video,
    Audio,
}

/// Hauteurs que l'interface propose ; tout le reste est refusé.
pub const HEIGHT_CHOICES: [u32; 6] = [2160, 1440, 1080, 720, 480, 360];

/* ------------------------------------------------------- choix des flux */

/// Hauteur réellement obtenue sous le plafond demandé : la plus grande qui ne
/// le dépasse pas, sinon la plus petite proposée. **Jamais au-dessus du plafond
/// quand une hauteur inférieure existe, jamais au-dessus de la source.**
pub fn effective_height(info: &MediaInfo, max_height: Option<u32>) -> Option<u32> {
    let heights = &info.heights; // triées décroissantes
    match max_height {
        None => heights.first().copied(),
        Some(cap) => heights.iter().copied().find(|&h| h <= cap).or_else(|| heights.last().copied()),
    }
}

fn container_matches(format: &FormatInfo, container: VideoContainer) -> bool {
    match container {
        VideoContainer::Mp4 => matches!(format.container.as_str(), "mp4" | "m4a"),
        VideoContainer::Webm => format.container == "webm",
        VideoContainer::Best | VideoContainer::Source => true,
    }
}

fn is_h264(format: &FormatInfo) -> bool {
    format.video_codec.as_deref().is_some_and(|c| c.starts_with("avc1") || c.starts_with("h264"))
}

fn rank(format: &FormatInfo) -> f64 {
    format.bitrate_kbps.unwrap_or(0.0)
}

/// Flux que le sélecteur retiendra : une vidéo (éventuellement complète) et,
/// si elle n'a pas de son, un audio à y ajouter.
pub fn choose_streams<'a>(info: &'a MediaInfo, request: &Request) -> (Option<&'a FormatInfo>, Option<&'a FormatInfo>) {
    let best_audio = |prefer: Option<VideoContainer>| {
        info.formats
            .iter()
            .filter(|f| f.has_audio && !f.has_video)
            .max_by(|a, b| {
                let key = |f: &FormatInfo| (prefer.is_some_and(|c| container_matches(f, c)), rank(f));
                let (ka, kb) = (key(a), key(b));
                ka.0.cmp(&kb.0).then(ka.1.total_cmp(&kb.1))
            })
    };

    if request.mode == Mode::Audio {
        return (None, best_audio(None));
    }

    let wanted = effective_height(info, request.max_height);
    let videos: Vec<&FormatInfo> = info
        .formats
        .iter()
        .filter(|f| f.has_video && wanted.is_none_or(|h| f.height == Some(h)))
        .collect();
    let by_container: Vec<&FormatInfo> = videos.iter().copied().filter(|f| container_matches(f, request.container)).collect();
    let pool = if by_container.is_empty() { &videos } else { &by_container };

    let video = pool.iter().copied().max_by(|a, b| {
        // À hauteur égale : H.264 pour le MP4, puis le plus gros débit.
        let prefer_h264 = request.container == VideoContainer::Mp4;
        let key = |f: &FormatInfo| (prefer_h264 && is_h264(f), rank(f));
        let (ka, kb) = (key(a), key(b));
        ka.0.cmp(&kb.0).then(ka.1.total_cmp(&kb.1))
    });

    match video {
        Some(v) if v.has_audio => (Some(v), None),
        Some(v) => {
            let prefer = match request.container {
                VideoContainer::Mp4 | VideoContainer::Webm => Some(request.container),
                _ => None,
            };
            (Some(v), best_audio(prefer))
        }
        None => (None, best_audio(None)),
    }
}

/// Taille attendue du téléchargement, quand elle est connue ou estimable.
pub fn estimate_bytes(info: &MediaInfo, request: &Request) -> Option<u64> {
    let (video, audio) = choose_streams(info, request);
    let size_of = |f: &FormatInfo| {
        f.filesize.or_else(|| {
            let seconds = info.duration_secs?;
            f.bitrate_kbps.map(|kbps| (kbps * 1000.0 / 8.0 * seconds) as u64)
        })
    };
    let mut total = 0_u64;
    let mut any = false;
    for format in [video, audio].into_iter().flatten() {
        total += size_of(format)?;
        any = true;
    }
    let total = any.then_some(total)?;
    // Un extrait ne télécharge que sa part de la durée.
    match (request.section, info.duration_secs) {
        (Some(section), Some(duration)) if duration > 0.0 => {
            Some((total as f64 * (section.duration() / duration).clamp(0.0, 1.0)) as u64)
        }
        _ => Some(total),
    }
}

/* ----------------------------------------------------------- arguments */

fn height_clause(max_height: Option<u32>) -> String {
    max_height.map(|h| format!("[height<={h}]")).unwrap_or_default()
}

/// Sélecteur de format (`-f`), tri (`-S`) et conteneur de fusion.
pub struct Selection {
    pub format: String,
    pub sort: Option<&'static str>,
    pub merge: Option<&'static str>,
}

pub fn selection(request: &Request) -> Selection {
    let h = height_clause(request.max_height);
    match request.mode {
        Mode::Audio => Selection { format: "ba/b".into(), sort: None, merge: None },
        Mode::Video => match request.container {
            VideoContainer::Mp4 => Selection {
                format: format!("bv*[ext=mp4]{h}+ba[ext=m4a]/b[ext=mp4]{h}/bv*{h}+ba/b{h}/wv*+ba/w"),
                sort: Some("res,vcodec:h264,acodec:m4a"),
                merge: Some("mp4"),
            },
            VideoContainer::Webm => Selection {
                format: format!("bv*[ext=webm]{h}+ba[ext=webm]/b[ext=webm]{h}/bv*{h}+ba/b{h}/wv*+ba/w"),
                sort: Some("res"),
                merge: Some("webm/mkv"),
            },
            VideoContainer::Best | VideoContainer::Source => Selection {
                format: format!("bv*{h}+ba/b{h}/wv*+ba/w"),
                sort: Some("res"),
                merge: None,
            },
        },
    }
}

fn number(value: f64) -> String {
    format!("{:.3}", value.max(0.0))
}

/// Tous les arguments de yt-dlp pour un téléchargement.
///
/// `output_dir` est un dossier privé créé par FourTout : le fichier y reçoit un
/// nom fixe (`ft`), de sorte que **le titre du média n'entre jamais dans un
/// chemin** — il est assaini à part, au moment de livrer le fichier.
pub fn download_args(request: &Request, ffmpeg: &Path, output_dir: &Path, cache_dir: &Path, with_section: bool) -> Vec<String> {
    let mut args: Vec<String> = [
        // Jamais de configuration utilisateur : elle pourrait injecter des
        // cookies de navigateur, un proxy, un `--exec`.
        "--ignore-config",
        "--no-playlist",
        "--newline",
        "--color",
        "never",
        "--no-mtime",
        "--socket-timeout",
        "30",
        "--retries",
        "3",
        "--fragment-retries",
        "3",
        "--concurrent-fragments",
        "4",
        "--progress",
        "--progress-template",
        "download:FTPROG %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    args.extend(["--ffmpeg-location".into(), ffmpeg.to_string_lossy().to_string()]);
    args.extend(["--cache-dir".into(), cache_dir.to_string_lossy().to_string()]);
    args.extend(["-o".into(), output_dir.join("ft.%(ext)s").to_string_lossy().to_string()]);

    let selected = selection(request);
    args.extend(["-f".into(), selected.format]);
    if let Some(sort) = selected.sort {
        args.extend(["-S".into(), sort.into()]);
    }
    if let Some(merge) = selected.merge {
        args.extend(["--merge-output-format".into(), merge.into()]);
    }

    if request.mode == Mode::Audio {
        args.push("-x".into());
        let format = match request.audio_format {
            AudioFormat::Source => "best",
            AudioFormat::Mp3 => "mp3",
            AudioFormat::M4a => "m4a",
            AudioFormat::Opus => "opus",
            AudioFormat::Ogg => "vorbis",
            AudioFormat::Wav => "wav",
            AudioFormat::Flac => "flac",
        };
        args.extend(["--audio-format".into(), format.into()]);
        let lossy = matches!(request.audio_format, AudioFormat::Mp3 | AudioFormat::M4a | AudioFormat::Opus | AudioFormat::Ogg);
        if lossy {
            let quality = match request.audio_kbps {
                Some(kbps) => format!("{}K", kbps.clamp(32, 320)),
                // Meilleure qualité VBR de LAME ; les autres encodeurs prennent leur défaut.
                None if request.audio_format == AudioFormat::Mp3 => "0".into(),
                None => "192K".into(),
            };
            args.extend(["--audio-quality".into(), quality]);
        }
    }

    if let (Some(section), true) = (request.section, with_section) {
        args.extend(["--download-sections".into(), format!("*{}-{}", number(section.start), number(section.end))]);
        if request.exact_cuts {
            args.push("--force-keyframes-at-cuts".into());
        }
    }

    // `--` : plus aucune option après ce point, quoi que contienne l'adresse.
    args.push("--".into());
    args.push(request.url.trim().to_string());
    args
}

/// Arguments de `yt-dlp -J` (métadonnées seules).
pub fn info_args(url: &str, cache_dir: &Path) -> Vec<String> {
    let mut args: Vec<String> =
        ["--ignore-config", "--no-playlist", "--no-warnings", "-J", "--socket-timeout", "30", "--color", "never"]
            .iter()
            .map(|s| s.to_string())
            .collect();
    args.extend(["--cache-dir".into(), cache_dir.to_string_lossy().to_string()]);
    args.push("--".into());
    args.push(url.trim().to_string());
    args
}

/* ---------------------------------------------------- sorties de yt-dlp */

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Progress {
    pub downloaded: u64,
    pub total: Option<u64>,
    pub speed: Option<f64>,
    pub eta: Option<f64>,
}

/// Lit une ligne de progression `FTPROG <reçu> <total> <estimé> <débit> <reste>`.
pub fn parse_progress(line: &str) -> Option<Progress> {
    let rest = line.trim().strip_prefix("FTPROG ")?;
    let fields: Vec<&str> = rest.split_whitespace().collect();
    if fields.len() < 5 {
        return None;
    }
    let value = |i: usize| fields[i].parse::<f64>().ok().filter(|n| n.is_finite() && *n >= 0.0);
    Some(Progress {
        downloaded: value(0)? as u64,
        total: value(1).or_else(|| value(2)).filter(|t| *t > 0.0).map(|t| t as u64),
        speed: value(3),
        eta: value(4),
    })
}

/// « [info] id: Downloading 1 format(s): 137+140 » → 2 flux.
pub fn parse_stream_count(line: &str) -> Option<usize> {
    let rest = line.split("format(s):").nth(1)?;
    let ids = rest.trim().split_whitespace().next()?;
    Some(ids.split('+').count())
}

/// Étape annoncée par une ligne `[Merger]`, `[ExtractAudio]`…
pub fn parse_stage(line: &str) -> Option<&'static str> {
    let line = line.trim();
    if line.starts_with("[Merger]") || line.starts_with("[VideoRemuxer]") || line.starts_with("[Fixup") {
        Some("merge")
    } else if line.starts_with("[ExtractAudio]") {
        Some("audio")
    } else if line.starts_with("[download] Destination") || line.starts_with("[download] Downloading") {
        Some("download")
    } else {
        None
    }
}

/// Traduit les dernières lignes d'erreur de yt-dlp en erreur structurée.
pub fn classify_error(lines: &[String]) -> InternetError {
    let errors: Vec<&String> = lines.iter().filter(|l| l.contains("ERROR")).collect();
    let text = errors.last().map(|s| s.as_str()).unwrap_or_else(|| lines.last().map(|s| s.as_str()).unwrap_or(""));
    let lower = text.to_lowercase();
    let detail = text.trim_start_matches("ERROR:").trim().to_string();
    let has = |needles: &[&str]| needles.iter().any(|n| lower.contains(n));

    let (kind, message) = if has(&["drm"]) {
        (ErrorKind::Drm, "Ce contenu est protégé par un DRM : FourTout ne contourne pas les protections.".to_string())
    } else if has(&["private video", "this video is private"]) {
        (ErrorKind::LoginRequired, "Cette vidéo est privée : FourTout ne gère pas les comptes.".to_string())
    } else if has(&["members-only", "members only", "join this channel", "premium", "subscribers-only"]) {
        (ErrorKind::LoginRequired, "Ce contenu est réservé à des abonnés : FourTout ne gère pas les comptes.".to_string())
    } else if has(&["sign in", "log in", "login required", "age-restricted", "confirm your age", "not a bot", "cookies"]) {
        (
            ErrorKind::LoginRequired,
            "Le service demande une connexion pour ce contenu : FourTout ne gère ni les comptes ni les cookies.".to_string(),
        )
    } else if has(&["not available in your country", "geo", "blocked it in your country"]) {
        (ErrorKind::Unavailable, "Ce contenu n'est pas disponible dans votre pays.".to_string())
    } else if has(&["video unavailable", "has been removed", "no longer available", "does not exist", "is unavailable", "been terminated"]) {
        (ErrorKind::Unavailable, "Ce contenu n'est plus disponible.".to_string())
    } else if has(&["unsupported url", "no suitable extractor"]) {
        (ErrorKind::Unsupported, "Ce site ou ce type d'adresse n'est pas pris en charge par yt-dlp.".to_string())
    } else if has(&["requested format is not available", "no video formats found"]) {
        (ErrorKind::Unavailable, "Aucun format correspondant à ce choix n'est proposé pour ce média.".to_string())
    } else if has(&["http error 429", "too many requests"]) {
        (ErrorKind::Status, "Trop de requêtes : le service demande de patienter. Réessayez plus tard.".to_string())
    } else if has(&["http error 403"]) {
        (ErrorKind::Status, "Accès refusé par le service (HTTP 403).".to_string())
    } else if has(&["http error 404"]) {
        (ErrorKind::Unavailable, "Média introuvable (HTTP 404).".to_string())
    } else if has(&["ffmpeg", "ffprobe"]) && has(&["not found", "not installed", "no such file"]) {
        (ErrorKind::FfmpegMissing, "FFmpeg est introuvable : il est nécessaire pour assembler ou convertir ce média.".to_string())
    } else if has(&["unable to download", "getaddrinfo", "name resolution", "network is unreachable", "timed out", "connection"]) {
        (ErrorKind::Other, "Connexion impossible au service : vérifiez votre accès Internet.".to_string())
    } else {
        (ErrorKind::Other, "yt-dlp n'a pas pu télécharger ce média.".to_string())
    };

    let message = if kind == ErrorKind::Other && !detail.is_empty() {
        format!("{message} Détail : {detail}")
    } else {
        message
    };
    InternetError::new(kind, message)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::super::info::{parse_info, SAMPLE};
    use super::*;

    fn request(mode: Mode) -> Request {
        Request {
            url: "https://www.youtube.com/watch?v=abc123XYZ_-".into(),
            mode,
            container: VideoContainer::Mp4,
            max_height: None,
            audio_format: AudioFormat::Mp3,
            audio_kbps: None,
            section: None,
            exact_cuts: false,
            max_bytes: None,
        }
    }

    fn info() -> MediaInfo {
        parse_info(SAMPLE).unwrap()
    }

    #[test]
    fn resolution_is_capped_and_never_upscaled() {
        let info = info(); // 360, 720, 1080, 2160
        assert_eq!(effective_height(&info, None), Some(2160));
        assert_eq!(effective_height(&info, Some(1440)), Some(1080), "pas de 1440 : on reste en dessous");
        assert_eq!(effective_height(&info, Some(1080)), Some(1080));
        assert_eq!(effective_height(&info, Some(480)), Some(360), "pas de 480 : 360, jamais 720");
        assert_eq!(effective_height(&info, Some(144)), Some(360), "rien d'inférieur : le plus petit existant");

        // Une source plus petite que le plafond n'est pas agrandie.
        let small = parse_info(r#"{"id":"s","formats":[{"format_id":"a","ext":"mp4","height":480,"vcodec":"avc1","acodec":"aac"}]}"#).unwrap();
        assert_eq!(effective_height(&small, Some(2160)), Some(480));
        assert_eq!(effective_height(&small, None), Some(480));
    }

    #[test]
    fn picks_h264_video_and_m4a_audio_for_mp4() {
        let info = info();
        let mut r = request(Mode::Video);
        r.max_height = Some(1080);
        let (video, audio) = choose_streams(&info, &r);
        assert_eq!(video.unwrap().id, "137", "H.264 1080p, pas le VP9 au meilleur débit");
        assert_eq!(audio.unwrap().id, "140", "audio M4A, compatible avec le conteneur MP4");
    }

    #[test]
    fn picks_webm_streams_for_webm_and_the_best_for_best() {
        let info = info();
        let mut r = request(Mode::Video);
        r.container = VideoContainer::Webm;
        r.max_height = Some(720);
        let (video, audio) = choose_streams(&info, &r);
        assert_eq!(video.unwrap().id, "247");
        assert_eq!(audio.unwrap().id, "251");

        r.container = VideoContainer::Best;
        r.max_height = None;
        let (video, _) = choose_streams(&info, &r);
        assert_eq!(video.unwrap().id, "313", "meilleure définition disponible");
    }

    #[test]
    fn a_progressive_format_needs_no_separate_audio() {
        let info = parse_info(r#"{"id":"p","formats":[{"format_id":"18","ext":"mp4","height":360,"vcodec":"avc1","acodec":"mp4a"},{"format_id":"140","ext":"m4a","vcodec":"none","acodec":"mp4a","abr":128}]}"#).unwrap();
        let (video, audio) = choose_streams(&info, &request(Mode::Video));
        assert_eq!(video.unwrap().id, "18");
        assert!(audio.is_none());
    }

    #[test]
    fn audio_mode_picks_the_best_audio_only_stream() {
        let info = info();
        let (video, audio) = choose_streams(&info, &request(Mode::Audio));
        assert!(video.is_none());
        assert_eq!(audio.unwrap().id, "251", "Opus 130 kb/s devant AAC 129 kb/s");
    }

    #[test]
    fn estimates_sizes_from_known_streams_and_scales_for_a_section() {
        let info = info();
        let mut r = request(Mode::Video);
        r.max_height = Some(1080);
        // 137 (64 Mo) + 140 (3,4 Mo).
        assert_eq!(estimate_bytes(&info, &r), Some(64_000_000 + 3_400_000));
        r.section = Some(Section { start: 10.0, end: 31.2 }); // 21,2 s sur 212 s = 10 %
        let part = estimate_bytes(&info, &r).unwrap();
        assert!((6_700_000..6_800_000).contains(&part), "{part}");
        r.mode = Mode::Audio;
        r.section = None;
        assert_eq!(estimate_bytes(&info, &r), Some(3_500_000));
        // Sans taille ni débit : pas d'estimation inventée.
        let unknown = parse_info(r#"{"id":"u","formats":[{"format_id":"a","ext":"mp4","height":720,"vcodec":"h264","acodec":"aac"}]}"#).unwrap();
        assert_eq!(estimate_bytes(&unknown, &request(Mode::Video)), None);
    }

    #[test]
    fn selector_strings_follow_the_user_choice() {
        let mut r = request(Mode::Video);
        r.max_height = Some(720);
        let mp4 = selection(&r);
        assert!(mp4.format.starts_with("bv*[ext=mp4][height<=720]+ba[ext=m4a]/"));
        assert_eq!(mp4.merge, Some("mp4"));
        assert!(mp4.sort.unwrap().contains("vcodec:h264"));
        // Un repli final existe toujours : le choix ne doit jamais tout refuser.
        assert!(mp4.format.ends_with("/wv*+ba/w"));

        r.container = VideoContainer::Webm;
        assert_eq!(selection(&r).merge, Some("webm/mkv"), "repli MKV si rien n'est WebM");
        r.container = VideoContainer::Source;
        assert_eq!(selection(&r).merge, None);
        r.max_height = None;
        assert!(selection(&r).format.starts_with("bv*+ba/b/"));
        assert_eq!(selection(&request(Mode::Audio)).format, "ba/b");
    }

    fn args(r: &Request, with_section: bool) -> Vec<String> {
        download_args(r, &PathBuf::from("/opt/ff mpeg/ffmpeg"), &PathBuf::from("/tmp/dl"), &PathBuf::from("/tmp/cache"), with_section)
    }

    #[test]
    fn arguments_are_structured_and_the_url_comes_after_a_terminator() {
        // Une adresse qui ressemble à une injection d'option reste une valeur.
        let mut r = request(Mode::Video);
        r.url = "https://x.org/watch?v=1 --exec rm".into();
        let a = args(&r, false);
        let dashdash = a.iter().position(|x| x == "--").unwrap();
        assert_eq!(dashdash, a.len() - 2);
        assert_eq!(a.last().unwrap(), "https://x.org/watch?v=1 --exec rm");
        assert!(!a[..dashdash].iter().any(|x| x.contains("--exec")));
        assert!(a.contains(&"--ignore-config".to_string()), "aucune configuration utilisateur");
        assert!(a.windows(2).any(|w| w == ["--ffmpeg-location", "/opt/ff mpeg/ffmpeg"]), "chemin à espace : un seul argument");
        assert!(a.windows(2).any(|w| w[0] == "-o" && w[1].ends_with("ft.%(ext)s")), "le titre n'entre jamais dans le chemin");
        for forbidden in ["--cookies", "--cookies-from-browser", "--username", "--password", "--exec", "--no-check-certificates"] {
            assert!(!a.iter().any(|x| x.starts_with(forbidden)), "{forbidden} ne doit jamais apparaître");
        }
    }

    #[test]
    fn audio_arguments_map_to_real_conversions() {
        let mut r = request(Mode::Audio);
        let a = args(&r, false);
        assert!(a.contains(&"-x".to_string()));
        assert!(a.windows(2).any(|w| w == ["--audio-format", "mp3"]));
        assert!(a.windows(2).any(|w| w == ["--audio-quality", "0"]), "MP3 sans débit : meilleure qualité VBR");

        r.audio_kbps = Some(192);
        assert!(args(&r, false).windows(2).any(|w| w == ["--audio-quality", "192K"]));
        r.audio_format = AudioFormat::Flac;
        let flac = args(&r, false);
        assert!(flac.windows(2).any(|w| w == ["--audio-format", "flac"]));
        assert!(!flac.contains(&"--audio-quality".to_string()), "sans perte : aucune qualité à régler");
        r.audio_format = AudioFormat::Ogg;
        assert!(args(&r, false).windows(2).any(|w| w == ["--audio-format", "vorbis"]));
        r.audio_format = AudioFormat::Source;
        assert!(args(&r, false).windows(2).any(|w| w == ["--audio-format", "best"]));
        // Un débit extravagant est borné.
        r.audio_format = AudioFormat::Mp3;
        r.audio_kbps = Some(9999);
        assert!(args(&r, false).windows(2).any(|w| w == ["--audio-quality", "320K"]));
    }

    #[test]
    fn sections_use_yt_dlp_syntax_and_exact_cuts_are_opt_in() {
        let mut r = request(Mode::Video);
        r.section = Some(Section { start: 12.5, end: 47.0 });
        let fast = args(&r, true);
        assert!(fast.windows(2).any(|w| w == ["--download-sections", "*12.500-47.000"]));
        assert!(!fast.contains(&"--force-keyframes-at-cuts".to_string()));
        r.exact_cuts = true;
        assert!(args(&r, true).contains(&"--force-keyframes-at-cuts".to_string()));
        // Repli : sans section côté yt-dlp, la découpe est locale.
        assert!(!args(&r, false).contains(&"--download-sections".to_string()));
    }

    #[test]
    fn validates_sections() {
        assert!(Section { start: 0.0, end: 10.0 }.validate(Some(60.0)).is_ok());
        for (bad, total) in [
            (Section { start: 10.0, end: 10.0 }, None),
            (Section { start: 10.0, end: 5.0 }, None),
            (Section { start: -1.0, end: 5.0 }, None),
            (Section { start: 0.0, end: 0.2 }, None),
            (Section { start: f64::NAN, end: 5.0 }, None),
            (Section { start: 100.0, end: 130.0 }, Some(60.0)),
        ] {
            assert!(bad.validate(total).is_err(), "{bad:?}");
        }
        // Une fin au-delà de la durée est tolérée : yt-dlp s'arrête au bout.
        assert!(Section { start: 50.0, end: 90.0 }.validate(Some(60.0)).is_ok());
    }

    #[test]
    fn info_arguments_never_download() {
        let a = info_args("https://x.org/v", &PathBuf::from("/tmp/c"));
        assert!(a.contains(&"-J".to_string()) && a.contains(&"--no-playlist".to_string()));
        assert!(a.contains(&"--ignore-config".to_string()));
        assert_eq!(a[a.len() - 2], "--");
    }

    #[test]
    fn parses_progress_lines_defensively() {
        let line = "FTPROG 1048576 10485760 NA 524288.5 18";
        let p = parse_progress(line).unwrap();
        assert_eq!(p.downloaded, 1_048_576);
        assert_eq!(p.total, Some(10_485_760));
        assert_eq!(p.speed, Some(524_288.5));
        assert_eq!(p.eta, Some(18.0));
        // Total inconnu mais estimé.
        assert_eq!(parse_progress("FTPROG 100 NA 5000 NA NA").unwrap().total, Some(5000));
        assert_eq!(parse_progress("FTPROG 100 NA NA NA NA").unwrap().total, None);
        assert_eq!(parse_progress("FTPROG 100 0 NA 1 1").unwrap().total, None, "total 0 = inconnu");
        for junk in ["", "FTPROG", "FTPROG 1 2", "[download]  50%", "FTPROG abc 1 2 3 4", "FTPROG -5 1 2 3 4"] {
            assert!(parse_progress(junk).is_none(), "{junk:?}");
        }
        assert_eq!(parse_stream_count("[info] abc: Downloading 1 format(s): 137+140"), Some(2));
        assert_eq!(parse_stream_count("[info] abc: Downloading 1 format(s): 18"), Some(1));
        assert_eq!(parse_stream_count("autre chose"), None);
        assert_eq!(parse_stage("[Merger] Merging formats into \"x\""), Some("merge"));
        assert_eq!(parse_stage("[ExtractAudio] Destination: x.mp3"), Some("audio"));
    }

    #[test]
    fn classifies_errors_without_ever_suggesting_a_bypass() {
        let cases = [
            ("ERROR: [youtube] abc: Video unavailable", ErrorKind::Unavailable),
            ("ERROR: [youtube] abc: Private video. Sign in if you've been granted access", ErrorKind::LoginRequired),
            ("ERROR: [youtube] abc: Sign in to confirm your age", ErrorKind::LoginRequired),
            ("ERROR: [youtube] abc: Sign in to confirm you’re not a bot", ErrorKind::LoginRequired),
            ("ERROR: [youtube] abc: This video is DRM protected", ErrorKind::Drm),
            ("ERROR: [youtube] abc: Join this channel to get access to members-only content", ErrorKind::LoginRequired),
            ("ERROR: Unsupported URL: https://x.org/", ErrorKind::Unsupported),
            ("ERROR: [x] 1: Requested format is not available", ErrorKind::Unavailable),
            ("ERROR: unable to download video data: HTTP Error 403: Forbidden", ErrorKind::Status),
            ("ERROR: ffmpeg not found. Please install or provide the path using --ffmpeg-location", ErrorKind::FfmpegMissing),
            ("ERROR: [generic] Unable to download webpage: <urlopen error [Errno -3] Temporary failure in name resolution>", ErrorKind::Other),
            ("ERROR: something strange", ErrorKind::Other),
        ];
        for (line, kind) in cases {
            let error = classify_error(&[line.to_string()]);
            assert_eq!(error.kind, kind, "{line} → {error}");
        }
        // Aucune des réponses ne propose de contourner la restriction.
        for line in ["Sign in to confirm your age", "DRM protected", "Private video"] {
            let message = classify_error(&[format!("ERROR: {line}")]).message.to_lowercase();
            assert!(!message.contains("cookies-from") && !message.contains("--cookies"), "{message}");
        }
        // Le détail technique n'est ajouté que pour une erreur inconnue.
        assert!(classify_error(&["ERROR: boom 42".to_string()]).message.contains("boom 42"));
        assert_eq!(classify_error(&[]).kind, ErrorKind::Other);
    }

    #[test]
    fn a_hostile_title_never_reaches_the_command_line() {
        let info = info();
        assert!(info.title.contains("rm -rf"));
        let a = args(&request(Mode::Video), false);
        assert!(!a.iter().any(|x| x.contains("rm -rf") || x.contains(&info.title)));
    }
}
