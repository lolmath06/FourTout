//! Commandes Tauri de l'inventaire de stockage.
//!
//! Deux commandes, toutes deux en lecture. L'inventaire est `async` et déporté :
//! il lit des dizaines de fichiers dans `/sys` et interroge `statvfs` pour
//! chaque point de montage, ce qui n'a rien à faire sur la boucle d'événements.
//! L'interrogation de santé l'est aussi : elle peut appeler un programme
//! externe, et attendre jusqu'à six secondes.

use super::smart::SmartReport;
use super::StorageInventory;

/// Dresse l'inventaire des disques, partitions et volumes.
#[tauri::command]
pub async fn disks_inventory() -> Result<StorageInventory, String> {
    tauri::async_runtime::spawn_blocking(collect)
        .await
        .unwrap_or_else(|error| Err(format!("Inventaire interrompu : {error}")))
}

fn collect() -> Result<StorageInventory, String> {
    #[cfg(target_os = "linux")]
    {
        Ok(super::linux::inventory(&super::linux::RealSys, &super::mount_usage))
    }
    #[cfg(windows)]
    {
        Ok(super::windows::inventory())
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        Ok(StorageInventory {
            provider: "aucun".to_string(),
            notes: vec![
                "L'inventaire de stockage n'est implémenté que pour Linux et Windows.".to_string(),
            ],
            ..StorageInventory::default()
        })
    }
}

/// Interroge la santé d'un disque, si un fournisseur répond.
///
/// Ne lance **aucun** autotest : ce sont des lectures de compteurs déjà tenus
/// par le disque.
#[tauri::command]
pub async fn disks_health(device: String) -> Result<SmartReport, String> {
    tauri::async_runtime::spawn_blocking(move || super::smart::health(&device))
        .await
        .map_err(|error| format!("Interrogation interrompue : {error}"))
}

/// Un fournisseur de santé est-il présent sur cette machine ?
///
/// Sert à expliquer l'écran avant même de cliquer, plutôt qu'après un échec.
#[tauri::command]
pub fn disks_health_provider() -> String {
    #[cfg(target_os = "linux")]
    {
        if super::smart::smartctl_available() {
            "smartctl".to_string()
        } else {
            String::new()
        }
    }
    #[cfg(windows)]
    {
        "windows".to_string()
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        String::new()
    }
}
