//! Tests d'intégration du socle média, exécutés contre le FFmpeg réel.
//!
//! Ils sont ignorés automatiquement si FFmpeg n'est pas installé, pour ne pas
//! bloquer un environnement sans média ; sur Fedora/CI avec FFmpeg ils valident
//! réellement l'exécution, l'inspection et la robustesse aux chemins Unicode.

use std::path::{Path, PathBuf};
use std::process::Command;

use fourtout_lib::media::{probe_with, run_ffmpeg};

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
