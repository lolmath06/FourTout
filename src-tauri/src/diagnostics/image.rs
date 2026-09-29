//! Diagnostic et récupération d'images PNG et JPEG.
//!
//! Les deux formats se lisent par le début, ce qui change tout par rapport au
//! ZIP et au PDF : une image dont la fin manque garde ses premières lignes.
//! C'est la base de ce que FourTout appelle une **récupération visuelle** —
//! les pixels que le décodeur accepte de rendre sont réencodés dans un fichier
//! sain, et rien d'autre n'est promis.
//!
//! Ce que ce module ne fait pas, et ne fera pas :
//!
//! - **recalculer une somme de contrôle abîmée** pour faire croire que les
//!   données qu'elle protège sont intactes. Corriger un CRC d'`IDAT` ne répare
//!   rien : cela masque la corruption ;
//! - **inventer les lignes manquantes** d'une image tronquée. Ce qui manque
//!   manque, et le diagnostic le dit.
//!
//! Les cas réellement traitables sont nets : un nom d'extension qui ment, des
//! octets ajoutés après la fin de l'image, un bloc de métadonnées abîmé alors
//! que les pixels sont lisibles, une fin de fichier JPEG absente.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::{Finding, Repairability};

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

/// Un bloc PNG, tel qu'il apparaît dans le fichier.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PngChunk {
    /// Type sur quatre lettres (`IHDR`, `IDAT`, `tEXt`…).
    pub kind: String,
    pub offset: u64,
    pub length: u32,
    /// Somme de contrôle valide ?
    pub crc_valid: bool,
    /// Bloc auxiliaire (première lettre minuscule) : sa perte n'ôte aucun pixel.
    pub ancillary: bool,
}

/// Un segment JPEG.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JpegSegment {
    /// Code du marqueur (`0xE0` pour APP0, `0xC0` pour SOF0…).
    pub marker: u8,
    pub label: String,
    pub offset: u64,
    pub length: u32,
}

/// Détail du diagnostic image.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageDetails {
    /// Format réellement reconnu : « png », « jpg », ou autre.
    pub format: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Le décodeur a-t-il accepté le fichier tel quel ?
    pub decodes: bool,
    /// Message du décodeur en cas de refus.
    pub decode_error: Option<String>,
    pub chunks: Vec<PngChunk>,
    pub segments: Vec<JpegSegment>,
    /// Octets présents après la fin de l'image.
    pub trailing_bytes: u64,
    /// Marque de fin présente (`IEND` ou `EOI`).
    pub end_marker: bool,
    /// Blocs auxiliaires dont la somme de contrôle est fausse.
    pub broken_ancillary: usize,
    /// Blocs essentiels dont la somme de contrôle est fausse.
    pub broken_critical: usize,
    /// Le décodeur rend-il des pixels, sur le fichier tel quel **ou** après le
    /// nettoyage structurel que FourTout sait justifier ?
    ///
    /// C'est la seule question qui décide si une récupération a un sens.
    /// Proposer un bouton quand la réponse est « non » ne peut mener qu'à une
    /// erreur : l'action n'est alors pas offerte du tout.
    pub recoverable: bool,
    /// La récupération serait-elle sans perte, ou seulement visuelle ?
    pub recovery_lossless: bool,
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = flate2::Crc::new();
    crc.update(bytes);
    crc.sum()
}

/// Parcourt les blocs d'un PNG, du premier au dernier.
fn walk_png(bytes: &[u8], details: &mut ImageDetails) -> Vec<Finding> {
    let mut findings = Vec::new();

    if bytes.len() < 8 || bytes[..8] != PNG_SIGNATURE {
        findings.push(Finding::error(
            "png.bad-signature",
            "Signature PNG absente",
            "Les huit premiers octets d'un PNG sont fixés par la norme. Ceux-ci ne \
             correspondent pas : ce fichier n'est pas un PNG, ou son début est perdu.",
            Repairability::None,
        ));
        return findings;
    }

    let mut position = 8_usize;
    let mut saw_ihdr = false;
    let mut saw_idat = false;
    let mut saw_iend = false;

    while position + 8 <= bytes.len() {
        let length = u32::from_be_bytes([
            bytes[position],
            bytes[position + 1],
            bytes[position + 2],
            bytes[position + 3],
        ]);
        let kind_bytes = &bytes[position + 4..position + 8];
        let kind = String::from_utf8_lossy(kind_bytes).to_string();
        let data_start = position + 8;
        let data_end = data_start + length as usize;

        if data_end + 4 > bytes.len() {
            findings.push(Finding::error(
                "png.truncated",
                "Image tronquée",
                format!(
                    "Le bloc « {kind} » annonce {length} octets, mais le fichier s'arrête avant. \
                     Les données manquantes n'existent nulle part : elles ne seront pas \
                     reconstituées."
                ),
                Repairability::RecoverVisual,
            ));
            break;
        }

        let stored = u32::from_be_bytes([
            bytes[data_end],
            bytes[data_end + 1],
            bytes[data_end + 2],
            bytes[data_end + 3],
        ]);
        let computed = crc32(&bytes[position + 4..data_end]);
        // Un bloc dont la première lettre est minuscule est auxiliaire : un
        // lecteur a le droit de l'ignorer sans perdre un seul pixel.
        let ancillary = kind_bytes.first().is_some_and(|b| b.is_ascii_lowercase());

        details.chunks.push(PngChunk {
            kind: kind.clone(),
            offset: position as u64,
            length,
            crc_valid: stored == computed,
            ancillary,
        });

        if stored != computed {
            if ancillary {
                details.broken_ancillary += 1;
            } else {
                details.broken_critical += 1;
            }
        }

        match kind.as_str() {
            "IHDR" if length >= 8 => {
                saw_ihdr = true;
                details.width = Some(u32::from_be_bytes([
                    bytes[data_start],
                    bytes[data_start + 1],
                    bytes[data_start + 2],
                    bytes[data_start + 3],
                ]));
                details.height = Some(u32::from_be_bytes([
                    bytes[data_start + 4],
                    bytes[data_start + 5],
                    bytes[data_start + 6],
                    bytes[data_start + 7],
                ]));
            }
            "IDAT" => saw_idat = true,
            "IEND" => {
                saw_iend = true;
                details.end_marker = true;
                let end = data_end + 4;
                if end < bytes.len() {
                    details.trailing_bytes = (bytes.len() - end) as u64;
                }
                break;
            }
            _ => {}
        }

        position = data_end + 4;
    }

    if !saw_ihdr {
        findings.push(Finding::error(
            "png.no-ihdr",
            "En-tête d'image absent",
            "Le bloc « IHDR », qui porte les dimensions et le format des pixels, est \
             introuvable. Aucun décodeur ne peut travailler sans lui.",
            Repairability::None,
        ));
    }
    if !saw_idat {
        findings.push(Finding::error(
            "png.no-idat",
            "Données d'image absentes",
            "Aucun bloc « IDAT » : le fichier décrit une image mais ne contient pas ses pixels.",
            Repairability::None,
        ));
    }
    if !saw_iend && saw_idat {
        findings.push(Finding::warning(
            "png.no-iend",
            "Fin d'image absente",
            "Le bloc « IEND » qui clôt un PNG est introuvable. Beaucoup de décodeurs s'en \
             passent si les données d'image sont complètes ; d'autres refusent le fichier.",
            Repairability::RecoverVisual,
        ));
    }

    if details.broken_critical > 0 {
        findings.push(Finding::error(
            "png.broken-critical-chunk",
            "Données d'image altérées",
            format!(
                "{} bloc(s) essentiel(s) portent une somme de contrôle qui ne correspond pas à \
                 leur contenu. Les octets ont été modifiés depuis l'écriture du fichier. \
                 FourTout ne recalculera pas cette somme : cela masquerait la corruption sans \
                 rien réparer. Seuls les pixels que le décodeur accepte encore de rendre \
                 peuvent être sauvés.",
                details.broken_critical
            ),
            Repairability::RecoverVisual,
        ));
    }

    if details.broken_ancillary > 0 {
        findings.push(Finding::warning(
            "png.broken-ancillary-chunk",
            "Métadonnées altérées",
            format!(
                "{} bloc(s) auxiliaire(s) — métadonnées, profil de couleur, commentaires — \
                 portent une somme de contrôle fausse. Les pixels, eux, ne sont pas concernés : \
                 retirer ces blocs produit une image saine sans perdre un seul point.",
                details.broken_ancillary
            ),
            Repairability::SafeRepair,
        ));
    }

    if details.trailing_bytes > 0 {
        findings.push(Finding::warning(
            "png.trailing-garbage",
            "Données parasites après l'image",
            format!(
                "{} octets suivent le bloc de fin. Ils ne font pas partie de l'image ; les \
                 retirer est une copie tronquée après « IEND ».",
                details.trailing_bytes
            ),
            Repairability::SafeRepair,
        ));
    }

    findings
}

fn jpeg_marker_label(marker: u8) -> &'static str {
    match marker {
        0xD8 => "SOI — début d'image",
        0xD9 => "EOI — fin d'image",
        0xDA => "SOS — début des données",
        0xC0 => "SOF0 — image de base",
        0xC1 => "SOF1",
        0xC2 => "SOF2 — image progressive",
        0xC4 => "DHT — table de Huffman",
        0xDB => "DQT — table de quantification",
        0xDD => "DRI",
        0xE0 => "APP0 — JFIF",
        0xE1 => "APP1 — EXIF ou XMP",
        0xE2..=0xEF => "APPn — métadonnées",
        0xFE => "COM — commentaire",
        _ => "segment",
    }
}

/// Parcourt les segments d'un JPEG.
fn walk_jpeg(bytes: &[u8], details: &mut ImageDetails) -> Vec<Finding> {
    let mut findings = Vec::new();

    if bytes.len() < 2 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        findings.push(Finding::error(
            "jpeg.bad-signature",
            "Marqueur de début absent",
            "Un JPEG commence par les octets FF D8. Ceux-ci ne correspondent pas : ce fichier \
             n'est pas un JPEG, ou son début est perdu.",
            Repairability::None,
        ));
        return findings;
    }

    details.segments.push(JpegSegment {
        marker: 0xD8,
        label: jpeg_marker_label(0xD8).to_string(),
        offset: 0,
        length: 0,
    });

    let mut position = 2_usize;
    let mut saw_sos = false;
    let mut saw_eoi = false;

    while position + 1 < bytes.len() {
        if bytes[position] != 0xFF {
            position += 1;
            continue;
        }
        let marker = bytes[position + 1];
        // Les octets de remplissage FF FF et FF 00 ne sont pas des marqueurs.
        if marker == 0xFF || marker == 0x00 {
            position += 1;
            continue;
        }

        if marker == 0xD9 {
            saw_eoi = true;
            details.end_marker = true;
            details.segments.push(JpegSegment {
                marker,
                label: jpeg_marker_label(marker).to_string(),
                offset: position as u64,
                length: 0,
            });
            let end = position + 2;
            if end < bytes.len() {
                details.trailing_bytes = (bytes.len() - end) as u64;
            }
            break;
        }

        // Marqueurs autonomes, sans longueur.
        if (0xD0..=0xD8).contains(&marker) || marker == 0x01 {
            position += 2;
            continue;
        }

        if position + 4 > bytes.len() {
            break;
        }
        let length = u16::from_be_bytes([bytes[position + 2], bytes[position + 3]]) as u32;
        details.segments.push(JpegSegment {
            marker,
            label: jpeg_marker_label(marker).to_string(),
            offset: position as u64,
            length,
        });

        // Les dimensions vivent dans le segment SOFn.
        if matches!(marker, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF)
            && position + 9 < bytes.len()
        {
            details.height =
                Some(u16::from_be_bytes([bytes[position + 5], bytes[position + 6]]) as u32);
            details.width =
                Some(u16::from_be_bytes([bytes[position + 7], bytes[position + 8]]) as u32);
        }

        if marker == 0xDA {
            // Après SOS viennent les données entropiques : on saute au
            // marqueur suivant plutôt que de les interpréter.
            saw_sos = true;
            position = position + 2 + length as usize;
            while position + 1 < bytes.len() {
                if bytes[position] == 0xFF
                    && bytes[position + 1] != 0x00
                    && !(0xD0..=0xD7).contains(&bytes[position + 1])
                {
                    break;
                }
                position += 1;
            }
            continue;
        }

        position = position + 2 + length as usize;
    }

    if !saw_sos {
        findings.push(Finding::error(
            "jpeg.no-sos",
            "Données d'image absentes",
            "Le marqueur « SOS », qui ouvre les données compressées, est introuvable : ce \
             fichier décrit une image sans contenir ses pixels.",
            Repairability::None,
        ));
    }

    if !saw_eoi {
        findings.push(Finding::warning(
            "jpeg.no-eoi",
            "Marqueur de fin absent",
            "Un JPEG se termine par FF D9. Cette marque est absente : le fichier a été tronqué, \
             ou son écriture a été interrompue. Si les données d'image sont malgré tout \
             complètes, un décodeur tolérant rendra l'image entière ; sinon, seules les \
             premières lignes seront lisibles.",
            Repairability::RecoverVisual,
        ));
    }

    if details.trailing_bytes > 0 {
        findings.push(Finding::warning(
            "jpeg.trailing-garbage",
            "Données parasites après l'image",
            format!(
                "{} octets suivent le marqueur de fin. Ils ne font pas partie de l'image ; les \
                 retirer est une copie tronquée après « EOI ».",
                details.trailing_bytes
            ),
            Repairability::SafeRepair,
        ));
    }

    findings
}

/// Tente un décodage, sans rien écrire.
fn try_decode(bytes: &[u8], format: ::image::ImageFormat) -> Result<(u32, u32), String> {
    match ::image::load_from_memory_with_format(bytes, format) {
        Ok(decoded) => Ok((
            ::image::GenericImageView::width(&decoded),
            ::image::GenericImageView::height(&decoded),
        )),
        Err(error) => Err(error.to_string()),
    }
}

/// Diagnostic d'une image, PNG ou JPEG.
pub fn diagnose(bytes: &[u8], format_id: &str) -> (Vec<Finding>, ImageDetails) {
    let mut details = ImageDetails { format: format_id.to_string(), ..ImageDetails::default() };

    let mut findings = match format_id {
        "png" => walk_png(bytes, &mut details),
        "jpg" => walk_jpeg(bytes, &mut details),
        other => {
            return (
                vec![Finding::info(
                    "image.unsupported",
                    "Format d'image non analysé en profondeur",
                    format!(
                        "FourTout analyse la structure interne du PNG et du JPEG. Pour « {other} », \
                         seul le diagnostic générique s'applique."
                    ),
                )],
                details,
            );
        }
    };

    // Le décodeur a le dernier mot : une structure impeccable qui ne se décode
    // pas reste un fichier inutilisable, et l'inverse est vrai aussi.
    let decoder_format = if format_id == "png" {
        ::image::ImageFormat::Png
    } else {
        ::image::ImageFormat::Jpeg
    };
    match try_decode(bytes, decoder_format) {
        Ok((width, height)) => {
            details.decodes = true;
            details.width = Some(width);
            details.height = Some(height);
        }
        Err(error) => {
            details.decodes = false;
            details.decode_error = Some(error.clone());
        }
    }

    // La question qui décide de tout : reste-t-il un pixel à sauver ? On tente
    // réellement le nettoyage et le décodage, plutôt que de le supposer d'après
    // les constats. Une réponse négative n'est pas un échec à cacher : c'est le
    // résultat, et il vaut mieux l'afficher qu'offrir un bouton qui ne peut que
    // finir en erreur.
    let (recoverable, lossless) = recoverability(bytes, format_id);
    details.recoverable = recoverable;
    details.recovery_lossless = lossless;

    if !details.decodes {
        findings.push(if recoverable {
            Finding::error(
                "image.decode-failed",
                "Le décodeur refuse le fichier tel quel",
                format!(
                    "Message du décodeur : {}. Les défauts relevés ci-dessus peuvent être \
                     corrigés sans toucher aux pixels, et le décodeur accepte le fichier une \
                     fois nettoyé.",
                    details.decode_error.clone().unwrap_or_default()
                ),
                Repairability::RecoverVisual,
            )
        } else {
            Finding::error(
                "image.no-pixels",
                "Le décodeur ne rend aucun pixel",
                format!(
                    "Message du décodeur : {}. FourTout a tenté le nettoyage structurel qu'il \
                     sait justifier, puis un nouveau décodage : sans résultat. Les données \
                     d'image manquantes n'existent nulle part, et aucune ne sera inventée. Ce \
                     fichier est diagnosticable, il n'est pas récupérable — aucune action n'est \
                     donc proposée.",
                    details.decode_error.clone().unwrap_or_default()
                ),
                Repairability::None,
            )
        });
    }

    if findings.is_empty() {
        findings.push(Finding::info(
            "image.healthy",
            "Image conforme",
            format!(
                "Structure complète et décodage réussi : {} × {} pixels.",
                details.width.unwrap_or(0),
                details.height.unwrap_or(0)
            ),
        ));
    }

    (findings, details)
}

/// Reconstruit un PNG en écartant les blocs auxiliaires abîmés et les données
/// parasites finales. Aucun pixel n'est touché.
fn rebuild_png(bytes: &[u8]) -> Option<Vec<u8>> {
    if bytes.len() < 8 || bytes[..8] != PNG_SIGNATURE {
        return None;
    }
    let mut output = Vec::with_capacity(bytes.len());
    output.extend_from_slice(&PNG_SIGNATURE);

    let mut position = 8_usize;
    let mut wrote_iend = false;
    while position + 8 <= bytes.len() {
        let length = u32::from_be_bytes([
            bytes[position],
            bytes[position + 1],
            bytes[position + 2],
            bytes[position + 3],
        ]);
        let kind = &bytes[position + 4..position + 8];
        let data_end = position + 8 + length as usize;
        if data_end + 4 > bytes.len() {
            break;
        }
        let stored = u32::from_be_bytes([
            bytes[data_end],
            bytes[data_end + 1],
            bytes[data_end + 2],
            bytes[data_end + 3],
        ]);
        let ancillary = kind.first().is_some_and(|b| b.is_ascii_lowercase());
        let valid = stored == crc32(&bytes[position + 4..data_end]);

        // On ne recopie que les blocs intègres, plus les blocs essentiels
        // quels qu'ils soient : écarter un IDAT abîmé ferait disparaître une
        // partie de l'image en silence.
        if valid || !ancillary {
            output.extend_from_slice(&bytes[position..data_end + 4]);
        }
        if kind == b"IEND" {
            wrote_iend = true;
            break;
        }
        position = data_end + 4;
    }

    if !wrote_iend {
        output.extend_from_slice(&[0, 0, 0, 0]);
        output.extend_from_slice(b"IEND");
        output.extend_from_slice(&crc32(b"IEND").to_be_bytes());
    }
    Some(output)
}

/// Ce qu'une récupération d'image a produit.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageRecovery {
    pub output: String,
    pub width: u32,
    pub height: u32,
    /// Nature de l'opération : « sans perte » ou « visuelle ».
    pub lossless: bool,
    /// Étapes réellement appliquées, dans l'ordre.
    pub steps: Vec<String>,
    pub output_size: u64,
}

/// Nettoyage structurel, défendable octet par octet.
///
/// Extrait du chemin de récupération pour être employé **aussi** au diagnostic :
/// c'est en tentant ce nettoyage puis un décodage que l'on sait si une
/// récupération a le moindre sens. Sans cette réponse, l'écran proposerait un
/// bouton qui ne peut que finir en erreur.
fn clean(bytes: &[u8], format_id: &str) -> Result<(Vec<u8>, Vec<String>), String> {
    let mut steps = Vec::new();
    let cleaned: Vec<u8> = match format_id {
        "png" => {
            let rebuilt = rebuild_png(bytes)
                .ok_or_else(|| "Ce fichier n'a pas la signature d'un PNG.".to_string())?;
            if rebuilt.len() != bytes.len() {
                steps.push(format!(
                    "Blocs non conformes et données finales écartés ({} octets)",
                    bytes.len().saturating_sub(rebuilt.len())
                ));
            }
            rebuilt
        }
        "jpg" => {
            let mut cleaned = bytes.to_vec();
            // Données après EOI : on coupe.
            if let Some(at) = super::rfind(&cleaned, &[0xFF, 0xD9]) {
                if at + 2 < cleaned.len() {
                    steps.push(format!(
                        "Données après la fin de l'image écartées ({} octets)",
                        cleaned.len() - at - 2
                    ));
                    cleaned.truncate(at + 2);
                }
            } else {
                // Fin absente : l'ajouter ne fabrique aucun pixel, cela ferme
                // seulement le fichier là où il s'arrête déjà.
                steps.push("Marqueur de fin « EOI » ajouté".into());
                cleaned.extend_from_slice(&[0xFF, 0xD9]);
            }
            cleaned
        }
        other => return Err(format!("Récupération non prise en charge pour « {other} ».")),
    };
    Ok((cleaned, steps))
}

/// Le décodeur rendrait-il des pixels, et l'opération serait-elle sans perte ?
fn recoverability(bytes: &[u8], format_id: &str) -> (bool, bool) {
    let decoder_format = match format_id {
        "png" => ::image::ImageFormat::Png,
        "jpg" => ::image::ImageFormat::Jpeg,
        _ => return (false, false),
    };
    let Ok((cleaned, _)) = clean(bytes, format_id) else { return (false, false) };
    let cleaned_ok = try_decode(&cleaned, decoder_format).is_ok();
    // Seul un PNG dont le nettoyage suffit est réparable sans perte : les
    // pixels d'origine sont alors recopiés tels quels. Tout le reste passe par
    // un décodage, donc par une récupération visuelle.
    let lossless = format_id == "png" && cleaned_ok;
    let recoverable = cleaned_ok || try_decode(bytes, decoder_format).is_ok();
    (recoverable, lossless)
}

/// Récupère ce qui est décodable d'une image, dans un fichier neuf.
///
/// Deux chemins, et ils ne portent pas le même nom :
///
/// - **sans perte** : le fichier est nettoyé de ce qui ne fait pas partie de
///   l'image (octets parasites, blocs auxiliaires abîmés), et les octets des
///   pixels sont recopiés tels quels ;
/// - **visuelle** : le fichier ne peut pas être réparé, mais le décodeur rend
///   des pixels ; ils sont réencodés en PNG. L'image est sauvée, le fichier
///   d'origine ne l'est pas.
pub fn recover(bytes: &[u8], format_id: &str, destination: &Path) -> Result<ImageRecovery, String> {
    let (cleaned, mut steps) = clean(bytes, format_id)?;

    let decoder_format =
        if format_id == "png" { ::image::ImageFormat::Png } else { ::image::ImageFormat::Jpeg };

    // 2. Le nettoyage suffit-il à rendre le fichier lisible tel quel ?
    let original_ok = try_decode(bytes, decoder_format).is_ok();
    let cleaned_ok = try_decode(&cleaned, decoder_format).is_ok();

    if format_id == "png" && cleaned_ok {
        // Le PNG nettoyé est un PNG valide dont les pixels sont les octets
        // d'origine : c'est une réparation sans perte, pas un réencodage.
        let (width, height) = try_decode(&cleaned, decoder_format)?;
        std::fs::write(destination, &cleaned).map_err(|e| format!("Écriture impossible : {e}"))?;
        if steps.is_empty() {
            steps.push("Aucun défaut structurel : le fichier a été recopié tel quel".into());
        }
        return Ok(ImageRecovery {
            output: destination.to_string_lossy().to_string(),
            width,
            height,
            lossless: true,
            steps,
            output_size: cleaned.len() as u64,
        });
    }

    // 3. Sinon : récupération visuelle. On décode ce qui peut l'être et on
    //    réencode en PNG — sans perte à partir des pixels obtenus, ce qui
    //    évite d'ajouter une seconde compression destructrice à une image déjà
    //    abîmée.
    let source = if cleaned_ok { &cleaned } else { bytes };
    if !cleaned_ok && !original_ok {
        return Err(
            "Le décodeur ne rend aucun pixel, ni sur le fichier d'origine ni après nettoyage. \
             La structure est partiellement identifiable, mais aucune image ne peut être \
             reconstruite automatiquement."
                .to_string(),
        );
    }

    let decoded = ::image::load_from_memory_with_format(source, decoder_format)
        .map_err(|error| format!("Décodage impossible : {error}"))?;
    let width = ::image::GenericImageView::width(&decoded);
    let height = ::image::GenericImageView::height(&decoded);
    decoded
        .save_with_format(destination, ::image::ImageFormat::Png)
        .map_err(|error| format!("Écriture PNG impossible : {error}"))?;

    steps.push(format!("Pixels décodés puis réencodés en PNG sans perte ({width} × {height})"));
    let size = std::fs::metadata(destination).map(|m| m.len()).unwrap_or(0);

    Ok(ImageRecovery {
        output: destination.to_string_lossy().to_string(),
        width,
        height,
        lossless: false,
        steps,
        output_size: size,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// PNG minuscule, écrit par la bibliothèque d'images elle-même.
    fn healthy_png() -> Vec<u8> {
        let image = ::image::RgbaImage::from_fn(4, 3, |x, y| {
            ::image::Rgba([(x * 60) as u8, (y * 80) as u8, 128, 255])
        });
        let mut bytes = std::io::Cursor::new(Vec::new());
        ::image::DynamicImage::ImageRgba8(image)
            .write_to(&mut bytes, ::image::ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }

    fn healthy_jpeg() -> Vec<u8> {
        let image = ::image::RgbImage::from_fn(8, 8, |x, y| {
            ::image::Rgb([(x * 30) as u8, (y * 30) as u8, 64])
        });
        let mut bytes = std::io::Cursor::new(Vec::new());
        ::image::DynamicImage::ImageRgb8(image)
            .write_to(&mut bytes, ::image::ImageFormat::Jpeg)
            .unwrap();
        bytes.into_inner()
    }

    #[test]
    fn a_healthy_png_raises_nothing() {
        let (findings, details) = diagnose(&healthy_png(), "png");
        assert_eq!(details.width, Some(4));
        assert_eq!(details.height, Some(3));
        assert!(details.decodes);
        assert!(details.end_marker);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].code, "image.healthy");
    }

    #[test]
    fn a_healthy_jpeg_raises_nothing() {
        let (findings, details) = diagnose(&healthy_jpeg(), "jpg");
        assert_eq!(details.width, Some(8));
        assert_eq!(details.height, Some(8));
        assert!(details.decodes);
        assert!(details.end_marker);
        assert_eq!(findings.len(), 1, "{findings:?}");
    }

    #[test]
    fn measures_trailing_garbage_on_both_formats() {
        let mut png = healthy_png();
        png.extend_from_slice(b"parasite");
        let (findings, details) = diagnose(&png, "png");
        assert_eq!(details.trailing_bytes, 8);
        assert!(findings.iter().any(|f| f.code == "png.trailing-garbage"));

        let mut jpeg = healthy_jpeg();
        jpeg.extend_from_slice(b"parasite");
        let (findings, details) = diagnose(&jpeg, "jpg");
        assert_eq!(details.trailing_bytes, 8);
        assert!(findings.iter().any(|f| f.code == "jpeg.trailing-garbage"));
    }

    #[test]
    fn a_broken_ancillary_chunk_costs_no_pixel() {
        // On insère un bloc de texte, puis on abîme sa somme de contrôle.
        let png = healthy_png();
        let insert_at = 8 + 25; // après la signature et le bloc IHDR
        let mut chunk = Vec::new();
        chunk.extend_from_slice(&4_u32.to_be_bytes());
        chunk.extend_from_slice(b"tEXt");
        chunk.extend_from_slice(b"abcd");
        chunk.extend_from_slice(&0xDEAD_BEEF_u32.to_be_bytes()); // CRC volontairement faux

        let mut broken = png[..insert_at].to_vec();
        broken.extend_from_slice(&chunk);
        broken.extend_from_slice(&png[insert_at..]);

        let (findings, details) = diagnose(&broken, "png");
        assert_eq!(details.broken_ancillary, 1);
        assert_eq!(details.broken_critical, 0);
        let finding = findings.iter().find(|f| f.code == "png.broken-ancillary-chunk").unwrap();
        assert_eq!(finding.repairability, Repairability::SafeRepair);

        // La récupération retire le bloc fautif et rend un PNG sans perte.
        let dir = std::env::temp_dir().join("fourtout-image-ancillary");
        std::fs::create_dir_all(&dir).unwrap();
        let out = dir.join("out.png");
        let recovery = recover(&broken, "png", &out).unwrap();
        assert!(recovery.lossless, "étapes : {:?}", recovery.steps);
        assert_eq!((recovery.width, recovery.height), (4, 3));

        // Et les pixels sont rigoureusement identiques à l'original.
        let before = ::image::load_from_memory(&png).unwrap().to_rgba8();
        let after = ::image::open(&out).unwrap().to_rgba8();
        assert_eq!(before.as_raw(), after.as_raw());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_broken_critical_chunk_is_never_papered_over() {
        let mut png = healthy_png();
        // On abîme la somme de contrôle du bloc IHDR (essentiel).
        let ihdr_crc = 8 + 4 + 4 + 13;
        png[ihdr_crc] ^= 0xFF;
        let (findings, details) = diagnose(&png, "png");
        assert_eq!(details.broken_critical, 1);
        let finding = findings.iter().find(|f| f.code == "png.broken-critical-chunk").unwrap();
        assert!(finding.detail.contains("masquerait la corruption"));
        assert_eq!(finding.repairability, Repairability::RecoverVisual);
    }

    #[test]
    fn a_truncated_png_says_what_is_missing() {
        let png = healthy_png();
        let truncated = &png[..png.len() / 2];
        let (findings, details) = diagnose(truncated, "png");
        assert!(!details.decodes);
        assert!(findings.iter().any(|f| f.code == "png.truncated"));

        // Et la récupération échoue franchement plutôt que d'écrire un fichier.
        let error = recover(truncated, "png", Path::new("/tmp/never-written.png")).unwrap_err();
        assert!(error.contains("aucune image ne peut être reconstruite"), "{error}");
        assert!(!Path::new("/tmp/never-written.png").exists());
    }

    #[test]
    fn a_jpeg_without_its_end_marker_is_closed_not_invented() {
        let jpeg = healthy_jpeg();
        let without_eoi = &jpeg[..jpeg.len() - 2];
        let (findings, details) = diagnose(without_eoi, "jpg");
        assert!(!details.end_marker);
        assert!(findings.iter().any(|f| f.code == "jpeg.no-eoi"));

        let dir = std::env::temp_dir().join("fourtout-image-eoi");
        std::fs::create_dir_all(&dir).unwrap();
        let out = dir.join("out.png");
        let recovery = recover(without_eoi, "jpg", &out).unwrap();
        assert!(recovery.steps.iter().any(|step| step.contains("EOI")));
        assert_eq!((recovery.width, recovery.height), (8, 8));
        // La sortie est un PNG relisible.
        assert!(::image::open(&out).is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn recovering_a_jpeg_is_never_called_lossless() {
        let jpeg = healthy_jpeg();
        let dir = std::env::temp_dir().join("fourtout-image-jpeg");
        std::fs::create_dir_all(&dir).unwrap();
        let out = dir.join("out.png");
        let recovery = recover(&jpeg, "jpg", &out).unwrap();
        // Les pixels d'un JPEG passent par un décodage : on ne prétend pas
        // rendre le fichier d'origine.
        assert!(!recovery.lossless);
        assert!(recovery.steps.iter().any(|step| step.contains("réencodés")));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_unsupported_format_is_admitted_not_guessed() {
        let (findings, details) = diagnose(b"GIF89a....", "gif");
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].code, "image.unsupported");
        assert!(details.chunks.is_empty());
    }
}
