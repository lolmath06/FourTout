//! Indicateurs de santé — **opportunistes, jamais inventés**.
//!
//! Tous les disques n'exposent pas les mêmes compteurs, et beaucoup n'en
//! exposent aucun sans privilèges. Ce module part donc du principe inverse de
//! l'habitude : il n'affiche que ce qu'il a réellement obtenu, et dit le reste
//! indisponible plutôt que de le remplacer par un tiret vert rassurant.
//!
//! # Ce qui n'est pas fait
//!
//! - **Aucun autotest n'est lancé.** Un « SMART short test » n'est pas une
//!   lecture : il occupe le disque plusieurs minutes et modifie son journal
//!   interne. Cette phase lit, elle ne demande rien au disque.
//! - **`smartmontools` n'est ni téléchargé, ni embarqué.** C'est un logiciel
//!   sous GPL : le distribuer avec FourTout ferait peser ses obligations sur
//!   l'ensemble. S'il est déjà installé sur la machine, FourTout s'en sert
//!   comme d'un fournisseur optionnel ; sinon, l'interface se dégrade
//!   proprement.
//! - **Aucune requête réseau.** Ni base de fabricants, ni table de modèles :
//!   seules les données du système et du périphérique sont employées.

use std::path::Path;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// Ce que l'on a pu apprendre de la santé d'un disque.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartReport {
    /// Un fournisseur a-t-il répondu ?
    pub available: bool,
    /// Nom du fournisseur employé, pour que l'origine du chiffre soit visible.
    pub provider: String,
    /// Verdict global tel que le disque le rapporte (« PASSED », « Healthy »).
    pub health: Option<String>,
    pub temperature_c: Option<i64>,
    pub power_on_hours: Option<u64>,
    pub power_cycles: Option<u64>,
    pub reallocated_sectors: Option<u64>,
    pub pending_sectors: Option<u64>,
    pub uncorrectable_sectors: Option<u64>,
    /// Usure NVMe, en pourcentage de la durée de vie prévue.
    pub percentage_used: Option<u64>,
    /// Erreurs d'intégrité rapportées par un NVMe.
    pub media_errors: Option<u64>,
    /// Octets écrits sur la durée de vie, quand le disque les expose.
    pub bytes_written: Option<u64>,
    /// Ce qui n'a pas pu être obtenu, et pourquoi.
    pub notes: Vec<String>,
}

impl SmartReport {
    fn unavailable(provider: &str, note: &str) -> Self {
        Self {
            available: false,
            provider: provider.to_string(),
            notes: vec![note.to_string()],
            ..Self::default()
        }
    }
}

/// Délai au-delà duquel on cesse d'attendre le fournisseur.
///
/// Un `smartctl` qui interroge un disque qui ne répond pas peut rester bloqué
/// plusieurs dizaines de secondes. L'inventaire n'a pas à attendre avec lui.
pub const PROVIDER_TIMEOUT: Duration = Duration::from_secs(6);

/// Le chemin de périphérique est-il de la forme attendue ?
///
/// Les chemins ne sont jamais concaténés dans un interpréteur de commandes —
/// ils sont passés en argument séparé — mais on refuse malgré tout ce qui n'a
/// pas la forme d'un nœud de périphérique : un argument inattendu n'a aucune
/// raison d'atteindre un programme externe.
pub fn is_device_path(path: &str) -> bool {
    if !path.starts_with("/dev/") || path.len() > 64 {
        return false;
    }
    path.trim_start_matches("/dev/")
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '/' || c == '-' || c == '_')
        && !path.contains("..")
}

/// Exécute un programme et rend sa sortie standard, avec un délai maximal.
fn run_with_timeout(program: &str, args: &[&str]) -> Result<String, String> {
    use std::process::{Command, Stdio};

    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("{program} introuvable ou non exécutable : {error}"))?;

    let deadline = Instant::now() + PROVIDER_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "{program} n'a pas répondu en {} secondes : l'interrogation a été \
                         abandonnée pour ne pas retarder l'inventaire.",
                        PROVIDER_TIMEOUT.as_secs()
                    ));
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(error) => return Err(format!("{program} : {error}")),
        }
    }

    let output = child.wait_with_output().map_err(|error| format!("{program} : {error}"))?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// `smartctl` est-il installé sur cette machine ?
pub fn smartctl_available() -> bool {
    #[cfg(unix)]
    {
        for directory in ["/usr/sbin", "/usr/bin", "/sbin", "/bin", "/usr/local/sbin"] {
            if Path::new(&format!("{directory}/smartctl")).exists() {
                return true;
            }
        }
        false
    }
    #[cfg(not(unix))]
    {
        false
    }
}

/// Extrait un entier d'un chemin pointé dans un document JSON.
fn number(value: &serde_json::Value, path: &[&str]) -> Option<u64> {
    let mut current = value;
    for key in path {
        current = current.get(key)?;
    }
    current.as_u64()
}

/// Analyse la sortie JSON de `smartctl`.
///
/// Séparée de l'exécution pour être éprouvée sur des relevés figés : un disque
/// SATA avec ses attributs, un NVMe avec son journal, et un disque qui ne dit
/// presque rien.
pub fn parse_smartctl(json: &str) -> Result<SmartReport, String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|error| format!("Sortie illisible : {error}"))?;

    let mut report = SmartReport {
        available: true,
        provider: "smartctl (smartmontools, installé sur cette machine)".to_string(),
        ..SmartReport::default()
    };

    report.health = value
        .get("smart_status")
        .and_then(|status| status.get("passed"))
        .and_then(serde_json::Value::as_bool)
        .map(|passed| if passed { "Sain".to_string() } else { "Défaillant".to_string() });

    report.temperature_c = number(&value, &["temperature", "current"]).map(|t| t as i64);
    report.power_on_hours = number(&value, &["power_on_time", "hours"]);
    report.power_cycles = number(&value, &["power_cycle_count"]);

    // NVMe : les compteurs vivent dans un journal dédié.
    report.percentage_used = number(&value, &["nvme_smart_health_information_log", "percentage_used"]);
    report.media_errors = number(&value, &["nvme_smart_health_information_log", "media_errors"]);
    if let Some(units) = number(&value, &["nvme_smart_health_information_log", "data_units_written"]) {
        // Une unité NVMe vaut 1 000 blocs de 512 octets, par définition de la
        // norme : ce n'est pas une estimation.
        report.bytes_written = Some(units * 1000 * 512);
    }
    if report.power_on_hours.is_none() {
        report.power_on_hours =
            number(&value, &["nvme_smart_health_information_log", "power_on_hours"]);
    }
    if report.power_cycles.is_none() {
        report.power_cycles =
            number(&value, &["nvme_smart_health_information_log", "power_cycles"]);
    }
    if report.temperature_c.is_none() {
        report.temperature_c =
            number(&value, &["nvme_smart_health_information_log", "temperature"]).map(|t| t as i64);
    }

    // SATA : les attributs numérotés.
    if let Some(attributes) =
        value.get("ata_smart_attributes").and_then(|a| a.get("table")).and_then(|t| t.as_array())
    {
        for attribute in attributes {
            let id = attribute.get("id").and_then(serde_json::Value::as_u64);
            let raw = number(attribute, &["raw", "value"]);
            match id {
                Some(5) => report.reallocated_sectors = raw,
                Some(197) => report.pending_sectors = raw,
                Some(198) => report.uncorrectable_sectors = raw,
                Some(9) if report.power_on_hours.is_none() => report.power_on_hours = raw,
                Some(12) if report.power_cycles.is_none() => report.power_cycles = raw,
                _ => {}
            }
        }
    }

    // Ce que ce disque n'expose pas, dit explicitement.
    let mut missing = Vec::new();
    if report.temperature_c.is_none() {
        missing.push("température");
    }
    if report.power_on_hours.is_none() {
        missing.push("heures de fonctionnement");
    }
    if report.reallocated_sectors.is_none() && report.percentage_used.is_none() {
        missing.push("compteurs d'usure");
    }
    if !missing.is_empty() {
        report.notes.push(format!(
            "Ce disque n'expose pas : {}. Tous les modèles ne rapportent pas les mêmes \
             compteurs.",
            missing.join(", ")
        ));
    }

    Ok(report)
}

/// Interroge la santé d'un disque, si un fournisseur est disponible.
pub fn health(device: &str) -> SmartReport {
    #[cfg(target_os = "linux")]
    {
        if !is_device_path(device) {
            return SmartReport::unavailable(
                "aucun",
                "Chemin de périphérique inattendu : aucune interrogation n'a été tentée.",
            );
        }
        if !smartctl_available() {
            return SmartReport::unavailable(
                "aucun",
                "Informations SMART détaillées non disponibles : `smartctl` n'est pas installé \
                 sur cette machine. FourTout ne l'installe pas et ne l'embarque pas — c'est un \
                 logiciel sous GPL, distribué séparément. Une fois `smartmontools` installé par \
                 vos soins, cet écran s'enrichira de lui-même.",
            );
        }
        // `--json=c` : sortie JSON compacte. `-i` identité, `-H` état de santé,
        // `-A` attributs. Aucun de ces arguments ne déclenche d'autotest.
        match run_with_timeout("smartctl", &["--json=c", "-i", "-H", "-A", device]) {
            Ok(output) => match parse_smartctl(&output) {
                Ok(mut report) => {
                    if report.health.is_none() && report.power_on_hours.is_none() {
                        report.notes.push(
                            "`smartctl` a répondu sans donnée exploitable. Certaines données \
                             nécessitent des permissions supplémentaires ; FourTout ne demande \
                             pas à être relancé en administrateur."
                                .to_string(),
                        );
                    }
                    report
                }
                Err(error) => SmartReport::unavailable("smartctl", &error),
            },
            Err(error) => SmartReport::unavailable("smartctl", &error),
        }
    }

    #[cfg(windows)]
    {
        super::windows::health(device)
    }

    #[cfg(not(any(target_os = "linux", windows)))]
    {
        let _ = device;
        SmartReport::unavailable(
            "aucun",
            "Aucun fournisseur de santé disque n'est implémenté pour ce système.",
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Relevé d'un disque SATA, réduit aux champs que FourTout lit.
    const SATA: &str = r#"{
      "smart_status": { "passed": true },
      "temperature": { "current": 38 },
      "power_on_time": { "hours": 14235 },
      "power_cycle_count": 1893,
      "ata_smart_attributes": { "table": [
        { "id": 5,   "name": "Reallocated_Sector_Ct", "raw": { "value": 0 } },
        { "id": 9,   "name": "Power_On_Hours",        "raw": { "value": 14235 } },
        { "id": 197, "name": "Current_Pending_Sector","raw": { "value": 2 } },
        { "id": 198, "name": "Offline_Uncorrectable", "raw": { "value": 0 } }
      ] }
    }"#;

    /// Relevé d'un NVMe : les compteurs vivent ailleurs.
    const NVME: &str = r#"{
      "smart_status": { "passed": true },
      "nvme_smart_health_information_log": {
        "temperature": 41,
        "percentage_used": 3,
        "power_on_hours": 2210,
        "power_cycles": 940,
        "media_errors": 0,
        "data_units_written": 41234567
      }
    }"#;

    /// Un disque avare : il répond, mais ne dit presque rien.
    const SPARSE: &str = r#"{ "smart_status": { "passed": true } }"#;

    #[test]
    fn reads_the_attributes_of_a_sata_disk() {
        let report = parse_smartctl(SATA).unwrap();
        assert!(report.available);
        assert_eq!(report.health.as_deref(), Some("Sain"));
        assert_eq!(report.temperature_c, Some(38));
        assert_eq!(report.power_on_hours, Some(14235));
        assert_eq!(report.power_cycles, Some(1893));
        assert_eq!(report.reallocated_sectors, Some(0));
        assert_eq!(report.pending_sectors, Some(2));
        assert_eq!(report.uncorrectable_sectors, Some(0));
        assert!(report.notes.is_empty(), "rien ne manque : {:?}", report.notes);
    }

    #[test]
    fn reads_the_health_log_of_an_nvme() {
        let report = parse_smartctl(NVME).unwrap();
        assert_eq!(report.temperature_c, Some(41));
        assert_eq!(report.percentage_used, Some(3));
        assert_eq!(report.power_on_hours, Some(2210));
        assert_eq!(report.media_errors, Some(0));
        // 41 234 567 unités × 1000 × 512 octets, par définition de la norme.
        assert_eq!(report.bytes_written, Some(21_112_098_304_000));
        // Un NVMe n'a pas de secteurs réalloués : on ne prétend pas le contraire.
        assert_eq!(report.reallocated_sectors, None);
    }

    #[test]
    fn says_what_a_sparse_disk_does_not_expose() {
        let report = parse_smartctl(SPARSE).unwrap();
        assert!(report.available);
        assert_eq!(report.health.as_deref(), Some("Sain"));
        assert_eq!(report.temperature_c, None);
        let note = report.notes.first().unwrap();
        assert!(note.contains("température"));
        assert!(note.contains("n'expose pas"));
    }

    #[test]
    fn reports_a_failing_disk_as_failing() {
        let report = parse_smartctl(r#"{ "smart_status": { "passed": false } }"#).unwrap();
        assert_eq!(report.health.as_deref(), Some("Défaillant"));
    }

    #[test]
    fn refuses_anything_that_is_not_a_device_node() {
        assert!(is_device_path("/dev/sda"));
        assert!(is_device_path("/dev/nvme0n1"));
        assert!(is_device_path("/dev/disk/by-id/ata-x_1"));
        assert!(!is_device_path("/etc/passwd"));
        assert!(!is_device_path("/dev/../etc/passwd"));
        assert!(!is_device_path("/dev/sda; rm -rf /"));
        assert!(!is_device_path("sda"));
        assert!(!is_device_path(""));
    }

    #[test]
    fn an_unreadable_answer_is_an_absence_not_a_crash() {
        assert!(parse_smartctl("pas du json").is_err());
        let report = SmartReport::unavailable("smartctl", "indisponible");
        assert!(!report.available);
        assert!(report.health.is_none());
    }
}
