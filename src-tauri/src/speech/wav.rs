//! Lecture d'en-têtes WAV et concaténation.
//!
//! Les segments produits par une même voix Piper partagent exactement le même
//! format : les concaténer revient à recoller leurs données PCM sous un nouvel
//! en-tête. C'est exact, instantané, et cela évite un réencodage FFmpeg pour la
//! sortie WAV (le MP3 passe, lui, par le socle média existant).

use std::path::Path;

/// Format audio d'un fichier WAV PCM.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Format {
    pub channels: u16,
    pub sample_rate: u32,
    pub bits: u16,
}

/// En-tête `fmt ` + données PCM d'un fichier WAV.
pub struct Wav {
    pub format: Format,
    pub data: Vec<u8>,
}

fn u16_at(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

/// Analyse un fichier WAV PCM : parcours des morceaux RIFF jusqu'à `fmt ` et
/// `data`. Tolère les morceaux additionnels (LIST, fact…).
pub fn parse(bytes: &[u8]) -> Result<Wav, String> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("Fichier WAV invalide.".into());
    }

    let mut format: Option<Format> = None;
    let mut data: Option<Vec<u8>> = None;
    let mut cursor = 12usize;

    while cursor + 8 <= bytes.len() {
        let id = &bytes[cursor..cursor + 4];
        let size = u32_at(bytes, cursor + 4) as usize;
        let body = cursor + 8;
        let end = body.saturating_add(size).min(bytes.len());

        if id == b"fmt " && size >= 16 {
            format = Some(Format {
                channels: u16_at(bytes, body + 2),
                sample_rate: u32_at(bytes, body + 4),
                bits: u16_at(bytes, body + 14),
            });
        } else if id == b"data" {
            data = Some(bytes[body..end].to_vec());
        }

        // Les morceaux RIFF sont alignés sur 2 octets.
        cursor = body + size + (size % 2);
    }

    match (format, data) {
        (Some(format), Some(data)) => Ok(Wav { format, data }),
        _ => Err("Fichier WAV incomplet.".into()),
    }
}

/// Construit un WAV PCM complet à partir d'un format et de données brutes.
pub fn encode(format: Format, data: &[u8]) -> Vec<u8> {
    let block_align = format.channels * format.bits / 8;
    let byte_rate = format.sample_rate * u32::from(block_align);
    let mut out = Vec::with_capacity(44 + data.len());

    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&((36 + data.len()) as u32).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&format.channels.to_le_bytes());
    out.extend_from_slice(&format.sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&format.bits.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(data);
    out
}

/// Durée en millisecondes d'un flux PCM de ce format.
pub fn duration_ms(format: Format, data_len: usize) -> u64 {
    let block_align = u64::from(format.channels) * u64::from(format.bits) / 8;
    if block_align == 0 || format.sample_rate == 0 {
        return 0;
    }
    (data_len as u64 / block_align) * 1000 / u64::from(format.sample_rate)
}

/// Concatène plusieurs WAV de format identique en un seul.
pub fn concat(paths: &[impl AsRef<Path>]) -> Result<Vec<u8>, String> {
    let mut format: Option<Format> = None;
    let mut data: Vec<u8> = Vec::new();

    for path in paths {
        let bytes = std::fs::read(path.as_ref())
            .map_err(|e| format!("Segment audio illisible : {e}"))?;
        let wav = parse(&bytes)?;
        match format {
            None => format = Some(wav.format),
            Some(first) if first != wav.format => {
                return Err("Les segments audio n'ont pas le même format.".into())
            }
            _ => {}
        }
        data.extend_from_slice(&wav.data);
    }

    let format = format.ok_or_else(|| "Aucun segment audio à assembler.".to_string())?;
    Ok(encode(format, &data))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FORMAT: Format = Format { channels: 1, sample_rate: 22050, bits: 16 };

    #[test]
    fn round_trips_a_wav() {
        let data = vec![1u8, 2, 3, 4, 5, 6, 7, 8];
        let encoded = encode(FORMAT, &data);
        let parsed = parse(&encoded).unwrap();
        assert_eq!(parsed.format, FORMAT);
        assert_eq!(parsed.data, data);
    }

    #[test]
    fn rejects_non_wav_bytes() {
        assert!(parse(b"pas du tout un wav").is_err());
    }

    #[test]
    fn skips_extra_chunks_before_data() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        // fmt
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&22050u32.to_le_bytes());
        bytes.extend_from_slice(&44100u32.to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        // morceau inconnu, de taille impaire (donc suivi d'un octet de bourrage)
        bytes.extend_from_slice(b"LIST");
        bytes.extend_from_slice(&3u32.to_le_bytes());
        bytes.extend_from_slice(&[9, 9, 9, 0]);
        // data
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&4u32.to_le_bytes());
        bytes.extend_from_slice(&[1, 2, 3, 4]);

        let parsed = parse(&bytes).unwrap();
        assert_eq!(parsed.format.sample_rate, 22050);
        assert_eq!(parsed.data, vec![1, 2, 3, 4]);
    }

    #[test]
    fn concatenation_sums_the_payloads() {
        let dir = std::env::temp_dir().join("fourtout-wav-concat-test");
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.wav");
        let b = dir.join("b.wav");
        std::fs::write(&a, encode(FORMAT, &[1, 2, 3, 4])).unwrap();
        std::fs::write(&b, encode(FORMAT, &[5, 6, 7, 8])).unwrap();

        let joined = concat(&[&a, &b]).unwrap();
        let parsed = parse(&joined).unwrap();
        assert_eq!(parsed.data, vec![1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(parsed.format, FORMAT);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_mixed_formats() {
        let dir = std::env::temp_dir().join("fourtout-wav-mixed-test");
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.wav");
        let b = dir.join("b.wav");
        std::fs::write(&a, encode(FORMAT, &[1, 2])).unwrap();
        std::fs::write(
            &b,
            encode(Format { channels: 2, sample_rate: 44100, bits: 16 }, &[1, 2, 3, 4]),
        )
        .unwrap();
        assert!(concat(&[&a, &b]).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn computes_duration() {
        // 22050 échantillons 16 bits mono = 44100 octets = 1 seconde.
        assert_eq!(duration_ms(FORMAT, 44_100), 1000);
    }
}
