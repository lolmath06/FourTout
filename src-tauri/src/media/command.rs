//! Commandes Tauri du socle média.
//!
//! Modèle : le frontend **prépare** ses fichiers (`media_stage`), obtient des
//! chemins de sortie temporaires (`media_temp`), **exécute** FFmpeg avec une
//! liste d'arguments (`media_exec`, progression + annulation), **relit** la
//! sortie (`media_read`) puis **nettoie** (`media_cleanup`). Tous les chemins
//! manipulés vivent dans le dossier temporaire de FourTout : `media_exec`
//! refuse tout argument qui serait un chemin absolu hors de ce dossier — un
//! frontend compromis ne peut donc pas faire lire/écrire FFmpeg n'importe où.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::ipc::{Request, Response};
use tauri::{AppHandle, Emitter};

use super::{probe_with, probe_availability, resolve_binary, temp_dir, temp_path};

#[derive(Clone)]
struct Job {
    child: Arc<Mutex<Child>>,
    cancel: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct MediaState {
    jobs: Mutex<HashMap<String, Job>>,
}

/// FFmpeg est-il disponible (embarqué ou système) ?
#[tauri::command]
pub fn media_available(app: AppHandle) -> bool {
    probe_availability(&app)
}

/// Liste les noms d'encodeurs disponibles dans le FFmpeg utilisé (pour choisir
/// un codec réellement présent, ex. libx264 vs libopenh264).
#[tauri::command]
pub fn media_encoders(app: AppHandle) -> Vec<String> {
    let ffmpeg = resolve_binary(&app, "ffmpeg");
    let output = match Command::new(ffmpeg).arg("-hide_banner").arg("-encoders").output() {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .filter_map(|line| {
            let trimmed = line.trim_start();
            // Les lignes d'encodeur commencent par des drapeaux (ex. "V....D ").
            let mut parts = trimmed.split_whitespace();
            let flags = parts.next()?;
            if flags.len() == 6 && flags.chars().all(|c| "AVSFXBDL.".contains(c)) {
                parts.next().map(|name| name.to_string())
            } else {
                None
            }
        })
        .collect()
}

/// Renvoie un chemin temporaire (fichier non créé), pour une sortie FFmpeg.
#[tauri::command]
pub fn media_temp(ext: String) -> Result<String, String> {
    temp_path(&ext).map(path_to_string).map_err(|e| e.to_string())
}

/// Écrit les octets reçus dans un fichier temporaire, renvoie son chemin.
#[tauri::command]
pub fn media_stage(request: Request<'_>) -> Result<String, String> {
    let ext = request
        .headers()
        .get("x-media-ext")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("bin");
    let bytes = raw_body(&request)?;
    let path = temp_path(ext).map_err(|e| e.to_string())?;
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path_to_string(path))
}

/// Inspecte un fichier déjà préparé (chemin temporaire) via ffprobe.
#[tauri::command]
pub fn media_probe(app: AppHandle, path: String) -> Result<String, String> {
    let path = guarded_path(&path)?;
    probe_with(&resolve_binary(&app, "ffprobe"), &path)
}

/// Relit un fichier temporaire produit par FFmpeg.
#[tauri::command]
pub fn media_read(path: String) -> Result<Response, String> {
    let path = guarded_path(&path)?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

/// Supprime des fichiers temporaires (nettoyage explicite).
#[tauri::command]
pub fn media_cleanup(paths: Vec<String>) {
    for path in paths {
        if let Ok(p) = guarded_path(&path) {
            let _ = std::fs::remove_file(p);
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecParams {
    job_id: String,
    /// Arguments FFmpeg complets (dont `-i <path>` et le chemin de sortie).
    args: Vec<String>,
    /// Durée totale attendue en ms (0 = progression indéterminée).
    #[serde(default)]
    total_ms: u64,
}

#[derive(Clone, Serialize)]
struct ProgressEvent {
    job_id: String,
    ratio: f64,
}

/// Exécute FFmpeg avec la liste d'arguments fournie. Progression par événements
/// `media://progress`, annulation par `media_cancel` (le processus est tué).
#[tauri::command]
pub fn media_exec(
    app: AppHandle,
    state: tauri::State<'_, MediaState>,
    params: ExecParams,
) -> Result<(), String> {
    // Garde-fou : aucun argument n'est un chemin absolu hors du dossier temporaire.
    for arg in &params.args {
        if is_outside_temp(arg) {
            return Err("Argument de chemin non autorisé.".into());
        }
    }

    let ffmpeg = resolve_binary(&app, "ffmpeg");
    let mut command = Command::new(ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-nostdin")
        .arg("-y")
        .args(&params.args)
        .arg("-progress")
        .arg("pipe:1")
        .arg("-nostats")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|e| format!("FFmpeg introuvable : {e}"))?;
    let stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let cancel = Arc::new(AtomicBool::new(false));
    let job = Job { child: Arc::new(Mutex::new(child)), cancel: cancel.clone() };
    state.jobs.lock().unwrap().insert(params.job_id.clone(), job.clone());

    if let Some(stdout) = stdout {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            if let Some(value) = line.strip_prefix("out_time_us=") {
                if params.total_ms > 0 {
                    if let Ok(us) = value.trim().parse::<u64>() {
                        let ratio = (us as f64 / 1000.0 / params.total_ms as f64).clamp(0.0, 1.0);
                        let _ = app.emit("media://progress", ProgressEvent { job_id: params.job_id.clone(), ratio });
                    }
                }
            }
        }
    }

    let mut stderr_text = String::new();
    if let Some(ref mut err) = stderr {
        let _ = err.read_to_string(&mut stderr_text);
    }

    let status = job.child.lock().unwrap().wait();
    state.jobs.lock().unwrap().remove(&params.job_id);

    if cancel.load(Ordering::SeqCst) {
        return Err("cancelled".into());
    }
    match status {
        Ok(s) if s.success() => {
            let _ = app.emit("media://progress", ProgressEvent { job_id: params.job_id.clone(), ratio: 1.0 });
            Ok(())
        }
        _ => {
            let tail: Vec<&str> = stderr_text.lines().rev().take(5).collect();
            let message: String = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
            Err(if message.is_empty() { "Le traitement FFmpeg a échoué.".into() } else { message })
        }
    }
}

/// Annule un travail FFmpeg : tue réellement le processus.
#[tauri::command]
pub fn media_cancel(state: tauri::State<'_, MediaState>, job_id: String) {
    if let Some(job) = state.jobs.lock().unwrap().get(&job_id).cloned() {
        job.cancel.store(true, Ordering::SeqCst);
        if let Ok(mut child) = job.child.lock() {
            let _ = child.kill();
        }
    }
}

fn raw_body(request: &Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => Ok(b.clone()),
        tauri::ipc::InvokeBody::Json(_) => Err("Corps binaire attendu.".into()),
    }
}

fn path_to_string(path: PathBuf) -> String {
    path.to_string_lossy().to_string()
}

/// Vérifie qu'un chemin manipulé vit bien dans le dossier temporaire FourTout.
fn guarded_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    let dir = temp_dir().map_err(|e| e.to_string())?;
    if p.starts_with(&dir) {
        Ok(p)
    } else {
        Err("Chemin hors du dossier temporaire.".into())
    }
}

/// Un argument est-il un chemin absolu situé HORS du dossier temporaire ?
/// (Les valeurs de filtres/codecs ne sont pas des chemins absolus.)
fn is_outside_temp(arg: &str) -> bool {
    let looks_absolute = arg.starts_with('/')
        || (arg.len() >= 3 && arg.as_bytes()[1] == b':' && (arg.as_bytes()[2] == b'\\' || arg.as_bytes()[2] == b'/'));
    if !looks_absolute {
        return false;
    }
    match temp_dir() {
        Ok(dir) => !Path::new(arg).starts_with(dir),
        Err(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exec_params_parse_camel_case() {
        let json = r#"{"jobId":"j1","args":["-i","/x","out.wav"],"totalMs":5000}"#;
        let p: ExecParams = serde_json::from_str(json).unwrap();
        assert_eq!(p.job_id, "j1");
        assert_eq!(p.total_ms, 5000);
        assert_eq!(p.args.len(), 3);
    }

    #[test]
    fn rejects_absolute_paths_outside_temp() {
        assert!(is_outside_temp("/etc/passwd"));
        assert!(!is_outside_temp("-c:a"));
        assert!(!is_outside_temp("sine=frequency=440"));
        assert!(!is_outside_temp("00:00:05.000"));
        let inside = temp_path("wav").unwrap();
        assert!(!is_outside_temp(&inside.to_string_lossy()));
    }

    #[test]
    fn guards_paths_to_temp_dir() {
        assert!(guarded_path("/etc/passwd").is_err());
        let inside = temp_path("wav").unwrap();
        assert!(guarded_path(&inside.to_string_lossy()).is_ok());
    }
}
