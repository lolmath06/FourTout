//! Écriture d'une image ISO 9660 (+ Joliet, + Rock Ridge) depuis un dossier.
//!
//! Disposition de l'image, dans l'ordre :
//!
//! ```text
//! secteurs 0-15   zone système (zéros : cette image n'est pas amorçable)
//! 16              descripteur de volume primaire
//! 17              descripteur supplémentaire Joliet (si demandé)
//! 18              terminateur
//! …               tables de chemins L et M (primaire, puis Joliet)
//! …               répertoires de l'arborescence primaire, puis Joliet
//! …               données des fichiers — partagées par les deux arborescences
//! ```
//!
//! L'écriture se fait dans un fichier voisin du résultat, renommé une fois
//! l'image complète : un échec ou une annulation ne laisse jamais une image
//! tronquée sous le nom attendu.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::{broken_down, MAX_ENTRIES, SECTOR, SYSTEM_AREA_SECTORS};
use crate::files::Reporter;

/// Longueur maximale d'un nom de fichier sur les systèmes courants. Ce que
/// l'enregistrement peut réellement contenir (255 octets, zone de continuation
/// non écrite) est vérifié dans `build_system_use`.
const RR_NAME_MAX: usize = 255;
/// Un fichier ISO 9660 sans extensions multiples ne dépasse pas 4 Gio − 1.
const MAX_FILE: u64 = u32::MAX as u64;
/// Nombre de remarques détaillées conservées dans le résultat.
const MAX_WARNINGS: usize = 40;

#[derive(Clone, Debug)]
pub struct CreateOptions {
    /// Nom du volume, tel que l'utilisateur le voit.
    pub label: String,
    /// Écrire l'arborescence Joliet (noms Unicode, lue par Windows).
    pub joliet: bool,
    /// Écrire les extensions Rock Ridge (noms longs et droits POSIX).
    pub rock_ridge: bool,
    /// Remplacer un fichier existant. Sinon, l'écriture est refusée.
    pub overwrite: bool,
    /// Horodatage imposé à tout (volume et fichiers) : rend l'image
    /// reproductible octet pour octet, pour les tests.
    pub fixed_time: Option<i64>,
}

impl Default for CreateOptions {
    fn default() -> Self {
        Self { label: "CDROM".into(), joliet: true, rock_ridge: true, overwrite: false, fixed_time: None }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSummary {
    pub path: String,
    pub files: u64,
    pub directories: u64,
    /// Octets de données des fichiers.
    pub data_bytes: u64,
    /// Taille de l'image produite.
    pub image_bytes: u64,
    /// Nom de volume ISO 9660 effectivement écrit (restreint aux d-caractères).
    pub label: String,
    /// Noms qu'une des arborescences n'a pas pu conserver tels quels.
    pub warnings: Vec<String>,
    pub warning_count: u64,
}

struct Node {
    name: String,
    source: PathBuf,
    is_dir: bool,
    size: u64,
    mtime: i64,
    mode: u32,
    parent: usize,
    children: Vec<usize>,
    depth: u32,
    p_id: Vec<u8>,
    j_id: Vec<u8>,
    rr_name: Option<Vec<u8>>,
    /// Zone d'utilisation système (Rock Ridge) de l'enregistrement du nœud.
    su: Vec<u8>,
    /// Extension de données (fichier) ou de répertoire primaire.
    lba: u32,
    dir_len: u32,
    j_lba: u32,
    j_dir_len: u32,
    p_num: u16,
    j_num: u16,
}

#[derive(Clone, Copy, PartialEq)]
enum Tree {
    Primary,
    Joliet,
}

struct Collector {
    warnings: Vec<String>,
    count: u64,
}

impl Collector {
    fn warn(&mut self, message: String) {
        self.count += 1;
        if self.warnings.len() < MAX_WARNINGS {
            self.warnings.push(message);
        }
    }
}

/// Crée une image ISO à partir d'un dossier.
pub fn create(
    source: &Path,
    output: &Path,
    options: &CreateOptions,
    reporter: &Reporter,
) -> Result<CreateSummary, String> {
    let meta = fs::metadata(source).map_err(|e| format!("Dossier illisible : {e}"))?;
    if !meta.is_dir() {
        return Err("La source doit être un dossier.".into());
    }
    if output.exists() && !options.overwrite {
        return Err(format!("« {} » existe déjà.", output.display()));
    }
    refuse_output_inside_source(source, output)?;

    let mut warn = Collector { warnings: Vec::new(), count: 0 };
    let mut nodes = scan(source, options, &mut warn, reporter)?;
    assign_names(&mut nodes, options, &mut warn);
    build_system_use(&mut nodes, options, &mut warn);

    let layout = lay_out(&mut nodes, options);

    let part = part_path(output);
    let _ = fs::remove_file(&part);
    let result = write_image(&nodes, &layout, options, &part, reporter);
    match result {
        Ok(()) => {
            if output.exists() {
                fs::remove_file(output).map_err(|e| format!("Remplacement impossible : {e}"))?;
            }
            fs::rename(&part, output).map_err(|e| {
                let _ = fs::remove_file(&part);
                format!("Finalisation impossible : {e}")
            })?;
        }
        Err(error) => {
            let _ = fs::remove_file(&part);
            return Err(error);
        }
    }

    Ok(CreateSummary {
        path: output.to_string_lossy().to_string(),
        files: nodes.iter().filter(|n| !n.is_dir).count() as u64,
        directories: nodes.iter().filter(|n| n.is_dir).count() as u64 - 1,
        data_bytes: nodes.iter().filter(|n| !n.is_dir).map(|n| n.size).sum(),
        image_bytes: layout.total_sectors as u64 * SECTOR,
        label: volume_id_primary(&options.label),
        warnings: warn.warnings,
        warning_count: warn.count,
    })
}

fn part_path(output: &Path) -> PathBuf {
    let mut name = output.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".fourtout-part");
    output.with_file_name(name)
}

/// Une image écrite dans le dossier qu'elle décrit s'inclurait elle-même.
fn refuse_output_inside_source(source: &Path, output: &Path) -> Result<(), String> {
    let source = fs::canonicalize(source).map_err(|e| e.to_string())?;
    let parent = output.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or_else(|| Path::new("."));
    let parent = fs::canonicalize(parent).map_err(|e| format!("Destination inaccessible : {e}"))?;
    if parent.starts_with(&source) {
        return Err("L'image ne peut pas être enregistrée dans le dossier qu'elle contient.".into());
    }
    Ok(())
}

/* ----------------------------------------------------------- parcours */

fn unix_seconds(time: std::io::Result<std::time::SystemTime>) -> i64 {
    time.ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(unix)]
fn posix_mode(meta: &fs::Metadata) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    let executable = meta.permissions().mode() & 0o111 != 0;
    match (meta.is_dir(), executable) {
        (true, _) => 0o040_755,
        (false, true) => 0o100_755,
        (false, false) => 0o100_644,
    }
}

#[cfg(not(unix))]
fn posix_mode(meta: &fs::Metadata) -> u32 {
    if meta.is_dir() {
        0o040_755
    } else {
        0o100_644
    }
}

fn scan(
    source: &Path,
    options: &CreateOptions,
    warn: &mut Collector,
    reporter: &Reporter,
) -> Result<Vec<Node>, String> {
    let root_meta = fs::metadata(source).map_err(|e| e.to_string())?;
    let stamp = |meta: &fs::Metadata| options.fixed_time.unwrap_or_else(|| unix_seconds(meta.modified()));
    let new_node = |name: String, source: PathBuf, meta: &fs::Metadata, parent: usize, depth: u32| Node {
        name,
        source,
        is_dir: meta.is_dir(),
        size: if meta.is_dir() { 0 } else { meta.len() },
        mtime: stamp(meta),
        mode: posix_mode(meta),
        parent,
        children: Vec::new(),
        depth,
        p_id: Vec::new(),
        j_id: Vec::new(),
        rr_name: None,
        su: Vec::new(),
        lba: 0,
        dir_len: 0,
        j_lba: 0,
        j_dir_len: 0,
        p_num: 0,
        j_num: 0,
    };

    let mut nodes = vec![new_node(String::new(), source.to_path_buf(), &root_meta, 0, 0)];
    let mut stack = vec![0_usize];
    while let Some(dir) = stack.pop() {
        reporter.check()?;
        let mut entries: Vec<_> = fs::read_dir(&nodes[dir].source)
            .map_err(|e| format!("Lecture impossible de « {} » : {e}", nodes[dir].source.display()))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Lecture impossible : {e}"))?;
        // Ordre déterministe : le résultat ne dépend pas du système de fichiers.
        entries.sort_by_key(|e| e.file_name());

        for entry in entries {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            // Ni `metadata` ni `canonicalize` : un lien symbolique n'est jamais
            // suivi, sinon un lien vers `/` copierait le disque entier.
            let meta = fs::symlink_metadata(&path).map_err(|e| format!("« {} » : {e}", path.display()))?;
            let kind = meta.file_type();
            if kind.is_symlink() {
                warn.warn(format!("lien symbolique ignoré : {name}"));
                continue;
            }
            if !kind.is_dir() && !kind.is_file() {
                warn.warn(format!("fichier spécial ignoré : {name}"));
                continue;
            }
            if !kind.is_dir() && meta.len() > MAX_FILE {
                return Err(format!(
                    "« {name} » dépasse 4 Gio : ISO 9660 ne le permet pas sans extensions multiples."
                ));
            }
            if nodes.len() >= MAX_ENTRIES {
                return Err(format!("Dossier trop volumineux : plus de {MAX_ENTRIES} éléments."));
            }
            let depth = nodes[dir].depth + 1;
            let index = nodes.len();
            nodes.push(new_node(name, path, &meta, dir, depth));
            nodes[dir].children.push(index);
            if kind.is_dir() {
                stack.push(index);
            }
        }
    }
    Ok(nodes)
}

/* -------------------------------------------------------------- noms */

fn d_char(c: char) -> char {
    if c.is_ascii_alphanumeric() {
        c.to_ascii_uppercase()
    } else {
        '_'
    }
}

fn d_string(text: &str) -> String {
    text.chars().map(d_char).collect()
}

/// Identifiant primaire d'un fichier : `NOM.EXT;1`, 30 caractères au plus.
fn primary_file_id(name: &str, attempt: u32) -> String {
    let (stem, extension) = match name.rfind('.') {
        Some(dot) if dot > 0 && dot + 1 < name.len() => (&name[..dot], &name[dot + 1..]),
        _ => (name, ""),
    };
    let mut extension: String = d_string(extension).chars().take(10).collect();
    let mut stem = d_string(stem);
    if stem.is_empty() {
        stem = "_".into();
    }
    if extension.is_empty() {
        extension = String::new();
    }
    let suffix = if attempt == 0 { String::new() } else { attempt.to_string() };
    let room = 30_usize.saturating_sub(1 + extension.len() + suffix.len()).max(1);
    let stem: String = stem.chars().take(room).collect();
    format!("{stem}{suffix}.{extension};1")
}

fn primary_dir_id(name: &str, attempt: u32) -> String {
    let suffix = if attempt == 0 { String::new() } else { attempt.to_string() };
    let mut base = d_string(name);
    if base.is_empty() {
        base = "_".into();
    }
    let room = 31_usize.saturating_sub(suffix.len()).max(1);
    let base: String = base.chars().take(room).collect();
    format!("{base}{suffix}")
}

/// Nom Joliet : Unicode (UCS-2), 64 caractères, sans `* / : ; ? \`.
fn joliet_name(name: &str, attempt: u32) -> Vec<u16> {
    let cleaned: Vec<u16> = name
        .chars()
        .map(|c| match c {
            '*' | '/' | ':' | ';' | '?' | '\\' => '_',
            c if (c as u32) < 0x20 || (c as u32) > 0xFFFF => '_',
            c => c,
        })
        .map(|c| c as u16)
        .collect();
    let suffix: Vec<u16> = if attempt == 0 { Vec::new() } else { format!("~{attempt}").encode_utf16().collect() };
    let limit = 64_usize.saturating_sub(suffix.len());
    if cleaned.len() <= limit {
        return [cleaned, suffix].concat();
    }
    // Troncature qui préserve l'extension : « rapport-très-long.pdf » reste un PDF.
    let dot = cleaned.iter().rposition(|&c| c == b'.' as u16).filter(|&d| d > 0);
    let extension: Vec<u16> = match dot {
        Some(d) if cleaned.len() - d <= 9 => cleaned[d..].to_vec(),
        _ => Vec::new(),
    };
    let stem_len = limit.saturating_sub(extension.len()).max(1);
    let stem = &cleaned[..stem_len.min(cleaned.len() - extension.len())];
    [stem.to_vec(), suffix, extension].concat()
}

fn ucs2_be(units: &[u16]) -> Vec<u8> {
    units.iter().flat_map(|u| u.to_be_bytes()).collect()
}

fn assign_names(nodes: &mut [Node], options: &CreateOptions, warn: &mut Collector) {
    for dir in 0..nodes.len() {
        if !nodes[dir].is_dir {
            continue;
        }
        let children = nodes[dir].children.clone();
        let mut taken_primary: HashSet<Vec<u8>> = HashSet::new();
        let mut taken_joliet: HashSet<String> = HashSet::new();

        for child in children {
            let name = nodes[child].name.clone();
            let is_dir = nodes[child].is_dir;

            let mut attempt = 0;
            let primary = loop {
                let id = if is_dir { primary_dir_id(&name, attempt) } else { primary_file_id(&name, attempt) };
                if taken_primary.insert(id.clone().into_bytes()) {
                    break id;
                }
                attempt += 1;
            };
            nodes[child].p_id = primary.into_bytes();

            if options.joliet {
                let mut attempt = 0;
                let units = loop {
                    let units = joliet_name(&name, attempt);
                    // Windows ignore la casse : deux noms qui ne diffèrent que
                    // par elle se confondraient à la lecture.
                    let key = String::from_utf16_lossy(&units).to_lowercase();
                    if taken_joliet.insert(key) {
                        break units;
                    }
                    attempt += 1;
                };
                if String::from_utf16_lossy(&units) != name {
                    warn.warn(format!("nom modifié dans l'arborescence Joliet : {name}"));
                }
                nodes[child].j_id = ucs2_be(&units);
            }

            if options.rock_ridge {
                if name.len() <= RR_NAME_MAX {
                    nodes[child].rr_name = Some(name.into_bytes());
                } else {
                    warn.warn(format!("nom trop long pour Rock Ridge : {name}"));
                }
            }
        }
    }
}

/* ------------------------------------------------- Rock Ridge (SUSP) */

fn both32(value: u32) -> [u8; 8] {
    let mut out = [0; 8];
    out[..4].copy_from_slice(&value.to_le_bytes());
    out[4..].copy_from_slice(&value.to_be_bytes());
    out
}

fn both16(value: u16) -> [u8; 4] {
    let mut out = [0; 4];
    out[..2].copy_from_slice(&value.to_le_bytes());
    out[2..].copy_from_slice(&value.to_be_bytes());
    out
}

/// Date d'enregistrement à 7 octets (UTC).
fn record_date(seconds: i64) -> [u8; 7] {
    let (year, month, day, hour, minute, second) = broken_down(seconds);
    [(year - 1900).clamp(0, 255) as u8, month as u8, day as u8, hour as u8, minute as u8, second as u8, 0]
}

/// Date de volume à 17 octets : `AAAAMMJJHHMMSScc` puis le décalage horaire.
fn volume_date(seconds: i64) -> [u8; 17] {
    let (year, month, day, hour, minute, second) = broken_down(seconds);
    let text = format!("{:04}{month:02}{day:02}{hour:02}{minute:02}{second:02}00", year.clamp(0, 9999));
    let mut out = [0_u8; 17];
    out[..16].copy_from_slice(text.as_bytes());
    out
}

fn rr_px(mode: u32, links: u32) -> Vec<u8> {
    let mut out = vec![b'P', b'X', 36, 1];
    out.extend_from_slice(&both32(mode));
    out.extend_from_slice(&both32(links));
    out.extend_from_slice(&both32(0)); // uid : celui de l'utilisateur ne fuite pas.
    out.extend_from_slice(&both32(0)); // gid.
    out
}

fn rr_tf(seconds: i64) -> Vec<u8> {
    let mut out = vec![b'T', b'F', 12, 1, 0x02]; // 0x02 : date de modification.
    out.extend_from_slice(&record_date(seconds));
    out
}

fn rr_nm(name: &[u8]) -> Vec<u8> {
    let mut out = vec![b'N', b'M', (5 + name.len()) as u8, 1, 0];
    out.extend_from_slice(name);
    out
}

fn pad_even(mut bytes: Vec<u8>) -> Vec<u8> {
    if bytes.len() % 2 == 1 {
        bytes.push(0);
    }
    bytes
}

fn record_len(id_len: usize, su_len: usize) -> usize {
    let base = 33 + id_len;
    (if base % 2 == 1 { base + 1 } else { base }) + su_len
}

fn build_system_use(nodes: &mut [Node], options: &CreateOptions, warn: &mut Collector) {
    if !options.rock_ridge {
        return;
    }
    for index in 0..nodes.len() {
        let subdirs = nodes[index].children.iter().filter(|&&c| nodes[c].is_dir).count() as u32;
        let links = if nodes[index].is_dir { 2 + subdirs } else { 1 };
        let mut su = Vec::new();
        su.extend(rr_px(nodes[index].mode, links));
        su.extend(rr_tf(nodes[index].mtime));
        if index != 0 {
            if let Some(name) = &nodes[index].rr_name {
                let with_name = [su.clone(), rr_nm(name)].concat();
                if record_len(nodes[index].p_id.len(), pad_even(with_name.clone()).len()) <= 255 {
                    su = with_name;
                } else {
                    warn.warn(format!("nom trop long pour Rock Ridge : {}", nodes[index].name));
                }
            }
        }
        nodes[index].su = pad_even(su);
    }
}

/* ------------------------------------------------------------ disposition */

struct Layout {
    /// Répertoires dans l'ordre de la table des chemins.
    p_dirs: Vec<usize>,
    j_dirs: Vec<usize>,
    /// Fichiers dans l'ordre d'écriture des données.
    files: Vec<usize>,
    p_table_len: u32,
    j_table_len: u32,
    p_l: u32,
    p_m: u32,
    j_l: u32,
    j_m: u32,
    total_sectors: u32,
}

fn sectors(bytes: u64) -> u32 {
    bytes.div_ceil(SECTOR) as u32
}

fn id_of(node: &Node, tree: Tree) -> &[u8] {
    match tree {
        Tree::Primary => &node.p_id,
        Tree::Joliet => &node.j_id,
    }
}

/// Répertoires par niveau, puis par numéro de parent, puis par identifiant.
fn path_table_order(nodes: &mut [Node], tree: Tree) -> Vec<usize> {
    let mut order = vec![0_usize];
    let number = |n: &Node| if tree == Tree::Primary { n.p_num } else { n.j_num };
    let set = |n: &mut Node, v: u16| {
        if tree == Tree::Primary {
            n.p_num = v
        } else {
            n.j_num = v
        }
    };
    set(&mut nodes[0], 1);
    let mut level = vec![0_usize];
    while !level.is_empty() {
        let mut next: Vec<usize> = level
            .iter()
            .flat_map(|&d| nodes[d].children.iter().copied().filter(|&c| nodes[c].is_dir))
            .collect();
        next.sort_by(|&a, &b| {
            (number(&nodes[nodes[a].parent]), id_of(&nodes[a], tree))
                .cmp(&(number(&nodes[nodes[b].parent]), id_of(&nodes[b], tree)))
        });
        for &d in &next {
            order.push(d);
            let value = order.len() as u16;
            set(&mut nodes[d], value);
        }
        level = next;
    }
    order
}

fn path_table_len(nodes: &[Node], order: &[usize], tree: Tree) -> u32 {
    order
        .iter()
        .map(|&d| {
            let id_len = if d == 0 { 1 } else { id_of(&nodes[d], tree).len() };
            (8 + id_len + id_len % 2) as u32
        })
        .sum()
}

/// Taille en octets d'un répertoire : les enregistrements ne chevauchent
/// jamais deux secteurs.
fn directory_len(nodes: &[Node], dir: usize, tree: Tree) -> u32 {
    let dot_su = if tree == Tree::Primary { dot_system_use(nodes, dir, true) } else { Vec::new() };
    let dotdot_su = if tree == Tree::Primary { dot_system_use(nodes, dir, false) } else { Vec::new() };
    let mut sizes = vec![record_len(1, dot_su.len()), record_len(1, dotdot_su.len())];
    for &child in &nodes[dir].children {
        let su = if tree == Tree::Primary { nodes[child].su.len() } else { 0 };
        sizes.push(record_len(id_of(&nodes[child], tree).len(), su));
    }
    let mut sector_count = 1_u64;
    let mut used = 0_u64;
    for size in sizes {
        let size = size as u64;
        if used + size > SECTOR {
            sector_count += 1;
            used = 0;
        }
        used += size;
    }
    (sector_count * SECTOR) as u32
}

/// Zone système des enregistrements « . » et « .. ». Seule la racine porte
/// l'indicateur `SP`, qui signale la présence de SUSP à qui lit l'image.
fn dot_system_use(nodes: &[Node], dir: usize, current: bool) -> Vec<u8> {
    let source = if current { dir } else { nodes[dir].parent };
    let su = &nodes[source].su;
    if su.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    if dir == 0 && current {
        out.extend_from_slice(&[b'S', b'P', 7, 1, 0xBE, 0xEF, 0]);
    }
    out.extend_from_slice(su);
    pad_even(out)
}

fn lay_out(nodes: &mut [Node], options: &CreateOptions) -> Layout {
    let p_dirs = path_table_order(nodes, Tree::Primary);
    let j_dirs = if options.joliet { path_table_order(nodes, Tree::Joliet) } else { Vec::new() };
    let p_table_len = path_table_len(nodes, &p_dirs, Tree::Primary);
    let j_table_len = if options.joliet { path_table_len(nodes, &j_dirs, Tree::Joliet) } else { 0 };

    let mut cursor = SYSTEM_AREA_SECTORS + if options.joliet { 3 } else { 2 };
    let p_l = cursor;
    cursor += sectors(p_table_len as u64);
    let p_m = cursor;
    cursor += sectors(p_table_len as u64);
    let (mut j_l, mut j_m) = (0, 0);
    if options.joliet {
        j_l = cursor;
        cursor += sectors(j_table_len as u64);
        j_m = cursor;
        cursor += sectors(j_table_len as u64);
    }

    for &dir in &p_dirs {
        let len = directory_len(nodes, dir, Tree::Primary);
        nodes[dir].dir_len = len;
        nodes[dir].lba = cursor;
        cursor += len / SECTOR as u32;
    }
    for &dir in &j_dirs {
        let len = directory_len(nodes, dir, Tree::Joliet);
        nodes[dir].j_dir_len = len;
        nodes[dir].j_lba = cursor;
        cursor += len / SECTOR as u32;
    }

    // Données : parcours en profondeur dans l'ordre alphabétique primaire.
    let mut files = Vec::new();
    let mut stack = vec![0_usize];
    while let Some(dir) = stack.pop() {
        let mut children = nodes[dir].children.clone();
        children.sort_by(|&a, &b| nodes[a].p_id.cmp(&nodes[b].p_id));
        for &child in children.iter().rev() {
            if nodes[child].is_dir {
                stack.push(child);
            }
        }
        for &child in &children {
            if !nodes[child].is_dir {
                files.push(child);
            }
        }
    }
    for &file in &files {
        nodes[file].lba = cursor;
        cursor += sectors(nodes[file].size);
    }

    Layout { p_dirs, j_dirs, files, p_table_len, j_table_len, p_l, p_m, j_l, j_m, total_sectors: cursor }
}

/* ----------------------------------------------------------- écriture */

fn volume_id_primary(label: &str) -> String {
    let id: String = label
        .trim()
        .chars()
        .map(|c| if c == ' ' { '_' } else { d_char(c) })
        .take(32)
        .collect();
    if id.is_empty() {
        "CDROM".into()
    } else {
        id
    }
}

fn padded(text: &str, width: usize) -> Vec<u8> {
    let mut bytes = text.as_bytes().to_vec();
    bytes.truncate(width);
    bytes.resize(width, b' ');
    bytes
}

fn directory_record(extent: u32, length: u32, date: [u8; 7], directory: bool, id: &[u8], su: &[u8]) -> Vec<u8> {
    let total = record_len(id.len(), su.len());
    let mut out = Vec::with_capacity(total);
    out.push(total as u8);
    out.push(0);
    out.extend_from_slice(&both32(extent));
    out.extend_from_slice(&both32(length));
    out.extend_from_slice(&date);
    out.push(if directory { 2 } else { 0 });
    out.push(0);
    out.push(0);
    out.extend_from_slice(&both16(1));
    out.push(id.len() as u8);
    out.extend_from_slice(id);
    if id.len() % 2 == 0 {
        out.push(0);
    }
    out.extend_from_slice(su);
    debug_assert_eq!(out.len(), total);
    out
}

fn descriptor(options: &CreateOptions, nodes: &[Node], layout: &Layout, tree: Tree, now: i64) -> Vec<u8> {
    let mut out = vec![0_u8; SECTOR as usize];
    let joliet = tree == Tree::Joliet;
    out[0] = if joliet { 2 } else { 1 };
    out[1..6].copy_from_slice(super::STANDARD_ID);
    out[6] = 1;

    let text = |out: &mut Vec<u8>, at: usize, width: usize, value: &str| {
        if joliet {
            let units: Vec<u16> = value.encode_utf16().take(width / 2).collect();
            let mut bytes = ucs2_be(&units);
            bytes.resize(width, 0);
            for chunk in bytes.chunks_exact_mut(2).skip(units.len()) {
                chunk.copy_from_slice(&0x0020_u16.to_be_bytes());
            }
            out[at..at + width].copy_from_slice(&bytes);
        } else {
            out[at..at + width].copy_from_slice(&padded(value, width));
        }
    };
    text(&mut out, 8, 32, "");
    let label = if joliet { options.label.trim().to_string() } else { volume_id_primary(&options.label) };
    text(&mut out, 40, 32, &label);

    out[80..88].copy_from_slice(&both32(layout.total_sectors));
    if joliet {
        out[88..91].copy_from_slice(b"%/E");
    }
    out[120..124].copy_from_slice(&both16(1));
    out[124..128].copy_from_slice(&both16(1));
    out[128..132].copy_from_slice(&both16(SECTOR as u16));
    let (table_len, l, m) = if joliet {
        (layout.j_table_len, layout.j_l, layout.j_m)
    } else {
        (layout.p_table_len, layout.p_l, layout.p_m)
    };
    out[132..140].copy_from_slice(&both32(table_len));
    out[140..144].copy_from_slice(&l.to_le_bytes());
    out[148..152].copy_from_slice(&m.to_be_bytes());

    let root = &nodes[0];
    let (lba, len) = if joliet { (root.j_lba, root.j_dir_len) } else { (root.lba, root.dir_len) };
    out[156..190].copy_from_slice(&directory_record(lba, len, record_date(root.mtime), true, &[0], &[]));

    // Identifiants de jeu, d'éditeur, de préparateur, d'application : 128 octets
    // chacun, remplis d'espaces (ou de leur équivalent UCS-2).
    for (at, value) in [(190, ""), (318, ""), (446, "FourTout"), (574, "FourTout")] {
        text(&mut out, at, 128, value);
    }
    for at in [702, 739, 776] {
        text(&mut out, at, 37, "");
    }
    let created = volume_date(now);
    out[813..830].copy_from_slice(&created);
    out[830..847].copy_from_slice(&created);
    let never = {
        let mut v = [b'0'; 17];
        v[16] = 0;
        v
    };
    out[847..864].copy_from_slice(&never);
    out[864..881].copy_from_slice(&created);
    out[881] = 1;
    out
}

fn path_table(nodes: &[Node], order: &[usize], tree: Tree, big_endian: bool) -> Vec<u8> {
    let mut out = Vec::new();
    for &dir in order {
        let node = &nodes[dir];
        let id: &[u8] = if dir == 0 { &[0] } else { id_of(node, tree) };
        let (lba, parent) = match tree {
            Tree::Primary => (node.lba, nodes[node.parent].p_num),
            Tree::Joliet => (node.j_lba, nodes[node.parent].j_num),
        };
        let parent = if dir == 0 { 1 } else { parent };
        out.push(id.len() as u8);
        out.push(0);
        if big_endian {
            out.extend_from_slice(&lba.to_be_bytes());
            out.extend_from_slice(&parent.to_be_bytes());
        } else {
            out.extend_from_slice(&lba.to_le_bytes());
            out.extend_from_slice(&parent.to_le_bytes());
        }
        out.extend_from_slice(id);
        if id.len() % 2 == 1 {
            out.push(0);
        }
    }
    out
}

fn directory_bytes(nodes: &[Node], dir: usize, tree: Tree) -> Vec<u8> {
    let node = &nodes[dir];
    let (own_lba, own_len) = match tree {
        Tree::Primary => (node.lba, node.dir_len),
        Tree::Joliet => (node.j_lba, node.j_dir_len),
    };
    let parent = &nodes[if dir == 0 { 0 } else { node.parent }];
    let (parent_lba, parent_len) = match tree {
        Tree::Primary => (parent.lba, parent.dir_len),
        Tree::Joliet => (parent.j_lba, parent.j_dir_len),
    };
    let rr = tree == Tree::Primary;
    let su_dot = if rr { dot_system_use(nodes, dir, true) } else { Vec::new() };
    let su_dotdot = if rr { dot_system_use(nodes, dir, false) } else { Vec::new() };

    let mut records = vec![
        directory_record(own_lba, own_len, record_date(node.mtime), true, &[0], &su_dot),
        directory_record(parent_lba, parent_len, record_date(parent.mtime), true, &[1], &su_dotdot),
    ];
    let mut children = node.children.clone();
    children.sort_by(|&a, &b| id_of(&nodes[a], tree).cmp(id_of(&nodes[b], tree)));
    for child in children {
        let c = &nodes[child];
        let (extent, length) = match (c.is_dir, tree) {
            (true, Tree::Primary) => (c.lba, c.dir_len),
            (true, Tree::Joliet) => (c.j_lba, c.j_dir_len),
            (false, _) => (c.lba, c.size as u32),
        };
        let su: &[u8] = if rr { &c.su } else { &[] };
        records.push(directory_record(extent, length, record_date(c.mtime), c.is_dir, id_of(c, tree), su));
    }

    let mut out = vec![0_u8; own_len as usize];
    let mut at = 0_usize;
    for record in records {
        if at % SECTOR as usize + record.len() > SECTOR as usize {
            at = at.div_ceil(SECTOR as usize) * SECTOR as usize;
        }
        out[at..at + record.len()].copy_from_slice(&record);
        at += record.len();
    }
    out
}

fn write_image(
    nodes: &[Node],
    layout: &Layout,
    options: &CreateOptions,
    part: &Path,
    reporter: &Reporter,
) -> Result<(), String> {
    let now = options.fixed_time.unwrap_or_else(|| unix_seconds(Ok(std::time::SystemTime::now())));
    let file = File::create(part).map_err(|e| format!("Création impossible : {e}"))?;
    let mut out = BufWriter::with_capacity(1 << 20, file);
    let fail = |e: std::io::Error| format!("Écriture impossible (disque plein ?) : {e}");

    let zero_sector = [0_u8; SECTOR as usize];
    for _ in 0..SYSTEM_AREA_SECTORS {
        out.write_all(&zero_sector).map_err(fail)?;
    }
    out.write_all(&descriptor(options, nodes, layout, Tree::Primary, now)).map_err(fail)?;
    if options.joliet {
        out.write_all(&descriptor(options, nodes, layout, Tree::Joliet, now)).map_err(fail)?;
    }
    let mut terminator = vec![0_u8; SECTOR as usize];
    terminator[0] = 255;
    terminator[1..6].copy_from_slice(super::STANDARD_ID);
    terminator[6] = 1;
    out.write_all(&terminator).map_err(fail)?;

    let write_padded = |out: &mut BufWriter<File>, bytes: &[u8]| -> Result<(), String> {
        out.write_all(bytes).map_err(fail)?;
        let remainder = bytes.len() % SECTOR as usize;
        if remainder != 0 {
            out.write_all(&zero_sector[..SECTOR as usize - remainder]).map_err(fail)?;
        }
        Ok(())
    };
    write_padded(&mut out, &path_table(nodes, &layout.p_dirs, Tree::Primary, false))?;
    write_padded(&mut out, &path_table(nodes, &layout.p_dirs, Tree::Primary, true))?;
    if options.joliet {
        write_padded(&mut out, &path_table(nodes, &layout.j_dirs, Tree::Joliet, false))?;
        write_padded(&mut out, &path_table(nodes, &layout.j_dirs, Tree::Joliet, true))?;
    }
    for &dir in &layout.p_dirs {
        out.write_all(&directory_bytes(nodes, dir, Tree::Primary)).map_err(fail)?;
    }
    for &dir in &layout.j_dirs {
        out.write_all(&directory_bytes(nodes, dir, Tree::Joliet)).map_err(fail)?;
    }

    let total: u64 = layout.files.iter().map(|&f| nodes[f].size).sum();
    let mut done = 0_u64;
    let mut buffer = vec![0_u8; 1 << 20];
    for &index in &layout.files {
        reporter.check()?;
        let node = &nodes[index];
        let mut source = File::open(&node.source)
            .map_err(|e| format!("Lecture impossible de « {} » : {e}", node.source.display()))?;
        let mut written = 0_u64;
        loop {
            reporter.check()?;
            let read = source
                .read(&mut buffer)
                .map_err(|e| format!("Lecture impossible de « {} » : {e}", node.source.display()))?;
            if read == 0 {
                break;
            }
            written += read as u64;
            if written > node.size {
                break;
            }
            out.write_all(&buffer[..read]).map_err(fail)?;
            done += read as u64;
            reporter.report(done, total, &node.name);
        }
        if written != node.size {
            // Les tailles sont déjà écrites dans les répertoires : un fichier
            // modifié en cours de route produirait une image incohérente.
            return Err(format!("« {} » a changé pendant l'écriture de l'image.", node.name));
        }
        let remainder = (node.size % SECTOR) as usize;
        if remainder != 0 {
            out.write_all(&zero_sector[..SECTOR as usize - remainder]).map_err(fail)?;
        }
    }
    out.flush().map_err(fail)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primary_identifiers_follow_iso_9660() {
        assert_eq!(primary_file_id("readme.txt", 0), "README.TXT;1");
        assert_eq!(primary_file_id("Makefile", 0), "MAKEFILE.;1");
        assert_eq!(primary_file_id("é accentué.md", 0), "__ACCENTU_.MD;1");
        assert_eq!(primary_file_id(".hidden", 0), "_HIDDEN.;1");
        let long = primary_file_id(&format!("{}.dat", "a".repeat(80)), 0);
        assert!(long.len() <= 30 + 2, "{long}");
        assert!(long.ends_with(".DAT;1"));
        assert_eq!(primary_dir_id("Mes Photos", 0), "MES_PHOTOS");
        assert_ne!(primary_file_id("a.txt", 1), primary_file_id("a.txt", 0));
        assert!(primary_dir_id(&"d".repeat(50), 3).len() <= 31);
    }

    #[test]
    fn joliet_keeps_unicode_and_the_extension() {
        let name = joliet_name("日本語-café.txt", 0);
        assert_eq!(String::from_utf16_lossy(&name), "日本語-café.txt");
        assert_eq!(String::from_utf16_lossy(&joliet_name("a:b?c.txt", 0)), "a_b_c.txt");
        let long = joliet_name(&format!("{}.pdf", "x".repeat(100)), 0);
        assert_eq!(long.len(), 64);
        assert!(String::from_utf16_lossy(&long).ends_with(".pdf"));
        assert!(joliet_name(&"y".repeat(100), 12).len() <= 64);
    }

    #[test]
    fn volume_labels_are_restricted_to_d_characters() {
        assert_eq!(volume_id_primary("Mon disque 2026"), "MON_DISQUE_2026");
        assert_eq!(volume_id_primary("  "), "CDROM");
        assert_eq!(volume_id_primary(&"a".repeat(60)).len(), 32);
    }

    #[test]
    fn records_have_even_lengths() {
        for id_len in 1..40 {
            for su in [0, 2, 38] {
                assert_eq!(record_len(id_len, su) % 2, 0, "id {id_len} su {su}");
                let record = directory_record(0, 0, [0; 7], false, &vec![b'A'; id_len], &vec![0; su]);
                assert_eq!(record.len(), record_len(id_len, su));
            }
        }
    }
}
