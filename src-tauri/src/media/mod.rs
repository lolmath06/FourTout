//! Socle média : exécution locale de FFmpeg / ffprobe.
//!
//! Toutes les opérations audio et les petits ponts vidéo de FourTout passent
//! par ici. Principes :
//!
//! * **Aucune exécution shell** : on utilise `std::process::Command` avec des
//!   arguments séparés ; aucun chemin utilisateur n'est concaténé dans une
//!   ligne de commande interprétée.
//! * **Local** : rien ne quitte la machine.
//! * **Binaire résolu proprement** : un binaire embarqué (application
//!   empaquetée) est préféré, avec repli sur le FFmpeg du système en
//!   développement. Le packaging Windows/Fedora est documenté dans
//!   `docs/MEDIA.md`.
//! * **Annulable** : le processus enfant est suivi et réellement tué à
//!   l'annulation ; les fichiers temporaires sont nettoyés dans tous les cas
//!   (succès, erreur, annulation).

pub mod command;

use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::{AppHandle, Manager};

/// Nom du binaire selon la plateforme.
fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Localise un binaire média : d'abord embarqué (ressources de l'app), puis le
/// système. On documente le packaging plutôt que de dépendre silencieusement du
/// PATH du développeur.
pub fn resolve_binary(app: &AppHandle, name: &str) -> PathBuf {
    let file = exe(name);

    if let Ok(dir) = app.path().resource_dir() {
        for candidate in [
            dir.join("resources/ffmpeg").join(&file),
            dir.join("ffmpeg").join(&file),
            dir.join(&file),
        ] {
            if candidate.exists() {
                return candidate;
            }
        }
    }

    // Développement / système : on laisse le PATH résoudre le binaire.
    PathBuf::from(&file)
}

/// FFmpeg / ffprobe sont-ils exécutables dans cet environnement ?
pub fn probe_availability(app: &AppHandle) -> bool {
    let ffmpeg = resolve_binary(app, "ffmpeg");
    Command::new(ffmpeg)
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Répertoire temporaire propre à FourTout, créé au besoin.
pub fn temp_dir() -> std::io::Result<PathBuf> {
    let dir = std::env::temp_dir().join("fourtout-media");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Chemin temporaire à nom aléatoire, robuste aux espaces/accents (le dossier
/// est contrôlé par FourTout ; seul un suffixe d'extension varie).
pub fn temp_path(extension: &str) -> std::io::Result<PathBuf> {
    let dir = temp_dir()?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    let ext = extension.trim_start_matches('.');
    Ok(dir.join(format!("ft-{pid}-{nanos}.{ext}")))
}

/// Exécute ffprobe et renvoie le JSON brut (format + flux).
pub fn probe(app: &AppHandle, input: &Path) -> Result<String, String> {
    probe_with(&resolve_binary(app, "ffprobe"), input)
}

/// Cœur testable de l'inspection : ffprobe donné, sans dépendance à Tauri.
pub fn probe_with(ffprobe: &Path, input: &Path) -> Result<String, String> {
    let output = Command::new(ffprobe)
        .args(["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams"])
        .arg(input)
        .output()
        .map_err(|e| format!("ffprobe introuvable : {e}"))?;

    if !output.status.success() {
        return Err("Fichier média illisible ou format non pris en charge.".into());
    }
    String::from_utf8(output.stdout).map_err(|e| format!("Sortie ffprobe illisible : {e}"))
}

/// Cœur testable d'une exécution FFmpeg simple (sans progression ni
/// annulation) : entrée → sortie, arguments strictement séparés. Renvoie une
/// erreur portant la fin de stderr si FFmpeg échoue.
pub fn run_ffmpeg(
    ffmpeg: &Path,
    pre_input_args: &[String],
    input: &Path,
    args: &[String],
    output: &Path,
) -> Result<(), String> {
    let result = Command::new(ffmpeg)
        .arg("-hide_banner")
        .arg("-nostdin")
        .arg("-y")
        .args(pre_input_args)
        .arg("-i")
        .arg(input)
        .args(args)
        .arg(output)
        .output()
        .map_err(|e| format!("FFmpeg introuvable : {e}"))?;

    if result.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&result.stderr);
    let tail: Vec<&str> = stderr.lines().rev().take(4).collect();
    let message: String = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
    Err(if message.is_empty() {
        "Le traitement FFmpeg a échoué.".into()
    } else {
        message
    })
}
