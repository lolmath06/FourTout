//! Tests d'intégration du socle média, exécutés contre le FFmpeg réel.
//!
//! Ils sont ignorés automatiquement si FFmpeg n'est pas installé, pour ne pas
//! bloquer un environnement sans média ; sur Fedora/CI avec FFmpeg ils valident
//! réellement l'exécution, l'inspection et la robustesse aux chemins Unicode.

use std::path::{Path, PathBuf};
use std::process::Command;

use fourtout_lib::media::{encoder_works, probe_with, run_ffmpeg};

fn which(name: &str) -> Option<PathBuf> {
    let out = Command::new("sh").arg("-c").arg(format!("command -v {name}")).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if path.is_empty() { None } else { Some(PathBuf::from(path)) }
}

/// Génère une tonalité WAV de `secs` secondes via ffmpeg (source lavfi).
fn make_tone(ffmpeg: &Path, out: &Path, secs: u32) {
    let status = Command::new(ffmpeg)
        .args(["-hide_banner", "-y", "-f", "lavfi", "-i"])
        .arg(format!("sine=frequency=440:duration={secs}"))
        .arg(out)
        .status()
        .unwrap();
    assert!(status.success(), "génération de la tonalité");
}

#[test]
fn converts_and_probes_real_audio() {
    let (Some(ffmpeg), Some(ffprobe)) = (which("ffmpeg"), which("ffprobe")) else {
        eprintln!("ffmpeg/ffprobe absents : test ignoré");
        return;
    };
    let dir = std::env::temp_dir().join("fourtout-media-test");
    std::fs::create_dir_all(&dir).unwrap();

    let wav = dir.join("tone.wav");
    make_tone(&ffmpeg, &wav, 1);

    // WAV -> MP3 avec arguments séparés.
    let mp3 = dir.join("tone.mp3");
    run_ffmpeg(&ffmpeg, &[], &wav, &["-c:a".into(), "libmp3lame".into(), "-b:a".into(), "128k".into()], &mp3).unwrap();
    assert!(mp3.exists() && std::fs::metadata(&mp3).unwrap().len() > 0);

    // ffprobe reconnaît un flux MP3.
    let json = probe_with(&ffprobe, &mp3).unwrap();
    assert!(json.contains("codec_name"));
    assert!(json.to_lowercase().contains("mp3"));

    let _ = std::fs::remove_file(&wav);
    let _ = std::fs::remove_file(&mp3);
}

#[test]
fn handles_paths_with_spaces_and_accents() {
    let Some(ffmpeg) = which("ffmpeg") else {
        eprintln!("ffmpeg absent : test ignoré");
        return;
    };
    let dir = std::env::temp_dir().join("fourtout média test");
    std::fs::create_dir_all(&dir).unwrap();
    let wav = dir.join("tonalité éàç.wav");
    make_tone(&ffmpeg, &wav, 1);
    let out = dir.join("sortie éàç.flac");
    run_ffmpeg(&ffmpeg, &[], &wav, &[], &out).unwrap();
    assert!(out.exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn reports_an_error_on_invalid_input() {
    let Some(ffmpeg) = which("ffmpeg") else { return };
    let dir = std::env::temp_dir().join("fourtout-media-test");
    std::fs::create_dir_all(&dir).unwrap();
    let bad = dir.join("not-audio.wav");
    std::fs::write(&bad, b"this is not audio").unwrap();
    let out = dir.join("out.mp3");
    assert!(run_ffmpeg(&ffmpeg, &[], &bad, &[], &out).is_err());
    let _ = std::fs::remove_file(&bad);
}


/// Encodeurs vidéo que FourTout est susceptible de choisir. La liste doit
/// rester alignée sur `VIDEO_ENCODERS` (`src/core/media/capabilities.ts`).
const VIDEO_CANDIDATES: &[&str] = &[
    "libx264", "libopenh264", "h264_nvenc", "h264_qsv", "h264_vaapi", "h264_v4l2m2m",
    "libx265", "hevc_nvenc", "hevc_qsv", "hevc_vaapi", "hevc_v4l2m2m",
    "libvpx-vp9", "vp9_qsv", "vp9_vaapi",
    "libsvtav1", "libaom-av1", "av1_nvenc", "av1_qsv", "av1_vaapi",
];

/// Noms d'encodeurs annoncés par `ffmpeg -encoders`, même analyse que la
/// commande `media_encoders`.
fn announced(ffmpeg: &Path) -> Vec<String> {
    let output = Command::new(ffmpeg).arg("-hide_banner").arg("-encoders").output().unwrap();
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let flags = parts.next()?;
            if flags.len() == 6 && flags.chars().all(|c| "AVSFXBDL.".contains(c)) {
                parts.next().map(str::to_string)
            } else {
                None
            }
        })
        .collect()
}

/// Le test d'encodeur reflète-t-il la réalité de cette machine ?
///
/// C'est le garde-fou de la régression de la phase 5 : un encodeur annoncé par
/// FFmpeg n'est pas un encodeur utilisable. On vérifie donc que le test dit
/// « non » quand FFmpeg échoue vraiment, et « oui » quand il produit un
/// fichier — sur une vraie vidéo, pas seulement sur l'image 64×64 du test.
#[test]
fn encoder_probe_matches_real_encoding() {
    let Some(ffmpeg) = which("ffmpeg") else {
        eprintln!("ffmpeg absent : test ignoré");
        return;
    };
    let dir = std::env::temp_dir().join("fourtout-encoder-probe");
    std::fs::create_dir_all(&dir).unwrap();

    let listed = announced(&ffmpeg);
    let mut usable = Vec::new();

    for name in VIDEO_CANDIDATES.iter().filter(|n| listed.iter().any(|l| l == *n)) {
        let works = encoder_works(&ffmpeg, name);
        eprintln!("encodeur {name} : annoncé, test réel = {works}");
        if !works {
            continue;
        }
        usable.push(*name);

        // Un encodeur déclaré utilisable doit produire un vrai fichier sur une
        // définition réaliste, pas seulement sur l'image d'essai.
        let out = dir.join(format!("{name}.mkv"));
        let status = Command::new(&ffmpeg)
            .args(["-hide_banner", "-nostdin", "-y", "-f", "lavfi", "-i",
                   "color=c=red:s=640x360:r=25:d=1", "-pix_fmt", "yuv420p", "-c:v", name])
            .arg(&out)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(
            status.success() && std::fs::metadata(&out).map(|m| m.len() > 0).unwrap_or(false),
            "{name} a passé le test mais échoue sur une vidéo 640×360",
        );
        let _ = std::fs::remove_file(&out);
    }

    assert!(
        !usable.is_empty(),
        "aucun encodeur vidéo utilisable : FourTout ne pourrait rien produire ici",
    );
    eprintln!("encodeurs vidéo réellement utilisables : {usable:?}");
}

/// Un nom d'encodeur inexistant ne doit jamais être déclaré utilisable.
#[test]
fn unknown_encoder_never_passes_the_probe() {
    let Some(ffmpeg) = which("ffmpeg") else { return };
    assert!(!encoder_works(&ffmpeg, "libx264_qui_nexiste_pas"));
}
