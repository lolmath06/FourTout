//! Lecture des métadonnées que fournit `yt-dlp -J`.
//!
//! La sortie est du JSON produit par un programme tiers à partir de pages web :
//! tout champ peut manquer, valoir `null`, ou changer de type d'une version à
//! l'autre. Aucun champ n'est donc obligatoire, sauf un identifiant exploitable.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::internet::http::{ErrorKind, InternetError};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FormatInfo {
    pub id: String,
    pub container: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    /// Débit total, vidéo ou audio, en kb/s.
    pub bitrate_kbps: Option<f64>,
    pub filesize: Option<u64>,
    /// Taille estimée plutôt que connue.
    pub filesize_approx: bool,
    pub note: String,
    pub has_video: bool,
    pub has_audio: bool,
    pub protocol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub id: String,
    pub title: String,
    pub uploader: Option<String>,
    pub duration_secs: Option<f64>,
    pub thumbnail_url: Option<String>,
    pub webpage_url: String,
    pub extractor: String,
    pub is_live: bool,
    pub formats: Vec<FormatInfo>,
    /// Hauteurs vidéo distinctes proposées, de la plus grande à la plus petite.
    pub heights: Vec<u32>,
    pub has_audio: bool,
    pub has_video: bool,
}

fn text(value: &Value) -> Option<String> {
    value.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn number(value: &Value) -> Option<f64> {
    value.as_f64().filter(|n| n.is_finite() && *n >= 0.0)
}

fn codec(value: &Value) -> Option<String> {
    // yt-dlp écrit « none » (la chaîne) pour un flux absent.
    text(value).filter(|c| c != "none")
}

fn parse_format(value: &Value) -> Option<FormatInfo> {
    let id = text(&value["format_id"])?;
    let video_codec = codec(&value["vcodec"]);
    let audio_codec = codec(&value["acodec"]);
    let height = value["height"].as_u64().map(|h| h as u32).filter(|&h| h > 0);
    // Un format sans codec déclaré mais avec une hauteur est de la vidéo ;
    // l'inverse (« audio only » dans la note) est de l'audio.
    let note = text(&value["format_note"]).or_else(|| text(&value["format"])).unwrap_or_default();
    let audio_only_note = note.to_lowercase().contains("audio only");
    let has_video = video_codec.is_some() || (height.is_some() && !audio_only_note && value["vcodec"].is_null());
    let has_audio = audio_codec.is_some() || (value["acodec"].is_null() && !has_video);
    let (filesize, approx) = match (value["filesize"].as_u64(), value["filesize_approx"].as_f64()) {
        (Some(exact), _) => (Some(exact), false),
        (None, Some(approx)) => (Some(approx as u64), true),
        _ => (None, false),
    };
    Some(FormatInfo {
        id,
        container: text(&value["ext"]).unwrap_or_default(),
        width: value["width"].as_u64().map(|w| w as u32).filter(|&w| w > 0),
        height,
        fps: number(&value["fps"]).filter(|f| *f > 0.0),
        video_codec,
        audio_codec,
        bitrate_kbps: number(&value["tbr"]).or_else(|| number(&value["vbr"])).or_else(|| number(&value["abr"])),
        filesize,
        filesize_approx: approx,
        note,
        has_video,
        has_audio,
        protocol: text(&value["protocol"]).unwrap_or_default(),
    })
}

/// Lit la sortie JSON de `yt-dlp -J --no-playlist`.
pub fn parse_info(json: &str) -> Result<MediaInfo, InternetError> {
    let value: Value = serde_json::from_str(json.trim())
        .map_err(|_| InternetError::new(ErrorKind::Other, "Réponse de yt-dlp illisible."))?;

    if value["_type"] == "playlist" || value["entries"].is_array() {
        return Err(InternetError::new(
            ErrorKind::Unsupported,
            "Cette adresse désigne une liste de lecture ou une chaîne : indiquez l'adresse d'une seule vidéo.",
        ));
    }
    let id = text(&value["id"]).ok_or_else(|| InternetError::new(ErrorKind::Other, "Aucun média trouvé à cette adresse."))?;

    let mut formats: Vec<FormatInfo> = value["formats"]
        .as_array()
        .map(|list| list.iter().filter_map(parse_format).collect())
        .unwrap_or_default();
    // Les formats « storyboard » (mosaïques de vignettes) ne sont pas des médias.
    formats.retain(|f| !f.note.to_lowercase().contains("storyboard") && f.container != "mhtml");

    // Certains sites ne listent aucun format : l'unique flux est alors à plat dans l'objet.
    if formats.is_empty() {
        if let Some(single) = parse_format(&value) {
            formats.push(single);
        }
    }

    let mut heights: Vec<u32> = formats.iter().filter(|f| f.has_video).filter_map(|f| f.height).collect();
    heights.sort_unstable_by(|a, b| b.cmp(a));
    heights.dedup();

    Ok(MediaInfo {
        id,
        title: text(&value["title"]).unwrap_or_else(|| "media".to_string()),
        uploader: text(&value["uploader"]).or_else(|| text(&value["channel"])),
        duration_secs: number(&value["duration"]).filter(|d| *d > 0.0),
        thumbnail_url: text(&value["thumbnail"]),
        webpage_url: text(&value["webpage_url"]).unwrap_or_default(),
        extractor: text(&value["extractor_key"]).or_else(|| text(&value["extractor"])).unwrap_or_default(),
        is_live: value["is_live"].as_bool().unwrap_or(false) || value["live_status"] == "is_live",
        has_audio: formats.iter().any(|f| f.has_audio),
        has_video: formats.iter().any(|f| f.has_video),
        heights,
        formats,
    })
}

#[cfg(test)]
pub const SAMPLE: &str = r#"{
  "id": "abc123XYZ_-", "title": "Titre; rm -rf ~ $(id) \"guillemets\" / ../../x", "uploader": "Une chaîne",
  "duration": 212.0, "thumbnail": "https://img.example.org/vi/abc/maxres.jpg",
  "webpage_url": "https://www.youtube.com/watch?v=abc123XYZ_-", "extractor_key": "Youtube",
  "is_live": false,
  "formats": [
    {"format_id": "sb0", "ext": "mhtml", "format_note": "storyboard", "vcodec": "none", "acodec": "none", "protocol": "mhtml"},
    {"format_id": "139", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.5", "abr": 48.8, "tbr": 48.8, "filesize": 1300000, "format_note": "low", "protocol": "https"},
    {"format_id": "251", "ext": "webm", "vcodec": "none", "acodec": "opus", "abr": 130.5, "tbr": 130.5, "filesize": 3500000, "format_note": "medium", "protocol": "https"},
    {"format_id": "140", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.2", "abr": 129.5, "tbr": 129.5, "filesize": 3400000, "protocol": "https"},
    {"format_id": "18", "ext": "mp4", "width": 640, "height": 360, "fps": 30, "vcodec": "avc1.42001E", "acodec": "mp4a.40.2", "tbr": 450.0, "filesize_approx": 12000000, "format_note": "360p", "protocol": "https"},
    {"format_id": "134", "ext": "mp4", "width": 640, "height": 360, "fps": 30, "vcodec": "avc1.4d401e", "acodec": "none", "vbr": 300.0, "tbr": 300.0, "filesize": 8000000, "protocol": "https"},
    {"format_id": "136", "ext": "mp4", "width": 1280, "height": 720, "fps": 30, "vcodec": "avc1.4d401f", "acodec": "none", "tbr": 1200.0, "filesize": 30000000, "protocol": "https"},
    {"format_id": "247", "ext": "webm", "width": 1280, "height": 720, "fps": 30, "vcodec": "vp9", "acodec": "none", "tbr": 900.0, "filesize": 22000000, "protocol": "https"},
    {"format_id": "137", "ext": "mp4", "width": 1920, "height": 1080, "fps": 30, "vcodec": "avc1.640028", "acodec": "none", "tbr": 2600.0, "filesize": 64000000, "protocol": "https"},
    {"format_id": "248", "ext": "webm", "width": 1920, "height": 1080, "fps": 30, "vcodec": "vp9", "acodec": "none", "tbr": 1700.0, "filesize": 42000000, "protocol": "https"},
    {"format_id": "313", "ext": "webm", "width": 3840, "height": 2160, "fps": 30, "vcodec": "vp9", "acodec": "none", "tbr": 12000.0, "filesize": 290000000, "protocol": "https"}
  ]
}"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_sample_into_typed_formats() {
        let info = parse_info(SAMPLE).unwrap();
        assert_eq!(info.id, "abc123XYZ_-");
        assert_eq!(info.uploader.as_deref(), Some("Une chaîne"));
        assert_eq!(info.duration_secs, Some(212.0));
        assert_eq!(info.extractor, "Youtube");
        assert!(!info.is_live && info.has_audio && info.has_video);
        // Le storyboard n'est pas un format.
        assert!(info.formats.iter().all(|f| f.id != "sb0"));
        assert_eq!(info.heights, vec![2160, 1080, 720, 360]);

        let progressive = info.formats.iter().find(|f| f.id == "18").unwrap();
        assert!(progressive.has_video && progressive.has_audio);
        assert_eq!(progressive.video_codec.as_deref(), Some("avc1.42001E"));
        assert_eq!((progressive.filesize, progressive.filesize_approx), (Some(12_000_000), true));
        assert_eq!(progressive.fps, Some(30.0));

        let video_only = info.formats.iter().find(|f| f.id == "137").unwrap();
        assert!(video_only.has_video && !video_only.has_audio);
        assert_eq!((video_only.width, video_only.height), (Some(1920), Some(1080)));
        assert_eq!(video_only.bitrate_kbps, Some(2600.0));
        assert!(!video_only.filesize_approx);

        let audio_only = info.formats.iter().find(|f| f.id == "251").unwrap();
        assert!(!audio_only.has_video && audio_only.has_audio);
        assert_eq!(audio_only.audio_codec.as_deref(), Some("opus"));
        assert_eq!(audio_only.container, "webm");
    }

    #[test]
    fn tolerates_missing_nulls_and_odd_types() {
        let info = parse_info(r#"{"id":"x","title":null,"duration":null,"formats":[{"format_id":"a","ext":"mp4","vcodec":null,"acodec":null,"height":null,"tbr":"fast"},{"ext":"mp4"}]}"#).unwrap();
        assert_eq!(info.title, "media");
        assert_eq!(info.duration_secs, None);
        assert_eq!(info.formats.len(), 1, "un format sans identifiant est ignoré");
        assert_eq!(info.formats[0].bitrate_kbps, None);
    }

    #[test]
    fn a_site_without_a_format_list_exposes_its_single_stream() {
        let info = parse_info(r#"{"id":"clip","title":"Clip","ext":"mp4","format_id":"http-720","height":720,"width":1280,"vcodec":"h264","acodec":"aac","duration":10}"#).unwrap();
        assert_eq!(info.formats.len(), 1);
        assert_eq!(info.heights, vec![720]);
    }

    #[test]
    fn refuses_playlists_live_streams_are_flagged_and_garbage_is_an_error() {
        let playlist = parse_info(r#"{"_type":"playlist","id":"PL1","entries":[{"id":"a"}]}"#).unwrap_err();
        assert_eq!(playlist.kind, ErrorKind::Unsupported);
        let live = parse_info(r#"{"id":"l","title":"Direct","live_status":"is_live","formats":[]}"#).unwrap();
        assert!(live.is_live);
        assert!(parse_info("<html>").is_err());
        assert!(parse_info("{}").is_err());
        assert!(parse_info("").is_err());
    }
}
