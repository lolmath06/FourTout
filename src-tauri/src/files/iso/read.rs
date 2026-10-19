//! Lecture d'une image ISO 9660 : inspection (sans toucher aux données) et
//! extraction (chaque nom de l'image est tenu pour hostile).
//!
//! L'image est une entrée non fiable. Chaque lecture est donc bornée : une
//! extension ne sort jamais du fichier, un répertoire qui se contient lui-même
//! est détecté, la profondeur et le nombre d'entrées sont plafonnés.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::{days_from_civil, le16, le32, MAX_ENTRIES, SECTOR, STANDARD_ID, SYSTEM_AREA_SECTORS};
use crate::files::archive::ExtractSummary;
use crate::files::{unique_path, Reporter};

const MAX_DEPTH: usize = 128;
/// Un répertoire plus gros que cela n'est pas un répertoire.
const MAX_DIRECTORY_BYTES: u64 = 64 * 1024 * 1024;
/// Zones de continuation Rock Ridge suivies pour un même enregistrement.
const MAX_CONTINUATIONS: usize = 8;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IsoEntry {
    /// Chemin complet, séparé par `/`.
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    /// Secondes Unix, 0 si l'image n'en donne pas.
    pub modified: i64,
    pub symlink: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootEntry {
    pub bootable: bool,
    /// `no-emulation`, `floppy-1.44`, `hard-disk`…
    pub media: String,
    pub load_segment: u16,
    pub system_type: u8,
    pub sectors: u16,
    pub load_lba: u32,
    /// Fichier de l'image qui commence à ce secteur, quand on le retrouve.
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootInfo {
    /// `bios`, `efi`, `powerpc`, `mac` ou `unknown`.
    pub platforms: Vec<String>,
    pub catalog_lba: u32,
    pub validation_ok: bool,
    pub id_string: String,
    pub entries: Vec<BootEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IsoInfo {
    pub path: String,
    pub file_size: u64,
    pub label: String,
    pub system_id: String,
    pub publisher: String,
    pub preparer: String,
    pub application: String,
    pub created: i64,
    pub modified: i64,
    /// Taille déclarée du volume (secteurs × 2 048).
    pub volume_bytes: u64,
    /// `iso9660`, `joliet`, `rock-ridge`, `el-torito`, `udf`.
    pub features: Vec<String>,
    /// Arborescence lue : celle qui conserve le mieux les noms.
    pub tree: String,
    pub entries: Vec<IsoEntry>,
    pub files: u64,
    pub directories: u64,
    pub total_bytes: u64,
    /// Des entrées existent au-delà de celles listées.
    pub truncated: bool,
    pub boot: Option<BootInfo>,
    pub hybrid_mbr: bool,
    pub gpt: bool,
    pub warnings: Vec<String>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Naming {
    RockRidge,
    Joliet,
    Plain,
}

#[derive(Debug, Clone)]
struct Record {
    extent: u32,
    length: u32,
    flags: u8,
    id: Vec<u8>,
    su: Vec<u8>,
    date: i64,
}

#[derive(Debug, Clone)]
struct Descriptor {
    label: String,
    system_id: String,
    publisher: String,
    preparer: String,
    application: String,
    created: i64,
    modified: i64,
    blocks: u32,
    root: Record,
}

#[derive(Debug, Clone)]
struct Item {
    entry: IsoEntry,
    extents: Vec<(u32, u32)>,
}

struct Volume {
    file: File,
    len: u64,
    primary: Descriptor,
    joliet: Option<Descriptor>,
    rock_ridge: bool,
    udf: bool,
    boot_catalog: Option<u32>,
    warnings: Vec<String>,
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim_end_matches([' ', '\0']).to_string()
}

fn ucs2(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
    String::from_utf16_lossy(&units).trim_end_matches([' ', '\0']).to_string()
}

fn volume_date(bytes: &[u8]) -> i64 {
    let digits = &bytes[..16.min(bytes.len())];
    if digits.len() < 16 || !digits.iter().all(u8::is_ascii_digit) {
        return 0;
    }
    let number = |from: usize, to: usize| -> i64 {
        std::str::from_utf8(&digits[from..to]).ok().and_then(|s| s.parse().ok()).unwrap_or(0)
    };
    let (year, month, day) = (number(0, 4), number(4, 6), number(6, 8));
    if year == 0 || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return 0;
    }
    let offset = bytes.get(16).map(|&b| b as i8 as i64 * 900).unwrap_or(0);
    days_from_civil(year, month, day) * 86_400 + number(8, 10) * 3600 + number(10, 12) * 60 + number(12, 14) - offset
}

fn record_date(bytes: &[u8]) -> i64 {
    if bytes.len() < 7 || bytes[1] == 0 || bytes[1] > 12 || bytes[2] == 0 {
        return 0;
    }
    let offset = bytes[6] as i8 as i64 * 900;
    days_from_civil(1900 + bytes[0] as i64, bytes[1] as i64, bytes[2] as i64) * 86_400
        + bytes[3] as i64 * 3600
        + bytes[4] as i64 * 60
        + bytes[5] as i64
        - offset
}

fn parse_record(buffer: &[u8]) -> Option<Record> {
    let length = *buffer.first()? as usize;
    if length < 34 || length > buffer.len() {
        return None;
    }
    let id_len = buffer[32] as usize;
    if id_len == 0 || 33 + id_len > length {
        return None;
    }
    let su_start = 33 + id_len + usize::from(id_len % 2 == 0);
    Some(Record {
        extent: le32(&buffer[2..6]),
        length: le32(&buffer[10..14]),
        flags: buffer[25],
        id: buffer[33..33 + id_len].to_vec(),
        su: if su_start < length { buffer[su_start..length].to_vec() } else { Vec::new() },
        date: record_date(&buffer[18..25]),
    })
}

fn parse_descriptor(sector: &[u8], joliet: bool) -> Result<Descriptor, String> {
    let read = |from: usize, to: usize| if joliet { ucs2(&sector[from..to]) } else { text(&sector[from..to]) };
    if le16(&sector[128..130]) as u64 != SECTOR {
        return Err("Taille de bloc logique non prise en charge (seuls les blocs de 2 048 octets le sont).".into());
    }
    let root = parse_record(&sector[156..190]).ok_or("Répertoire racine illisible : image corrompue.")?;
    Ok(Descriptor {
        label: read(40, 72),
        system_id: read(8, 40),
        publisher: read(318, 446),
        preparer: read(446, 574),
        application: read(574, 702),
        created: volume_date(&sector[813..830]),
        modified: volume_date(&sector[830..847]),
        blocks: le32(&sector[80..84]),
        root,
    })
}

/* ------------------------------------------------------------ SUSP */

#[derive(Default)]
struct Susp {
    name: Option<String>,
    mode: Option<u32>,
    symlink: bool,
    relocated: bool,
    child_link: Option<u32>,
}

impl Volume {
    fn read_at(&mut self, offset: u64, length: usize) -> Result<Vec<u8>, String> {
        if offset.checked_add(length as u64).is_none_or(|end| end > self.len) {
            return Err("Lecture au-delà de la fin de l'image : fichier tronqué ou corrompu.".into());
        }
        self.file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
        let mut buffer = vec![0_u8; length];
        self.file.read_exact(&mut buffer).map_err(|e| format!("Lecture impossible : {e}"))?;
        Ok(buffer)
    }

    fn open(path: &Path) -> Result<Self, String> {
        let mut file = File::open(path).map_err(|e| format!("Image illisible : {e}"))?;
        let len = file.metadata().map_err(|e| e.to_string())?.len();
        if len < (SYSTEM_AREA_SECTORS as u64 + 1) * SECTOR {
            return Err("Ce fichier est trop petit pour être une image ISO 9660.".into());
        }

        let mut volume = Volume {
            file: file.try_clone().map_err(|e| e.to_string())?,
            len,
            primary: Descriptor {
                label: String::new(),
                system_id: String::new(),
                publisher: String::new(),
                preparer: String::new(),
                application: String::new(),
                created: 0,
                modified: 0,
                blocks: 0,
                root: Record { extent: 0, length: 0, flags: 2, id: vec![0], su: Vec::new(), date: 0 },
            },
            joliet: None,
            rock_ridge: false,
            udf: false,
            boot_catalog: None,
            warnings: Vec::new(),
        };
        file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;

        let mut primary: Option<Descriptor> = None;
        let mut sector = SYSTEM_AREA_SECTORS as u64;
        // Les descripteurs se suivent jusqu'au terminateur ; 64 secteurs de plus
        // que la norme n'en connaît suffisent à toute image réelle.
        while sector < SYSTEM_AREA_SECTORS as u64 + 64 && (sector + 1) * SECTOR <= len {
            let data = volume.read_at(sector * SECTOR, SECTOR as usize)?;
            let known = &data[1..6] == STANDARD_ID;
            let udf = matches!(&data[1..6], b"BEA01" | b"NSR02" | b"NSR03" | b"TEA01");
            if udf {
                volume.udf = true;
            }
            if !known {
                if udf {
                    sector += 1;
                    continue;
                }
                break;
            }
            match data[0] {
                0 if text(&data[7..39]).starts_with("EL TORITO SPECIFICATION") => {
                    volume.boot_catalog = Some(le32(&data[71..75]));
                }
                1 if primary.is_none() => primary = Some(parse_descriptor(&data, false)?),
                2 if volume.joliet.is_none() && matches!(&data[88..91], b"%/@" | b"%/C" | b"%/E") => {
                    volume.joliet = Some(parse_descriptor(&data, true)?);
                }
                255 => {
                    sector += 1;
                    // D'éventuels descripteurs UDF suivent le terminateur.
                    continue;
                }
                _ => {}
            }
            sector += 1;
        }
        volume.primary = primary.ok_or("Aucun descripteur de volume ISO 9660 : ce n'est pas une image ISO valide.")?;

        // La racine annonce Rock Ridge par une entrée SP dans son « . ».
        let root = volume.primary.root.clone();
        if let Some(dot) = volume.read_directory(&root)?.into_iter().next() {
            volume.rock_ridge = dot.su.starts_with(&[b'S', b'P']) || find_signature(&dot.su, b"SP");
        }
        Ok(volume)
    }

    fn naming(&self) -> Naming {
        if self.rock_ridge {
            Naming::RockRidge
        } else if self.joliet.is_some() {
            Naming::Joliet
        } else {
            Naming::Plain
        }
    }

    /// Enregistrements d'un répertoire, « . » et « .. » compris.
    fn read_directory(&mut self, dir: &Record) -> Result<Vec<Record>, String> {
        if dir.length as u64 > MAX_DIRECTORY_BYTES {
            return Err("Répertoire démesuré : image corrompue ou piégée.".into());
        }
        let data = self.read_at(dir.extent as u64 * SECTOR, dir.length as usize)?;
        let mut records = Vec::new();
        let mut at = 0_usize;
        while at < data.len() {
            let length = data[at] as usize;
            if length == 0 {
                // Fin des enregistrements de ce secteur.
                at = (at / SECTOR as usize + 1) * SECTOR as usize;
                continue;
            }
            if at / SECTOR as usize != (at + length - 1) / SECTOR as usize {
                return Err("Enregistrement de répertoire à cheval sur deux secteurs : image corrompue.".into());
            }
            let Some(record) = data.get(at..at + length).and_then(parse_record) else {
                return Err("Enregistrement de répertoire invalide : image corrompue.".into());
            };
            records.push(record);
            at += length;
            if records.len() > MAX_ENTRIES {
                return Err("Répertoire démesuré : image corrompue ou piégée.".into());
            }
        }
        Ok(records)
    }

    fn susp(&mut self, record: &Record) -> Susp {
        let mut out = Susp::default();
        let mut name_bytes: Vec<u8> = Vec::new();
        let mut areas = vec![record.su.clone()];
        let mut index = 0;
        let mut followed = 0;
        while index < areas.len() {
            let area = areas[index].clone();
            index += 1;
            let mut at = 0_usize;
            while at + 4 <= area.len() {
                let length = area[at + 2] as usize;
                if length < 4 || at + length > area.len() {
                    break;
                }
                let body = &area[at + 4..at + length];
                match &area[at..at + 2] {
                    b"NM" if !body.is_empty() => {
                        // Les drapeaux « . » et « .. » ne portent pas de nom.
                        if body[0] & 0x06 == 0 {
                            name_bytes.extend_from_slice(&body[1..]);
                        }
                    }
                    b"PX" if body.len() >= 4 => out.mode = Some(le32(body)),
                    b"SL" => out.symlink = true,
                    b"RE" => out.relocated = true,
                    b"CL" if body.len() >= 4 => out.child_link = Some(le32(body)),
                    b"CE" if body.len() >= 24 && followed < MAX_CONTINUATIONS => {
                        followed += 1;
                        let (block, offset, size) = (le32(body), le32(&body[8..]), le32(&body[16..]));
                        if size <= 4 * SECTOR as u32 {
                            if let Ok(bytes) = self.read_at(block as u64 * SECTOR + offset as u64, size as usize) {
                                areas.push(bytes);
                            }
                        }
                    }
                    b"ST" => break,
                    _ => {}
                }
                at += length;
            }
        }
        if !name_bytes.is_empty() {
            out.name = Some(String::from_utf8_lossy(&name_bytes).to_string());
        }
        out
    }

    /// Parcourt tout l'arbre. `limit` borne les entrées conservées ; les
    /// comptes, eux, couvrent tout.
    fn walk(&mut self, reporter: &Reporter) -> Result<Walk, String> {
        let naming = self.naming();
        let root = match (naming, &self.joliet) {
            (Naming::Joliet, Some(joliet)) => joliet.root.clone(),
            _ => self.primary.root.clone(),
        };

        let mut walk = Walk::default();
        let mut visited: HashSet<u32> = HashSet::new();
        visited.insert(root.extent);
        let mut stack = vec![(root, String::new(), 0_usize)];

        while let Some((dir, prefix, depth)) = stack.pop() {
            reporter.check()?;
            if depth > MAX_DEPTH {
                self.warnings.push(format!("répertoire trop profond ignoré : {prefix}"));
                continue;
            }
            let records = self.read_directory(&dir)?;
            let mut pending: Option<(Record, Vec<(u32, u32)>)> = None;

            for record in records {
                if record.id == [0] || record.id == [1] {
                    continue;
                }
                // Fichier en plusieurs extensions : les enregistrements se
                // suivent, tous sauf le dernier portant le drapeau 0x80.
                let (record, extents) = match pending.take() {
                    Some((first, mut extents)) => {
                        extents.push((record.extent, record.length));
                        if record.flags & 0x80 != 0 {
                            pending = Some((first, extents));
                            continue;
                        }
                        (first, extents)
                    }
                    None => {
                        if record.flags & 0x80 != 0 {
                            let extents = vec![(record.extent, record.length)];
                            pending = Some((record, extents));
                            continue;
                        }
                        let extents = vec![(record.extent, record.length)];
                        (record, extents)
                    }
                };

                let susp = if naming == Naming::RockRidge { self.susp(&record) } else { Susp::default() };
                // Les répertoires profonds sont relogés sous RR_MOVED : leur
                // place logique est celle du marqueur « CL ».
                if susp.relocated {
                    continue;
                }
                let mut is_dir = record.flags & 2 != 0;
                let mut extent = record.extent;
                let mut length = record.length;
                if let Some(target) = susp.child_link {
                    is_dir = true;
                    extent = target;
                    length = SECTOR as u32;
                    if let Ok(real) = self.read_at(target as u64 * SECTOR, SECTOR as usize) {
                        if let Some(dot) = parse_record(&real[..]) {
                            length = dot.length;
                        }
                    }
                }

                let name = match naming {
                    Naming::RockRidge => susp.name.clone().unwrap_or_else(|| plain_name(&record.id)),
                    Naming::Joliet => strip_version(&ucs2(&record.id)),
                    Naming::Plain => plain_name(&record.id),
                };
                if naming == Naming::RockRidge && dir.extent == self.primary.root.extent && name == "RR_MOVED" {
                    continue;
                }
                let symlink = susp.symlink || susp.mode.is_some_and(|m| m & 0o170_000 == 0o120_000);
                let path = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };

                if walk.count >= MAX_ENTRIES {
                    return Err(format!("Image refusée : plus de {MAX_ENTRIES} entrées."));
                }
                walk.count += 1;
                let size: u64 = if is_dir { 0 } else { extents.iter().map(|e| e.1 as u64).sum() };
                if is_dir {
                    walk.directories += 1;
                    if !visited.insert(extent) {
                        self.warnings.push(format!("répertoire qui se référence lui-même ignoré : {path}"));
                        continue;
                    }
                    let child = Record { extent, length, flags: 2, id: record.id.clone(), su: Vec::new(), date: record.date };
                    stack.push((child, path.clone(), depth + 1));
                } else {
                    walk.files += 1;
                    walk.total_bytes += size;
                }
                walk.items.push(Item {
                    entry: IsoEntry { path, name, is_dir, size, modified: record.date, symlink },
                    extents: if is_dir { Vec::new() } else { extents },
                });
            }
        }
        walk.items.sort_by(|a, b| a.entry.path.cmp(&b.entry.path));
        Ok(walk)
    }
}

#[derive(Default)]
struct Walk {
    items: Vec<Item>,
    count: usize,
    files: u64,
    directories: u64,
    total_bytes: u64,
}

fn find_signature(area: &[u8], signature: &[u8; 2]) -> bool {
    let mut at = 0;
    while at + 4 <= area.len() {
        let length = area[at + 2] as usize;
        if length < 4 || at + length > area.len() {
            return false;
        }
        if &area[at..at + 2] == signature {
            return true;
        }
        at += length;
    }
    false
}

/// `README.TXT;1` → `README.TXT`, `DOSSIER.` → `DOSSIER`.
fn strip_version(name: &str) -> String {
    let mut name = name;
    if let Some(semicolon) = name.rfind(';') {
        if name[semicolon + 1..].chars().all(|c| c.is_ascii_digit()) && semicolon + 1 < name.len() {
            name = &name[..semicolon];
        }
    }
    name.trim_end_matches('.').to_string()
}

fn plain_name(id: &[u8]) -> String {
    strip_version(&String::from_utf8_lossy(id))
}

/* ------------------------------------------------------------ El Torito */

fn media_name(code: u8) -> &'static str {
    match code & 0x0F {
        0 => "no-emulation",
        1 => "floppy-1.2",
        2 => "floppy-1.44",
        3 => "floppy-2.88",
        4 => "hard-disk",
        _ => "unknown",
    }
}

fn platform_name(code: u8) -> &'static str {
    match code {
        0 => "bios",
        1 => "powerpc",
        2 => "mac",
        0xEF => "efi",
        _ => "unknown",
    }
}

fn read_boot(volume: &mut Volume, items: &[Item]) -> Option<BootInfo> {
    let lba = volume.boot_catalog?;
    let catalog = volume.read_at(lba as u64 * SECTOR, SECTOR as usize).ok()?;
    let validation = &catalog[..32];
    let sum = validation.chunks_exact(2).fold(0_u16, |acc, w| acc.wrapping_add(u16::from_le_bytes([w[0], w[1]])));
    let validation_ok = validation[0] == 1 && validation[30] == 0x55 && validation[31] == 0xAA && sum == 0;

    let path_of = |load: u32| {
        items.iter().find(|i| i.extents.first().is_some_and(|e| e.0 == load)).map(|i| i.entry.path.clone())
    };
    let entry_at = |bytes: &[u8]| BootEntry {
        bootable: bytes[0] == 0x88,
        media: media_name(bytes[1]).into(),
        load_segment: le16(&bytes[2..4]),
        system_type: bytes[4],
        sectors: le16(&bytes[6..8]),
        load_lba: le32(&bytes[8..12]),
        path: path_of(le32(&bytes[8..12])),
    };

    let mut platforms = vec![platform_name(validation[1]).to_string()];
    let mut entries = vec![entry_at(&catalog[32..64])];
    // Sections suivantes : en-tête 0x90 (suite) ou 0x91 (dernière), puis ses entrées.
    let mut at = 64;
    while at + 32 <= catalog.len() && (catalog[at] == 0x90 || catalog[at] == 0x91) {
        let header = &catalog[at..at + 32];
        let count = le16(&header[2..4]) as usize;
        let platform = platform_name(header[1]).to_string();
        if !platforms.contains(&platform) {
            platforms.push(platform);
        }
        at += 32;
        for _ in 0..count {
            if at + 32 > catalog.len() {
                break;
            }
            entries.push(entry_at(&catalog[at..at + 32]));
            at += 32;
        }
        if header[0] == 0x91 {
            break;
        }
    }

    Some(BootInfo {
        platforms,
        catalog_lba: lba,
        validation_ok,
        id_string: text(&validation[4..28]),
        entries,
    })
}

/* ---------------------------------------------------------- inspection */

/// Décrit une image sans extraire quoi que ce soit.
pub fn inspect(path: &Path, list_limit: usize, reporter: &Reporter) -> Result<IsoInfo, String> {
    let mut volume = Volume::open(path)?;
    let walk = volume.walk(reporter)?;
    let boot = read_boot(&mut volume, &walk.items);

    let head = volume.read_at(0, 1024.min(volume.len as usize))?;
    let hybrid_mbr = head.len() >= 512 && head[510] == 0x55 && head[511] == 0xAA;
    let gpt = head.len() >= 520 && &head[512..520] == b"EFI PART";

    let mut features = vec!["iso9660".to_string()];
    if volume.joliet.is_some() {
        features.push("joliet".into());
    }
    if volume.rock_ridge {
        features.push("rock-ridge".into());
    }
    if boot.is_some() {
        features.push("el-torito".into());
    }
    if volume.udf {
        features.push("udf".into());
        volume.warnings.push(
            "Image UDF : seul le contenu visible en ISO 9660 est lu, et il peut n'être qu'un fichier d'explication."
                .into(),
        );
    }

    let truncated = walk.items.len() > list_limit;
    let entries = walk.items.iter().take(list_limit).map(|i| i.entry.clone()).collect();
    let tree = match volume.naming() {
        Naming::RockRidge => "rock-ridge",
        Naming::Joliet => "joliet",
        Naming::Plain => "iso9660",
    };
    let d = &volume.primary;
    if d.blocks as u64 * SECTOR > volume.len {
        volume.warnings.push("Le fichier est plus court que la taille déclarée du volume : image tronquée.".into());
    }
    Ok(IsoInfo {
        path: path.to_string_lossy().to_string(),
        file_size: volume.len,
        label: d.label.clone(),
        system_id: d.system_id.clone(),
        publisher: d.publisher.clone(),
        preparer: d.preparer.clone(),
        application: d.application.clone(),
        created: d.created,
        modified: d.modified,
        volume_bytes: d.blocks as u64 * SECTOR,
        features,
        tree: tree.into(),
        entries,
        files: walk.files,
        directories: walk.directories,
        total_bytes: walk.total_bytes,
        truncated,
        boot,
        hybrid_mbr,
        gpt,
        warnings: volume.warnings,
    })
}

/* ---------------------------------------------------------- extraction */

/// Composant de chemin sûr, sur Linux comme sur Windows, ou la raison du refus.
///
/// Un nom venu d'une image est écrit sur le disque de l'utilisateur : il ne
/// doit désigner ni le parent, ni un autre lecteur, ni un périphérique. Les
/// caractères réservés de Windows sont remplacés plutôt que refusés, pour
/// qu'une image légitime produite sous Linux reste extractible sous Windows.
pub fn safe_component(name: &str) -> Result<String, String> {
    if name.is_empty() || name == "." || name == ".." {
        return Err("nom de composant invalide".into());
    }
    if name.contains(['/', '\\', '\0']) {
        return Err("séparateur de chemin dans un nom".into());
    }
    let mut cleaned: String = name
        .chars()
        .map(|c| if cfg!(windows) && (c < ' ' || "<>:\"|?*".contains(c)) { '_' } else { c })
        .collect();
    if cfg!(windows) {
        cleaned = cleaned.trim_end_matches([' ', '.']).to_string();
        if cleaned.is_empty() {
            return Err("nom de composant invalide".into());
        }
        let stem = cleaned.split('.').next().unwrap_or("").to_ascii_uppercase();
        let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
            || (stem.len() == 4
                && (stem.starts_with("COM") || stem.starts_with("LPT"))
                && stem.as_bytes()[3].is_ascii_digit());
        if reserved {
            cleaned = format!("_{cleaned}");
        }
    }
    Ok(cleaned)
}

/// Chemin de destination pour une entrée, composant par composant.
fn destination_for(root: &Path, entry_path: &str) -> Result<PathBuf, String> {
    let mut target = root.to_path_buf();
    for part in entry_path.split('/') {
        target.push(safe_component(part)?);
    }
    // Contrôle redondant volontaire : la construction ci-dessus ne peut pas
    // sortir de la racine, et cette vérification le garantit.
    if !target.starts_with(root) || target == root {
        return Err("chemin hors du dossier de destination".into());
    }
    Ok(target)
}

fn selected(path: &str, selection: &[String]) -> bool {
    selection.is_empty()
        || selection.iter().any(|s| {
            let s = s.trim_matches('/');
            path == s || path.strip_prefix(s).is_some_and(|rest| rest.starts_with('/'))
        })
}

/// Extrait tout ou une sélection de chemins (fichiers ou dossiers de l'image).
///
/// En cas d'erreur ou d'annulation, tout ce que cette extraction a créé est
/// retiré : on ne laisse pas un dossier à moitié rempli passer pour un résultat.
pub fn extract(
    path: &Path,
    destination: &Path,
    selection: &[String],
    overwrite: bool,
    reporter: &Reporter,
) -> Result<ExtractSummary, String> {
    let mut volume = Volume::open(path)?;
    let walk = volume.walk(reporter)?;
    let chosen: Vec<&Item> = walk.items.iter().filter(|i| selected(&i.entry.path, selection)).collect();
    if chosen.is_empty() {
        return Err("Aucun élément à extraire.".into());
    }

    // Plusieurs entrées peuvent partager une extension (fichiers identiques) ;
    // un total sans rapport avec l'image trahit des tailles mensongères.
    let declared: u64 = chosen.iter().map(|i| i.entry.size).sum();
    if declared > volume.len.saturating_mul(64).saturating_add(1 << 30) {
        return Err("Tailles incohérentes avec la taille de l'image : image corrompue ou piégée.".into());
    }

    fs::create_dir_all(destination).map_err(|e| format!("Dossier de destination : {e}"))?;
    let root = fs::canonicalize(destination).map_err(|e| e.to_string())?;

    let mut created_files: Vec<PathBuf> = Vec::new();
    let mut created_dirs: Vec<PathBuf> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    let mut extracted = 0_usize;
    let mut bytes = 0_u64;

    let outcome = (|| -> Result<(), String> {
        for item in chosen {
            reporter.check()?;
            let entry = &item.entry;
            if entry.symlink {
                skipped.push(format!("{} — lien symbolique non recréé", entry.path));
                continue;
            }
            let target = match destination_for(&root, &entry.path) {
                Ok(target) => target,
                Err(reason) => {
                    skipped.push(format!("{} — {reason}", entry.path));
                    continue;
                }
            };
            if entry.is_dir {
                make_dirs(&target, &root, &mut created_dirs)?;
                continue;
            }
            if let Some(parent) = target.parent() {
                make_dirs(parent, &root, &mut created_dirs)?;
            }
            let final_path = if overwrite { target } else { unique_path(&target) };
            let part = {
                let mut name = final_path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
                name.push(".fourtout-part");
                final_path.with_file_name(name)
            };
            created_files.push(part.clone());
            copy_extents(&mut volume.file, volume.len, &item.extents, &part, &mut bytes, declared, &entry.name, reporter)?;
            if overwrite && final_path.exists() {
                fs::remove_file(&final_path).map_err(|e| format!("Remplacement impossible : {e}"))?;
            }
            fs::rename(&part, &final_path).map_err(|e| format!("Finalisation impossible : {e}"))?;
            created_files.pop();
            created_files.push(final_path);
            extracted += 1;
        }
        Ok(())
    })();

    if let Err(error) = outcome {
        for file in &created_files {
            let _ = fs::remove_file(file);
        }
        // Les dossiers les plus profonds d'abord ; `remove_dir` refuse un
        // dossier non vide, ce qui protège ce que l'utilisateur y avait mis.
        for dir in created_dirs.iter().rev() {
            let _ = fs::remove_dir(dir);
        }
        return Err(error);
    }

    Ok(ExtractSummary { destination: root.to_string_lossy().to_string(), extracted, skipped, bytes })
}

fn make_dirs(dir: &Path, root: &Path, created: &mut Vec<PathBuf>) -> Result<(), String> {
    let mut missing = Vec::new();
    let mut cursor = dir;
    while cursor != root && !cursor.exists() {
        missing.push(cursor.to_path_buf());
        cursor = cursor.parent().ok_or("chemin invalide")?;
    }
    for path in missing.into_iter().rev() {
        fs::create_dir(&path).map_err(|e| format!("Création impossible de « {} » : {e}", path.display()))?;
        created.push(path);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn copy_extents(
    source: &mut File,
    source_len: u64,
    extents: &[(u32, u32)],
    part: &Path,
    done: &mut u64,
    total: u64,
    label: &str,
    reporter: &Reporter,
) -> Result<(), String> {
    let mut out = File::create(part).map_err(|e| format!("Création impossible de « {} » : {e}", part.display()))?;
    let mut buffer = vec![0_u8; 256 * 1024];
    for &(extent, length) in extents {
        let start = extent as u64 * SECTOR;
        if start + length as u64 > source_len {
            return Err(format!("« {label} » dépasse la fin de l'image : fichier tronqué ou corrompu."));
        }
        source.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
        let mut remaining = length as u64;
        while remaining > 0 {
            reporter.check()?;
            let want = remaining.min(buffer.len() as u64) as usize;
            source.read_exact(&mut buffer[..want]).map_err(|e| format!("Lecture impossible : {e}"))?;
            out.write_all(&buffer[..want]).map_err(|e| format!("Écriture impossible (disque plein ?) : {e}"))?;
            remaining -= want as u64;
            *done += want as u64;
            reporter.report(*done, total, label);
        }
    }
    out.flush().map_err(|e| format!("Écriture impossible (disque plein ?) : {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn components_cannot_leave_the_destination() {
        for hostile in ["", ".", "..", "a/b", "a\\b", "x\0y"] {
            assert!(safe_component(hostile).is_err(), "accepté à tort : {hostile:?}");
        }
        assert_eq!(safe_component("café.txt").unwrap(), "café.txt");
        let root = Path::new("/tmp/fourtout-iso-dest");
        assert!(destination_for(root, "a/../b").is_err());
        assert!(destination_for(root, "../b").is_err());
        assert!(destination_for(root, "/etc/passwd").is_err());
        assert_eq!(destination_for(root, "a/b.txt").unwrap(), root.join("a").join("b.txt"));
    }

    #[test]
    fn selection_matches_files_and_whole_folders() {
        let selection = vec!["docs".to_string(), "readme.txt".to_string()];
        assert!(selected("docs/a/b.txt", &selection));
        assert!(selected("docs", &selection));
        assert!(selected("readme.txt", &selection));
        // « docs-old » n'est pas dans « docs ».
        assert!(!selected("docs-old/x", &selection));
        assert!(selected("anything", &[]));
    }

    #[test]
    fn strips_iso_versions_and_trailing_dots() {
        assert_eq!(strip_version("README.TXT;1"), "README.TXT");
        assert_eq!(strip_version("DIR."), "DIR");
        assert_eq!(strip_version("a;b"), "a;b");
    }

    #[test]
    fn rejects_a_directory_record_that_overflows() {
        assert!(parse_record(&[10, 0, 0]).is_none());
        let mut bytes = vec![0_u8; 40];
        bytes[0] = 40;
        bytes[32] = 200;
        assert!(parse_record(&bytes).is_none());
    }
}
