//! Inventaire des disques, partitions et volumes — **en lecture seule**.
//!
//! Ce module lit. Il n'écrit nulle part, et il n'existe aucun chemin de code
//! capable d'ouvrir un périphérique bloc en écriture : pas de partitionnement,
//! pas de formatage, pas de réparation de système de fichiers, pas d'écriture
//! d'image, pas de clonage, pas d'effacement, pas de montage ni de démontage.
//! Ces opérations appartiennent à un outil de sauvetage dédié — elles n'ont pas
//! leur place dans une boîte à outils de bureau, où un clic malheureux coûterait
//! un disque entier.
//!
//! Il n'y a pas non plus de bouton « Réparer le disque », « Optimiser » ou
//! « Corriger les secteurs ». Ces formulations ne veulent rien dire de précis,
//! et un bouton dont on ne peut pas énoncer l'effet exact n'a rien à faire ici.
//!
//! # Organisation
//!
//! - [`linux`] et [`windows`] fournissent les données brutes du système ;
//! - [`smart`] interroge, quand c'est possible, les indicateurs de santé ;
//! - les analyseurs sont séparés des fournisseurs, pour qu'ils se testent sur
//!   des relevés figés plutôt que sur le matériel de la machine de
//!   développement.

pub mod command;
#[cfg(target_os = "linux")]
pub mod linux;
pub mod smart;
// Compilé sur toutes les plateformes, et pas seulement sous Windows : seules
// l'exécution de PowerShell et l'entrée publique portent `cfg(windows)`. Les
// analyseurs, eux, doivent être éprouvés ici, sur la machine de développement
// Fedora, faute de quoi ils ne le seraient nulle part.
pub mod windows;

use serde::{Deserialize, Serialize};

/// Type de raccordement d'un disque, tel que le système le rapporte.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Transport {
    Sata,
    Nvme,
    Usb,
    Mmc,
    Virtual,
    /// Le système n'a pas dit comment ce disque est raccordé.
    #[default]
    Unknown,
}

impl Transport {
    pub fn label(self) -> &'static str {
        match self {
            Transport::Sata => "SATA / ATA",
            Transport::Nvme => "NVMe",
            Transport::Usb => "USB",
            Transport::Mmc => "Carte mémoire",
            Transport::Virtual => "Virtuel",
            Transport::Unknown => "Inconnu",
        }
    }
}

/// Une partition d'un disque physique.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Partition {
    /// Nom système (`sda1`, `nvme0n1p2`, `Disk #0, Partition #1`).
    pub name: String,
    /// Numéro de partition, quand le système le donne.
    pub number: Option<u32>,
    /// Taille en octets.
    pub size: u64,
    /// Décalage du début de la partition, en octets.
    pub offset: Option<u64>,
    /// Type déclaré : GUID de type GPT, ou identifiant MBR.
    pub kind: Option<String>,
    /// Identifiant unique de la partition (GPT).
    pub guid: Option<String>,
    /// Partition système EFI ou marquée amorçable.
    pub boot: bool,
    /// Volume monté correspondant, s'il y en a un.
    pub volume: Option<Volume>,
}

/// Un volume : un système de fichiers, monté ou non.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    /// Système de fichiers (`ext4`, `btrfs`, `NTFS`…).
    pub filesystem: Option<String>,
    pub label: Option<String>,
    /// Identifiant du système de fichiers. Donnée sensible : affichée, jamais
    /// enregistrée.
    pub uuid: Option<String>,
    /// Point de montage, quand le volume est monté.
    pub mount_point: Option<String>,
    pub total_bytes: Option<u64>,
    pub used_bytes: Option<u64>,
    pub available_bytes: Option<u64>,
    /// Monté en lecture seule.
    pub read_only: bool,
}

/// Un disque physique.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Disk {
    /// Nom système (`sda`, `nvme0n1`, `\\\\.\\PhysicalDrive0`).
    pub name: String,
    /// Chemin du périphérique, à titre informatif.
    pub path: String,
    pub model: Option<String>,
    pub vendor: Option<String>,
    /// Capacité en octets.
    pub size: u64,
    pub transport: Transport,
    pub removable: bool,
    pub read_only: bool,
    /// Disque à plateaux (`Some(true)`), à mémoire flash (`Some(false)`), ou
    /// indéterminé.
    pub rotational: Option<bool>,
    /// Numéro de série. Donnée sensible : affichée, jamais enregistrée.
    pub serial: Option<String>,
    /// Schéma de partitionnement : `gpt`, `mbr`, ou inconnu.
    pub partition_table: Option<String>,
    pub partitions: Vec<Partition>,
    /// Vrai si ce disque porte le volume qui contient le système.
    pub system: bool,
}

/// Inventaire complet, tel qu'il est rendu à l'interface.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInventory {
    pub disks: Vec<Disk>,
    /// Volumes montés sans disque physique identifié (réseau, tmpfs, images).
    pub other_volumes: Vec<Volume>,
    /// Nom du fournisseur employé, pour que l'affichage ne puisse pas mentir
    /// sur l'origine des données.
    pub provider: String,
    /// Ce que le système n'a pas voulu ou pas su donner.
    pub notes: Vec<String>,
}

/// Taille lisible, en unités binaires.
pub fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["o", "Kio", "Mio", "Gio", "Tio"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} o")
    } else {
        format!("{value:.1} {}", UNITS[unit]).replace('.', ",")
    }
}

/// Espace occupé et disponible d'un point de montage.
///
/// `statvfs` est la seule interface portable pour cette information, et elle
/// est absente de la bibliothèque standard. L'espace « disponible » retenu est
/// celui offert à un utilisateur ordinaire (`f_bavail`), pas celui réservé à
/// l'administrateur : c'est le chiffre que l'utilisateur constatera vraiment.
#[cfg(unix)]
pub fn mount_usage(mount_point: &str) -> Option<(u64, u64, u64)> {
    use std::ffi::CString;

    let path = CString::new(mount_point).ok()?;
    let mut stats: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY : `path` est une chaîne C valide, `stats` une structure allouée
    // par nous. `statvfs` ne fait que lire.
    if unsafe { libc::statvfs(path.as_ptr(), &mut stats) } != 0 {
        return None;
    }
    let block = stats.f_frsize as u64;
    let total = stats.f_blocks as u64 * block;
    let available = stats.f_bavail as u64 * block;
    let used = total.saturating_sub(stats.f_bfree as u64 * block);
    Some((total, used, available))
}

#[cfg(not(unix))]
pub fn mount_usage(_mount_point: &str) -> Option<(u64, u64, u64)> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_sizes_the_way_a_file_manager_does() {
        assert_eq!(human_size(512), "512 o");
        assert_eq!(human_size(1024), "1,0 Kio");
        assert_eq!(human_size(1024 * 1024 * 1024), "1,0 Gio");
        assert_eq!(human_size(500_107_862_016), "465,8 Gio");
    }

    #[test]
    fn names_every_transport_without_inventing_one() {
        assert_eq!(Transport::Nvme.label(), "NVMe");
        assert_eq!(Transport::Usb.label(), "USB");
        assert_eq!(Transport::Unknown.label(), "Inconnu");
    }
}
