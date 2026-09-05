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

/// Un encodeur vidéo est-il **réellement utilisable ici** ?
///
/// Le nom d'un encodeur dans `ffmpeg -encoders` ne prouve rien : il dit que
/// FFmpeg a été compilé avec, pas que la machine sait s'en servir. Un
/// `h264_nvenc` compilé sur un poste sans carte NVIDIA, sans pilote compatible,
/// ou dans une session où le périphérique n'est pas accessible, est annoncé
/// exactement comme un encodeur fonctionnel — puis échoue à l'ouverture,
/// plusieurs secondes après que l'utilisateur a cliqué.
///
/// On l'essaie donc pour de vrai : une image de 64×64 encodée vers `null`. Si
/// l'encodeur ne sait pas s'ouvrir dans cet environnement, FFmpeg sort en
/// erreur et FourTout ne le proposera pas.
///
/// Le test est borné dans le temps : un pilote en mauvais état peut bloquer
/// indéfiniment, et une détection ne doit jamais figer l'application.
pub fn encoder_works(ffmpeg: &Path, name: &str) -> bool {
    // Un nom d'encodeur ne contient que des caractères de nom : on refuse tout
    // le reste plutôt que de passer une valeur inattendue à FFmpeg.
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return false;
    }

    let spawned = Command::new(ffmpeg)
        .args([
            "-hide_banner", "-nostdin", "-y",
            "-f", "lavfi", "-i", "color=c=black:s=64x64:r=5:d=1",
            "-frames:v", "1", "-pix_fmt", "yuv420p",
            "-c:v", name,
            "-f", "null", "-",
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();

    let mut child = match spawned {
        Ok(child) => child,
        Err(_) => return false,
    };

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(PROBE_TIMEOUT_SECS);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return false;
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            Err(_) => return false,
        }
    }
}

/// Durée maximale d'un test d'encodeur. Généreuse : le premier appel à un
/// encodeur matériel peut initialiser un pilote.
const PROBE_TIMEOUT_SECS: u64 = 12;

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

#[cfg(test)]
mod tests {
    use super::*;

    fn ffmpeg() -> Option<PathBuf> {
        let path = PathBuf::from(exe("ffmpeg"));
        Command::new(&path)
            .arg("-version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .ok()
            .filter(|s| s.success())
            .map(|_| path)
    }

    #[test]
    fn rejects_encoder_names_that_are_not_names() {
        let path = PathBuf::from("ffmpeg");
        assert!(!encoder_works(&path, ""));
        assert!(!encoder_works(&path, "libx264; rm -rf /"));
        assert!(!encoder_works(&path, "../../bin/sh"));
    }

    #[test]
    fn probes_a_real_encoder_and_an_imaginary_one() {
        let Some(ffmpeg) = ffmpeg() else { return };
        // Un nom inexistant ne peut pas « fonctionner ».
        assert!(!encoder_works(&ffmpeg, "encodeur_qui_nexiste_pas"));
        // Au moins un encodeur logiciel doit passer sur une machine de dev.
        let software = ["libx264", "libopenh264", "libvpx-vp9", "mpeg4"];
        assert!(
            software.iter().any(|name| encoder_works(&ffmpeg, name)),
            "aucun encodeur logiciel utilisable : environnement inattendu",
        );
    }
}
