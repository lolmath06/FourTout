//! Tests d'intégration de la parole, exécutés contre les **vrais** moteurs.
//!
//! Ils sont ignorés automatiquement tant que Piper, whisper.cpp et leurs
//! modèles ne sont pas installés (`FOURTOUT_MODELS_DIR`, sinon le dossier
//! applicatif). Quand ils le sont, ils valident la chaîne complète :
//! texte → synthèse → WAV → concaténation → reconnaissance, avec exactement
//! les arguments qu'utilise l'application.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use fourtout_lib::speech::{piper_args, wav, whisper_args};

fn models_root() -> PathBuf {
    if let Some(dir) = std::env::var_os("FOURTOUT_MODELS_DIR") {
        return PathBuf::from(dir);
    }
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    home.join(".local/share/app.fourtout.desktop/models")
}

fn exe(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_string() }
}

/// Renvoie les chemins nécessaires, ou `None` si l'installation est absente.
fn setup(voice: &str, model: &str) -> Option<(PathBuf, PathBuf, PathBuf, PathBuf)> {
    let root = models_root();
    let piper = root.join("engines/piper").join(exe("piper"));
    let whisper = root.join("engines/whisper").join(exe("whisper-cli"));
    let voice = root.join("voices").join(voice);
    let model = root.join("stt").join(model);
    let all = [&piper, &whisper, &voice, &model];
    if all.iter().all(|p| p.exists()) {
        Some((piper, whisper, voice, model))
    } else {
        None
    }
}

fn which(name: &str) -> Option<PathBuf> {
    let out = Command::new("sh").arg("-c").arg(format!("command -v {name}")).output().ok()?;
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !path.is_empty()).then(|| PathBuf::from(path))
}

/// Synthétise une phrase avec le vrai Piper, exactement comme l'application.
fn speak(piper: &Path, voice: &Path, text: &str, out: &Path) {
    let espeak = piper.parent().map(|d| d.join("espeak-ng-data")).filter(|d| d.is_dir());
    let mut child = Command::new(piper)
        .args(piper_args(voice, out, 1.0, 0.25, espeak.as_deref()))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("Piper doit démarrer");
    child.stdin.take().unwrap().write_all(format!("{text}\n").as_bytes()).unwrap();
    assert!(child.wait().unwrap().success(), "la synthèse doit réussir");
    assert!(out.exists(), "un WAV doit être produit");
}

/// Transcrit un WAV 16 kHz mono avec le vrai whisper.cpp et renvoie le texte.
fn transcribe(whisper: &Path, model: &Path, wav_path: &Path, base: &Path, lang: &str) -> String {
    let status = Command::new(whisper)
        .args(whisper_args(model, wav_path, base, lang, 4))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("whisper-cli doit démarrer");
    assert!(status.success(), "la transcription doit réussir");

    let json_path = PathBuf::from(format!("{}.json", base.to_string_lossy()));
    let json = std::fs::read_to_string(&json_path).expect("whisper doit écrire un JSON");
    let _ = std::fs::remove_file(&json_path);
    json
}

/// Normalise pour comparer : minuscules, sans accents ni ponctuation.
fn normalize(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            c if c.is_alphanumeric() => c,
            _ => ' ',
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn to_16k_mono(ffmpeg: &Path, input: &Path, output: &Path) {
    let status = Command::new(ffmpeg)
        .args(["-hide_banner", "-y", "-i"])
        .arg(input)
        .args(["-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"])
        .arg(output)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .unwrap();
    assert!(status.success());
}

fn workspace(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn french_speech_survives_a_round_trip() {
    let Some((piper, whisper, voice, model)) = setup("fr_FR-siwis-medium.onnx", "ggml-base.bin")
    else {
        eprintln!("moteurs de parole absents : test ignoré");
        return;
    };
    let Some(ffmpeg) = which("ffmpeg") else {
        eprintln!("ffmpeg absent : test ignoré");
        return;
    };
    let dir = workspace("fourtout-speech-fr");

    let spoken = dir.join("speech.wav");
    speak(&piper, &voice, "Bonjour, ceci est un test de FourTout. Le numéro est 2026.", &spoken);

    let prepared = dir.join("speech16.wav");
    to_16k_mono(&ffmpeg, &spoken, &prepared);
    let json = transcribe(&whisper, &model, &prepared, &dir.join("out"), "fr");

    let text = normalize(&json);
    // Reconnaissance approchée : on n'exige jamais l'égalité exacte.
    assert!(text.contains("bonjour"), "« bonjour » attendu dans : {text}");
    assert!(text.contains("test"), "« test » attendu dans : {text}");
    assert!(
        text.replace('-', "").replace(' ', "").contains("fourtout"),
        "« FourTout » attendu dans : {text}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn english_speech_survives_a_round_trip() {
    let Some((piper, whisper, voice, model)) = setup("en_US-lessac-medium.onnx", "ggml-base.bin")
    else {
        eprintln!("moteurs de parole absents : test ignoré");
        return;
    };
    let Some(ffmpeg) = which("ffmpeg") else {
        eprintln!("ffmpeg absent : test ignoré");
        return;
    };
    let dir = workspace("fourtout-speech-en");

    let spoken = dir.join("speech.wav");
    speak(&piper, &voice, "Hello, this is a FourTout voice test. The number is 2026.", &spoken);

    let prepared = dir.join("speech16.wav");
    to_16k_mono(&ffmpeg, &spoken, &prepared);
    let json = transcribe(&whisper, &model, &prepared, &dir.join("out"), "en");

    let text = normalize(&json);
    assert!(text.contains("hello"), "« hello » attendu dans : {text}");
    assert!(text.contains("voice"), "« voice » attendu dans : {text}");
    assert!(text.contains("2026"), "« 2026 » attendu dans : {text}");
    assert!(
        text.replace('-', "").replace(' ', "").contains("fourtout"),
        "« FourTout » attendu dans : {text}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn several_segments_concatenate_into_one_readable_audio() {
    let Some((piper, whisper, voice, model)) = setup("fr_FR-siwis-medium.onnx", "ggml-base.bin")
    else {
        eprintln!("moteurs de parole absents : test ignoré");
        return;
    };
    let Some(ffmpeg) = which("ffmpeg") else {
        eprintln!("ffmpeg absent : test ignoré");
        return;
    };
    let dir = workspace("fourtout-speech-concat");

    // Deux segments distincts, comme le ferait la synthèse d'un long texte.
    let first = dir.join("a.wav");
    let second = dir.join("b.wav");
    speak(&piper, &voice, "Bienvenue dans FourTout.", &first);
    speak(&piper, &voice, "Ce document sert à tester la conversion.", &second);

    let joined_bytes = wav::concat(&[&first, &second]).unwrap();
    let parsed = wav::parse(&joined_bytes).unwrap();
    let a = wav::parse(&std::fs::read(&first).unwrap()).unwrap();
    let b = wav::parse(&std::fs::read(&second).unwrap()).unwrap();
    assert_eq!(parsed.data.len(), a.data.len() + b.data.len());
    assert!(wav::duration_ms(parsed.format, parsed.data.len()) > 1000);

    let joined = dir.join("joined.wav");
    std::fs::write(&joined, &joined_bytes).unwrap();
    let prepared = dir.join("joined16.wav");
    to_16k_mono(&ffmpeg, &joined, &prepared);
    let json = transcribe(&whisper, &model, &prepared, &dir.join("out"), "fr");

    let text = normalize(&json);
    // Les deux segments doivent être audibles dans le fichier assemblé.
    assert!(text.contains("bienvenue"), "premier segment absent : {text}");
    assert!(text.contains("document"), "second segment absent : {text}");

    let _ = std::fs::remove_dir_all(&dir);
}
