//! Encodage d'images natif.
//!
//! La WebView WebKitGTK ne sait pas encoder le WebP : `canvas.toBlob(…,
//! "image/webp")` renvoie silencieusement du PNG. Les fichiers `.webp` produits
//! côté frontend étaient donc en réalité des PNG mal étiquetés, refusés par les
//! visionneuses GNOME (glycin/Loupe) qui choisissent le décodeur selon
//! l'extension. On encode donc le WebP ici, en Rust pur (crate `image`), à
//! partir du PNG — valide, lui — produit par le canvas.
//!
//! Le WebP est encodé **sans perte** : c'est le mode fourni par `image`, il
//! garantit un fichier parfaitement valide et idéal pour les captures et les
//! graphiques. Les photos, elles, gagnent à rester en JPEG (choix offert par
//! l'interface).

use image::{ExtendedColorType, ImageEncoder};

/// Transcode un PNG (produit par le canvas) en WebP sans perte, réellement valide.
///
/// Le PNG arrive comme corps binaire brut de la requête IPC (le frontend passe
/// un `ArrayBuffer`), pour éviter toute sérialisation coûteuse d'un grand
/// tableau d'octets.
#[tauri::command]
pub fn encode_webp(request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    let png = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.as_slice(),
        tauri::ipc::InvokeBody::Json(_) => return Err("corps binaire attendu".into()),
    };
    let bytes = encode_webp_bytes(png)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Cœur testable : PNG → WebP sans perte.
pub fn encode_webp_bytes(png: &[u8]) -> Result<Vec<u8>, String> {
    let image = image::load_from_memory_with_format(png, image::ImageFormat::Png)
        .map_err(|e| format!("PNG illisible : {e}"))?;
    let rgba = image.to_rgba8();
    let (width, height) = rgba.dimensions();

    let mut out = Vec::new();
    image::codecs::webp::WebPEncoder::new_lossless(&mut out)
        .write_image(rgba.as_raw(), width, height, ExtendedColorType::Rgba8)
        .map_err(|e| format!("Encodage WebP impossible : {e}"))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ExtendedColorType, ImageEncoder};

    /// Construit un petit PNG RVBA avec transparence, comme le ferait le canvas.
    fn sample_png() -> Vec<u8> {
        let mut rgba = vec![0u8; 8 * 8 * 4];
        for (i, px) in rgba.chunks_mut(4).enumerate() {
            px[0] = (i * 3) as u8;
            px[1] = 128;
            px[2] = 200;
            px[3] = if i % 2 == 0 { 255 } else { 64 };
        }
        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png)
            .write_image(&rgba, 8, 8, ExtendedColorType::Rgba8)
            .unwrap();
        png
    }

    #[test]
    fn produces_a_real_webp_file() {
        let webp = encode_webp_bytes(&sample_png()).unwrap();
        // En-tête RIFF/WEBP : c'est précisément ce qui manquait aux sorties
        // WebKitGTK (qui étaient des PNG).
        assert_eq!(&webp[0..4], b"RIFF");
        assert_eq!(&webp[8..12], b"WEBP");
        assert!(webp.len() > 12);
    }

    #[test]
    fn the_webp_is_decodable_and_keeps_dimensions() {
        let webp = encode_webp_bytes(&sample_png()).unwrap();
        let decoded =
            image::load_from_memory_with_format(&webp, image::ImageFormat::WebP).unwrap();
        assert_eq!(decoded.width(), 8);
        assert_eq!(decoded.height(), 8);
    }

    #[test]
    fn rejects_non_png_input() {
        assert!(encode_webp_bytes(b"not a png").is_err());
    }
}
