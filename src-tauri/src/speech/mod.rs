//! Socle parole : synthèse (Piper) et reconnaissance (whisper.cpp).
//!
//! Mêmes principes que le socle média : aucun shell, arguments strictement
//! séparés, processus enfant suivi et réellement tué à l'annulation, fichiers
//! de travail confinés au dossier temporaire de FourTout. Les moteurs et les
//! modèles sont fournis par `crate::models` — jamais supposés dans le PATH de
//! l'utilisateur final.

pub mod command;
pub mod wav;

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use tauri::AppHandle;

use crate::models::{asset, root};

/// Message d'erreur homogène quand un pré-requis manque.
pub fn missing(label: &str) -> String {
    format!("{label} n'est pas installé. Installez-le depuis l'outil pour continuer.")
}

/// Chemin du binaire Piper, ou une erreur explicite.
pub fn piper(app: &AppHandle) -> Result<PathBuf, String> {
    crate::models::resolve_engine(app, "piper")
        .ok_or_else(|| missing("Le moteur de synthèse vocale (Piper)"))
}

/// Chemin du binaire whisper-cli, ou une erreur explicite.
pub fn whisper(app: &AppHandle) -> Result<PathBuf, String> {
    crate::models::resolve_engine(app, "whisper")
        .ok_or_else(|| missing("Le moteur de transcription (whisper.cpp)"))
}

/// Chemin d'un fichier de modèle décrit par le catalogue (voix ou modèle STT).
/// La première entrée `check` d'un élément est toujours son fichier principal.
pub fn model_file(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let entry = asset(id).ok_or_else(|| format!("Élément inconnu : {id}"))?;
    let path = root(app).join(entry.check[0]);
    if path.exists() {
        Ok(path)
    } else {
        Err(missing(&format!("« {} »", entry.label)))
    }
}

/// Dossier de données espeak-ng livré avec Piper, s'il est présent à côté du
/// binaire (indispensable à la phonémisation hors installation système).
pub fn espeak_data(piper_binary: &std::path::Path) -> Option<PathBuf> {
    let dir = piper_binary.parent()?.join("espeak-ng-data");
    dir.is_dir().then_some(dir)
}

/// Arguments de synthèse Piper. Extraits ici pour être testés — et exécutés —
/// sans dépendre de Tauri : le test d'intégration lance le vrai binaire avec
/// exactement les arguments qu'utilise l'application.
pub fn piper_args(
    voice: &Path,
    output: &Path,
    length_scale: f32,
    sentence_silence: f32,
    espeak: Option<&Path>,
) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec![
        "--model".into(),
        voice.into(),
        "--output_file".into(),
        output.into(),
        "--length_scale".into(),
        format!("{}", length_scale.clamp(0.3, 3.0)).into(),
        "--sentence_silence".into(),
        format!("{}", sentence_silence.clamp(0.0, 2.0)).into(),
        "--quiet".into(),
    ];
    if let Some(data) = espeak {
        args.push("--espeak_data".into());
        args.push(data.into());
    }
    args
}

/// Arguments de transcription whisper.cpp. `base` reçoit l'extension `.json`.
pub fn whisper_args(
    model: &Path,
    input: &Path,
    base: &Path,
    language: &str,
    threads: usize,
) -> Vec<OsString> {
    vec![
        "--model".into(),
        model.into(),
        "--file".into(),
        input.into(),
        "--language".into(),
        (if language.is_empty() { "auto" } else { language }).into(),
        "--threads".into(),
        threads.clamp(1, 32).to_string().into(),
        "--output-json".into(),
        "--output-file".into(),
        base.into(),
        "--print-progress".into(),
    ]
}

/// Nombre de fils de calcul par défaut : rapide sans rendre la machine
/// inutilisable pendant une transcription longue.
pub fn default_threads() -> usize {
    (num_cpus::get() / 2).clamp(1, 8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_threads_stay_reasonable() {
        let threads = default_threads();
        assert!((1..=8).contains(&threads));
    }

    #[test]
    fn piper_args_carry_speed_and_voice() {
        let args = piper_args(
            Path::new("/m/voice.onnx"),
            Path::new("/t/out.wav"),
            0.8,
            0.25,
            Some(Path::new("/m/espeak-ng-data")),
        );
        let flat: Vec<String> = args.iter().map(|a| a.to_string_lossy().to_string()).collect();
        assert!(flat.contains(&"--model".to_string()));
        assert!(flat.contains(&"/m/voice.onnx".to_string()));
        assert!(flat.contains(&"0.8".to_string()));
        assert!(flat.contains(&"--espeak_data".to_string()));
    }

    #[test]
    fn piper_args_clamp_absurd_speeds() {
        let args = piper_args(Path::new("v"), Path::new("o"), 99.0, 9.0, None);
        let flat: Vec<String> = args.iter().map(|a| a.to_string_lossy().to_string()).collect();
        assert!(flat.contains(&"3".to_string()));
        assert!(flat.contains(&"2".to_string()));
        assert!(!flat.contains(&"--espeak_data".to_string()));
    }

    #[test]
    fn whisper_args_default_to_auto_language() {
        let args = whisper_args(Path::new("m"), Path::new("i.wav"), Path::new("b"), "", 4);
        let flat: Vec<String> = args.iter().map(|a| a.to_string_lossy().to_string()).collect();
        let index = flat.iter().position(|a| a == "--language").unwrap();
        assert_eq!(flat[index + 1], "auto");
        assert!(flat.contains(&"--output-json".to_string()));
    }

    #[test]
    fn missing_message_names_the_component() {
        let message = missing("Le moteur de synthèse vocale (Piper)");
        assert!(message.contains("Piper"));
        assert!(message.contains("Installez"));
    }
}
