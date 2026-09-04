//! Commandes de synthèse et de transcription.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::media::{temp_dir, temp_path};

use super::{default_threads, espeak_data, model_file, piper, piper_args, wav, whisper, whisper_args};

#[derive(Clone)]
struct Running {
    child: Arc<Mutex<Child>>,
    cancel: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct SpeechState {
    jobs: Mutex<HashMap<String, Running>>,
}

impl SpeechState {
    fn register(&self, job_id: &str, running: Running) {
        self.jobs.lock().unwrap().insert(job_id.to_string(), running);
    }

    fn finish(&self, job_id: &str) {
        self.jobs.lock().unwrap().remove(job_id);
    }
}

/// Arrête un travail de parole en cours (synthèse ou transcription) : le
/// processus moteur est réellement tué.
#[tauri::command]
pub fn speech_cancel(state: tauri::State<'_, SpeechState>, job_id: String) {
    if let Some(job) = state.jobs.lock().unwrap().get(&job_id).cloned() {
        job.cancel.store(true, Ordering::SeqCst);
        if let Ok(mut child) = job.child.lock() {
            let _ = child.kill();
        }
    }
}

fn path_string(path: PathBuf) -> String {
    path.to_string_lossy().to_string()
}

/// Les chemins manipulés vivent tous dans le dossier temporaire de FourTout.
fn guarded(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    let dir = temp_dir().map_err(|e| e.to_string())?;
    if candidate.starts_with(&dir) {
        Ok(candidate)
    } else {
        Err("Chemin hors du dossier temporaire.".into())
    }
}

// --- Synthèse vocale --------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakParams {
    job_id: String,
    /// Identifiant de la voix dans le catalogue (ex. `voice-fr-siwis`).
    voice_id: String,
    text: String,
    /// Durée des phonèmes : > 1 ralentit, < 1 accélère.
    #[serde(default = "one")]
    length_scale: f32,
    /// Silence inséré après chaque phrase, en secondes.
    #[serde(default = "default_silence")]
    sentence_silence: f32,
}

fn one() -> f32 {
    1.0
}

fn default_silence() -> f32 {
    0.2
}

/// Synthétise un segment de texte et renvoie le chemin du WAV produit.
#[tauri::command]
pub async fn tts_speak(
    app: AppHandle,
    state: tauri::State<'_, SpeechState>,
    params: SpeakParams,
) -> Result<String, String> {
    let spoken = params.text.trim();
    if spoken.is_empty() {
        return Err("Le texte à lire est vide.".into());
    }

    let binary = piper(&app)?;
    let voice = model_file(&app, &params.voice_id)?;
    let output = temp_path("wav").map_err(|e| e.to_string())?;
    // Piper traite une ligne comme une phrase à prononcer : on aplatit.
    let line = spoken.split_whitespace().collect::<Vec<_>>().join(" ");
    let length_scale = params.length_scale.clamp(0.3, 3.0);
    let silence = params.sentence_silence.clamp(0.0, 2.0);

    let espeak = espeak_data(&binary);
    let mut command = Command::new(&binary);
    command
        .args(piper_args(&voice, &output, length_scale, silence, espeak.as_deref()))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| format!("Le moteur de synthèse n'a pas pu démarrer : {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(line.as_bytes());
        let _ = stdin.write_all(b"\n");
    }
    let mut stderr = child.stderr.take();

    let cancel = Arc::new(AtomicBool::new(false));
    let running = Running { child: Arc::new(Mutex::new(child)), cancel: cancel.clone() };
    state.register(&params.job_id, running.clone());

    let wait = tauri::async_runtime::spawn_blocking(move || {
        let mut message = String::new();
        if let Some(ref mut err) = stderr {
            let _ = err.read_to_string(&mut message);
        }
        let status = running.child.lock().unwrap().wait();
        (status, message)
    })
    .await;

    state.finish(&params.job_id);

    let (status, message) = wait.map_err(|e| format!("Synthèse interrompue : {e}"))?;
    if cancel.load(Ordering::SeqCst) {
        let _ = std::fs::remove_file(&output);
        return Err("cancelled".into());
    }
    match status {
        Ok(code) if code.success() && output.exists() => Ok(path_string(output)),
        _ => {
            let _ = std::fs::remove_file(&output);
            let tail: Vec<&str> = message.lines().rev().take(3).collect();
            let detail: String = tail.into_iter().rev().collect::<Vec<_>>().join(" ");
            Err(if detail.is_empty() {
                "La synthèse vocale a échoué.".into()
            } else {
                format!("La synthèse vocale a échoué : {detail}")
            })
        }
    }
}

/// Assemble les segments WAV produits en un seul fichier, et renvoie son
/// chemin ainsi que sa durée.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcatResult {
    path: String,
    duration_ms: u64,
    bytes: u64,
}

#[tauri::command]
pub fn tts_concat(paths: Vec<String>) -> Result<ConcatResult, String> {
    if paths.is_empty() {
        return Err("Aucun segment audio à assembler.".into());
    }
    let checked: Vec<PathBuf> = paths.iter().map(|p| guarded(p)).collect::<Result<_, _>>()?;
    let joined = wav::concat(&checked)?;
    let parsed = wav::parse(&joined)?;
    let duration = wav::duration_ms(parsed.format, parsed.data.len());

    let output = temp_path("wav").map_err(|e| e.to_string())?;
    std::fs::write(&output, &joined).map_err(|e| format!("Écriture impossible : {e}"))?;
    Ok(ConcatResult { path: path_string(output), duration_ms: duration, bytes: joined.len() as u64 })
}

// --- Transcription ----------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeParams {
    job_id: String,
    /// Identifiant du modèle dans le catalogue (ex. `stt-base`).
    model_id: String,
    /// WAV 16 kHz mono déjà préparé par le socle média.
    wav_path: String,
    /// `auto`, `fr`, `en`…
    language: String,
    #[serde(default)]
    threads: Option<usize>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeechProgress {
    job_id: String,
    ratio: f64,
}

/// Transcrit un WAV et renvoie le JSON complet produit par whisper.cpp.
#[tauri::command]
pub async fn stt_transcribe(
    app: AppHandle,
    state: tauri::State<'_, SpeechState>,
    params: TranscribeParams,
) -> Result<String, String> {
    let binary = whisper(&app)?;
    let model = model_file(&app, &params.model_id)?;
    let input = guarded(&params.wav_path)?;
    if !input.exists() {
        return Err("Le fichier audio préparé est introuvable.".into());
    }

    // whisper-cli ajoute l'extension : `-of <base>` produit `<base>.json`.
    let base = temp_path("stt").map_err(|e| e.to_string())?;
    let json_path = PathBuf::from(format!("{}.json", base.to_string_lossy()));
    let threads = params.threads.unwrap_or_else(default_threads).clamp(1, 32);
    let language = match params.language.as_str() {
        "" => "auto".to_string(),
        other => other.to_string(),
    };

    let mut child = Command::new(&binary)
        .args(whisper_args(&model, &input, &base, &language, threads))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Le moteur de transcription n'a pas pu démarrer : {e}"))?;

    let stderr = child.stderr.take();
    let stdout = child.stdout.take();
    let cancel = Arc::new(AtomicBool::new(false));
    let running = Running { child: Arc::new(Mutex::new(child)), cancel: cancel.clone() };
    state.register(&params.job_id, running.clone());

    let emitter = app.clone();
    let job_id = params.job_id.clone();
    let wait = tauri::async_runtime::spawn_blocking(move || {
        // whisper.cpp journalise sur stderr : on y lit la progression.
        let mut message = String::new();
        if let Some(err) = stderr {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                if let Some(ratio) = progress_ratio(&line) {
                    let _ = emitter.emit(
                        "speech://progress",
                        SpeechProgress { job_id: job_id.clone(), ratio },
                    );
                } else if message.len() < 4096 {
                    message.push_str(&line);
                    message.push('\n');
                }
            }
        }
        if let Some(mut out) = stdout {
            let mut sink = String::new();
            let _ = out.read_to_string(&mut sink);
        }
        let status = running.child.lock().unwrap().wait();
        (status, message)
    })
    .await;

    state.finish(&params.job_id);

    let (status, message) = wait.map_err(|e| format!("Transcription interrompue : {e}"))?;
    if cancel.load(Ordering::SeqCst) {
        let _ = std::fs::remove_file(&json_path);
        return Err("cancelled".into());
    }

    match status {
        Ok(code) if code.success() => {
            let json = std::fs::read_to_string(&json_path)
                .map_err(|_| "La transcription n'a produit aucun résultat.".to_string())?;
            let _ = std::fs::remove_file(&json_path);
            Ok(json)
        }
        _ => {
            let _ = std::fs::remove_file(&json_path);
            let tail: Vec<&str> = message.lines().rev().take(3).collect();
            let detail: String = tail.into_iter().rev().collect::<Vec<_>>().join(" ");
            Err(if detail.is_empty() {
                "La transcription a échoué.".into()
            } else {
                format!("La transcription a échoué : {detail}")
            })
        }
    }
}

/// Extrait le pourcentage des lignes de progression de whisper.cpp.
fn progress_ratio(line: &str) -> Option<f64> {
    let rest = line.split("progress =").nth(1)?;
    let value = rest.trim().trim_end_matches('%').trim();
    value.parse::<f64>().ok().map(|p| (p / 100.0).clamp(0.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_whisper_progress_lines() {
        assert_eq!(
            progress_ratio("whisper_print_progress_callback: progress =  45%"),
            Some(0.45)
        );
        assert_eq!(
            progress_ratio("whisper_print_progress_callback: progress = 100%"),
            Some(1.0)
        );
        assert_eq!(progress_ratio("whisper_init_from_file_with_params_no_state"), None);
    }

    #[test]
    fn speak_params_parse_camel_case_with_defaults() {
        let json = r#"{"jobId":"j","voiceId":"voice-fr-siwis","text":"Bonjour"}"#;
        let params: SpeakParams = serde_json::from_str(json).unwrap();
        assert_eq!(params.voice_id, "voice-fr-siwis");
        assert_eq!(params.length_scale, 1.0);
        assert_eq!(params.sentence_silence, 0.2);
    }

    #[test]
    fn transcribe_params_accept_optional_threads() {
        let json = r#"{"jobId":"j","modelId":"stt-base","wavPath":"/tmp/x.wav","language":"fr"}"#;
        let params: TranscribeParams = serde_json::from_str(json).unwrap();
        assert_eq!(params.model_id, "stt-base");
        assert!(params.threads.is_none());
    }

    #[test]
    fn guards_paths_to_the_temp_folder() {
        assert!(guarded("/etc/passwd").is_err());
        let inside = temp_path("wav").unwrap();
        assert!(guarded(&inside.to_string_lossy()).is_ok());
    }
}
