//! Diagnostic générique : ce que l'on peut dire de n'importe quel fichier.
//!
//! Trois questions, posées dans cet ordre :
//!
//! 1. **Qu'est-ce que c'est ?** La signature décide, jamais l'extension.
//! 2. **Le nom dit-il la vérité ?** Une photo appelée `.jpg` qui contient du
//!    PNG s'ouvre partout, jusqu'au jour où un programme fait confiance au nom.
//! 3. **Le fichier est-il entier ?** Beaucoup de formats portent une marque de
//!    fin : son absence, ou des octets après elle, se constatent sans parser
//!    quoi que ce soit.
//!
//! Au-delà, le diagnostic délègue aux modules spécialisés (`zip`, `pdf`,
//! `image`). FourTout n'écrit pas un analyseur pour chaque format du monde : il
//! en connaît quatre en profondeur et reste honnête sur les autres.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::{rfind, Finding, Repairability};
use crate::files::magic;

/// Marque de fin attendue pour les formats qui en portent une.
struct EndMarker {
    /// Identifiant de signature (`magic::identify`).
    format: &'static str,
    marker: &'static [u8],
    label: &'static str,
}

const END_MARKERS: &[EndMarker] = &[
    EndMarker { format: "png", marker: b"IEND\xAE\x42\x60\x82", label: "IEND" },
    EndMarker { format: "jpg", marker: &[0xFF, 0xD9], label: "EOI" },
    EndMarker { format: "pdf", marker: b"%%EOF", label: "%%EOF" },
    EndMarker { format: "gif", marker: &[0x3B], label: "trailer GIF" },
];

/// Détail générique, joint à tout rapport.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenericDetails {
    /// Premiers octets, en hexadécimal, pour situer sans ouvrir l'éditeur.
    pub head_hex: String,
    /// Derniers octets, en hexadécimal.
    pub tail_hex: String,
    /// Marque de fin attendue pour ce format, si le format en porte une.
    pub end_marker: Option<String>,
    /// La marque de fin a-t-elle été trouvée ?
    pub end_marker_found: bool,
    /// Octets présents après la marque de fin.
    pub trailing_bytes: u64,
    /// Le fichier est-il vide ?
    pub empty: bool,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(" ")
}

/// Constats valables pour tout fichier, quel que soit son type.
pub fn diagnose(
    path: &Path,
    bytes: &[u8],
    signature: &magic::Signature,
    extension: &str,
) -> (Vec<Finding>, GenericDetails) {
    let mut findings = Vec::new();
    let mut details = GenericDetails {
        head_hex: hex(&bytes[..bytes.len().min(16)]),
        tail_hex: hex(&bytes[bytes.len().saturating_sub(16)..]),
        empty: bytes.is_empty(),
        ..GenericDetails::default()
    };

    if bytes.is_empty() {
        findings.push(Finding::error(
            "file.empty",
            "Fichier vide",
            "Ce fichier ne contient aucun octet. Il n'y a rien à diagnostiquer, et rien à \
             récupérer : le contenu n'est pas abîmé, il est absent.",
            Repairability::None,
        ));
        return (findings, details);
    }

    // Le nom ment-il sur le contenu ?
    if signature.id != "inconnu" && !magic::extension_matches(signature, extension) {
        let expected = signature.extensions.first().copied().unwrap_or(signature.id);
        findings.push(Finding::warning(
            "file.extension-mismatch",
            "L'extension ne correspond pas au contenu",
            format!(
                "Le nom annonce « .{extension} », le contenu est du {} (extension attendue : \
                 « .{expected} »). Le fichier n'est pas abîmé pour autant — mais un programme \
                 qui fait confiance au nom le refusera, ou l'ouvrira de travers.",
                signature.label
            ),
            Repairability::SafeRepair,
        ));
    } else if signature.id == "inconnu" {
        findings.push(Finding::info(
            "file.unknown-format",
            "Format non reconnu",
            format!(
                "Aucune signature connue de FourTout ne correspond à ces premiers octets ({}). \
                 Cela ne veut pas dire que le fichier est abîmé : la table des signatures est \
                 volontairement courte.",
                details.head_hex
            ),
        ));
    }

    // Marque de fin : présente, absente, ou suivie d'octets parasites.
    if let Some(expected) = END_MARKERS.iter().find(|end| end.format == signature.id) {
        details.end_marker = Some(expected.label.to_string());
        match rfind(bytes, expected.marker) {
            Some(position) => {
                details.end_marker_found = true;
                let end = position + expected.marker.len();
                if end < bytes.len() {
                    details.trailing_bytes = (bytes.len() - end) as u64;
                }
            }
            None => {
                findings.push(Finding::error(
                    "file.missing-end-marker",
                    "Marque de fin absente",
                    format!(
                        "Un fichier {} se termine normalement par « {} ». Cette marque est \
                         introuvable : le fichier a très probablement été tronqué — une copie \
                         interrompue, un téléchargement coupé, un support retiré trop tôt.",
                        signature.label, expected.label
                    ),
                    Repairability::RecoverPartial,
                ));
            }
        }
    }

    if let Ok(meta) = std::fs::metadata(path) {
        if meta.len() as usize != bytes.len() {
            findings.push(Finding::info(
                "file.partially-read",
                "Fichier lu partiellement",
                format!(
                    "Le diagnostic porte sur les {} premiers octets d'un fichier de {} octets.",
                    bytes.len(),
                    meta.len()
                ),
            ));
        }
    }

    (findings, details)
}

/// Copie un fichier en corrigeant son extension, sans toucher à l'original.
pub fn fix_extension(source: &Path, signature: &magic::Signature) -> Result<std::path::PathBuf, String> {
    let expected = signature
        .extensions
        .first()
        .copied()
        .ok_or_else(|| "Aucune extension connue pour ce format.".to_string())?;
    let destination = super::output_path(source, "type-corrige", expected);
    std::fs::copy(source, &destination).map_err(|e| format!("Copie impossible : {e}"))?;
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signature_of(bytes: &[u8]) -> magic::Signature {
        magic::identify(bytes)
    }

    #[test]
    fn says_nothing_alarming_about_a_healthy_png() {
        let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        bytes.extend_from_slice(b"IEND\xAE\x42\x60\x82");
        let signature = signature_of(&bytes);
        let (findings, details) =
            diagnose(Path::new("image.png"), &bytes, &signature, "png");
        assert!(findings.is_empty(), "constats inattendus : {findings:?}");
        assert!(details.end_marker_found);
        assert_eq!(details.trailing_bytes, 0);
    }

    #[test]
    fn notices_when_the_name_lies() {
        let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        bytes.extend_from_slice(b"IEND\xAE\x42\x60\x82");
        let signature = signature_of(&bytes);
        let (findings, _) = diagnose(Path::new("photo.jpg"), &bytes, &signature, "jpg");
        let mismatch = findings.iter().find(|f| f.code == "file.extension-mismatch").unwrap();
        assert_eq!(mismatch.repairability, Repairability::SafeRepair);
        assert!(mismatch.detail.contains("png"));
    }

    #[test]
    fn counts_bytes_that_follow_the_end_of_a_file() {
        let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        bytes.extend_from_slice(b"IEND\xAE\x42\x60\x82");
        bytes.extend_from_slice(b"parasite");
        let signature = signature_of(&bytes);
        let (_, details) = diagnose(Path::new("image.png"), &bytes, &signature, "png");
        assert!(details.end_marker_found);
        assert_eq!(details.trailing_bytes, 8);
    }

    #[test]
    fn reports_a_missing_end_marker_as_truncation() {
        let bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3];
        let signature = signature_of(&bytes);
        let (findings, details) = diagnose(Path::new("image.png"), &bytes, &signature, "png");
        assert!(!details.end_marker_found);
        let truncated = findings.iter().find(|f| f.code == "file.missing-end-marker").unwrap();
        assert!(truncated.detail.contains("tronqué"));
    }

    #[test]
    fn an_empty_file_is_absent_content_not_damaged_content() {
        let signature = signature_of(&[]);
        let (findings, details) = diagnose(Path::new("vide.bin"), &[], &signature, "bin");
        assert!(details.empty);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].code, "file.empty");
        assert!(findings[0].detail.contains("absent"));
    }
}
