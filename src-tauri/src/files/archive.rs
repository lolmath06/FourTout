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

/// Crée une archive **protégée par mot de passe**.
///
/// Seul le ZIP est proposé : TAR n'a pas de chiffrement natif, et le
/// « tar.gz.gpg » qu'on voit parfois demande un outil tiers pour être relu.
pub fn create_encrypted(
    members: &[Member],
    output: &Path,
    level: u32,
    password: &str,
    reporter: &Reporter,
) -> Result<ArchiveSummary, String> {
    if password.is_empty() {
        return Err("Le mot de passe ne peut pas être vide.".into());
    }
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

    if let Err(error) =
        write_zip_maybe_encrypted(members, output, level, total, Some(password), reporter)
    {
        // Une archive partielle protégée par mot de passe serait pire qu'aucune
        // archive : impossible de savoir ce qu'elle contient vraiment.
        let _ = fs::remove_file(output);
        return Err(error);
    }

    let output_bytes = fs::metadata(output).map(|m| m.len()).unwrap_or(0);
    Ok(ArchiveSummary {
        path: output.to_string_lossy().to_string(),
        files: members.len(),
        input_bytes: total,
        output_bytes,
    })
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
    write_zip_maybe_encrypted(members, output, level, total, None, reporter)
}

/// Écrit une archive ZIP, éventuellement chiffrée.
///
/// Le chiffrement utilisé est **WinZip AES-256**, celui que lisent 7-Zip,
/// WinRAR, PeaZip, Keka et l'Explorateur de fichiers moderne. Le « ZipCrypto »
/// historique n'est jamais employé : il est cassé depuis les années 1990 et se
/// déchiffre à partir de quelques octets de clair connu.
fn write_zip_maybe_encrypted(
    members: &[Member],
    output: &Path,
    level: u32,
    total: u64,
    password: Option<&str>,
    reporter: &Reporter,
) -> Result<(), String> {
    let file = File::create(output).map_err(|e| format!("Création impossible : {e}"))?;
    let mut writer = zip::ZipWriter::new(BufWriter::new(file));
    let mut options: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default()
        .compression_method(if level == 0 {
            zip::CompressionMethod::Stored
        } else {
            zip::CompressionMethod::Deflated
        })
        .compression_level(if level == 0 { None } else { Some(level as i64) })
        .large_file(true);
    if let Some(password) = password {
        options = options.with_aes_encryption(zip::AesMode::Aes256, password);
    }

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
    /// Au moins une entrée est protégée par mot de passe.
    pub encrypted: bool,
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
    let mut encrypted = false;

    match format {
        Format::Zip => {
            let file = File::open(path).map_err(|e| format!("Ouverture impossible : {e}"))?;
            let mut archive = zip::ZipArchive::new(BufReader::new(file))
                .map_err(|e| format!("Archive ZIP illisible : {e}"))?;
            for index in 0..archive.len() {
                // `by_index_raw` lit l'en-tête sans décompresser ni déchiffrer :
                // c'est ce qui permet de décrire une archive protégée par mot de
                // passe sans le demander.
                let entry = archive
                    .by_index_raw(index)
                    .map_err(|error| describe_zip_error(error, false))?;
                let raw = entry.name().to_string();
                let is_dir = entry.is_dir();
                if entry.encrypted() {
                    encrypted = true;
                }
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
        encrypted,
    })
}

/// Traduit une erreur de la bibliothèque ZIP en message utile.
fn describe_zip_error(error: zip::result::ZipError, password_given: bool) -> String {
    match error {
        zip::result::ZipError::InvalidPassword if password_given => {
            "Mot de passe incorrect : l'archive n'a pas été extraite.".to_string()
        }
        zip::result::ZipError::InvalidPassword => {
            "Cette archive est protégée par un mot de passe.".to_string()
        }
        zip::result::ZipError::UnsupportedArchive(reason)
            if reason.to_lowercase().contains("password") =>
        {
            if password_given {
                "Mot de passe incorrect : l'archive n'a pas été extraite.".to_string()
            } else {
                "Cette archive est protégée par un mot de passe.".to_string()
            }
        }
        zip::result::ZipError::UnsupportedArchive(reason) => {
            format!("Archive non prise en charge : {reason}")
        }
        other => format!("Archive ZIP illisible : {other}"),
    }
}

/// Retire les fichiers déjà écrits avant de propager l'erreur.
fn rollback(created: Vec<PathBuf>, error: String) -> String {
    for path in created {
        let _ = fs::remove_file(path);
    }
    error
}

fn check_entry(name: &str, is_dir: bool) -> Option<String> {
    let _ = is_dir;
    safe_relative_path(name).err()
}

#[derive(Debug, Serialize)]
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
    extract_with_password(path, destination, overwrite, None, reporter)
}

/// Extrait une archive, éventuellement protégée par mot de passe.
///
/// Un mot de passe erroné doit produire un message clair et **aucun fichier** :
/// une extraction à moitié faite laisserait croire que l'archive est corrompue
/// alors qu'il ne manquait qu'un mot de passe.
pub fn extract_with_password(
    path: &Path,
    destination: &Path,
    overwrite: bool,
    password: Option<&str>,
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
    // Fichiers réellement créés : si l'extraction échoue en route (mot de passe
    // refusé sur une entrée, archive tronquée), on ne laisse pas derrière nous
    // une extraction à moitié faite qu'on prendrait pour un résultat.
    let mut created: Vec<PathBuf> = Vec::new();

    // `skipped` est passé en paramètre plutôt que capturé : la boucle
    // d'extraction doit pouvoir y ajouter ses propres refus (liens
    // symboliques, entrées spéciales) entre deux appels.
    let write_entry = |name: &str,
                       is_dir: bool,
                       reader: &mut dyn Read,
                       reporter: &Reporter,
                       bytes: &mut u64,
                       skipped: &mut Vec<String>,
                       created: &mut Vec<PathBuf>|
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
        created.push(final_path.clone());
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
                let mut entry = match password {
                    Some(password) => archive
                        .by_index_decrypt(index, password.as_bytes())
                        .map_err(|error| describe_zip_error(error, true))?,
                    None => archive
                        .by_index(index)
                        .map_err(|error| describe_zip_error(error, false))?,
                };
                let name = entry.name().to_string();
                let is_dir = entry.is_dir();
                match write_entry(
                    &name,
                    is_dir,
                    &mut entry,
                    reporter,
                    &mut bytes,
                    &mut skipped,
                    &mut created,
                ) {
                    Ok(true) => extracted += 1,
                    Ok(false) => {}
                    Err(error) => return Err(rollback(created, error)),
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
                match write_entry(
                    &name,
                    is_dir,
                    &mut entry,
                    reporter,
                    &mut bytes,
                    &mut skipped,
                    &mut created,
                ) {
                    Ok(true) => extracted += 1,
                    Ok(false) => {}
                    Err(error) => return Err(rollback(created, error)),
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
    fn encrypted_archive_round_trip() {
        let root = workspace("aes");
        seed(&root);
        let members = collect_members(&[root.join("source")], &Reporter::silent()).unwrap();
        let output = root.join("protege.zip");
        create_encrypted(&members, &output, 6, "mot de passe fort", &Reporter::silent()).unwrap();

        // Le contenu ne doit pas être lisible sans mot de passe.
        let destination = root.join("sans-mdp");
        let error = extract(&output, &destination, true, &Reporter::silent()).unwrap_err();
        assert!(error.contains("mot de passe"), "message inattendu : {error}");

        // Mauvais mot de passe : message clair, et aucun fichier extrait.
        let wrong_dir = root.join("mauvais");
        let error = extract_with_password(
            &output,
            &wrong_dir,
            true,
            Some("mauvais"),
            &Reporter::silent(),
        )
        .unwrap_err();
        assert!(error.contains("Mot de passe incorrect"), "message inattendu : {error}");
        let leftovers: Vec<_> = fs::read_dir(&wrong_dir)
            .map(|entries| entries.filter_map(|e| e.ok()).collect())
            .unwrap_or_default();
        assert!(leftovers.is_empty(), "des fichiers ont survécu à un mot de passe faux");

        // Bon mot de passe : contenu identique à l'original.
        let good_dir = root.join("bon");
        let summary = extract_with_password(
            &output,
            &good_dir,
            true,
            Some("mot de passe fort"),
            &Reporter::silent(),
        )
        .unwrap();
        assert!(summary.extracted >= 1);
        assert_eq!(
            fs::read(good_dir.join("source/a.txt")).unwrap(),
            fs::read(root.join("source/a.txt")).unwrap()
        );
    }

    #[test]
    fn encrypted_archive_refuses_an_empty_password() {
        let root = workspace("aes-empty");
        seed(&root);
        let members = collect_members(&[root.join("source/a.txt")], &Reporter::silent()).unwrap();
        assert!(
            create_encrypted(&members, &root.join("x.zip"), 6, "", &Reporter::silent()).is_err()
        );
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
