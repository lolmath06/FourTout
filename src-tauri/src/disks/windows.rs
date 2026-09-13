//! Fournisseur Windows : scripts PowerShell **figés**, sortie JSON.
//!
//! Les informations de stockage de Windows sont exposées par le module
//! `Storage` (`Get-Disk`, `Get-Partition`, `Get-Volume`) et par les compteurs de
//! fiabilité (`Get-StorageReliabilityCounter`). Y accéder par une API native
//! demanderait d'ouvrir des poignées sur `\\.\PhysicalDriveN` et d'émettre des
//! IOCTL, ce qui réclame des privilèges administrateur pour la plupart des
//! informations intéressantes — exactement ce que cette phase refuse de
//! demander.
//!
//! Les scripts sont **constants** : aucune saisie utilisateur n'y est
//! interpolée, jamais. Ils sont passés à `powershell.exe` en argument unique,
//! et leur seule sortie est du JSON compact.
//!
//! L'analyseur est séparé de l'exécution : il est éprouvé sur des relevés
//! figés, puisque la machine de développement est une Fedora.

use serde::Deserialize;

use super::smart::SmartReport;
use super::{Disk, Partition, StorageInventory, Transport, Volume};

/// Script d'inventaire. Constant, sans aucune interpolation.
pub const INVENTORY_SCRIPT: &str = "\
$ErrorActionPreference='SilentlyContinue';\
$d=Get-Disk|Select-Object Number,FriendlyName,Manufacturer,Model,SerialNumber,Size,BusType,IsBoot,IsReadOnly,PartitionStyle;\
$p=Get-Partition|Select-Object DiskNumber,PartitionNumber,Size,Offset,GptType,Guid,IsBoot,IsSystem,DriveLetter;\
$v=Get-Volume|Select-Object DriveLetter,FileSystemLabel,FileSystem,Size,SizeRemaining,UniqueId;\
[pscustomobject]@{disks=@($d);partitions=@($p);volumes=@($v)}|ConvertTo-Json -Depth 4 -Compress";

/// Script de santé. Constant lui aussi.
pub const HEALTH_SCRIPT: &str = "\
$ErrorActionPreference='SilentlyContinue';\
$r=Get-PhysicalDisk|ForEach-Object{$c=$_|Get-StorageReliabilityCounter;\
[pscustomobject]@{DeviceId=$_.DeviceId;HealthStatus=$_.HealthStatus;MediaType=$_.MediaType;\
Temperature=$c.Temperature;PowerOnHours=$c.PowerOnHours;Wear=$c.Wear;\
ReadErrorsUncorrected=$c.ReadErrorsUncorrected}};\
@($r)|ConvertTo-Json -Depth 3 -Compress";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PsDisk {
    number: Option<u32>,
    friendly_name: Option<String>,
    manufacturer: Option<String>,
    model: Option<String>,
    serial_number: Option<String>,
    size: Option<u64>,
    bus_type: Option<serde_json::Value>,
    is_boot: Option<bool>,
    is_read_only: Option<bool>,
    partition_style: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PsPartition {
    disk_number: Option<u32>,
    partition_number: Option<u32>,
    size: Option<u64>,
    offset: Option<u64>,
    gpt_type: Option<String>,
    guid: Option<String>,
    is_boot: Option<bool>,
    is_system: Option<bool>,
    drive_letter: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PsVolume {
    drive_letter: Option<serde_json::Value>,
    file_system_label: Option<String>,
    file_system: Option<String>,
    size: Option<u64>,
    size_remaining: Option<u64>,
    unique_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PsInventory {
    disks: Vec<PsDisk>,
    partitions: Vec<PsPartition>,
    volumes: Vec<PsVolume>,
}

/// `ConvertTo-Json` rend une lettre de lecteur tantôt en chaîne, tantôt en
/// point de code numérique. Les deux se ramènent à un caractère.
fn drive_letter(value: &Option<serde_json::Value>) -> Option<char> {
    match value.as_ref()? {
        serde_json::Value::String(text) => text.chars().next().filter(|c| c.is_ascii_alphabetic()),
        serde_json::Value::Number(number) => {
            let code = number.as_u64()? as u32;
            char::from_u32(code).filter(|c| c.is_ascii_alphabetic())
        }
        _ => None,
    }
}

/// Le type de bus est rendu tantôt par son nom, tantôt par son code.
fn transport_of(value: &Option<serde_json::Value>) -> Transport {
    let Some(value) = value else { return Transport::Unknown };
    let text = match value {
        serde_json::Value::String(text) => text.to_ascii_lowercase(),
        serde_json::Value::Number(number) => match number.as_u64() {
            // Codes MSFT_Disk.BusType.
            Some(7) => "usb".to_string(),
            Some(11) => "sata".to_string(),
            Some(17) => "nvme".to_string(),
            Some(12) => "sd".to_string(),
            Some(13) => "mmc".to_string(),
            Some(15) => "virtual".to_string(),
            _ => return Transport::Unknown,
        },
        _ => return Transport::Unknown,
    };
    if text.contains("nvme") {
        Transport::Nvme
    } else if text.contains("usb") {
        Transport::Usb
    } else if text.contains("sata") || text.contains("ata") {
        Transport::Sata
    } else if text.contains("mmc") || text.contains("sd") {
        Transport::Mmc
    } else if text.contains("file backed") || text.contains("virtual") {
        Transport::Virtual
    } else {
        Transport::Unknown
    }
}

fn partition_style(value: &Option<serde_json::Value>) -> Option<String> {
    match value.as_ref()? {
        serde_json::Value::String(text) => Some(text.to_ascii_lowercase()),
        serde_json::Value::Number(number) => match number.as_u64()? {
            1 => Some("mbr".into()),
            2 => Some("gpt".into()),
            _ => None,
        },
        _ => None,
    }
}

/// Analyse la sortie JSON du script d'inventaire.
pub fn parse_inventory(json: &str) -> Result<StorageInventory, String> {
    let parsed: PsInventory =
        serde_json::from_str(json).map_err(|error| format!("Sortie PowerShell illisible : {error}"))?;

    let mut inventory = StorageInventory {
        provider: "Windows — Get-Disk, Get-Partition, Get-Volume".to_string(),
        ..StorageInventory::default()
    };

    for source in &parsed.disks {
        let number = source.number.unwrap_or(0);
        let mut disk = Disk {
            name: format!("Disque {number}"),
            path: format!("\\\\.\\PhysicalDrive{number}"),
            model: source.model.clone().or_else(|| source.friendly_name.clone()),
            vendor: source.manufacturer.clone().filter(|v| !v.trim().is_empty()),
            size: source.size.unwrap_or(0),
            transport: transport_of(&source.bus_type),
            removable: matches!(transport_of(&source.bus_type), Transport::Usb | Transport::Mmc),
            read_only: source.is_read_only.unwrap_or(false),
            rotational: None,
            serial: source.serial_number.clone().filter(|s| !s.trim().is_empty()),
            partition_table: partition_style(&source.partition_style),
            system: source.is_boot.unwrap_or(false),
            partitions: Vec::new(),
        };

        for entry in parsed.partitions.iter().filter(|p| p.disk_number == Some(number)) {
            let letter = drive_letter(&entry.drive_letter);
            let volume = letter.and_then(|letter| {
                let matching = parsed
                    .volumes
                    .iter()
                    .find(|volume| drive_letter(&volume.drive_letter) == Some(letter))?;
                let total = matching.size;
                let free = matching.size_remaining;
                Some(Volume {
                    filesystem: matching.file_system.clone().filter(|f| !f.trim().is_empty()),
                    label: matching.file_system_label.clone().filter(|l| !l.trim().is_empty()),
                    uuid: matching.unique_id.clone(),
                    mount_point: Some(format!("{letter}:\\")),
                    total_bytes: total,
                    used_bytes: match (total, free) {
                        (Some(total), Some(free)) => Some(total.saturating_sub(free)),
                        _ => None,
                    },
                    available_bytes: free,
                    read_only: false,
                })
            });

            disk.partitions.push(Partition {
                name: match letter {
                    Some(letter) => format!("Partition {} ({letter}:)", entry.partition_number.unwrap_or(0)),
                    None => format!("Partition {}", entry.partition_number.unwrap_or(0)),
                },
                number: entry.partition_number,
                size: entry.size.unwrap_or(0),
                offset: entry.offset,
                kind: entry.gpt_type.clone().filter(|t| !t.trim().is_empty()),
                guid: entry.guid.clone().filter(|g| !g.trim().is_empty()),
                boot: entry.is_boot.unwrap_or(false) || entry.is_system.unwrap_or(false),
                volume,
            });
        }

        inventory.disks.push(disk);
    }

    // Volumes sans partition rattachée : lecteurs réseau, disques virtuels
    // montés, espaces de stockage.
    let letters: Vec<char> = inventory
        .disks
        .iter()
        .flat_map(|disk| disk.partitions.iter())
        .filter_map(|partition| partition.volume.as_ref())
        .filter_map(|volume| volume.mount_point.as_ref())
        .filter_map(|point| point.chars().next())
        .collect();

    for volume in &parsed.volumes {
        let Some(letter) = drive_letter(&volume.drive_letter) else { continue };
        if letters.contains(&letter) {
            continue;
        }
        inventory.other_volumes.push(Volume {
            filesystem: volume.file_system.clone().filter(|f| !f.trim().is_empty()),
            label: volume.file_system_label.clone().filter(|l| !l.trim().is_empty()),
            uuid: volume.unique_id.clone(),
            mount_point: Some(format!("{letter}:\\")),
            total_bytes: volume.size,
            used_bytes: match (volume.size, volume.size_remaining) {
                (Some(total), Some(free)) => Some(total.saturating_sub(free)),
                _ => None,
            },
            available_bytes: volume.size_remaining,
            read_only: false,
        });
    }

    if inventory.disks.iter().all(|disk| disk.rotational.is_none()) {
        inventory.notes.push(
            "Windows ne rapporte pas la nature du support (plateaux ou mémoire flash) par cette \
             interface."
                .to_string(),
        );
    }

    Ok(inventory)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PsHealth {
    device_id: Option<serde_json::Value>,
    health_status: Option<serde_json::Value>,
    temperature: Option<i64>,
    power_on_hours: Option<u64>,
    wear: Option<u64>,
    read_errors_uncorrected: Option<u64>,
}

/// Analyse la sortie JSON du script de santé, pour un disque donné.
pub fn parse_health(json: &str, disk_number: u32) -> Result<SmartReport, String> {
    let entries: Vec<PsHealth> = match serde_json::from_str::<serde_json::Value>(json) {
        Ok(serde_json::Value::Array(_)) => serde_json::from_str(json)
            .map_err(|error| format!("Sortie PowerShell illisible : {error}"))?,
        // Un seul disque : `ConvertTo-Json` rend un objet, pas un tableau.
        Ok(serde_json::Value::Object(_)) => vec![serde_json::from_str(json)
            .map_err(|error| format!("Sortie PowerShell illisible : {error}"))?],
        _ => return Err("Sortie PowerShell inattendue.".to_string()),
    };

    let matching = entries.into_iter().find(|entry| {
        entry
            .device_id
            .as_ref()
            .map(|id| match id {
                serde_json::Value::String(text) => text.trim() == disk_number.to_string(),
                serde_json::Value::Number(number) => number.as_u64() == Some(disk_number as u64),
                _ => false,
            })
            .unwrap_or(false)
    });

    let Some(entry) = matching else {
        return Ok(SmartReport {
            available: false,
            provider: "Windows — Get-StorageReliabilityCounter".to_string(),
            notes: vec![
                "Ce disque ne figure pas dans les compteurs de fiabilité rapportés par Windows."
                    .to_string(),
            ],
            ..SmartReport::default()
        });
    };

    let mut report = SmartReport {
        available: true,
        provider: "Windows — Get-StorageReliabilityCounter".to_string(),
        health: entry.health_status.as_ref().and_then(|status| match status {
            serde_json::Value::String(text) => Some(text.clone()),
            serde_json::Value::Number(number) => match number.as_u64() {
                Some(0) => Some("Sain".to_string()),
                Some(1) => Some("Averti".to_string()),
                Some(2) => Some("Défaillant".to_string()),
                _ => None,
            },
            _ => None,
        }),
        temperature_c: entry.temperature,
        power_on_hours: entry.power_on_hours,
        percentage_used: entry.wear,
        uncorrectable_sectors: entry.read_errors_uncorrected,
        ..SmartReport::default()
    };

    if report.temperature_c.is_none() && report.power_on_hours.is_none() {
        report.notes.push(
            "Windows expose l'état de santé de ce disque, mais aucun compteur détaillé. \
             Beaucoup de contrôleurs, notamment USB, ne les transmettent pas."
                .to_string(),
        );
    }

    Ok(report)
}

/// Exécute un script figé et rend sa sortie.
#[cfg(windows)]
fn run(script: &str) -> Result<String, String> {
    use std::process::{Command, Stdio};

    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map_err(|error| format!("PowerShell introuvable : {error}"))?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Inventaire Windows.
#[cfg(windows)]
pub fn inventory() -> StorageInventory {
    match run(INVENTORY_SCRIPT).and_then(|json| parse_inventory(&json)) {
        Ok(inventory) => inventory,
        Err(error) => StorageInventory {
            provider: "Windows — Get-Disk".to_string(),
            notes: vec![format!("Inventaire indisponible : {error}")],
            ..StorageInventory::default()
        },
    }
}

/// Santé d'un disque Windows, désigné par son numéro.
#[cfg(windows)]
pub fn health(device: &str) -> SmartReport {
    let number: u32 = device
        .rsplit(|c: char| !c.is_ascii_digit())
        .find(|part| !part.is_empty())
        .and_then(|digits| digits.parse().ok())
        .unwrap_or(0);
    match run(HEALTH_SCRIPT).and_then(|json| parse_health(&json, number)) {
        Ok(report) => report,
        Err(error) => SmartReport {
            available: false,
            provider: "Windows — Get-StorageReliabilityCounter".to_string(),
            notes: vec![format!("Informations de santé indisponibles : {error}")],
            ..SmartReport::default()
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Relevé PowerShell synthétique : un NVMe système en GPT, une clé USB.
    const INVENTORY: &str = r#"{
      "disks": [
        { "Number": 0, "FriendlyName": "WDC PC SN730", "Manufacturer": "", "Model": "WDC PC SN730 SDBQNTY-512G",
          "SerialNumber": "20345A800123", "Size": 512110190592, "BusType": 17, "IsBoot": true,
          "IsReadOnly": false, "PartitionStyle": 2 },
        { "Number": 1, "FriendlyName": "SanDisk Ultra", "Manufacturer": "SanDisk", "Model": "Ultra USB 3.0",
          "SerialNumber": "4C530001", "Size": 15376000000, "BusType": "USB", "IsBoot": false,
          "IsReadOnly": false, "PartitionStyle": 1 }
      ],
      "partitions": [
        { "DiskNumber": 0, "PartitionNumber": 1, "Size": 104857600, "Offset": 1048576,
          "GptType": "{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}", "Guid": "{aaaa-1}", "IsBoot": false, "IsSystem": true, "DriveLetter": null },
        { "DiskNumber": 0, "PartitionNumber": 2, "Size": 511000000000, "Offset": 122683392,
          "GptType": "{ebd0a0a2-b9e5-4433-87c0-68b6b72699c7}", "Guid": "{aaaa-2}", "IsBoot": true, "IsSystem": false, "DriveLetter": 67 },
        { "DiskNumber": 1, "PartitionNumber": 1, "Size": 15370000000, "Offset": 1048576,
          "GptType": "", "Guid": "", "IsBoot": false, "IsSystem": false, "DriveLetter": "E" }
      ],
      "volumes": [
        { "DriveLetter": 67, "FileSystemLabel": "Windows", "FileSystem": "NTFS",
          "Size": 511000000000, "SizeRemaining": 210000000000, "UniqueId": "\\\\?\\Volume{1111}\\" },
        { "DriveLetter": "E", "FileSystemLabel": "SAUVEGARDE", "FileSystem": "exFAT",
          "Size": 15370000000, "SizeRemaining": 9000000000, "UniqueId": "\\\\?\\Volume{2222}\\" },
        { "DriveLetter": "Z", "FileSystemLabel": "Partage", "FileSystem": "NTFS",
          "Size": 2000000000000, "SizeRemaining": 500000000000, "UniqueId": "\\\\?\\Volume{3333}\\" }
      ]
    }"#;

    #[test]
    fn reads_a_windows_inventory_with_both_letter_encodings() {
        let inventory = parse_inventory(INVENTORY).unwrap();
        assert_eq!(inventory.disks.len(), 2);

        let system = &inventory.disks[0];
        assert_eq!(system.name, "Disque 0");
        assert_eq!(system.path, "\\\\.\\PhysicalDrive0");
        assert_eq!(system.transport, Transport::Nvme);
        assert_eq!(system.partition_table.as_deref(), Some("gpt"));
        assert!(system.system);
        assert!(!system.removable);
        assert_eq!(system.partitions.len(), 2);

        // La lettre C est rendue par son point de code : 67.
        let windows = &system.partitions[1];
        let volume = windows.volume.as_ref().expect("volume rattaché à la lettre C");
        assert_eq!(volume.mount_point.as_deref(), Some("C:\\"));
        assert_eq!(volume.filesystem.as_deref(), Some("NTFS"));
        assert_eq!(volume.label.as_deref(), Some("Windows"));
        assert_eq!(volume.used_bytes, Some(301_000_000_000));

        // La partition EFI n'a pas de lettre : pas de volume inventé.
        assert!(system.partitions[0].volume.is_none());
        assert!(system.partitions[0].boot, "marquée système");
    }

    #[test]
    fn recognises_a_removable_usb_disk() {
        let inventory = parse_inventory(INVENTORY).unwrap();
        let key = &inventory.disks[1];
        assert_eq!(key.transport, Transport::Usb);
        assert!(key.removable);
        assert_eq!(key.vendor.as_deref(), Some("SanDisk"));
        assert_eq!(key.partition_table.as_deref(), Some("mbr"));
        let volume = key.partitions[0].volume.as_ref().unwrap();
        assert_eq!(volume.label.as_deref(), Some("SAUVEGARDE"));
        assert_eq!(volume.mount_point.as_deref(), Some("E:\\"));
    }

    #[test]
    fn keeps_volumes_without_a_partition_apart() {
        let inventory = parse_inventory(INVENTORY).unwrap();
        assert_eq!(inventory.other_volumes.len(), 1);
        assert_eq!(inventory.other_volumes[0].mount_point.as_deref(), Some("Z:\\"));
        assert_eq!(inventory.other_volumes[0].label.as_deref(), Some("Partage"));
    }

    #[test]
    fn admits_what_windows_does_not_report() {
        let inventory = parse_inventory(INVENTORY).unwrap();
        assert!(inventory.disks.iter().all(|disk| disk.rotational.is_none()));
        assert!(inventory.notes.iter().any(|note| note.contains("plateaux")));
    }

    #[test]
    fn reads_the_reliability_counters_of_one_disk() {
        let json = r#"[
          { "DeviceId": "0", "HealthStatus": "Healthy", "MediaType": "SSD",
            "Temperature": 44, "PowerOnHours": 5120, "Wear": 4, "ReadErrorsUncorrected": 0 },
          { "DeviceId": "1", "HealthStatus": 0, "Temperature": null, "PowerOnHours": null }
        ]"#;
        let report = parse_health(json, 0).unwrap();
        assert!(report.available);
        assert_eq!(report.health.as_deref(), Some("Healthy"));
        assert_eq!(report.temperature_c, Some(44));
        assert_eq!(report.power_on_hours, Some(5120));
        assert_eq!(report.percentage_used, Some(4));

        // La clé USB répond, mais sans compteur : c'est dit.
        let sparse = parse_health(json, 1).unwrap();
        assert!(sparse.available);
        assert_eq!(sparse.health.as_deref(), Some("Sain"));
        assert!(sparse.notes.iter().any(|note| note.contains("USB")));
    }

    #[test]
    fn a_disk_absent_from_the_counters_is_reported_as_absent() {
        let report = parse_health(r#"[{"DeviceId":"0","HealthStatus":"Healthy"}]"#, 7).unwrap();
        assert!(!report.available);
        assert!(report.notes[0].contains("ne figure pas"));
    }

    #[test]
    fn a_single_disk_answer_is_an_object_not_an_array() {
        let report =
            parse_health(r#"{"DeviceId":0,"HealthStatus":"Healthy","Temperature":39}"#, 0).unwrap();
        assert!(report.available);
        assert_eq!(report.temperature_c, Some(39));
    }

    #[test]
    fn the_scripts_carry_no_interpolation_at_all() {
        // Une saisie utilisateur n'a aucun moyen d'atteindre ces scripts : ils
        // sont constants, et ce test le vérifie littéralement.
        for script in [INVENTORY_SCRIPT, HEALTH_SCRIPT] {
            assert!(!script.contains("{}"), "marqueur de formatage dans un script figé");
            assert!(!script.contains("Invoke-Expression"));
            assert!(!script.contains("iex"));
            assert!(!script.contains("&("));
        }
        assert!(INVENTORY_SCRIPT.contains("Get-Disk"));
        assert!(HEALTH_SCRIPT.contains("Get-StorageReliabilityCounter"));
        // Aucun verbe d'écriture nulle part.
        for forbidden in
            ["Set-", "Clear-", "Format-Volume", "Initialize-", "New-Partition", "Remove-"]
        {
            assert!(!INVENTORY_SCRIPT.contains(forbidden), "{forbidden} dans le script");
            assert!(!HEALTH_SCRIPT.contains(forbidden), "{forbidden} dans le script");
        }
    }
}
