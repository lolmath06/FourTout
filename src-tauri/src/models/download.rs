//! Téléchargement, vérification et installation des moteurs et modèles.
//!
//! Chaque fichier est écrit dans un `.part` puis vérifié par empreinte SHA-256
//! avant d'être mis en place : une coupure réseau ou une annulation ne laisse
//! jamais un modèle à moitié installé passer pour valide. Les archives sont
//! extraites en contrôlant chaque chemin (aucune sortie du dossier cible).

use std::fs::{self, File};
use std::io::{BufWriter, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use sha2::{Digest, Sha256};

use super::{Archive, Asset, AssetFile};

/// Taille des blocs lus sur le réseau : assez gros pour être efficace, assez
/// petit pour que l'annulation soit ressentie comme immédiate.
const CHUNK: usize = 64 * 1024;

/// Installe un élément. `progress` reçoit (octets reçus, octets attendus) pour
/// l'ensemble de l'élément. Renvoie `Err("cancelled")` si l'utilisateur annule.
pub fn install(
    root: &Path,
    asset: &Asset,
    cancel: &AtomicBool,
    progress: &dyn Fn(u64, u64),
) -> Result<(), String> {
    if asset.files.is_empty() {
        return Err(format!(
            "« {} » n'est pas disponible pour cette plateforme.",
            asset.label
        ));
    }

    let total = asset.size();
    let mut done = 0u64;

    for file in asset.files {
        let part = part_path(root, file)?;
        let outcome = fetch(file, &part, cancel, &|received| progress(done + received, total))
            .and_then(|_| place(root, file, &part));

        if outcome.is_err() {
            let _ = fs::remove_file(&part);
        }
        outcome?;
        done += file.size;
        progress(done, total);
    }

    Ok(())
}

/// Supprime les fichiers d'un élément installé.
pub fn remove(root: &Path, asset: &Asset) -> Result<(), String> {
    for file in asset.files {
        let target = safe_join(root, file.target)?;
        let result = if target.is_dir() {
            fs::remove_dir_all(&target)
        } else if target.exists() {
            fs::remove_file(&target)
        } else {
            Ok(())
        };
        result.map_err(|e| format!("Suppression impossible : {e}"))?;
    }
    Ok(())
}

/// Télécharge un fichier dans `part`, en vérifiant son empreinte.
fn fetch(
    file: &AssetFile,
    part: &Path,
    cancel: &AtomicBool,
    progress: &dyn Fn(u64),
) -> Result<(), String> {
    if let Some(parent) = part.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Dossier de travail illisible : {e}"))?;
    }

    let response = ureq::get(file.url)
        .call()
        .map_err(|e| format!("Téléchargement impossible : {e}"))?;

    let mut reader = response.into_reader();
    let mut writer = BufWriter::new(
        File::create(part).map_err(|e| format!("Écriture impossible : {e}"))?,
    );
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; CHUNK];
    let mut received = 0u64;

    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        let read = reader
            .read(&mut buffer)
            .map_err(|e| format!("Lecture réseau interrompue : {e}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        writer
            .write_all(&buffer[..read])
            .map_err(|e| format!("Écriture impossible (disque plein ?) : {e}"))?;
        received += read as u64;
        progress(received);
    }

    writer
        .flush()
        .map_err(|e| format!("Écriture impossible (disque plein ?) : {e}"))?;
    drop(writer);

    let digest = hex(&hasher.finalize());
    if digest != file.sha256 {
        return Err(
            "Fichier téléchargé corrompu (empreinte inattendue). Réessayez l'installation.".into(),
        );
    }
    Ok(())
}

/// Met le fichier vérifié à sa place définitive (déplacement ou extraction).
fn place(root: &Path, file: &AssetFile, part: &Path) -> Result<(), String> {
    let target = safe_join(root, file.target)?;
    match file.archive {
        None => {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Dossier illisible : {e}"))?;
            }
            // `rename` échoue entre systèmes de fichiers : on retombe sur copie.
            if fs::rename(part, &target).is_err() {
                fs::copy(part, &target).map_err(|e| format!("Installation impossible : {e}"))?;
                let _ = fs::remove_file(part);
            }
            Ok(())
        }
        Some(archive) => {
            // Une réinstallation repart d'un dossier propre.
            if target.exists() {
                fs::remove_dir_all(&target).map_err(|e| format!("Nettoyage impossible : {e}"))?;
            }
            fs::create_dir_all(&target).map_err(|e| format!("Dossier illisible : {e}"))?;
            let result = extract(archive, part, &target);
            let _ = fs::remove_file(part);
            result
        }
    }
}

fn extract(archive: Archive, source: &Path, dest: &Path) -> Result<(), String> {
    match archive {
        Archive::TarGz { strip } => extract_tar_gz(source, dest, strip),
        Archive::Zip { strip } => extract_zip(source, dest, strip),
    }
}

fn extract_tar_gz(source: &Path, dest: &Path, strip: usize) -> Result<(), String> {
    let file = File::open(source).map_err(|e| format!("Archive illisible : {e}"))?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(file));
    let entries = archive
        .entries()
        .map_err(|e| format!("Archive illisible : {e}"))?;

    for entry in entries {
        let mut entry = entry.map_err(|e| format!("Archive illisible : {e}"))?;
        let path = entry
            .path()
            .map_err(|e| format!("Archive illisible : {e}"))?
            .into_owned();
        let Some(relative) = strip_components(&path, strip) else {
            continue;
        };
        let out = safe_join(dest, &relative.to_string_lossy())?;
        if entry.header().entry_type().is_dir() {
            fs::create_dir_all(&out).map_err(|e| format!("Extraction impossible : {e}"))?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Extraction impossible : {e}"))?;
        }
        // `unpack` conserve le bit exécutable, indispensable aux moteurs.
        entry
            .unpack(&out)
            .map_err(|e| format!("Extraction impossible : {e}"))?;
    }
    Ok(())
}

fn extract_zip(source: &Path, dest: &Path, strip: usize) -> Result<(), String> {
    let file = File::open(source).map_err(|e| format!("Archive illisible : {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Archive illisible : {e}"))?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("Archive illisible : {e}"))?;
        let Some(name) = entry.enclosed_name() else {
            continue;
        };
        let Some(relative) = strip_components(&name, strip) else {
            continue;
        };
        let out = safe_join(dest, &relative.to_string_lossy())?;
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(|e| format!("Extraction impossible : {e}"))?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Extraction impossible : {e}"))?;
        }
        let mut writer =
            File::create(&out).map_err(|e| format!("Extraction impossible : {e}"))?;
        std::io::copy(&mut entry, &mut writer)
            .map_err(|e| format!("Extraction impossible : {e}"))?;

        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&out, fs::Permissions::from_mode(mode));
        }
    }
    Ok(())
}

/// Retire les `count` premiers composants d'un chemin d'archive.
pub fn strip_components(path: &Path, count: usize) -> Option<PathBuf> {
    let mut parts = path.components();
    for _ in 0..count {
        parts.next()?;
    }
    let rest: PathBuf = parts.as_path().to_path_buf();
    if rest.as_os_str().is_empty() {
        None
    } else {
        Some(rest)
    }
}

/// Joint un chemin relatif à une base en refusant toute sortie du dossier.
pub fn safe_join(base: &Path, relative: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(relative);
    for component in candidate.components() {
        match component {
            Component::Normal(_) => {}
            _ => return Err("Chemin d'archive non autorisé.".into()),
        }
    }
    Ok(base.join(candidate))
}

fn part_path(root: &Path, file: &AssetFile) -> Result<PathBuf, String> {
    let name = file
        .url
        .rsplit('/')
        .next()
        .filter(|n| !n.is_empty())
        .unwrap_or("asset");
    let name: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        .collect();
    Ok(root.join(".partial").join(format!("{name}.part")))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_the_archive_root() {
        let path = Path::new("piper/espeak-ng-data/fr_dict");
        assert_eq!(
            strip_components(path, 1),
            Some(PathBuf::from("espeak-ng-data/fr_dict"))
        );
        // Le dossier racine lui-même ne produit rien à écrire.
        assert_eq!(strip_components(Path::new("piper"), 1), None);
    }

    #[test]
    fn refuses_paths_escaping_the_destination() {
        let base = Path::new("/tmp/models");
        assert!(safe_join(base, "../../etc/passwd").is_err());
        assert!(safe_join(base, "/etc/passwd").is_err());
        assert!(safe_join(base, "engines/piper/piper").is_ok());
    }

    #[test]
    fn partial_files_live_in_a_dedicated_folder() {
        let file = AssetFile {
            url: "https://example.com/a/ggml-base.bin",
            sha256: "0".repeat(64).leak(),
            size: 1,
            target: "stt/ggml-base.bin",
            archive: None,
        };
        let part = part_path(Path::new("/tmp/models"), &file).unwrap();
        assert_eq!(part, PathBuf::from("/tmp/models/.partial/ggml-base.bin.part"));
    }

    #[test]
    fn hex_encodes_lowercase() {
        assert_eq!(hex(&[0x00, 0x0f, 0xff]), "000fff");
    }
}
