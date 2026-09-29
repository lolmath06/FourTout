//! Diagnostic et récupération d'archives ZIP.
//!
//! Une archive ZIP se lit normalement **par la fin** : le répertoire central,
//! placé en queue de fichier, dit où trouver chaque entrée. C'est pratique, et
//! c'est le point faible du format : si ces quelques kilo-octets finaux sont
//! abîmés ou absents, tous les lecteurs déclarent l'archive illisible alors que
//! la totalité des données peut être intacte quelques octets plus haut.
//!
//! D'où les deux moitiés de ce module :
//!
//! - le **diagnostic** lit les deux structures séparément — le répertoire
//!   central d'un côté, les en-têtes locaux qui précèdent chaque fichier de
//!   l'autre — et dit laquelle des deux est en cause ;
//! - la **récupération** ignore complètement le répertoire central et balaie
//!   l'archive à la recherche des en-têtes locaux, entrée par entrée.
//!
//! Ce que la récupération ne fait pas : reconstituer un flux compressé
//! physiquement tronqué. Quand les octets manquent, ils manquent — l'entrée est
//! déclarée perdue, avec son motif, et rien n'est écrit pour elle.

use std::io::Write;
use std::path::Path;

use flate2::Crc;
use serde::{Deserialize, Serialize};

use super::{find_from, rfind, Finding, Repairability, Severity};

/// Signatures des structures ZIP.
const LOCAL_HEADER: &[u8; 4] = b"PK\x03\x04";
const CENTRAL_HEADER: &[u8; 4] = b"PK\x01\x02";
const EOCD: &[u8; 4] = b"PK\x05\x06";
const EOCD64_LOCATOR: &[u8; 4] = b"PK\x06\x07";

/// Taille fixe d'un en-tête local, avant le nom et le champ « extra ».
const LOCAL_HEADER_SIZE: usize = 30;
/// Taille fixe d'une entrée du répertoire central.
const CENTRAL_HEADER_SIZE: usize = 46;
/// Taille fixe de la fin de répertoire central, hors commentaire.
const EOCD_SIZE: usize = 22;

fn u16_at(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

fn u32_at(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

/// État d'une entrée, du point de vue de la récupération.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryState {
    /// Décompressée et somme de contrôle vérifiée.
    Recoverable,
    /// Décompressée, mais la somme de contrôle ne correspond pas.
    ChecksumMismatch,
    /// Données absentes, tronquées ou illisibles.
    Lost,
    /// Chiffrée : sans le mot de passe, rien à en tirer.
    Encrypted,
    /// Refusée par les gardes de chemin (traversée de dossier, chemin absolu).
    Rejected,
}

/// Une entrée vue par le balayage des en-têtes locaux.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedEntry {
    pub name: String,
    /// Décalage de l'en-tête local dans le fichier.
    pub offset: u64,
    /// Méthode de compression : 0 = stocké, 8 = DEFLATE.
    pub method: u16,
    pub compressed_size: u64,
    pub uncompressed_size: u64,
    /// Somme de contrôle annoncée par l'en-tête.
    pub declared_crc: u32,
    /// Somme de contrôle réellement calculée, si l'entrée a pu être lue.
    pub actual_crc: Option<u32>,
    pub state: EntryState,
    /// Motif, quand l'entrée n'est pas récupérable.
    pub reason: Option<String>,
    pub is_dir: bool,
}

/// Détail du diagnostic, joint au rapport générique.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipDetails {
    /// Fin de répertoire central trouvée, et à quel décalage.
    pub eocd_offset: Option<u64>,
    /// Nombre d'entrées annoncé par le répertoire central.
    pub declared_entries: Option<u32>,
    /// Décalage annoncé du répertoire central.
    pub central_directory_offset: Option<u64>,
    /// Entrées effectivement lues dans le répertoire central.
    pub central_entries: usize,
    /// En-têtes locaux trouvés par balayage.
    pub local_headers: usize,
    /// Octets parasites après la fin de l'archive.
    pub trailing_bytes: u64,
    /// L'archive annonce-t-elle du chiffrement ?
    pub encrypted: bool,
    /// Format ZIP64.
    pub zip64: bool,
    pub entries: Vec<ScannedEntry>,
    /// Total des octets décompressés lors du balayage de vérification.
    pub recoverable_bytes: u64,
}

/// Lit le répertoire central, s'il est lisible.
///
/// Renvoie les noms trouvés : on ne cherche pas ici à en extraire quoi que ce
/// soit, seulement à savoir si cette moitié du format tient debout.
fn read_central_directory(bytes: &[u8], offset: usize, count: u32) -> (usize, bool) {
    let mut position = offset;
    let mut read = 0_usize;
    let mut encrypted = false;

    while read < count as usize {
        if position + CENTRAL_HEADER_SIZE > bytes.len() {
            break;
        }
        if &bytes[position..position + 4] != CENTRAL_HEADER {
            break;
        }
        let flags = u16_at(bytes, position + 8);
        if flags & 1 != 0 {
            encrypted = true;
        }
        let name_len = u16_at(bytes, position + 28) as usize;
        let extra_len = u16_at(bytes, position + 30) as usize;
        let comment_len = u16_at(bytes, position + 32) as usize;
        position += CENTRAL_HEADER_SIZE + name_len + extra_len + comment_len;
        read += 1;
    }
    (read, encrypted)
}

/// Balaie les en-têtes locaux du début à la fin, sans jamais consulter le
/// répertoire central.
///
/// C'est le cœur de la récupération : chaque en-tête local porte le nom, la
/// méthode et les tailles de son entrée, juste avant les données. Une archive
/// dont la queue a disparu reste donc entièrement lisible par l'avant.
pub fn scan_local_headers(bytes: &[u8], verify: bool) -> Vec<ScannedEntry> {
    let mut entries = Vec::new();
    let mut position = 0_usize;

    while let Some(found) = find_from(bytes, LOCAL_HEADER, position) {
        if found + LOCAL_HEADER_SIZE > bytes.len() {
            break;
        }
        let flags = u16_at(bytes, found + 6);
        let method = u16_at(bytes, found + 8);
        let declared_crc = u32_at(bytes, found + 14);
        let compressed = u32_at(bytes, found + 18) as u64;
        let uncompressed = u32_at(bytes, found + 22) as u64;
        let name_len = u16_at(bytes, found + 26) as usize;
        let extra_len = u16_at(bytes, found + 28) as usize;

        let name_start = found + LOCAL_HEADER_SIZE;
        let name_end = name_start + name_len;
        if name_end > bytes.len() {
            break;
        }
        let name = String::from_utf8_lossy(&bytes[name_start..name_end]).to_string();
        let data_start = name_end + extra_len;
        let is_dir = name.ends_with('/');

        // Le bit 3 signale que les tailles sont écrites *après* les données,
        // dans un descripteur. L'en-tête local porte alors des zéros : la seule
        // façon de savoir où l'entrée s'arrête est de décompresser jusqu'au
        // bout du flux.
        let deferred_sizes = flags & 0x0008 != 0 && compressed == 0;
        let encrypted = flags & 1 != 0;

        let mut entry = ScannedEntry {
            name: name.clone(),
            offset: found as u64,
            method,
            compressed_size: compressed,
            uncompressed_size: uncompressed,
            declared_crc,
            actual_crc: None,
            state: EntryState::Recoverable,
            reason: None,
            is_dir,
        };

        if is_dir {
            entry.state = EntryState::Recoverable;
            entries.push(entry);
            position = data_start.max(found + 4);
            continue;
        }

        if encrypted {
            entry.state = EntryState::Encrypted;
            entry.reason = Some(
                "Entrée chiffrée : son contenu ne peut pas être lu sans le mot de passe."
                    .to_string(),
            );
            entries.push(entry);
            position = found + 4;
            continue;
        }

        if verify {
            match extract_entry(bytes, data_start, method, compressed, deferred_sizes) {
                Ok((data, consumed)) => {
                    let mut crc = Crc::new();
                    crc.update(&data);
                    let actual = crc.sum();
                    entry.actual_crc = Some(actual);
                    entry.uncompressed_size = data.len() as u64;
                    if compressed > 0 {
                        entry.compressed_size = compressed;
                    } else {
                        entry.compressed_size = consumed as u64;
                    }
                    // Un descripteur différé laisse une somme de contrôle nulle
                    // dans l'en-tête : on ne peut alors rien comparer, et
                    // prétendre le contraire serait un mensonge commode.
                    if declared_crc != 0 && actual != declared_crc {
                        entry.state = EntryState::ChecksumMismatch;
                        entry.reason = Some(format!(
                            "Somme de contrôle attendue {declared_crc:08X}, obtenue {actual:08X} : \
                             les données décompressées ne sont pas celles d'origine."
                        ));
                    }
                    position = (data_start + consumed).max(found + 4);
                }
                Err(reason) => {
                    entry.state = EntryState::Lost;
                    entry.reason = Some(reason);
                    position = found + 4;
                }
            }
        } else {
            position = if compressed > 0 { data_start + compressed as usize } else { found + 4 };
        }

        entries.push(entry);
        if position <= found {
            position = found + 4;
        }
    }

    entries
}

/// Décompresse une entrée à partir de ses octets bruts.
///
/// Renvoie les données et le nombre d'octets compressés consommés — cette
/// seconde valeur est indispensable quand l'en-tête ne déclare pas les tailles.
fn extract_entry(
    bytes: &[u8],
    data_start: usize,
    method: u16,
    compressed: u64,
    deferred_sizes: bool,
) -> Result<(Vec<u8>, usize), String> {
    if data_start > bytes.len() {
        return Err("Les données de cette entrée commencent après la fin du fichier : \
                    l'archive est tronquée."
            .to_string());
    }

    match method {
        0 => {
            if deferred_sizes {
                return Err(
                    "Entrée stockée sans taille déclarée : impossible de savoir où elle \
                     s'arrête sans le répertoire central."
                        .to_string(),
                );
            }
            let end = data_start + compressed as usize;
            if end > bytes.len() {
                return Err(format!(
                    "Entrée tronquée : {} octets attendus, {} disponibles.",
                    compressed,
                    bytes.len().saturating_sub(data_start)
                ));
            }
            Ok((bytes[data_start..end].to_vec(), compressed as usize))
        }
        8 => {
            // Le décompresseur bas niveau est employé pour sa comptabilité :
            // `total_in` dit exactement combien d'octets compressés le flux a
            // consommés, ce qu'un lecteur de plus haut niveau n'expose pas.
            let available = if deferred_sizes || compressed == 0 {
                &bytes[data_start..]
            } else {
                let end = (data_start + compressed as usize).min(bytes.len());
                &bytes[data_start..end]
            };

            let mut decompressor = flate2::Decompress::new(false);
            let mut output = Vec::new();
            let mut buffer = vec![0_u8; 64 * 1024];
            let mut consumed = 0_usize;

            loop {
                let before_in = decompressor.total_in();
                let before_out = decompressor.total_out();
                let status = decompressor
                    .decompress(&available[consumed..], &mut buffer, flate2::FlushDecompress::None)
                    .map_err(|error| {
                        format!("Flux compressé illisible : {error}. Les données sont abîmées.")
                    })?;
                let read = (decompressor.total_in() - before_in) as usize;
                let written = (decompressor.total_out() - before_out) as usize;
                consumed += read;
                output.extend_from_slice(&buffer[..written]);

                match status {
                    flate2::Status::StreamEnd => break,
                    flate2::Status::Ok | flate2::Status::BufError => {
                        if read == 0 && written == 0 {
                            return Err(
                                "Flux compressé interrompu avant sa fin : l'entrée est tronquée."
                                    .to_string(),
                            );
                        }
                        if consumed >= available.len() {
                            return Err(
                                "Flux compressé interrompu avant sa fin : l'entrée est tronquée."
                                    .to_string(),
                            );
                        }
                    }
                }
            }
            Ok((output, consumed))
        }
        other => Err(format!(
            "Méthode de compression {other} non prise en charge par la récupération \
             (FourTout récupère les entrées stockées et DEFLATE)."
        )),
    }
}

/// Diagnostic complet d'une archive ZIP.
pub fn diagnose(bytes: &[u8]) -> (Vec<Finding>, ZipDetails) {
    let mut findings = Vec::new();
    let mut details = ZipDetails::default();

    if bytes.len() < 4 {
        findings.push(Finding::error(
            "zip.empty",
            "Fichier vide ou tronqué à l'extrême",
            "Ce fichier ne contient même pas la signature d'une archive ZIP.",
            Repairability::None,
        ));
        return (findings, details);
    }

    // 1. La fin de répertoire central, cherchée depuis la queue.
    let search_start = bytes.len().saturating_sub(super::TAIL_BYTES + EOCD_SIZE);
    let eocd = rfind(&bytes[search_start..], EOCD).map(|position| position + search_start);
    details.zip64 = rfind(&bytes[search_start..], EOCD64_LOCATOR).is_some();

    if let Some(offset) = eocd {
        details.eocd_offset = Some(offset as u64);
        if offset + EOCD_SIZE <= bytes.len() {
            let count = u32::from(u16_at(bytes, offset + 10));
            let cd_size = u32_at(bytes, offset + 12) as usize;
            let cd_offset = u32_at(bytes, offset + 16) as usize;
            let comment_len = u16_at(bytes, offset + 20) as usize;
            details.declared_entries = Some(count);
            details.central_directory_offset = Some(cd_offset as u64);

            // Octets au-delà de ce que l'archive déclare contenir.
            let declared_end = offset + EOCD_SIZE + comment_len;
            if declared_end < bytes.len() {
                details.trailing_bytes = (bytes.len() - declared_end) as u64;
                findings.push(Finding::warning(
                    "zip.trailing-garbage",
                    "Données parasites après la fin de l'archive",
                    format!(
                        "{} octets suivent la fin déclarée de l'archive. Beaucoup de lecteurs les \
                         tolèrent, certains refusent le fichier. Les retirer est une opération \
                         sans perte : les données de l'archive ne sont pas touchées.",
                        details.trailing_bytes
                    ),
                    Repairability::SafeRepair,
                ));
            }

            if cd_offset >= bytes.len() || cd_offset + cd_size > bytes.len() {
                findings.push(Finding::error(
                    "zip.central-directory-out-of-range",
                    "Répertoire central hors du fichier",
                    format!(
                        "La fin d'archive annonce un répertoire central à l'octet {cd_offset}, \
                         alors que le fichier n'en compte que {}. Les entrées restent \
                         récupérables par balayage des en-têtes locaux.",
                        bytes.len()
                    ),
                    Repairability::RecoverPartial,
                ));
            } else {
                let (read, encrypted) = read_central_directory(bytes, cd_offset, count);
                details.central_entries = read;
                details.encrypted = encrypted;
                if read < count as usize {
                    findings.push(Finding::error(
                        "zip.central-directory-corrupt",
                        "Répertoire central incomplet",
                        format!(
                            "L'archive annonce {count} entrées, mais seules {read} ont pu être \
                             lues dans le répertoire central. Les données elles-mêmes peuvent \
                             être intactes : elles sont situées plus haut dans le fichier."
                        ),
                        Repairability::RecoverPartial,
                    ));
                }
            }
        }
    } else {
        findings.push(Finding::error(
            "zip.no-eocd",
            "Fin de répertoire central absente",
            "Aucune structure de fin d'archive n'a été trouvée. C'est ce qui fait dire à la \
             plupart des lecteurs que le fichier « n'est pas une archive » — alors que les \
             données peuvent être entièrement intactes, puisqu'elles précèdent cette structure.",
            Repairability::RecoverPartial,
        ));
    }

    // 2. Les en-têtes locaux, balayés depuis le début, sans vérification de
    //    contenu : le diagnostic doit rester rapide.
    let scanned = scan_local_headers(bytes, false);
    details.local_headers = scanned.len();

    if scanned.is_empty() {
        findings.push(Finding::error(
            "zip.no-local-headers",
            "Aucun en-tête d'entrée trouvé",
            "Le balayage n'a trouvé aucune signature d'entrée ZIP. Rien ne peut être récupéré \
             de ce fichier.",
            Repairability::None,
        ));
        return (findings, details);
    }

    // 3. Troncature : la dernière entrée déborde-t-elle du fichier ?
    if let Some(last) = scanned.last() {
        let declared_end = last.offset + LOCAL_HEADER_SIZE as u64 + last.compressed_size;
        if declared_end > bytes.len() as u64 {
            findings.push(Finding::error(
                "zip.truncated",
                "Archive tronquée",
                format!(
                    "La dernière entrée (« {} ») annonce des données qui s'étendent au-delà de la \
                     fin du fichier. Le contenu manquant n'existe nulle part : il ne sera pas \
                     reconstitué. Les entrées précédentes restent récupérables.",
                    last.name
                ),
                Repairability::RecoverPartial,
            ));
        }
    }

    if let (Some(declared), local) = (details.declared_entries, details.local_headers) {
        if declared as usize != local && details.central_entries == declared as usize {
            findings.push(Finding::warning(
                "zip.entry-count-mismatch",
                "Nombre d'entrées incohérent",
                format!(
                    "Le répertoire central annonce {declared} entrées, le balayage en trouve \
                     {local}. L'une des deux structures ne décrit pas la même archive."
                ),
                Repairability::RecoverPartial,
            ));
        }
    }

    if details.encrypted {
        findings.push(Finding::warning(
            "zip.encrypted",
            "Archive protégée par mot de passe",
            "Au moins une entrée est chiffrée. Son contenu ne peut pas être récupéré sans le \
             mot de passe, et FourTout ne tentera pas de le deviner.",
            Repairability::None,
        ));
    }

    if findings.is_empty() {
        findings.push(Finding::info(
            "zip.healthy",
            "Structure conforme",
            format!(
                "Répertoire central et en-têtes locaux concordent : {} entrées décrites de part \
                 et d'autre.",
                details.local_headers
            ),
        ));
    }

    (findings, details)
}

/// Ce qu'une récupération a produit.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryResult {
    pub output: String,
    pub recovered: usize,
    pub lost: usize,
    pub recovered_bytes: u64,
    pub entries: Vec<ScannedEntry>,
}

/// Sortie demandée pour une récupération.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecoveryMode {
    /// Écrire les entrées récupérées dans un dossier.
    Folder,
    /// Reconstruire une archive ZIP saine ne contenant que ce qui est lisible.
    Archive,
}

/// Récupère ce qui est lisible d'une archive, par balayage des en-têtes locaux.
///
/// Le fichier source n'est ouvert qu'en lecture, et la sortie est un chemin
/// distinct : il n'existe aucun chemin de code capable de réécrire l'archive
/// d'origine.
pub fn recover(
    bytes: &[u8],
    destination: &Path,
    mode: RecoveryMode,
    reporter: &crate::files::Reporter,
) -> Result<RecoveryResult, String> {
    let scanned = scan_local_headers(bytes, true);
    let total = scanned.len().max(1);

    let mut entries: Vec<ScannedEntry> = Vec::with_capacity(scanned.len());
    let mut recovered_bytes = 0_u64;

    // Les entrées récupérées sont d'abord rassemblées, puis écrites : une
    // annulation en cours de route ne laisse ainsi aucune sortie partielle
    // présentée comme terminée.
    let mut payloads: Vec<(String, Vec<u8>)> = Vec::new();

    for (index, entry) in scanned.into_iter().enumerate() {
        reporter.check()?;
        reporter.report(index as u64, total as u64, &format!("Lecture de {}", entry.name));

        let mut entry = entry;
        if entry.is_dir || entry.state != EntryState::Recoverable {
            entries.push(entry);
            continue;
        }

        // Les gardes de chemin de la phase 9 s'appliquent telles quelles. Une
        // archive cassée n'autorise aucun relâchement : c'est même exactement
        // le genre de fichier dans lequel on glisse un chemin hostile.
        let relative = match crate::files::safe_relative_path(&entry.name) {
            Ok(path) => path,
            Err(reason) => {
                entry.state = EntryState::Rejected;
                entry.reason = Some(reason);
                entries.push(entry);
                continue;
            }
        };

        let flags_offset = entry.offset as usize + 6;
        let flags = if flags_offset + 2 <= bytes.len() { u16_at(bytes, flags_offset) } else { 0 };
        let name_len = u16_at(bytes, entry.offset as usize + 26) as usize;
        let extra_len = u16_at(bytes, entry.offset as usize + 28) as usize;
        let data_start = entry.offset as usize + LOCAL_HEADER_SIZE + name_len + extra_len;
        let declared = u32_at(bytes, entry.offset as usize + 18) as u64;

        match extract_entry(bytes, data_start, entry.method, declared, flags & 0x0008 != 0 && declared == 0) {
            Ok((data, _)) => {
                recovered_bytes += data.len() as u64;
                payloads.push((relative.to_string_lossy().replace('\\', "/"), data));
                entries.push(entry);
            }
            Err(reason) => {
                entry.state = EntryState::Lost;
                entry.reason = Some(reason);
                entries.push(entry);
            }
        }
    }

    reporter.check()?;

    let output = match mode {
        RecoveryMode::Folder => {
            std::fs::create_dir_all(destination)
                .map_err(|e| format!("Dossier de destination impossible à créer : {e}"))?;
            for (name, data) in &payloads {
                let target = crate::files::resolve_inside(destination, name)?;
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| format!("Dossier impossible à créer : {e}"))?;
                }
                std::fs::write(&target, data)
                    .map_err(|e| format!("Écriture impossible ({name}) : {e}"))?;
            }
            destination.to_path_buf()
        }
        RecoveryMode::Archive => {
            let file = std::fs::File::create(destination)
                .map_err(|e| format!("Archive de sortie impossible à créer : {e}"))?;
            let mut writer = ::zip::ZipWriter::new(std::io::BufWriter::new(file));
            let options: ::zip::write::FileOptions<'_, ()> = ::zip::write::FileOptions::default()
                .compression_method(::zip::CompressionMethod::Deflated);
            for (name, data) in &payloads {
                writer
                    .start_file(name.as_str(), options)
                    .map_err(|e| format!("Entrée impossible à écrire ({name}) : {e}"))?;
                writer
                    .write_all(data)
                    .map_err(|e| format!("Écriture impossible ({name}) : {e}"))?;
            }
            writer.finish().map_err(|e| format!("Archive impossible à fermer : {e}"))?;
            destination.to_path_buf()
        }
    };

    let recovered = payloads.len();
    let lost = entries
        .iter()
        .filter(|entry| !entry.is_dir && entry.state != EntryState::Recoverable)
        .count();

    Ok(RecoveryResult {
        output: output.to_string_lossy().to_string(),
        recovered,
        lost,
        recovered_bytes,
        entries,
    })
}

/// Retire les octets parasites situés après la fin déclarée de l'archive.
///
/// Opération strictement sans perte : on recopie les octets jusqu'à la fin de
/// la structure de fin d'archive, et pas un de plus.
pub fn strip_trailing(bytes: &[u8], destination: &Path) -> Result<u64, String> {
    let search_start = bytes.len().saturating_sub(super::TAIL_BYTES + EOCD_SIZE);
    let offset = rfind(&bytes[search_start..], EOCD)
        .map(|position| position + search_start)
        .ok_or_else(|| "Aucune fin de répertoire central : rien à rogner.".to_string())?;
    let comment_len = u16_at(bytes, offset + 20) as usize;
    let end = offset + EOCD_SIZE + comment_len;
    if end >= bytes.len() {
        return Err("Aucune donnée parasite après la fin de l'archive.".to_string());
    }
    std::fs::write(destination, &bytes[..end])
        .map_err(|e| format!("Écriture impossible : {e}"))?;
    Ok((bytes.len() - end) as u64)
}

/// Vrai si le fichier commence par une signature ZIP.
pub fn looks_like_zip(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && (&bytes[..4] == LOCAL_HEADER || &bytes[..4] == EOCD || &bytes[..4] == CENTRAL_HEADER)
}

/// Résume un diagnostic en une phrase, sans jamais confondre les mots.
pub fn summarize(details: &ZipDetails, findings: &[Finding]) -> String {
    let broken = findings.iter().any(|f| f.severity == Severity::Error);
    if !broken {
        return format!("Archive lisible : {} entrées.", details.local_headers);
    }
    format!(
        "Structure abîmée. {} en-tête(s) d'entrée retrouvé(s) par balayage : c'est à partir \
         d'eux que la récupération travaillera.",
        details.local_headers
    )
}
