//! Images disque ISO 9660 : création, inspection, extraction.
//!
//! Tout est écrit ici, sans dépendance externe : le format est court et
//! précisément spécifié (ECMA-119), et un écrivain maison évite d'imposer
//! `xorriso` ou `genisoimage` — absents de Windows, et d'une installation
//! Fedora minimale. Même code, mêmes octets, sur les deux systèmes.
//!
//! * **Création** : ISO 9660 niveau 2, plus Joliet (noms longs en Unicode, lus
//!   par Windows) et Rock Ridge (noms longs, droits POSIX, lus par Linux et
//!   macOS). Les trois arborescences partagent les mêmes données.
//! * **Inspection** : lit uniquement les descripteurs et les répertoires, sans
//!   jamais parcourir les données des fichiers.
//! * **Extraction** : chaque nom venu de l'image est traité comme hostile.
//!
//! Hors périmètre, volontairement : écrire sur un disque physique, rendre une
//! image amorçable, éditer des partitions. Voir `docs/features/FILES.md`.

pub mod read;
pub mod write;

/// Taille d'un secteur logique : la seule que les lecteurs courants acceptent.
pub const SECTOR: u64 = 2048;
/// Secteurs de la zone système, avant le premier descripteur de volume.
pub const SYSTEM_AREA_SECTORS: u32 = 16;
/// Identifiant standard de tout descripteur de volume ISO 9660.
pub const STANDARD_ID: &[u8; 5] = b"CD001";

/// Nombre maximal d'entrées traitées, pour borner mémoire et temps.
pub const MAX_ENTRIES: usize = 2_000_000;

/* ------------------------------------------------------------- dates */

/// Jours depuis 1970-01-01 pour une date civile (algorithme de H. Hinnant).
pub(crate) fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month_index = (month + 9) % 12;
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// Date civile (année, mois, jour) pour un nombre de jours depuis 1970-01-01.
pub(crate) fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 { month_index + 3 } else { month_index - 9 };
    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// Secondes Unix décomposées en (année, mois, jour, heure, minute, seconde).
pub(crate) fn broken_down(seconds: i64) -> (i64, i64, i64, i64, i64, i64) {
    let days = seconds.div_euclid(86_400);
    let rest = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    (year, month, day, rest / 3600, rest % 3600 / 60, rest % 60)
}

/// Lit un entier boutien-double : la valeur petit-boutienne fait foi.
pub(crate) fn le32(bytes: &[u8]) -> u32 {
    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

pub(crate) fn le16(bytes: &[u8]) -> u16 {
    u16::from_le_bytes([bytes[0], bytes[1]])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_dates_round_trip() {
        for seconds in [0_i64, 86_399, 951_782_400, 1_700_000_000, 4_102_444_800] {
            let (y, m, d, hh, mm, ss) = broken_down(seconds);
            let back = days_from_civil(y, m, d) * 86_400 + hh * 3600 + mm * 60 + ss;
            assert_eq!(back, seconds);
        }
        // 29 février d'une année bissextile séculaire.
        assert_eq!(broken_down(951_782_400), (2000, 2, 29, 0, 0, 0));
    }
}

#[cfg(test)]
mod roundtrip;
