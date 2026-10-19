//! Décodage d'images que la WebView ou FFmpeg ne lisent pas partout.
//!
//! * **HEIC / HEIF** — décodeur Rust pur (`zune-heic`), identique octet pour
//!   octet à libheif sur les images fixes. Aucune bibliothèque système à
//!   installer, donc le même comportement sous Fedora et Windows.
//! * **AVIF** — FFmpeg (libdav1d), si ce FFmpeg sait le décoder : la capacité
//!   est **vérifiée en décodant un échantillon embarqué**, jamais supposée.
//! * **WebP et PNG animés** — décodés image par image, avec leurs durées, puis
//!   réassemblés par FFmpeg dans le format demandé (`anim`).
//!
//! Les séquences HEIF (rafales, photos « live ») ne sont pas décodées : seule
//! l'image principale existe pour ce décodeur, et on le dit plutôt que de la
//! présenter comme le fichier entier.

pub mod anim;
pub mod command;
pub mod heic;

/// Échantillon AVIF de 64×64 pixels (quatre quadrants colorés), pour vérifier
/// qu'un FFmpeg sait réellement décoder l'AVIF.
pub const AVIF_PROBE: &[u8] = include_bytes!("probe.avif");
