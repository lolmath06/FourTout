//! Fournisseur Linux : `/sys`, `/proc` et `/dev/disk/by-*`.
//!
//! Tout vient de fichiers que le noyau expose en lecture, sans privilège
//! particulier et sans appeler le moindre programme externe. Aucune commande
//! n'est construite à partir d'une saisie : il n'y a pas de commande du tout.
//!
//! L'accès au système de fichiers passe par le trait [`SysSource`]. Cette
//! indirection n'est pas de la cérémonie : elle permet de faire tourner
//! l'analyseur sur un relevé figé — un disque SATA, un NVMe, une clé USB, une
//! table GPT, une table MBR — plutôt que sur le matériel de la machine qui
//! exécute les tests, dont on ne sait rien.

use std::collections::BTreeMap;

use super::{Disk, Partition, Transport, Volume};

/// Accès en lecture au système de fichiers pseudo du noyau.
pub trait SysSource {
    fn read(&self, path: &str) -> Option<String>;
    fn list(&self, path: &str) -> Vec<String>;
    /// Cible d'un lien symbolique, telle quelle.
    fn link_target(&self, path: &str) -> Option<String>;
}

/// Le vrai `/sys` et le vrai `/proc`.
pub struct RealSys;

impl SysSource for RealSys {
    fn read(&self, path: &str) -> Option<String> {
        std::fs::read_to_string(path).ok().map(|text| text.trim().to_string())
    }

    fn list(&self, path: &str) -> Vec<String> {
        let Ok(entries) = std::fs::read_dir(path) else {
            return Vec::new();
        };
        let mut names: Vec<String> =
            entries.filter_map(|entry| entry.ok()).map(|entry| entry.file_name().to_string_lossy().to_string()).collect();
        names.sort();
        names
    }

    fn link_target(&self, path: &str) -> Option<String> {
        std::fs::read_link(path).ok().map(|target| target.to_string_lossy().to_string())
    }
}

/// Un `/sys` de laboratoire, pour les tests.
#[derive(Default)]
pub struct FakeSys {
    pub files: BTreeMap<String, String>,
    pub dirs: BTreeMap<String, Vec<String>>,
    pub links: BTreeMap<String, String>,
}

impl SysSource for FakeSys {
    fn read(&self, path: &str) -> Option<String> {
        self.files.get(path).cloned()
    }
    fn list(&self, path: &str) -> Vec<String> {
        self.dirs.get(path).cloned().unwrap_or_default()
    }
    fn link_target(&self, path: &str) -> Option<String> {
        self.links.get(path).cloned()
    }
}

/// Une ligne de `/proc/self/mountinfo`, réduite à ce qui nous intéresse.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MountEntry {
    pub source: String,
    pub mount_point: String,
    pub filesystem: String,
    pub read_only: bool,
}

/// Remplace les échappements octaux de `mountinfo` (`\040` pour l'espace).
fn unescape(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'\\' && index + 3 < bytes.len() {
            let digits = &value[index + 1..index + 4];
            if let Ok(code) = u8::from_str_radix(digits, 8) {
                output.push(code as char);
                index += 4;
                continue;
            }
        }
        output.push(bytes[index] as char);
        index += 1;
    }
    output
}

/// Analyse `/proc/self/mountinfo`.
///
/// Le format place les champs variables au milieu : la partie fixe se termine
/// par un tiret isolé, qu'il faut chercher plutôt que de compter les colonnes.
pub fn parse_mountinfo(text: &str) -> Vec<MountEntry> {
    let mut mounts = Vec::new();
    for line in text.lines() {
        let Some(separator) = line.split_whitespace().position(|field| field == "-") else {
            continue;
        };
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < separator + 3 || separator < 6 {
            continue;
        }
        let mount_point = unescape(fields[4]);
        let options = fields[5];
        let filesystem = fields[separator + 1].to_string();
        let source = unescape(fields[separator + 2]);
        mounts.push(MountEntry {
            source,
            mount_point,
            filesystem,
            read_only: options.split(',').any(|option| option == "ro"),
        });
    }
    mounts
}

/// Déduit le raccordement du chemin du périphérique dans `/sys`.
fn transport_of(link: &str, name: &str) -> Transport {
    if name.starts_with("nvme") || link.contains("/nvme/") {
        Transport::Nvme
    } else if link.contains("/usb") {
        Transport::Usb
    } else if name.starts_with("mmcblk") || link.contains("/mmc_host/") {
        Transport::Mmc
    } else if link.contains("/ata") || link.contains("/host") {
        Transport::Sata
    } else if name.starts_with("vd") || link.contains("/virtio") {
        Transport::Virtual
    } else {
        Transport::Unknown
    }
}

fn read_u64(source: &dyn SysSource, path: &str) -> Option<u64> {
    source.read(path)?.trim().parse().ok()
}

fn read_flag(source: &dyn SysSource, path: &str) -> bool {
    source.read(path).map(|value| value.trim() == "1").unwrap_or(false)
}

/// Construit la table `nom de périphérique → (uuid, label)` à partir des liens
/// de `/dev/disk/by-uuid` et `/dev/disk/by-label`.
fn identifiers(source: &dyn SysSource) -> (BTreeMap<String, String>, BTreeMap<String, String>) {
    let mut uuids = BTreeMap::new();
    let mut labels = BTreeMap::new();

    for (directory, target) in
        [("/dev/disk/by-uuid", &mut uuids), ("/dev/disk/by-label", &mut labels)]
    {
        for entry in source.list(directory) {
            let Some(link) = source.link_target(&format!("{directory}/{entry}")) else {
                continue;
            };
            if let Some(device) = link.rsplit('/').next() {
                target.insert(device.to_string(), unescape(&entry));
            }
        }
    }
    (uuids, labels)
}

/// Espace d'un point de montage : total, occupé, disponible.
///
/// Passée en paramètre plutôt qu'appelée directement, pour que l'analyseur se
/// teste avec des chiffres choisis au lieu de ceux de la machine.
pub type UsageProbe<'a> = &'a dyn Fn(&str) -> Option<(u64, u64, u64)>;

/// Le secteur logique de `/sys` vaut toujours 512 octets, quelle que soit la
/// taille de secteur physique du disque. C'est une convention du noyau, pas une
/// approximation.
const SYS_SECTOR: u64 = 512;

/// Dresse l'inventaire à partir d'une source de lecture.
pub fn inventory(
    source: &dyn SysSource,
    usage: UsageProbe<'_>,
) -> super::StorageInventory {
    let mut inventory = super::StorageInventory {
        provider: "Linux — /sys, /proc/self/mountinfo".to_string(),
        ..super::StorageInventory::default()
    };

    let mounts = source
        .read("/proc/self/mountinfo")
        .map(|text| parse_mountinfo(&text))
        .unwrap_or_default();
    let (uuids, labels) = identifiers(source);

    // Point de montage du système, pour le signaler sans rien en faire.
    let root_source = mounts
        .iter()
        .find(|mount| mount.mount_point == "/")
        .map(|mount| mount.source.clone())
        .unwrap_or_default();

    let mut claimed: Vec<String> = Vec::new();

    for name in source.list("/sys/block") {
        // Les périphériques virtuels de boucle et de RAM n'ont rien d'un
        // disque : les lister comme tels ne renseignerait personne.
        if name.starts_with("loop") || name.starts_with("ram") || name.starts_with("zram") {
            continue;
        }
        let base = format!("/sys/block/{name}");
        let link = source.link_target(&base).unwrap_or_default();

        let mut disk = Disk {
            path: format!("/dev/{name}"),
            size: read_u64(source, &format!("{base}/size")).unwrap_or(0) * SYS_SECTOR,
            model: source.read(&format!("{base}/device/model")).filter(|m| !m.is_empty()),
            vendor: source.read(&format!("{base}/device/vendor")).filter(|v| !v.is_empty()),
            serial: source.read(&format!("{base}/device/serial")).filter(|s| !s.is_empty()),
            removable: read_flag(source, &format!("{base}/removable")),
            read_only: read_flag(source, &format!("{base}/ro")),
            rotational: source
                .read(&format!("{base}/queue/rotational"))
                .and_then(|value| match value.trim() {
                    "1" => Some(true),
                    "0" => Some(false),
                    _ => None,
                }),
            transport: transport_of(&link, &name),
            name: name.clone(),
            ..Disk::default()
        };

        // Partitions : les sous-dossiers qui portent un fichier `partition`.
        for child in source.list(&base) {
            let child_base = format!("{base}/{child}");
            let Some(number) = read_u64(source, &format!("{child_base}/partition")) else {
                continue;
            };
            let device = format!("/dev/{child}");
            claimed.push(device.clone());

            let mut partition = Partition {
                number: Some(number as u32),
                size: read_u64(source, &format!("{child_base}/size")).unwrap_or(0) * SYS_SECTOR,
                offset: read_u64(source, &format!("{child_base}/start"))
                    .map(|start| start * SYS_SECTOR),
                kind: source.read(&format!("{child_base}/partition_type_uuid")),
                guid: source.read(&format!("{child_base}/partition_uuid")),
                boot: read_flag(source, &format!("{child_base}/partition_boot")),
                name: child.clone(),
                volume: None,
            };

            let mount = mounts.iter().find(|mount| mount.source == device);
            let uuid = uuids.get(&child).cloned();
            let label = labels.get(&child).cloned();
            if mount.is_some() || uuid.is_some() || label.is_some() {
                let mut volume = Volume {
                    filesystem: mount.map(|mount| mount.filesystem.clone()),
                    mount_point: mount.map(|mount| mount.mount_point.clone()),
                    read_only: mount.map(|mount| mount.read_only).unwrap_or(false),
                    uuid,
                    label,
                    ..Volume::default()
                };
                if let Some(point) = volume.mount_point.as_deref() {
                    if let Some((total, used, available)) = usage(point) {
                        volume.total_bytes = Some(total);
                        volume.used_bytes = Some(used);
                        volume.available_bytes = Some(available);
                    }
                }
                partition.volume = Some(volume);
            }

            if device == root_source {
                disk.system = true;
            }
            disk.partitions.push(partition);
        }

        // Le schéma de partitionnement se déduit de ce que le noyau expose :
        // un identifiant de type GUID signe une table GPT.
        disk.partition_table = if disk.partitions.iter().any(|p| p.guid.is_some()) {
            Some("gpt".into())
        } else if !disk.partitions.is_empty() {
            Some("mbr".into())
        } else {
            None
        };

        inventory.disks.push(disk);
    }

    // Volumes montés qui ne correspondent à aucune partition listée : images,
    // systèmes de fichiers réseau, tmpfs. On les montre à part plutôt que de
    // les rattacher arbitrairement à un disque.
    for mount in &mounts {
        if claimed.contains(&mount.source) {
            continue;
        }
        if !mount.source.starts_with("/dev/") {
            continue;
        }
        let mut volume = Volume {
            filesystem: Some(mount.filesystem.clone()),
            mount_point: Some(mount.mount_point.clone()),
            read_only: mount.read_only,
            label: labels
                .get(mount.source.trim_start_matches("/dev/"))
                .cloned(),
            uuid: uuids.get(mount.source.trim_start_matches("/dev/")).cloned(),
            ..Volume::default()
        };
        if let Some((total, used, available)) = usage(&mount.mount_point) {
            volume.total_bytes = Some(total);
            volume.used_bytes = Some(used);
            volume.available_bytes = Some(available);
        }
        inventory.other_volumes.push(volume);
    }

    if inventory.disks.iter().all(|disk| disk.serial.is_none()) {
        inventory.notes.push(
            "Les numéros de série ne sont pas exposés à un utilisateur ordinaire sur cette \
             machine. FourTout ne demande pas de privilèges supplémentaires pour les obtenir."
                .to_string(),
        );
    }

    inventory
}

#[cfg(test)]
mod tests {
    use super::*;

    const MOUNTINFO: &str = "\
25 30 0:23 / /proc rw,nosuid,nodev,noexec,relatime shared:5 - proc proc rw
30 1 259:2 / / rw,relatime shared:1 - btrfs /dev/nvme0n1p2 rw,ssd,subvol=/root
36 30 259:1 / /boot/efi rw,relatime shared:9 - vfat /dev/nvme0n1p1 rw,fmask=0077
48 30 8:1 / /run/media/matheo/CLE\\040USB ro,nosuid,relatime shared:33 - exfat /dev/sda1 ro
52 30 0:40 / /tmp rw,nosuid,nodev shared:29 - tmpfs tmpfs rw";

    /// Un relevé synthétique : un NVMe partitionné en GPT et une clé USB en MBR.
    fn machine() -> FakeSys {
        let mut sys = FakeSys::default();
        let file = |sys: &mut FakeSys, path: &str, value: &str| {
            sys.files.insert(path.to_string(), value.to_string());
        };

        sys.files.insert("/proc/self/mountinfo".into(), MOUNTINFO.into());
        sys.dirs.insert("/sys/block".into(), vec!["nvme0n1".into(), "sda".into(), "loop0".into()]);

        // NVMe 500 Go, GPT, deux partitions, non amovible, non rotatif.
        sys.links.insert(
            "/sys/block/nvme0n1".into(),
            "../devices/pci0000:00/0000:00:1d.0/nvme/nvme0/nvme0n1".into(),
        );
        file(&mut sys, "/sys/block/nvme0n1/size", "976773168");
        file(&mut sys, "/sys/block/nvme0n1/removable", "0");
        file(&mut sys, "/sys/block/nvme0n1/ro", "0");
        file(&mut sys, "/sys/block/nvme0n1/queue/rotational", "0");
        file(&mut sys, "/sys/block/nvme0n1/device/model", "Samsung SSD 980 500GB");
        sys.dirs.insert(
            "/sys/block/nvme0n1".into(),
            vec!["nvme0n1p1".into(), "nvme0n1p2".into(), "queue".into(), "device".into()],
        );
        file(&mut sys, "/sys/block/nvme0n1/nvme0n1p1/partition", "1");
        file(&mut sys, "/sys/block/nvme0n1/nvme0n1p1/size", "1228800");
        file(&mut sys, "/sys/block/nvme0n1/nvme0n1p1/start", "2048");
        file(
            &mut sys,
            "/sys/block/nvme0n1/nvme0n1p1/partition_type_uuid",
            "c12a7328-f81f-11d2-ba4b-00a0c93ec93b",
        );
        file(
            &mut sys,
            "/sys/block/nvme0n1/nvme0n1p1/partition_uuid",
            "1111aaaa-0000-0000-0000-000000000001",
        );
        file(&mut sys, "/sys/block/nvme0n1/nvme0n1p2/partition", "2");
        file(&mut sys, "/sys/block/nvme0n1/nvme0n1p2/size", "975542272");
        file(&mut sys, "/sys/block/nvme0n1/nvme0n1p2/start", "1230848");
        file(
            &mut sys,
            "/sys/block/nvme0n1/nvme0n1p2/partition_uuid",
            "1111aaaa-0000-0000-0000-000000000002",
        );

        // Clé USB 8 Go, MBR, une partition montée en lecture seule.
        sys.links.insert(
            "/sys/block/sda".into(),
            "../devices/pci0000:00/0000:00:14.0/usb2/2-1/2-1:1.0/host6/target6:0:0/6:0:0:0/block/sda"
                .into(),
        );
        file(&mut sys, "/sys/block/sda/size", "15728640");
        file(&mut sys, "/sys/block/sda/removable", "1");
        file(&mut sys, "/sys/block/sda/ro", "0");
        file(&mut sys, "/sys/block/sda/queue/rotational", "1");
        file(&mut sys, "/sys/block/sda/device/model", "Ultra Fit");
        file(&mut sys, "/sys/block/sda/device/vendor", "SanDisk");
        sys.dirs.insert("/sys/block/sda".into(), vec!["sda1".into(), "queue".into()]);
        file(&mut sys, "/sys/block/sda/sda1/partition", "1");
        file(&mut sys, "/sys/block/sda/sda1/size", "15726592");
        file(&mut sys, "/sys/block/sda/sda1/start", "2048");

        // Identifiants exposés par les liens de /dev/disk.
        sys.dirs.insert(
            "/dev/disk/by-uuid".into(),
            vec!["A1B2-C3D4".into(), "7f3d-root-uuid".into()],
        );
        sys.links
            .insert("/dev/disk/by-uuid/A1B2-C3D4".into(), "../../nvme0n1p1".into());
        sys.links
            .insert("/dev/disk/by-uuid/7f3d-root-uuid".into(), "../../nvme0n1p2".into());
        sys.dirs.insert("/dev/disk/by-label".into(), vec!["CLE\\040USB".into()]);
        sys.links.insert("/dev/disk/by-label/CLE\\040USB".into(), "../../sda1".into());

        sys
    }

    fn no_usage(_: &str) -> Option<(u64, u64, u64)> {
        None
    }

    #[test]
    fn reads_mountinfo_including_escaped_spaces() {
        let mounts = parse_mountinfo(MOUNTINFO);
        assert_eq!(mounts.len(), 5);

        let root = mounts.iter().find(|m| m.mount_point == "/").unwrap();
        assert_eq!(root.source, "/dev/nvme0n1p2");
        assert_eq!(root.filesystem, "btrfs");
        assert!(!root.read_only);

        let usb = mounts.iter().find(|m| m.source == "/dev/sda1").unwrap();
        assert_eq!(usb.mount_point, "/run/media/matheo/CLE USB");
        assert_eq!(usb.filesystem, "exfat");
        assert!(usb.read_only, "le montage porte l'option ro");
    }

    #[test]
    fn lists_physical_disks_without_the_loop_devices() {
        let inventory = inventory(&machine(), &no_usage);
        let names: Vec<&str> = inventory.disks.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(names, vec!["nvme0n1", "sda"]);
    }

    #[test]
    fn describes_an_nvme_disk_and_its_gpt_table() {
        let inventory = inventory(&machine(), &no_usage);
        let disk = inventory.disks.iter().find(|d| d.name == "nvme0n1").unwrap();

        assert_eq!(disk.transport, Transport::Nvme);
        assert_eq!(disk.size, 976_773_168 * 512);
        assert_eq!(disk.model.as_deref(), Some("Samsung SSD 980 500GB"));
        assert_eq!(disk.rotational, Some(false));
        assert!(!disk.removable);
        assert_eq!(disk.partition_table.as_deref(), Some("gpt"));
        assert!(disk.system, "ce disque porte la racine du système");

        assert_eq!(disk.partitions.len(), 2);
        let efi = &disk.partitions[0];
        assert_eq!(efi.number, Some(1));
        assert_eq!(efi.offset, Some(2048 * 512));
        assert_eq!(efi.kind.as_deref(), Some("c12a7328-f81f-11d2-ba4b-00a0c93ec93b"));
        let efi_volume = efi.volume.as_ref().unwrap();
        assert_eq!(efi_volume.filesystem.as_deref(), Some("vfat"));
        assert_eq!(efi_volume.mount_point.as_deref(), Some("/boot/efi"));
        assert_eq!(efi_volume.uuid.as_deref(), Some("A1B2-C3D4"));
    }

    #[test]
    fn describes_a_removable_usb_key_mounted_read_only() {
        let inventory = inventory(&machine(), &no_usage);
        let disk = inventory.disks.iter().find(|d| d.name == "sda").unwrap();

        assert_eq!(disk.transport, Transport::Usb);
        assert!(disk.removable);
        assert_eq!(disk.vendor.as_deref(), Some("SanDisk"));
        assert_eq!(disk.partition_table.as_deref(), Some("mbr"));
        assert!(!disk.system);

        let volume = disk.partitions[0].volume.as_ref().unwrap();
        assert!(volume.read_only, "le volume est monté en lecture seule");
        assert_eq!(volume.label.as_deref(), Some("CLE USB"));
        assert_eq!(volume.mount_point.as_deref(), Some("/run/media/matheo/CLE USB"));
    }

    #[test]
    fn reports_free_space_when_the_system_gives_it() {
        let usage = |point: &str| {
            if point == "/" {
                Some((500_000_000_000, 200_000_000_000, 290_000_000_000))
            } else {
                None
            }
        };
        let inventory = inventory(&machine(), &usage);
        let disk = inventory.disks.iter().find(|d| d.name == "nvme0n1").unwrap();
        let root = disk.partitions[1].volume.as_ref().unwrap();
        assert_eq!(root.total_bytes, Some(500_000_000_000));
        assert_eq!(root.available_bytes, Some(290_000_000_000));
        // Le volume EFI n'a pas de chiffre : on n'en invente pas.
        let efi = disk.partitions[0].volume.as_ref().unwrap();
        assert_eq!(efi.total_bytes, None);
    }

    #[test]
    fn says_plainly_when_serial_numbers_are_out_of_reach() {
        let inventory = inventory(&machine(), &no_usage);
        assert!(inventory.disks.iter().all(|disk| disk.serial.is_none()));
        assert!(inventory.notes.iter().any(|note| note.contains("privilèges")));
    }

    #[test]
    fn an_empty_machine_produces_an_empty_inventory_not_a_panic() {
        let inventory = inventory(&FakeSys::default(), &no_usage);
        assert!(inventory.disks.is_empty());
        assert!(inventory.other_volumes.is_empty());
        assert!(inventory.provider.contains("Linux"));
    }
}
