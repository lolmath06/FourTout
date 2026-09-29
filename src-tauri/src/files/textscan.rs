//! Décodage de texte côté natif, pour la recherche de contenu.
//!
//! La recherche avancée doit lire des milliers de fichiers sans les faire
//! transiter par la WebView : elle a donc besoin, ici, de la même décision que
//! le moteur d'encodage de la phase 8 (`src/core/text/encoding.ts`).
//!
//! Ce module en est la **transposition fidèle**, pas une seconde heuristique :
//! mêmes indices, dans le même ordre (BOM, motif UTF-16, validité UTF-8, puis
//! plage 0x80–0x9F), et un test croisé sur les fixtures partagées vérifie que
//! les deux moteurs ne divergent pas. Toute évolution de l'un doit se refléter
//! dans l'autre — c'est le prix de la recherche de contenu à pleine vitesse.

use serde::Serialize;

/// Fenêtre examinée pour décider « texte ou binaire ».
pub const SAMPLE: usize = 65536;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Encoding {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
    Windows1252,
    Iso8859_1,
}

impl Encoding {
    /// Identifiant identique à celui du moteur TypeScript.
    pub fn id(self) -> &'static str {
        match self {
            Encoding::Utf8 => "utf-8",
            Encoding::Utf8Bom => "utf-8-bom",
            Encoding::Utf16Le => "utf-16le",
            Encoding::Utf16Be => "utf-16be",
            Encoding::Windows1252 => "windows-1252",
            Encoding::Iso8859_1 => "iso-8859-1",
        }
    }
}

/// Marque d'ordre des octets éventuellement présente en tête.
pub fn detect_bom(bytes: &[u8]) -> (Option<Encoding>, usize) {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        (Some(Encoding::Utf8Bom), 3)
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        (Some(Encoding::Utf16Le), 2)
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        (Some(Encoding::Utf16Be), 2)
    } else {
        (None, 0)
    }
}

fn control_ratio(bytes: &[u8]) -> f64 {
    let limit = bytes.len().min(SAMPLE);
    if limit == 0 {
        return 0.0;
    }
    let mut control = 0_usize;
    for &byte in &bytes[..limit] {
        let printable = byte >= 0x20 || byte == 0x09 || byte == 0x0A || byte == 0x0D || byte == 0x0C;
        if !printable || byte == 0x7F {
            control += 1;
        }
    }
    control as f64 / limit as f64
}

fn nul_statistics(bytes: &[u8]) -> (usize, usize, usize) {
    let limit = bytes.len().min(SAMPLE);
    let (mut even, mut odd) = (0_usize, 0_usize);
    for (index, &byte) in bytes[..limit].iter().enumerate() {
        if byte == 0 {
            if index % 2 == 0 {
                even += 1;
            } else {
                odd += 1;
            }
        }
    }
    (even, odd, limit)
}

/// Résultat de la décision : encodage retenu, et s'il s'agit de binaire.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Detection {
    pub encoding: Encoding,
    pub binary: bool,
    pub bom: Option<Encoding>,
}

/// Décide de l'encodage d'un échantillon, exactement comme le moteur phase 8.
pub fn detect(bytes: &[u8]) -> Detection {
    let (bom, skip) = detect_bom(bytes);
    if let Some(encoding) = bom {
        return Detection { encoding, binary: false, bom };
    }
    if bytes.is_empty() {
        return Detection { encoding: Encoding::Utf8, binary: false, bom: None };
    }

    let body = &bytes[skip..];
    let (even, odd, total) = nul_statistics(body);
    let nul_ratio = (even + odd) as f64 / total.max(1) as f64;
    if total >= 4 && nul_ratio > 0.2 {
        if odd > even * 4 {
            return Detection { encoding: Encoding::Utf16Le, binary: false, bom: None };
        }
        if even > odd * 4 {
            return Detection { encoding: Encoding::Utf16Be, binary: false, bom: None };
        }
        return Detection { encoding: Encoding::Utf8, binary: true, bom: None };
    }
    if control_ratio(body) > 0.05 {
        return Detection { encoding: Encoding::Utf8, binary: true, bom: None };
    }
    if std::str::from_utf8(body).is_ok() {
        return Detection { encoding: Encoding::Utf8, binary: false, bom: None };
    }
    // Reste un encodage sur un octet ; seule la plage 0x80–0x9F les distingue,
    // et Windows-1252 y place des caractères imprimables là où Latin-1 ne met
    // que des codes de contrôle.
    Detection { encoding: Encoding::Windows1252, binary: false, bom: None }
}

/// Plage 0x80–0x9F de Windows-1252 ; `None` là où le format ne définit rien.
const CP1252_HIGH: [u32; 32] = [
    0x20AC, 0xFFFD, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039,
    0x0152, 0xFFFD, 0x017D, 0xFFFD, 0xFFFD, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0xFFFD, 0x017E, 0x0178,
];

/// Décode un contenu selon l'encodage retenu. Jamais d'échec : un octet
/// indécodable devient U+FFFD, comme dans le moteur TypeScript.
pub fn decode(bytes: &[u8], encoding: Encoding) -> String {
    match encoding {
        Encoding::Utf8 => String::from_utf8_lossy(bytes).into_owned(),
        Encoding::Utf8Bom => String::from_utf8_lossy(bytes.get(3..).unwrap_or(&[])).into_owned(),
        Encoding::Utf16Le | Encoding::Utf16Be => {
            let little = encoding == Encoding::Utf16Le;
            let body = if bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) {
                &bytes[2..]
            } else {
                bytes
            };
            let units: Vec<u16> = body
                .chunks_exact(2)
                .map(|pair| {
                    if little {
                        u16::from_le_bytes([pair[0], pair[1]])
                    } else {
                        u16::from_be_bytes([pair[0], pair[1]])
                    }
                })
                .collect();
            String::from_utf16_lossy(&units)
        }
        Encoding::Windows1252 => bytes
            .iter()
            .map(|&byte| {
                if (0x80..=0x9F).contains(&byte) {
                    char::from_u32(CP1252_HIGH[(byte - 0x80) as usize]).unwrap_or('\u{FFFD}')
                } else {
                    byte as char
                }
            })
            .collect(),
        Encoding::Iso8859_1 => bytes.iter().map(|&byte| byte as char).collect(),
    }
}

/// Les premiers octets ressemblent-ils à du texte ?
///
/// Réponse volontairement conservatrice : en cas de doute, on répond « non »,
/// car interpréter un binaire comme du texte produit des résultats de recherche
/// faux, et un fichier manqué se corrige, un faux positif se propage.
pub fn looks_like_text(sample: &[u8]) -> bool {
    !detect(sample).binary
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn honours_byte_order_marks() {
        assert_eq!(detect(b"\xEF\xBB\xBFabc").encoding, Encoding::Utf8Bom);
        assert_eq!(detect(b"\xFF\xFEa\0b\0").encoding, Encoding::Utf16Le);
        assert_eq!(detect(b"\xFE\xFF\0a\0b").encoding, Encoding::Utf16Be);
    }

    #[test]
    fn recognises_utf16_without_bom() {
        let mut le = Vec::new();
        for byte in b"FourTout cherche" {
            le.push(*byte);
            le.push(0);
        }
        assert_eq!(detect(&le).encoding, Encoding::Utf16Le);
        assert_eq!(decode(&le, Encoding::Utf16Le), "FourTout cherche");

        let mut be = Vec::new();
        for byte in b"FourTout cherche" {
            be.push(0);
            be.push(*byte);
        }
        assert_eq!(detect(&be).encoding, Encoding::Utf16Be);
        assert_eq!(decode(&be, Encoding::Utf16Be), "FourTout cherche");
    }

    #[test]
    fn separates_text_from_binary() {
        assert!(looks_like_text(b"Bonjour, FourTout.\nDeuxieme ligne.\n"));
        assert!(!looks_like_text(&[0x00, 0x01, 0x02, 0x03, 0x7F, 0x00, 0x01, 0x1B]));
        assert!(!looks_like_text(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13]));
    }

    #[test]
    fn decodes_windows_1252_high_range() {
        // 0x92 est l'apostrophe typographique de Windows-1252 ; Latin-1 n'y
        // place qu'un code de contrôle.
        let bytes = b"l\x92ann\xe9e";
        assert_eq!(detect(bytes).encoding, Encoding::Windows1252);
        assert_eq!(decode(bytes, Encoding::Windows1252), "l\u{2019}année");
        assert_eq!(decode(bytes, Encoding::Iso8859_1), "l\u{92}année");
    }

    #[test]
    fn plain_ascii_reads_as_utf8() {
        assert_eq!(detect(b"facture 2024").encoding, Encoding::Utf8);
    }
}
