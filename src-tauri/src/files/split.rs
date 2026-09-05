//! Découpage et réassemblage de gros fichiers.
//!
//! Un fichier de plusieurs gigaoctets ne tient ni en mémoire ni sur une clé
//! USB en FAT32 : on le coupe en morceaux numérotés, accompagnés d'un manifeste
//! qui permet de vérifier le réassemblage plutôt que de l'espérer.

use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{unique_path, Reporter};

const BUFFER: usize = 1024 * 1024;
/// Extension du manifeste écrit à côté des morceaux.
pub const MANIFEST_EXTENSION: &str = "fourtout-parts.json";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    /// Nom du fichier d'origine, tel qu'il sera restitué.
    pub original_name: String,
    pub total_size: u64,
    /// SHA-256 du fichier d'origine.
    pub sha256: String,
    pub parts: usize,
    pub part_size: u64,
    /// Taille de chaque morceau, dans l'ordre.
    pub part_sizes: Vec<u64>,
    pub created_by: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitSummary {
    pub directory: String,
    pub parts: Vec<String>,
    pub manifest_path: String,
    pub total_size: u64,
    pub sha256: String,
}

/// Nom du morceau numéro `index` (1-indexé) : `fichier.bin.part001`.
pub fn part_name(original: &str, index: usize) -> String {
    format!("{original}.part{index:03}")
}

/// Découpe un fichier en morceaux de `part_size` octets.
pub fn split_file(
    source: &Path,
    destination: &Path,
    part_size: u64,
    reporter: &Reporter,
) -> Result<SplitSummary, String> {
    if part_size < 1024 {
        return Err("La taille d'un morceau doit être d'au moins 1 Kio.".into());
    }
    let metadata = fs::metadata(source).map_err(|e| format!("Fichier illisible : {e}"))?;
    let total = metadata.len();
    if total == 0 {
        return Err("Le fichier est vide : il n'y a rien à découper.".into());
    }
    fs::create_dir_all(destination).map_err(|e| format!("Dossier de destination : {e}"))?;

    let original_name = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| "Nom de fichier illisible.".to_string())?;

    let mut reader = BufReader::with_capacity(BUFFER, File::open(source).map_err(|e| e.to_string())?);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; BUFFER];

    let mut parts: Vec<String> = Vec::new();
    let mut part_sizes: Vec<u64> = Vec::new();
    let mut written_total = 0_u64;
    let mut index = 0_usize;

    loop {
        reporter.check()?;
        index += 1;
        let path = destination.join(part_name(&original_name, index));
        let mut writer = BufWriter::new(File::create(&path).map_err(|e| e.to_string())?);
        let mut written = 0_u64;

        while written < part_size {
            reporter.check()?;
            let wanted = ((part_size - written) as usize).min(BUFFER);
            let read = reader.read(&mut buffer[..wanted]).map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            writer.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
            hasher.update(&buffer[..read]);
            written += read as u64;
            written_total += read as u64;
            reporter.report(written_total, total, &format!("Morceau {index}"));
        }
        writer.flush().map_err(|e| e.to_string())?;

        if written == 0 {
            // Le fichier tombait juste : ce morceau est vide, on le retire.
            let _ = fs::remove_file(&path);
            break;
        }
        parts.push(path.to_string_lossy().to_string());
        part_sizes.push(written);
        if written_total >= total {
            break;
        }
    }

    let sha256 = format!("{:x}", hasher.finalize());
    let manifest = Manifest {
        original_name: original_name.clone(),
        total_size: total,
        sha256: sha256.clone(),
        parts: parts.len(),
        part_size,
        part_sizes,
        created_by: format!("FourTout {}", env!("CARGO_PKG_VERSION")),
    };
    let manifest_path = destination.join(format!("{original_name}.{MANIFEST_EXTENSION}"));
    fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok(SplitSummary {
        directory: destination.to_string_lossy().to_string(),
        parts,
        manifest_path: manifest_path.to_string_lossy().to_string(),
        total_size: total,
        sha256,
    })
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JoinSummary {
    pub path: String,
    pub parts: usize,
    pub total_size: u64,
    pub sha256: String,
    /// Le manifeste a-t-il été trouvé et l'empreinte vérifiée ?
    pub verified: bool,
    /// Message d'avertissement (manifeste absent, taille inattendue…).
    pub warning: Option<String>,
}

/// Découvre la suite complète de morceaux à partir de l'un d'entre eux.
pub fn discover_parts(any_part: &Path) -> Result<(String, Vec<PathBuf>), String> {
    let name = any_part
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| "Nom de fichier illisible.".to_string())?;
    let base = name
        .rsplit_once(".part")
        .map(|(base, _)| base.to_string())
        .ok_or_else(|| "Ce fichier n'est pas un morceau « .partNNN ».".to_string())?;
    let directory = any_part.parent().unwrap_or(Path::new(".")).to_path_buf();

    let mut found: Vec<(usize, PathBuf)> = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        let Some(file_name) = path.file_name().map(|n| n.to_string_lossy().to_string()) else {
            continue;
        };
        let Some((candidate_base, suffix)) = file_name.rsplit_once(".part") else {
            continue;
        };
        if candidate_base != base {
            continue;
        }
        if let Ok(number) = suffix.parse::<usize>() {
            found.push((number, path));
        }
    }
    if found.is_empty() {
        return Err("Aucun morceau trouvé dans ce dossier.".into());
    }
    found.sort_by_key(|(number, _)| *number);

    // Séquence complète et sans trou : sinon le fichier reconstruit serait
    // silencieusement corrompu.
    for (position, (number, path)) in found.iter().enumerate() {
        if *number != position + 1 {
            return Err(format!(
                "Morceau manquant : la suite passe de {} à {number} ({}).",
                position,
                path.display()
            ));
        }
    }

    Ok((base, found.into_iter().map(|(_, path)| path).collect()))
}

/// Réassemble les morceaux en un fichier unique et vérifie le résultat.
pub fn join_parts(
    any_part: &Path,
    destination_dir: &Path,
    reporter: &Reporter,
) -> Result<JoinSummary, String> {
    let (base, parts) = discover_parts(any_part)?;
    let directory = any_part.parent().unwrap_or(Path::new(".")).to_path_buf();
    let manifest_path = directory.join(format!("{base}.{MANIFEST_EXTENSION}"));
    let manifest: Option<Manifest> = fs::read(&manifest_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok());

    if let Some(manifest) = &manifest {
        if manifest.parts != parts.len() {
            return Err(format!(
                "Le manifeste annonce {} morceaux, {} trouvés.",
                manifest.parts,
                parts.len()
            ));
        }
    }

    fs::create_dir_all(destination_dir).map_err(|e| e.to_string())?;
    let output = unique_path(&destination_dir.join(&base));
    let mut writer = BufWriter::new(File::create(&output).map_err(|e| e.to_string())?);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; BUFFER];
    let mut total = 0_u64;
    let expected: u64 = manifest.as_ref().map(|m| m.total_size).unwrap_or(0);

    for (index, part) in parts.iter().enumerate() {
        reporter.check()?;
        let mut reader = BufReader::with_capacity(BUFFER, File::open(part).map_err(|e| e.to_string())?);
        loop {
            reporter.check()?;
            let read = reader.read(&mut buffer).map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            writer.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
            hasher.update(&buffer[..read]);
            total += read as u64;
            reporter.report(total, expected, &format!("Morceau {} sur {}", index + 1, parts.len()));
        }
    }
    writer.flush().map_err(|e| e.to_string())?;

    let sha256 = format!("{:x}", hasher.finalize());
    let mut warning = None;
    let mut verified = false;
    match &manifest {
        None => {
            warning = Some(
                "Manifeste absent : le fichier a été reconstruit, mais son intégrité n'a pas pu être vérifiée."
                    .into(),
            );
        }
        Some(manifest) => {
            if manifest.sha256 == sha256 && manifest.total_size == total {
                verified = true;
            } else {
                // Un réassemblage faux est pire qu'une erreur : on supprime.
                let _ = fs::remove_file(&output);
                return Err(format!(
                    "Le fichier reconstruit ne correspond pas au manifeste ({} octets attendus, {total} obtenus).",
                    manifest.total_size
                ));
            }
        }
    }

    Ok(JoinSummary {
        path: output.to_string_lossy().to_string(),
        parts: parts.len(),
        total_size: total,
        sha256,
        verified,
        warning,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::hash::sha256_file;

    fn workspace(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fourtout-split-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn deterministic_bytes(size: usize) -> Vec<u8> {
        (0..size).map(|i| ((i * 31 + 7) % 251) as u8).collect()
    }

    #[test]
    fn split_then_join_restores_identical_file() {
        let root = workspace("roundtrip");
        let source = root.join("large-split.bin");
        fs::write(&source, deterministic_bytes(500_000)).unwrap();
        let original = sha256_file(&source).unwrap();

        let parts_dir = root.join("parts");
        let summary = split_file(&source, &parts_dir, 100_000, &Reporter::silent()).unwrap();
        assert_eq!(summary.parts.len(), 5);
        assert_eq!(summary.sha256, original);
        assert!(parts_dir.join("large-split.bin.part001").exists());
        assert!(parts_dir.join("large-split.bin.part005").exists());

        let rebuilt_dir = root.join("rebuilt");
        let joined = join_parts(
            &parts_dir.join("large-split.bin.part003"),
            &rebuilt_dir,
            &Reporter::silent(),
        )
        .unwrap();
        assert!(joined.verified);
        assert_eq!(joined.parts, 5);
        assert_eq!(joined.sha256, original);
        assert_eq!(sha256_file(Path::new(&joined.path)).unwrap(), original);
    }

    #[test]
    fn refuses_a_missing_part() {
        let root = workspace("missing");
        let source = root.join("data.bin");
        fs::write(&source, deterministic_bytes(300_000)).unwrap();
        let parts_dir = root.join("parts");
        split_file(&source, &parts_dir, 100_000, &Reporter::silent()).unwrap();

        fs::remove_file(parts_dir.join("data.bin.part002")).unwrap();
        let error = join_parts(&parts_dir.join("data.bin.part001"), &root.join("out"), &Reporter::silent())
            .unwrap_err();
        assert!(error.contains("manquant"), "message inattendu : {error}");
    }

    #[test]
    fn refuses_a_corrupted_part() {
        let root = workspace("corrupt");
        let source = root.join("data.bin");
        fs::write(&source, deterministic_bytes(250_000)).unwrap();
        let parts_dir = root.join("parts");
        split_file(&source, &parts_dir, 100_000, &Reporter::silent()).unwrap();

        let part = parts_dir.join("data.bin.part002");
        let mut bytes = fs::read(&part).unwrap();
        bytes[10] ^= 0xff;
        fs::write(&part, bytes).unwrap();

        let out = root.join("out");
        let error = join_parts(&parts_dir.join("data.bin.part001"), &out, &Reporter::silent())
            .unwrap_err();
        assert!(error.contains("ne correspond pas"), "message inattendu : {error}");
        // Aucun fichier trompeur ne doit rester derrière.
        assert!(!out.join("data.bin").exists());
    }
}
