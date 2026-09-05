//! Archives ZIP, TAR et TAR.GZ.
//!
//! Création et extraction passent par le disque en flux, jamais par la mémoire
//! de la WebView. L'extraction applique systématiquement les gardes de
//! `super::safe_relative_path` : aucune entrée ne peut écrire hors du dossier
//! choisi par l'utilisateur, quelle que soit la façon dont l'archive a été
//! fabriquée.

use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};

use super::{resolve_inside, safe_relative_path, unique_path, Reporter};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Format {
    Zip,
    Tar,
    TarGz,
}

impl Format {
    pub fn extension(&self) -> &'static str {
        match self {
            Format::Zip => "zip",
            Format::Tar => "tar",
            Format::TarGz => "tar.gz",
        }
    }

    /// Format déduit de l'extension d'un fichier existant.
    pub fn detect(path: &Path) -> Option<Format> {
        let name = path.file_name()?.to_string_lossy().to_lowercase();
        if name.ends_with(".zip") {
            Some(Format::Zip)
        } else if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
            Some(Format::TarGz)
        } else if name.ends_with(".tar") {
            Some(Format::Tar)
        } else {
            None
        }
    }
}

/// Un fichier à archiver, avec le chemin qu'il occupera dans l'archive.
#[derive(Clone, Debug)]
pub struct Member {
    pub source: PathBuf,
    /// Chemin relatif dans l'archive, séparateurs `/`.
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSummary {
    pub path: String,
    pub files: usize,
    pub input_bytes: u64,
    pub output_bytes: u64,
}

/// Développe une liste de chemins (fichiers et dossiers) en membres d'archive.
///
/// L'arborescence relative est conservée : un dossier `photos/` déposé produit
/// `photos/2024/a.jpg`, pas `a.jpg`.
pub fn collect_members(paths: &[PathBuf], reporter: &Reporter) -> Result<Vec<Member>, String> {
    let mut members = Vec::new();
    for path in paths {
        reporter.check()?;
        if path.is_dir() {
            let base = path.parent().unwrap_or(Path::new("")).to_path_buf();
            walk_into(path, &base, &mut members, reporter)?;
        } else if path.is_file() {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .ok_or_else(|| "Nom de fichier illisible.".to_string())?;
            members.push(Member { source: path.clone(), name });
        }
    }
    members.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(members)
}

fn walk_into(
    directory: &Path,
    base: &Path,
    members: &mut Vec<Member>,
    reporter: &Reporter,
) -> Result<(), String> {
    reporter.check()?;
    let entries = fs::read_dir(directory).map_err(|e| format!("{} : {e}", directory.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        // Les liens symboliques ne sont pas suivis : archiver la cible d'un
        // lien peut faire sortir de l'arborescence choisie.
        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            walk_into(&path, base, members, reporter)?;
        } else if meta.is_file() {
            let relative = path.strip_prefix(base).unwrap_or(&path);
            members.push(Member {
                source: path.clone(),
                name: relative.to_string_lossy().replace('\\', "/"),
            });
        }
    }
    Ok(())
}

/// Crée une archive à partir de membres déjà résolus.
pub fn create(
    members: &[Member],
    output: &Path,
    format: Format,
    level: u32,
    reporter: &Reporter,
) -> Result<ArchiveSummary, String> {
    if members.is_empty() {
        return Err("Aucun fichier à archiver.".into());
    }
    let total: u64 = members
        .iter()
        .map(|m| fs::metadata(&m.source).map(|meta| meta.len()).unwrap_or(0))
        .sum();

    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    match format {
        Format::Zip => write_zip(members, output, level, total, reporter)?,
        Format::Tar => write_tar(members, output, None, total, reporter)?,
        Format::TarGz => write_tar(members, output, Some(level), total, reporter)?,
    }

    let output_bytes = fs::metadata(output).map(|m| m.len()).unwrap_or(0);
    Ok(ArchiveSummary {
        path: output.to_string_lossy().to_string(),
        files: members.len(),
        input_bytes: total,
        output_bytes,
    })
}

fn write_zip(
    members: &[Member],
    output: &Path,
    level: u32,
    total: u64,
    reporter: &Reporter,
) -> Result<(), String> {
    let file = File::create(output).map_err(|e| format!("Création impossible : {e}"))?;
    let mut writer = zip::ZipWriter::new(BufWriter::new(file));
    let options: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default()
        .compression_method(if level == 0 {
            zip::CompressionMethod::Stored
        } else {
            zip::CompressionMethod::Deflated
        })
        .compression_level(if level == 0 { None } else { Some(level as i64) })
        .large_file(true);

    let mut done = 0_u64;
    let mut buffer = vec![0_u8; 256 * 1024];
    for member in members {
        reporter.check()?;
        // Le nom écrit dans l'archive passe par la même validation que celui
        // qu'on accepterait à l'extraction : on ne fabrique pas d'archive
        // piégée, même par accident.
        let name = safe_relative_path(&member.name)?.to_string_lossy().replace('\\', "/");
        writer.start_file(name, options).map_err(|e| e.to_string())?;
        let mut source = File::open(&member.source).map_err(|e| e.to_string())?;
        loop {
            reporter.check()?;
            let read = source.read(&mut buffer).map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            writer.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
            done += read as u64;
            reporter.report(done, total, &member.name);
        }
    }
    writer.finish().map_err(|e| e.to_string())?;
    Ok(())
}

fn write_tar(
    members: &[Member],
    output: &Path,
    gzip_level: Option<u32>,
    total: u64,
    reporter: &Reporter,
) -> Result<(), String> {
    let file = File::create(output).map_err(|e| format!("Création impossible : {e}"))?;
    let writer = BufWriter::new(file);

    fn append<W: Write>(
        builder: &mut tar::Builder<W>,
        members: &[Member],
        total: u64,
        reporter: &Reporter,
    ) -> Result<(), String> {
        let mut done = 0_u64;
        for member in members {
            reporter.check()?;
            let name = safe_relative_path(&member.name)?;
            let mut source = File::open(&member.source).map_err(|e| e.to_string())?;
            builder.append_file(&name, &mut source).map_err(|e| e.to_string())?;
            done += fs::metadata(&member.source).map(|m| m.len()).unwrap_or(0);
            reporter.report(done, total, &member.name);
        }
        builder.finish().map_err(|e| e.to_string())
    }

    match gzip_level {
        None => {
            let mut builder = tar::Builder::new(writer);
            append(&mut builder, members, total, reporter)?;
        }
        Some(level) => {
            let encoder = GzEncoder::new(writer, Compression::new(level.clamp(1, 9)));
            let mut builder = tar::Builder::new(encoder);
            append(&mut builder, members, total, reporter)?;
        }
    }
    Ok(())
}

/* ------------------------------------------------------------ inspection */

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    pub name: String,
    pub size: u64,
    pub compressed_size: u64,
    pub is_dir: bool,
    /// Motif de refus si cette entrée ne sera pas extraite.
    pub rejected: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveListing {
    pub format: String,
    pub entries: Vec<ArchiveEntry>,
    pub files: usize,
    /// Taille décompressée totale annoncée par l'archive (0 si inconnue).
    pub total_size: u64,
    pub archive_size: u64,
    /// Entrées refusées par les gardes de sécurité.
    pub rejected: usize,
    /// L'archive présente-t-elle un rapport de compression anormal ?
    pub suspicious: bool,
}

/// Rapport de compression au-delà duquel on prévient l'utilisateur.
const BOMB_RATIO: u64 = 200;
/// Taille décompressée au-delà de laquelle le rapport devient significatif.
const BOMB_MIN_SIZE: u64 = 1024 * 1024 * 1024;
/// Nombre d'entrées au-delà duquel on refuse d'extraire sans confirmation.
pub const MAX_ENTRIES: usize = 200_000;

/// Liste le contenu d'une archive **sans rien extraire**.
pub fn list(path: &Path) -> Result<ArchiveListing, String> {
    let format = Format::detect(path).ok_or_else(|| {
        "Format d'archive non reconnu. Formats pris en charge : ZIP, TAR, TAR.GZ.".to_string()
    })?;
    let archive_size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let mut entries: Vec<ArchiveEntry> = Vec::new();

    match format {
        Format::Zip => {
            let file = File::open(path).map_err(|e| format!("Ouverture impossible : {e}"))?;
            let mut archive = zip::ZipArchive::new(BufReader::new(file))
                .map_err(|e| format!("Archive ZIP illisible : {e}"))?;
            for index in 0..archive.len() {
                let entry = archive.by_index(index).map_err(|e| e.to_string())?;
                let raw = entry.name().to_string();
                let is_dir = entry.is_dir();
                entries.push(ArchiveEntry {
                    rejected: check_entry(&raw, is_dir),
                    name: raw,
                    size: entry.size(),
                    compressed_size: entry.compressed_size(),
                    is_dir,
                });
            }
        }
        Format::Tar | Format::TarGz => {
            let file = File::open(path).map_err(|e| format!("Ouverture impossible : {e}"))?;
            let reader: Box<dyn Read> = if format == Format::TarGz {
                Box::new(GzDecoder::new(BufReader::new(file)))
            } else {
                Box::new(BufReader::new(file))
            };
            let mut archive = tar::Archive::new(reader);
            for entry in archive.entries().map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| format!("Archive TAR illisible : {e}"))?;
                let raw = entry.path().map_err(|e| e.to_string())?.to_string_lossy().to_string();
                let kind = entry.header().entry_type();
                let is_dir = kind.is_dir();
                let rejected = if kind.is_symlink() || kind.is_hard_link() {
                    Some("Lien symbolique ignoré".to_string())
                } else if !is_dir && !kind.is_file() {
                    Some("Entrée spéciale ignorée".to_string())
                } else {
                    check_entry(&raw, is_dir)
                };
                entries.push(ArchiveEntry {
                    rejected,
                    name: raw,
                    size: entry.size(),
                    compressed_size: 0,
                    is_dir,
                });
            }
        }
    }

    let total_size: u64 = entries.iter().filter(|e| !e.is_dir).map(|e| e.size).sum();
    let files = entries.iter().filter(|e| !e.is_dir).count();
    let rejected = entries.iter().filter(|e| e.rejected.is_some()).count();
    let suspicious = total_size > BOMB_MIN_SIZE
        && archive_size > 0
        && total_size / archive_size.max(1) > BOMB_RATIO;

    Ok(ArchiveListing {
        format: format.extension().to_string(),
        entries,
        files,
        total_size,
        archive_size,
        rejected,
        suspicious,
    })
}

fn check_entry(name: &str, is_dir: bool) -> Option<String> {
    let _ = is_dir;
    match safe_relative_path(name) {
        Ok(_) => None,
        Err(message) => Some(message),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractSummary {
    pub destination: String,
    pub extracted: usize,
    pub skipped: Vec<String>,
    pub bytes: u64,
}

/// Extrait une archive dans un dossier. Rien n'est écrit hors de ce dossier.
pub fn extract(
    path: &Path,
    destination: &Path,
    overwrite: bool,
    reporter: &Reporter,
) -> Result<ExtractSummary, String> {
    let listing = list(path)?;
    if listing.entries.len() > MAX_ENTRIES {
        return Err(format!(
            "Archive refusée : {} entrées (limite {MAX_ENTRIES}).",
            listing.entries.len()
        ));
    }
    let format = Format::detect(path).ok_or("Format d'archive non reconnu.")?;
    fs::create_dir_all(destination).map_err(|e| format!("Dossier de destination : {e}"))?;
    let destination = fs::canonicalize(destination).map_err(|e| e.to_string())?;

    let mut skipped: Vec<String> = Vec::new();
    let mut extracted = 0_usize;
    let mut bytes = 0_u64;
    let total = listing.total_size;

    // `skipped` est passé en paramètre plutôt que capturé : la boucle
    // d'extraction doit pouvoir y ajouter ses propres refus (liens
    // symboliques, entrées spéciales) entre deux appels.
    let write_entry = |name: &str,
                       is_dir: bool,
                       reader: &mut dyn Read,
                       reporter: &Reporter,
                       bytes: &mut u64,
                       skipped: &mut Vec<String>|
     -> Result<bool, String> {
        reporter.check()?;
        let target = match resolve_inside(&destination, name) {
            Ok(target) => target,
            Err(message) => {
                skipped.push(format!("{name} — {message}"));
                return Ok(false);
            }
        };
        if is_dir {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            return Ok(false);
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // Jamais d'écrasement silencieux : soit l'utilisateur l'a demandé,
        // soit le fichier est écrit à côté sous un nom libre.
        let final_path = if overwrite { target } else { unique_path(&target) };
        let mut out = BufWriter::new(File::create(&final_path).map_err(|e| e.to_string())?);
        let mut buffer = vec![0_u8; 256 * 1024];
        loop {
            reporter.check()?;
            let read = reader.read(&mut buffer).map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            out.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
            *bytes += read as u64;
            reporter.report(*bytes, total, name);
        }
        out.flush().map_err(|e| e.to_string())?;
        Ok(true)
    };

    match format {
        Format::Zip => {
            let file = File::open(path).map_err(|e| e.to_string())?;
            let mut archive = zip::ZipArchive::new(BufReader::new(file)).map_err(|e| e.to_string())?;
            for index in 0..archive.len() {
                let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
                let name = entry.name().to_string();
                let is_dir = entry.is_dir();
                if write_entry(&name, is_dir, &mut entry, reporter, &mut bytes, &mut skipped)? {
                    extracted += 1;
                }
            }
        }
        Format::Tar | Format::TarGz => {
            let file = File::open(path).map_err(|e| e.to_string())?;
            let reader: Box<dyn Read> = if format == Format::TarGz {
                Box::new(GzDecoder::new(BufReader::new(file)))
            } else {
                Box::new(BufReader::new(file))
            };
            let mut archive = tar::Archive::new(reader);
            for entry in archive.entries().map_err(|e| e.to_string())? {
                let mut entry = entry.map_err(|e| e.to_string())?;
                let kind = entry.header().entry_type();
                let name = entry.path().map_err(|e| e.to_string())?.to_string_lossy().to_string();
                if kind.is_symlink() || kind.is_hard_link() {
                    skipped.push(format!("{name} — lien symbolique ignoré"));
                    continue;
                }
                let is_dir = kind.is_dir();
                if !is_dir && !kind.is_file() {
                    skipped.push(format!("{name} — entrée spéciale ignorée"));
                    continue;
                }
                if write_entry(&name, is_dir, &mut entry, reporter, &mut bytes, &mut skipped)? {
                    extracted += 1;
                }
            }
        }
    }

    Ok(ExtractSummary {
        destination: destination.to_string_lossy().to_string(),
        extracted,
        skipped,
        bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fourtout-archive-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn seed(root: &Path) {
        fs::create_dir_all(root.join("source/nested")).unwrap();
        fs::write(root.join("source/a.txt"), b"contenu A\n").unwrap();
        fs::write(root.join("source/nested/b.txt"), b"contenu B imbrique\n").unwrap();
        fs::write(root.join("source/unicode-e.txt"), "accents : eac\n".as_bytes()).unwrap();
    }

    fn roundtrip(format: Format, name: &str) {
        let root = workspace(name);
        seed(&root);
        let members = collect_members(&[root.join("source")], &Reporter::silent()).unwrap();
        assert_eq!(members.len(), 3);
        assert!(members.iter().all(|m| m.name.starts_with("source/")));

        let output = root.join(format!("archive.{}", format.extension()));
        let summary = create(&members, &output, format, 6, &Reporter::silent()).unwrap();
        assert_eq!(summary.files, 3);
        assert!(output.exists());

        let listing = list(&output).unwrap();
        assert_eq!(listing.files, 3);
        assert_eq!(listing.rejected, 0);

        let destination = root.join("out");
        let extracted = extract(&output, &destination, true, &Reporter::silent()).unwrap();
        assert_eq!(extracted.extracted, 3);
        assert!(extracted.skipped.is_empty());
        assert_eq!(
            fs::read(destination.join("source/nested/b.txt")).unwrap(),
            b"contenu B imbrique\n"
        );
    }

    #[test]
    fn zip_roundtrip_preserves_tree() {
        roundtrip(Format::Zip, "zip");
    }

    #[test]
    fn tar_roundtrip_preserves_tree() {
        roundtrip(Format::Tar, "tar");
    }

    #[test]
    fn targz_roundtrip_preserves_tree() {
        roundtrip(Format::TarGz, "targz");
    }

    #[test]
    fn refuses_zip_slip_entries() {
        let root = workspace("slip");
        let archive_path = root.join("evil.zip");
        {
            let file = File::create(&archive_path).unwrap();
            let mut writer = zip::ZipWriter::new(file);
            let options: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
            // `start_file` refuse parfois les noms dangereux : on passe par
            // l'API brute pour fabriquer une archive réellement piégée.
            writer.start_file("../../evil.txt", options).unwrap();
            writer.write_all(b"piege").unwrap();
            writer.start_file("sain.txt", options).unwrap();
            writer.write_all(b"ok").unwrap();
            writer.finish().unwrap();
        }

        let listing = list(&archive_path).unwrap();
        assert_eq!(listing.rejected, 1);

        let destination = root.join("out");
        let summary = extract(&archive_path, &destination, true, &Reporter::silent()).unwrap();
        assert_eq!(summary.extracted, 1);
        assert_eq!(summary.skipped.len(), 1);
        assert!(destination.join("sain.txt").exists());
        assert!(!root.join("evil.txt").exists());
        assert!(!root.parent().unwrap().join("evil.txt").exists());
    }

    #[test]
    fn never_overwrites_silently() {
        let root = workspace("overwrite");
        seed(&root);
        let members = collect_members(&[root.join("source/a.txt")], &Reporter::silent()).unwrap();
        let output = root.join("one.zip");
        create(&members, &output, Format::Zip, 6, &Reporter::silent()).unwrap();

        let destination = root.join("out");
        fs::create_dir_all(&destination).unwrap();
        fs::write(destination.join("a.txt"), b"existant").unwrap();

        extract(&output, &destination, false, &Reporter::silent()).unwrap();
        assert_eq!(fs::read(destination.join("a.txt")).unwrap(), b"existant");
        assert!(destination.join("a (2).txt").exists());
    }
}
