//! HEIC / HEIF → pixels.

use image::{DynamicImage, ImageBuffer, ImageFormat};
use zune_heic::zune_core::bytestream::ZCursor;
use zune_heic::zune_core::colorspace::ColorSpace;
use zune_heic::HeifDecoder;

use crate::files::magic;
use crate::internet::http::{ErrorKind, InternetError};

/// Taille maximale d'une image décodée (largeur × hauteur), contre les
/// fichiers fabriqués pour exploser la mémoire.
const MAX_PIXELS: u64 = 120_000_000;

pub fn is_heif(bytes: &[u8]) -> bool {
    matches!(magic::identify(&bytes[..bytes.len().min(magic::HEAD_BYTES)]).id, "heic" | "heif")
}

/// Une séquence d'images (rafale, photo « live ») ?
pub fn is_sequence(bytes: &[u8]) -> bool {
    let signature = magic::identify(&bytes[..bytes.len().min(magic::HEAD_BYTES)]);
    matches!(signature.id, "heic" | "heif") && signature.animated
}

pub fn decode(bytes: &[u8]) -> Result<DynamicImage, InternetError> {
    let fail = |m: &str| InternetError::new(ErrorKind::Other, m.to_string());
    let mut decoder = HeifDecoder::new(ZCursor::new(bytes));
    decoder.decode_headers().map_err(|_| fail("Image HEIC illisible ou non prise en charge."))?;
    let (width, height) = (
        decoder.width().ok_or_else(|| fail("Dimensions HEIC absentes."))?,
        decoder.height().ok_or_else(|| fail("Dimensions HEIC absentes."))?,
    );
    if width == 0 || height == 0 || width as u64 * height as u64 > MAX_PIXELS {
        return Err(fail("Image HEIC trop grande pour être décodée."));
    }
    let pixels = decoder.decode().map_err(|_| fail("Image HEIC illisible ou non prise en charge."))?;
    let (w, h) = (width as u32, height as u32);
    let image = match decoder.colorspace() {
        Some(ColorSpace::RGB) => ImageBuffer::from_raw(w, h, pixels).map(DynamicImage::ImageRgb8),
        Some(ColorSpace::RGBA) => ImageBuffer::from_raw(w, h, pixels).map(DynamicImage::ImageRgba8),
        Some(ColorSpace::Luma) => ImageBuffer::from_raw(w, h, pixels).map(DynamicImage::ImageLuma8),
        Some(ColorSpace::LumaA) => ImageBuffer::from_raw(w, h, pixels).map(DynamicImage::ImageLumaA8),
        _ => None,
    };
    image.ok_or_else(|| fail("Espace colorimétrique HEIC non pris en charge."))
}

/// HEIC → PNG sans perte, que la WebView sait ensuite lire comme n'importe quelle image.
pub fn to_png(bytes: &[u8]) -> Result<Vec<u8>, InternetError> {
    if is_sequence(bytes) {
        return Err(InternetError::new(
            ErrorKind::Unsupported,
            "Ce fichier est une séquence HEIF (plusieurs images) : seules les images fixes sont prises en charge.",
        ));
    }
    let image = decode(bytes)?;
    let mut out = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut out, ImageFormat::Png)
        .map_err(|e| InternetError::new(ErrorKind::Other, format!("Encodage PNG impossible : {e}")))?;
    Ok(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 64×64, quatre quadrants (rouge, vert, bleu, jaune) et un disque noir ;
    /// produit par libheif/x265. Octets figés : voir `tests/fixtures/README.md`.
    const STILL: &[u8] = include_bytes!("../../tests/fixtures/still.heic");

    #[test]
    fn decodes_a_real_heic_with_correct_colours() {
        assert!(is_heif(STILL));
        assert!(!is_sequence(STILL));
        let image = decode(STILL).unwrap().to_rgb8();
        assert_eq!(image.dimensions(), (64, 64));
        let near = |p: &image::Rgb<u8>, e: [u8; 3]| p.0.iter().zip(e).all(|(a, b)| (i32::from(*a) - i32::from(b)).abs() <= 6);
        assert!(near(image.get_pixel(2, 30), [220, 30, 30]) || near(image.get_pixel(30, 2), [220, 30, 30]) || near(image.get_pixel(28, 28), [220, 30, 30]));
        assert!(near(image.get_pixel(60, 4), [30, 160, 60]));
        assert!(near(image.get_pixel(4, 60), [30, 60, 220]));
        assert!(near(image.get_pixel(60, 60), [240, 200, 20]));
    }

    #[test]
    fn produces_a_png_the_webview_can_read() {
        let png = to_png(STILL).unwrap();
        assert!(png.starts_with(&[0x89, b'P', b'N', b'G']));
        assert_eq!(image::load_from_memory(&png).unwrap().to_rgb8().dimensions(), (64, 64));
    }

    #[test]
    fn refuses_garbage_truncation_and_sequences() {
        assert!(decode(b"pas une image").is_err());
        assert!(decode(&STILL[..STILL.len() / 2]).is_err());
        assert!(decode(&[]).is_err());
        // Une séquence HEIF (msf1/hevc) est refusée explicitement.
        let mut sequence = STILL.to_vec();
        sequence[8..12].copy_from_slice(b"msf1");
        sequence[16..20].copy_from_slice(b"hevc");
        let error = to_png(&sequence).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Unsupported);
    }
}
