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
    TarXz,
    SevenZ,
}

impl Format {
    pub fn extension(&self) -> &'static str {
        match self {
            Format::Zip => "zip",
            Format::Tar => "tar",
            Format::TarGz => "tar.gz",
            Format::TarXz => "tar.xz",
            Format::SevenZ => "7z",
        }
    }

    /// Ce format porte-t-il une arborescence ? (Par opposition à `.gz` et
    /// `.xz`, qui ne compressent qu'un flux — voir `super::compress`.)
    pub fn label(&self) -> &'static str {
        match self {
            Format::Zip => "ZIP",
            Format::Tar => "TAR",
            Format::TarGz => "TAR.GZ",
            Format::TarXz => "TAR.XZ",
            Format::SevenZ => "7z",
        }
    }

    /// Format déduit de l'extension d'un fichier existant.
    pub fn detect(path: &Path) -> Option<Format> {
        let name = path.file_name()?.to_string_lossy().to_lowercase();
        if name.ends_with(".zip") {
            Some(Format::Zip)
        } else if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
            Some(Format::TarGz)
        } else if name.ends_with(".tar.xz") || name.ends_with(".txz") {
            Some(Format::TarXz)
        } else if name.ends_with(".tar") {
            Some(Format::Tar)
        } else if name.ends_with(".7z") {
            Some(Format::SevenZ)
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

    let written = match format {
        Format::Zip => write_zip(members, output, level, total, reporter),
        Format::Tar => write_tar(members, output, Packing::Plain, total, reporter),
        Format::TarGz => write_tar(members, output, Packing::Gzip(level), total, reporter),
        Format::TarXz => write_tar(members, output, Packing::Xz(level), total, reporter),
        Format::SevenZ => write_7z(members, output, total, reporter),
    };
    if let Err(error) = written {
        // Une archive interrompue en cours d'écriture n'est pas une archive :
        // on ne la laisse pas derrière nous sous son nom définitif.
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

/// Enveloppe de compression appliquée au flux TAR.
enum Packing {
    Plain,
    Gzip(u32),
    Xz(u32),
}

fn write_tar(
    members: &[Member],
    output: &Path,
    packing: Packing,
    total: u64,
    reporter: &Reporter,
) -> Result<(), String> {
    let file = File::create(output).map_err(|e| format!("Création impossible : {e}"))?;
    let writer = BufWriter::new(file);

    /// Écrit les membres puis **rend l'enveloppe**, pour que l'appelant puisse
    /// la refermer explicitement. Se contenter de laisser tomber l'encodeur
    /// produirait une archive sans son pied de page : lisible à moitié, donc
    /// pire qu'absente.
    fn append<W: Write>(
        builder: tar::Builder<W>,
        members: &[Member],
        total: u64,
        reporter: &Reporter,
    ) -> Result<W, String> {
        let mut builder = builder;
        let mut done = 0_u64;
        for member in members {
            reporter.check()?;
            let name = safe_relative_path(&member.name)?;
            let mut source = File::open(&member.source).map_err(|e| e.to_string())?;
            builder.append_file(&name, &mut source).map_err(|e| e.to_string())?;
            done += fs::metadata(&member.source).map(|m| m.len()).unwrap_or(0);
            reporter.report(done, total, &member.name);
        }
        builder.into_inner().map_err(|e| e.to_string())
    }

    match packing {
        Packing::Plain => {
            let mut inner = append(tar::Builder::new(writer), members, total, reporter)?;
            inner.flush().map_err(|e| e.to_string())?;
        }
        Packing::Gzip(level) => {
            let encoder = GzEncoder::new(writer, Compression::new(level.clamp(1, 9)));
            let encoder = append(tar::Builder::new(encoder), members, total, reporter)?;
            let mut inner = encoder.finish().map_err(|e| e.to_string())?;
            inner.flush().map_err(|e| e.to_string())?;
        }
        Packing::Xz(level) => {
            let encoder = lzma_rust2::XzWriter::new(
                writer,
                lzma_rust2::XzOptions::with_preset(level.clamp(0, 9)),
            )
            .map_err(|e| e.to_string())?;
            let encoder = append(tar::Builder::new(encoder), members, total, reporter)?;
            let mut inner = encoder.finish().map_err(|e| e.to_string())?;
            inner.flush().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Écrit une archive 7z.
///
/// Le chiffrement 7z n'est volontairement pas proposé : il demande un format
/// d'en-tête chiffré dont la compatibilité avec les autres outils est délicate
/// à garantir, et FourTout dispose déjà d'une archive protégée éprouvée
/// (ZIP AES-256). Mieux vaut un format non chiffré qui s'ouvre partout qu'un
/// chiffrement que l'utilisateur ne pourrait pas relire ailleurs.
fn write_7z(
    members: &[Member],
    output: &Path,
    total: u64,
    reporter: &Reporter,
) -> Result<(), String> {
    let mut writer = sevenz_rust2::ArchiveWriter::create(output)
        .map_err(|e| format!("Création impossible : {e}"))?;
    let mut done = 0_u64;
    for member in members {
        reporter.check()?;
        let name = safe_relative_path(&member.name)?.to_string_lossy().replace('\\', "/");
        let entry = sevenz_rust2::ArchiveEntry::from_path(&member.source, name);
        let source = File::open(&member.source).map_err(|e| e.to_string())?;
        writer
            .push_archive_entry(entry, Some(source))
            .map_err(|e| format!("{} : {e}", member.name))?;
        done += fs::metadata(&member.source).map(|m| m.len()).unwrap_or(0);
        reporter.report(done, total, &member.name);
    }
    writer.finish().map_err(|e| e.to_string())?;
    Ok(())
}


/// Ouvre un flux TAR, quelle que soit son enveloppe de compression.
fn tar_reader(path: &Path, format: Format) -> Result<Box<dyn Read>, String> {
    let file = File::open(path).map_err(|e| format!("Ouverture impossible : {e}"))?;
    let buffered = BufReader::new(file);
    Ok(match format {
        Format::TarGz => Box::new(GzDecoder::new(buffered)),
        Format::TarXz => Box::new(lzma_rust2::XzReader::new(buffered, false)),
        _ => Box::new(buffered),
    })
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
///
/// En deçà, un fort taux de compression est banal — un journal de 10 Mo fait
/// de lignes répétées le dépasse sans rien avoir de suspect. Au-delà, un
/// rapport de plus de 200 pour 1 mérite qu'on prévienne avant d'extraire.
const BOMB_MIN_SIZE: u64 = 64 * 1024 * 1024;
/// Nombre d'entrées au-delà duquel on refuse d'extraire sans confirmation.
pub const MAX_ENTRIES: usize = 200_000;

/// Liste le contenu d'une archive **sans rien extraire**.
pub fn list(path: &Path) -> Result<ArchiveListing, String> {
    let format = Format::detect(path).ok_or_else(|| {
        "Format d'archive non reconnu. Formats pris en charge : ZIP, 7z, TAR, TAR.GZ et TAR.XZ.".to_string()
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
        Format::SevenZ => {
            // L'en-tête d'un 7z suffit à décrire tout son contenu : rien n'est
            // décompressé pour produire cette liste.
            let archive = sevenz_rust2::Archive::open(path)
                .map_err(|e| format!("Archive 7z illisible : {e}"))?;
            for file in &archive.files {
                let raw = file.name.replace('\\', "/");
                let is_dir = file.is_directory;
                entries.push(ArchiveEntry {
                    rejected: check_entry(&raw, is_dir),
                    name: raw,
                    size: file.size,
                    compressed_size: file.compressed_size,
                    is_dir,
                });
            }
        }
        _ => {
            let reader = tar_reader(path, format)?;
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
        Format::SevenZ => {
            let mut archive = sevenz_rust2::ArchiveReader::open(path, Default::default())
                .map_err(|e| format!("Archive 7z illisible : {e}"))?;
            let mut failure: Option<String> = None;
            archive
                .for_each_entries(|entry, reader| {
                    let name = entry.name.replace('\\', "/");
                    match write_entry(
                        &name,
                        entry.is_directory,
                        reader,
                        reporter,
                        &mut bytes,
                        &mut skipped,
                        &mut created,
                    ) {
                        Ok(true) => {
                            extracted += 1;
                            Ok(true)
                        }
                        Ok(false) => Ok(true),
                        Err(error) => {
                            failure = Some(error);
                            Ok(false)
                        }
                    }
                })
                .map_err(|e| format!("Archive 7z illisible : {e}"))?;
            if let Some(error) = failure {
                return Err(rollback(created, error));
            }
        }
        _ => {
            let reader = tar_reader(path, format)?;
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



/// Contrôle de bout en bout d'un flux TAR, éventuellement compressé.
///
/// Deux choses sont vérifiées ici, et nulle part ailleurs :
///
/// - **La somme de contrôle de l'enveloppe.** GZIP et XZ placent la leur *à la
///   fin* du flux. Or le parcours des entrées s'arrête à la marque de fin du
///   TAR, souvent bien avant : sans cette lecture complète, une archive
///   `.tar.gz` abîmée passerait pour saine.
/// - **La marque de fin du TAR lui-même** : deux blocs de 512 octets nuls. Un
///   TAR nu n'a aucune somme de contrôle globale ; s'il est coupé net, la
///   lecture s'arrête simplement, sans erreur, et rien d'autre ne le trahirait.
fn tar_tail_problem(path: &Path, format: Format) -> Result<Option<(Verdict, String)>, String> {
    const BLOCK: usize = 512;
    let mut tail = [0_u8; BLOCK * 2];
    let mut filled = 0_usize;
    let mut total = 0_u64;

    let mut reader = tar_reader(path, format)?;
    let mut buffer = vec![0_u8; 256 * 1024];
    loop {
        let read = match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => read,
            Err(error) => {
                let message = error.to_string();
                let verdict =
                    if looks_truncated(&message) { Verdict::Incomplete } else { Verdict::Corrupt };
                return Ok(Some((
                    verdict,
                    format!("Flux {} illisible jusqu'au bout : {message}", format.label()),
                )));
            }
        };
        total += read as u64;
        let slice = &buffer[..read];
        let window = tail.len();
        if slice.len() >= window {
            tail.copy_from_slice(&slice[slice.len() - window..]);
            filled = window;
        } else {
            tail.copy_within(slice.len().., 0);
            tail[window - slice.len()..].copy_from_slice(slice);
            filled = (filled + slice.len()).min(window);
        }
    }

    if total == 0 {
        return Ok(Some((Verdict::Incomplete, "Le flux TAR est vide.".into())));
    }
    if total % BLOCK as u64 != 0 {
        return Ok(Some((
            Verdict::Incomplete,
            format!("Le flux TAR ne fait pas un nombre entier de blocs de 512 octets ({total})."),
        )));
    }
    if filled < tail.len() || tail.iter().any(|byte| *byte != 0) {
        return Ok(Some((
            Verdict::Incomplete,
            "Le flux TAR ne se termine pas par sa marque de fin : il a été coupé.".into(),
        )));
    }
    Ok(None)
}

/* --------------------------------------------------- test d'intégrité */

/// Verdict porté sur une archive testée.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Verdict {
    /// Toutes les entrées se décompressent et leurs sommes de contrôle passent.
    Valid,
    /// Une entrée au moins est abîmée : somme de contrôle fausse, données illisibles.
    Corrupt,
    /// L'archive s'arrête avant la fin : elle a été tronquée.
    Incomplete,
    /// Le contenu est chiffré : sans mot de passe, il n'y a rien à vérifier.
    Encrypted,
    /// Format hors du périmètre de FourTout (RAR, par exemple).
    Unsupported,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityReport {
    pub path: String,
    pub format: String,
    pub verdict: Verdict,
    /// Entrées effectivement décompressées et vérifiées.
    pub checked: usize,
    /// Octets décompressés pendant le test (rien n'est écrit sur le disque).
    pub bytes: u64,
    /// Détail des entrées fautives.
    pub failures: Vec<String>,
    /// Phrase affichable résumant le verdict.
    pub detail: String,
}

/// Une erreur de lecture signale-t-elle une archive tronquée plutôt qu'abîmée ?
fn looks_truncated(message: &str) -> bool {
    let message = message.to_lowercase();
    message.contains("unexpected end")
        || message.contains("failed to fill whole buffer")
        || message.contains("early eof")
        || message.contains("inattendue")
        || message.contains("unexpected eof")
}

/// Teste réellement une archive : chaque entrée est décompressée et sa somme de
/// contrôle vérifiée, **sans rien écrire sur le disque**.
///
/// C'est la seule façon honnête de répondre à « cette archive est-elle
/// encore bonne ? » : lister ses entrées ne prouve rien, seul l'en-tête serait
/// lu. Le contenu est envoyé dans un puits qui compte les octets et les jette.
pub fn test(
    path: &Path,
    password: Option<&str>,
    reporter: &Reporter,
) -> Result<IntegrityReport, String> {
    let Some(format) = Format::detect(path) else {
        return Ok(IntegrityReport {
            path: path.to_string_lossy().to_string(),
            format: "inconnu".into(),
            verdict: Verdict::Unsupported,
            checked: 0,
            bytes: 0,
            failures: Vec::new(),
            detail: "Format non pris en charge : FourTout teste les archives ZIP, 7z, TAR, TAR.GZ et TAR.XZ."
                .into(),
        });
    };

    let mut checked = 0_usize;
    let mut bytes = 0_u64;
    let mut failures: Vec<String> = Vec::new();
    let mut verdict = Verdict::Valid;
    let mut buffer = vec![0_u8; 256 * 1024];

    // Consomme entièrement un flux d'entrée et rapporte ce qui a mal tourné.
    let consume = |name: &str,
                       reader: &mut dyn Read,
                       bytes: &mut u64,
                       failures: &mut Vec<String>,
                       verdict: &mut Verdict,
                       buffer: &mut [u8]|
     -> Result<(), String> {
        loop {
            reporter.check()?;
            match reader.read(buffer) {
                Ok(0) => return Ok(()),
                Ok(read) => *bytes += read as u64,
                Err(error) => {
                    let message = error.to_string();
                    if *verdict == Verdict::Valid {
                        *verdict = if looks_truncated(&message) {
                            Verdict::Incomplete
                        } else {
                            Verdict::Corrupt
                        };
                    }
                    failures.push(format!("{name} — {message}"));
                    return Ok(());
                }
            }
        }
    };

    match format {
        Format::Zip => {
            let file = File::open(path).map_err(|e| format!("Ouverture impossible : {e}"))?;
            let mut archive = match zip::ZipArchive::new(BufReader::new(file)) {
                Ok(archive) => archive,
                Err(error) => {
                    let message = error.to_string();
                    return Ok(IntegrityReport {
                        path: path.to_string_lossy().to_string(),
                        format: format.label().to_string(),
                        verdict: if looks_truncated(&message) {
                            Verdict::Incomplete
                        } else {
                            Verdict::Corrupt
                        },
                        checked: 0,
                        bytes: 0,
                        failures: vec![message],
                        detail: "Le répertoire central de l'archive est illisible.".into(),
                    });
                }
            };
            let count = archive.len();
            for index in 0..count {
                reporter.check()?;
                reporter.report(index as u64, count as u64, "Vérification des entrées…");
                let opened = match password {
                    Some(password) => archive.by_index_decrypt(index, password.as_bytes()),
                    None => archive.by_index(index),
                };
                let mut entry = match opened {
                    Ok(entry) => entry,
                    Err(zip::result::ZipError::InvalidPassword) => {
                        return Ok(IntegrityReport {
                            path: path.to_string_lossy().to_string(),
                            format: format.label().to_string(),
                            verdict: Verdict::Encrypted,
                            checked,
                            bytes,
                            failures: Vec::new(),
                            detail: "Archive protégée : le mot de passe est nécessaire pour vérifier son contenu."
                                .into(),
                        });
                    }
                    Err(error) => {
                        let message = describe_zip_error(error, password.is_some());
                        if message.contains("mot de passe") {
                            return Ok(IntegrityReport {
                                path: path.to_string_lossy().to_string(),
                                format: format.label().to_string(),
                                verdict: Verdict::Encrypted,
                                checked,
                                bytes,
                                failures: Vec::new(),
                                detail: message,
                            });
                        }
                        if verdict == Verdict::Valid {
                            verdict = Verdict::Corrupt;
                        }
                        failures.push(message);
                        continue;
                    }
                };
                if entry.is_dir() {
                    continue;
                }
                let name = entry.name().to_string();
                // Lire l'entrée jusqu'au bout vérifie son CRC-32 : la
                // bibliothèque échoue à la dernière lecture si elle ne
                // correspond pas.
                consume(&name, &mut entry, &mut bytes, &mut failures, &mut verdict, &mut buffer)?;
                checked += 1;
            }
        }

        Format::SevenZ => {
            let mut archive = match sevenz_rust2::ArchiveReader::open(path, Default::default()) {
                Ok(archive) => archive,
                Err(error) => {
                    let message = error.to_string();
                    return Ok(IntegrityReport {
                        path: path.to_string_lossy().to_string(),
                        format: format.label().to_string(),
                        verdict: if looks_truncated(&message) {
                            Verdict::Incomplete
                        } else {
                            Verdict::Corrupt
                        },
                        checked: 0,
                        bytes: 0,
                        failures: vec![message],
                        detail: "L'en-tête de l'archive 7z est illisible.".into(),
                    });
                }
            };
            let mut interrupted: Option<String> = None;
            let outcome = archive.for_each_entries(|entry, reader| {
                if entry.is_directory {
                    return Ok(true);
                }
                let name = entry.name.clone();
                match consume(
                    &name,
                    reader,
                    &mut bytes,
                    &mut failures,
                    &mut verdict,
                    &mut buffer,
                ) {
                    Ok(()) => {
                        checked += 1;
                        Ok(true)
                    }
                    Err(error) => {
                        interrupted = Some(error);
                        Ok(false)
                    }
                }
            });
            if let Some(error) = interrupted {
                return Err(error);
            }
            if let Err(error) = outcome {
                let message = error.to_string();
                if verdict == Verdict::Valid {
                    verdict =
                        if looks_truncated(&message) { Verdict::Incomplete } else { Verdict::Corrupt };
                }
                failures.push(message);
            }
        }

        _ => {
            if let Some((tail_verdict, problem)) = tar_tail_problem(path, format)? {
                verdict = tail_verdict;
                failures.push(problem);
            }
            let reader = tar_reader(path, format)?;
            let mut archive = tar::Archive::new(reader);
            let entries = match archive.entries() {
                Ok(entries) => entries,
                Err(error) => {
                    return Ok(IntegrityReport {
                        path: path.to_string_lossy().to_string(),
                        format: format.label().to_string(),
                        verdict: Verdict::Corrupt,
                        checked: 0,
                        bytes: 0,
                        failures: vec![error.to_string()],
                        detail: "Le flux TAR est illisible dès son en-tête.".into(),
                    });
                }
            };
            for entry in entries {
                reporter.check()?;
                match entry {
                    Ok(mut entry) => {
                        let name =
                            entry.path().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
                        if entry.header().entry_type().is_dir() {
                            continue;
                        }
                        consume(
                            &name,
                            &mut entry,
                            &mut bytes,
                            &mut failures,
                            &mut verdict,
                            &mut buffer,
                        )?;
                        checked += 1;
                    }
                    Err(error) => {
                        let message = error.to_string();
                        if verdict == Verdict::Valid {
                            verdict = if looks_truncated(&message) {
                                Verdict::Incomplete
                            } else {
                                Verdict::Corrupt
                            };
                        }
                        failures.push(message);
                        break;
                    }
                }
            }
        }
    }

    let detail = match verdict {
        // Le TAR nu est le seul format sans somme de contrôle du contenu : ses
        // en-têtes en ont une, ses données non. Annoncer « valide » sans le
        // dire laisserait croire à une garantie que le format ne donne pas.
        Verdict::Valid if format == Format::Tar => format!(
            "{checked} entrée(s) lue(s) intégralement, {bytes} octets. Structure et en-têtes conformes. \
             Attention : le format TAR ne porte aucune somme de contrôle du contenu — une altération \
             des données d'un fichier y est indétectable. Un TAR.GZ ou un TAR.XZ, eux, sont vérifiables."
        ),
        Verdict::Valid => format!(
            "{checked} entrée(s) décompressée(s) et vérifiée(s), {} octets lus. Aucune anomalie.",
            bytes
        ),
        Verdict::Corrupt => format!(
            "{} entrée(s) abîmée(s) sur {} vérifiée(s) : le contenu ne correspond plus à ses sommes de contrôle.",
            failures.len(),
            checked
        ),
        Verdict::Incomplete => {
            "L'archive s'arrête avant la fin : le fichier a été tronqué (transfert interrompu, copie incomplète).".to_string()
        }
        Verdict::Encrypted => "Archive protégée par mot de passe.".to_string(),
        Verdict::Unsupported => "Format non pris en charge.".to_string(),
    };

    Ok(IntegrityReport {
        path: path.to_string_lossy().to_string(),
        format: format.label().to_string(),
        verdict,
        checked,
        bytes,
        failures,
        detail,
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
    fn sevenz_roundtrip_preserves_tree() {
        roundtrip(Format::SevenZ, "7z");
    }

    #[test]
    fn tarxz_roundtrip_preserves_tree() {
        roundtrip(Format::TarXz, "tarxz");
    }

    #[test]
    fn detects_every_supported_extension() {
        for (name, expected) in [
            ("a.zip", Format::Zip),
            ("a.tar", Format::Tar),
            ("a.tar.gz", Format::TarGz),
            ("a.tgz", Format::TarGz),
            ("a.tar.xz", Format::TarXz),
            ("a.txz", Format::TarXz),
            ("a.7z", Format::SevenZ),
        ] {
            assert_eq!(Format::detect(Path::new(name)), Some(expected), "{name}");
        }
        assert_eq!(Format::detect(Path::new("a.rar")), None);
    }

    /// Fabrique une archive de chaque format à partir de la même source.
    fn build(root: &Path, format: Format) -> PathBuf {
        let members = collect_members(&[root.join("source")], &Reporter::silent()).unwrap();
        let output = root.join(format!("archive.{}", format.extension()));
        create(&members, &output, format, 6, &Reporter::silent()).unwrap();
        output
    }

    #[test]
    fn a_healthy_archive_passes_the_integrity_test() {
        for format in
            [Format::Zip, Format::Tar, Format::TarGz, Format::TarXz, Format::SevenZ]
        {
            let root = workspace(&format!("test-ok-{}", format.extension()));
            seed(&root);
            let archive = build(&root, format);
            let report = test(&archive, None, &Reporter::silent()).unwrap();
            assert_eq!(report.verdict, Verdict::Valid, "{} : {}", format.label(), report.detail);
            assert_eq!(report.checked, 3);
            assert!(report.bytes > 0);
            assert!(report.failures.is_empty());
        }
    }

    #[test]
    fn a_truncated_archive_is_rejected() {
        for format in
            [Format::Zip, Format::Tar, Format::TarGz, Format::TarXz, Format::SevenZ]
        {
            let root = workspace(&format!("test-cut-{}", format.extension()));
            seed(&root);
            let archive = build(&root, format);
            let mut bytes = fs::read(&archive).unwrap();
            bytes.truncate(bytes.len() / 2);
            let broken = root.join(format!("tronquee.{}", format.extension()));
            fs::write(&broken, &bytes).unwrap();

            let report = test(&broken, None, &Reporter::silent()).unwrap();
            assert_ne!(
                report.verdict,
                Verdict::Valid,
                "{} tronquée acceptée à tort : {}",
                format.label(),
                report.detail
            );
        }
    }

    #[test]
    fn a_corrupted_archive_is_rejected() {
        for format in [Format::Zip, Format::TarGz, Format::TarXz, Format::SevenZ] {
            let root = workspace(&format!("test-bitflip-{}", format.extension()));
            seed(&root);
            // Un contenu assez gros pour que le bit retourné tombe dans les
            // données, pas dans un en-tête.
            fs::write(root.join("source/gros.bin"), vec![b'Z'; 200_000]).unwrap();
            let archive = build(&root, format);

            let mut bytes = fs::read(&archive).unwrap();
            let middle = bytes.len() / 2;
            bytes[middle] ^= 0xFF;
            bytes[middle + 1] ^= 0x0F;
            let broken = root.join(format!("abimee.{}", format.extension()));
            fs::write(&broken, &bytes).unwrap();

            let report = test(&broken, None, &Reporter::silent()).unwrap();
            assert_ne!(
                report.verdict,
                Verdict::Valid,
                "{} corrompue acceptée à tort : {}",
                format.label(),
                report.detail
            );
        }
    }

    #[test]
    fn an_encrypted_archive_reports_that_it_needs_a_password() {
        let root = workspace("test-encrypted");
        seed(&root);
        let members = collect_members(&[root.join("source")], &Reporter::silent()).unwrap();
        let output = root.join("protege.zip");
        create_encrypted(&members, &output, 6, "secret", &Reporter::silent()).unwrap();

        let report = test(&output, None, &Reporter::silent()).unwrap();
        assert_eq!(report.verdict, Verdict::Encrypted);

        let report = test(&output, Some("secret"), &Reporter::silent()).unwrap();
        assert_eq!(report.verdict, Verdict::Valid);
        assert_eq!(report.checked, 3);
    }

    #[test]
    fn an_unsupported_format_is_named_as_such() {
        let root = workspace("test-unsupported");
        let fake = root.join("archive.rar");
        fs::write(&fake, b"Rar!\x1a\x07\x00").unwrap();
        let report = test(&fake, None, &Reporter::silent()).unwrap();
        assert_eq!(report.verdict, Verdict::Unsupported);
    }

    #[test]
    fn tar_traversal_entries_are_never_written() {
        let root = workspace("tar-slip");
        let archive_path = root.join("evil.tar");
        {
            let file = File::create(&archive_path).unwrap();
            let mut builder = tar::Builder::new(file);
            for (name, content) in
                [("../../evil.txt", &b"piege"[..]), ("/etc/passwd", b"piege"), ("sain.txt", b"ok")]
            {
                // `set_path` refuse les chemins dangereux : pour fabriquer une
                // archive réellement piégée, le nom est écrit tel quel dans
                // l'en-tête, exactement comme le ferait un outil malveillant.
                let mut header = tar::Header::new_gnu();
                header.set_size(content.len() as u64);
                header.set_mode(0o644);
                header.set_mtime(0);
                let bytes = name.as_bytes();
                header.as_gnu_mut().unwrap().name[..bytes.len()].copy_from_slice(bytes);
                header.set_cksum();
                builder.append(&header, content).unwrap();
            }
            builder.finish().unwrap();
        }

        let listing = list(&archive_path).unwrap();
        assert_eq!(listing.rejected, 2, "{:?}", listing.entries.iter().map(|e| &e.name).collect::<Vec<_>>());

        let destination = root.join("out");
        let summary = extract(&archive_path, &destination, true, &Reporter::silent()).unwrap();
        assert_eq!(summary.extracted, 1);
        assert_eq!(summary.skipped.len(), 2);
        assert!(destination.join("sain.txt").exists());
        assert!(!root.parent().unwrap().join("evil.txt").exists());
    }

    #[test]
    fn sevenz_traversal_entries_are_never_written() {
        let root = workspace("7z-slip");
        let archive_path = root.join("evil.7z");
        {
            let mut writer = sevenz_rust2::ArchiveWriter::create(&archive_path).unwrap();
            for name in ["../../evil.txt", "sain.txt"] {
                let entry = sevenz_rust2::ArchiveEntry::new_file(name);
                writer.push_archive_entry(entry, Some(&b"piege"[..])).unwrap();
            }
            writer.finish().unwrap();
        }

        let listing = list(&archive_path).unwrap();
        assert_eq!(listing.rejected, 1);

        let destination = root.join("out");
        let summary = extract(&archive_path, &destination, true, &Reporter::silent()).unwrap();
        assert_eq!(summary.extracted, 1);
        assert_eq!(summary.skipped.len(), 1);
        assert!(destination.join("sain.txt").exists());
        assert!(!root.parent().unwrap().join("evil.txt").exists());
    }

    #[test]
    fn listing_a_7z_does_not_decompress_it() {
        let root = workspace("7z-listing");
        seed(&root);
        let archive = build(&root, Format::SevenZ);
        let listing = list(&archive).unwrap();
        assert_eq!(listing.format, "7z");
        assert_eq!(listing.files, 3);
        assert!(listing.total_size > 0);
        assert!(listing.entries.iter().any(|entry| entry.name == "source/nested/b.txt"));
    }

    #[test]
    fn an_interrupted_creation_leaves_no_archive_behind() {
        let root = workspace("create-cancel");
        seed(&root);
        let members = collect_members(&[root.join("source")], &Reporter::silent()).unwrap();
        for format in [Format::Zip, Format::Tar, Format::TarGz, Format::SevenZ] {
            let output = root.join(format!("annulee.{}", format.extension()));
            let outcome =
                create(&members, &output, format, 6, &Reporter::silent_cancelled());
            assert!(outcome.is_err(), "{}", format.label());
            assert!(!output.exists(), "{} : archive partielle laissée", format.label());
        }
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
