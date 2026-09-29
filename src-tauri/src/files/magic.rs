//! Reconnaissance de format par **signature**, pas par extension.
//!
//! Un fichier ne dit pas ce qu'il est : son nom le prétend. Cette table est la
//! seule autorité de FourTout sur « ce que ce fichier est réellement ». Elle
//! sert à l'inspecteur, au prévisualiseur, à la recherche (pour écarter le
//! binaire) et à l'inspection d'archive (pour reconnaître le conteneur).
//!
//! Elle reste volontairement courte : quelques dizaines de formats que
//! l'utilisateur rencontre vraiment, pas une base de milliers d'entrées dont
//! personne ne vérifie jamais l'exactitude.

use serde::Serialize;

use super::textscan::Encoding;

/// Nombre d'octets à lire en tête de fichier pour décider.
pub const HEAD_BYTES: usize = 512;

/// Format reconnu : identifiant stable, libellé affichable, extensions usuelles.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Signature {
    /// Identifiant court, comparable à une extension (« png », « 7z »…).
    pub id: &'static str,
    /// Libellé affichable en français.
    pub label: &'static str,
    /// Extensions légitimes pour ce contenu.
    pub extensions: &'static [&'static str],
    /// Famille, pour router vers le bon aperçu.
    pub family: Family,
}

/// Grande famille d'un format : c'est ce qui décide de l'aperçu proposé.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Family {
    Document,
    Image,
    Audio,
    Video,
    Archive,
    Executable,
    Data,
    Text,
    Unknown,
}

const fn sig(
    id: &'static str,
    label: &'static str,
    extensions: &'static [&'static str],
    family: Family,
) -> Signature {
    Signature { id, label, extensions, family }
}

/// Format inconnu : ni erreur, ni mensonge — on ne sait pas.
pub const UNKNOWN: Signature = sig("inconnu", "Inconnu", &[], Family::Unknown);

/// Extensions légitimes pour un fichier texte quel que soit son encodage.
/// Un BOM ne dit rien du rôle du fichier : ce peut être un `.txt`, un `.csv`
/// exporté par un tableur, un `.srt` de sous-titres…
const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "csv", "md", "log", "json", "xml", "yaml", "yml", "html", "htm", "srt", "vtt", "sql",
    "ini", "cfg", "conf", "tsv", "svg", "ts", "js", "css", "reg",
];

/// Ce qui suit la marque d'ordre des octets ressemble-t-il vraiment à du texte ?
///
/// C'est ce qui sépare un `.txt` en UTF-16 d'un binaire qui commence par
/// hasard par `FF FE` : le premier se décode en caractères lisibles, le second
/// en une bouillie de codes de contrôle et de caractères de remplacement.
fn decodes_as_text(head: &[u8], encoding: Encoding) -> bool {
    let decoded = super::textscan::decode(head, encoding);
    if decoded.is_empty() {
        // Un fichier réduit à sa seule marque : rien ne contredit le texte.
        return head.len() <= 4;
    }

    let mut control = 0_usize;
    let mut total = 0_usize;
    for character in decoded.chars() {
        total += 1;
        // U+FFFD ne sort jamais d'un texte bien formé : il signale une paire
        // de substitution orpheline ou une séquence UTF-8 invalide. Sur des
        // octets quelconques pris pour de l'UTF-16, il en apparaît aussitôt.
        if character == '\u{FFFD}' {
            return false;
        }
        if character.is_control() && !matches!(character, '\t' | '\n' | '\r' | '\u{000C}') {
            control += 1;
        }
    }
    control * 100 / total.max(1) < 5
}

/// Les quatre premiers octets forment-ils un en-tête de trame MPEG audio
/// **valide** ?
///
/// Le seul mot de synchronisation (onze bits à 1) ne suffit pas : il apparaît
/// dans quantité de fichiers qui n'ont rien d'audio — à commencer par le BOM
/// UTF-16 petit-boutien, `FF FE`. Les quatre champs qui suivent ont chacun des
/// valeurs réservées ou interdites ; les vérifier écarte l'immense majorité des
/// coïncidences.
fn is_mpeg_frame(head: &[u8]) -> bool {
    if head.len() < 4 {
        return false;
    }
    // Mot de synchronisation : onze bits à 1.
    if head[0] != 0xFF || (head[1] & 0xE0) != 0xE0 {
        return false;
    }
    // Version MPEG : 01 est réservé.
    if (head[1] >> 3) & 0x03 == 0b01 {
        return false;
    }
    // Couche : 00 est réservé.
    if (head[1] >> 1) & 0x03 == 0b00 {
        return false;
    }
    // Débit : 0000 signifie « libre » et 1111 est interdit. Aucun encodeur
    // réel ne produit le premier ; le second n'existe pas.
    let bitrate = (head[2] >> 4) & 0x0F;
    if bitrate == 0b0000 || bitrate == 0b1111 {
        return false;
    }
    // Fréquence d'échantillonnage : 11 est réservé.
    if (head[2] >> 2) & 0x03 == 0b11 {
        return false;
    }
    true
}

/// Reconnaît un format d'après ses premiers octets.
///
/// L'ordre compte : les conteneurs à en-tête long (RIFF, ftyp) sont testés
/// avant les signatures courtes qui pourraient les recouvrir.
pub fn identify(head: &[u8]) -> Signature {
    let starts = |prefix: &[u8]| head.len() >= prefix.len() && &head[..prefix.len()] == prefix;
    let at = |offset: usize, prefix: &[u8]| {
        head.len() >= offset + prefix.len() && &head[offset..offset + prefix.len()] == prefix
    };

    // --- marques d'ordre des octets ---------------------------------------
    //
    // Elles passent **avant tout le reste**, et ce n'est pas un détail de
    // rangement : le BOM UTF-16 petit-boutien est `FF FE`, qui ressemble à s'y
    // méprendre au mot de synchronisation d'une trame MPEG audio. Un fichier
    // texte en UTF-16 s'est ainsi retrouvé annoncé comme un MP3.
    if starts(&[0xFF, 0xFE, 0x00, 0x00]) {
        return sig("utf32le", "Texte UTF-32 LE", &["txt"], Family::Text);
    }
    if starts(&[0x00, 0x00, 0xFE, 0xFF]) {
        return sig("utf32be", "Texte UTF-32 BE", &["txt"], Family::Text);
    }
    // Une marque d'ordre des octets est un **indice**, pas une preuve : elle
    // n'est que deux octets, et n'importe quel binaire peut commencer ainsi.
    // On ne conclut donc « texte » qu'après avoir lu ce qui suit.
    if starts(&[0xFF, 0xFE]) && decodes_as_text(head, Encoding::Utf16Le) {
        return sig("utf16le", "Texte UTF-16 LE", TEXT_EXTENSIONS, Family::Text);
    }
    if starts(&[0xFE, 0xFF]) && decodes_as_text(head, Encoding::Utf16Be) {
        return sig("utf16be", "Texte UTF-16 BE", TEXT_EXTENSIONS, Family::Text);
    }
    if starts(&[0xEF, 0xBB, 0xBF]) && decodes_as_text(head, Encoding::Utf8Bom) {
        return sig("utf8bom", "Texte UTF-8 avec BOM", TEXT_EXTENSIONS, Family::Text);
    }

    // --- conteneurs à en-tête composé -------------------------------------
    if starts(b"RIFF") && at(8, b"WEBP") {
        return sig("webp", "Image WebP", &["webp"], Family::Image);
    }
    if starts(b"RIFF") && at(8, b"WAVE") {
        return sig("wav", "Audio WAV", &["wav"], Family::Audio);
    }
    if starts(b"RIFF") && at(8, b"AVI ") {
        return sig("avi", "Vidéo AVI", &["avi"], Family::Video);
    }
    if at(4, b"ftyp") {
        // La marque de format (major brand) départage MP4, MOV et AVIF.
        let brand = if head.len() >= 12 { &head[8..12] } else { b"    " };
        return match brand {
            b"qt  " => sig("mov", "Vidéo QuickTime", &["mov"], Family::Video),
            b"avif" | b"avis" => sig("avif", "Image AVIF", &["avif"], Family::Image),
            b"heic" | b"heix" | b"hevc" | b"mif1" => {
                sig("heic", "Image HEIC", &["heic", "heif"], Family::Image)
            }
            b"M4A " => sig("m4a", "Audio M4A", &["m4a"], Family::Audio),
            _ => sig("mp4", "Vidéo MP4", &["mp4", "m4v", "m4a", "mov"], Family::Video),
        };
    }
    if at(257, b"ustar") {
        return sig("tar", "Archive TAR", &["tar"], Family::Archive);
    }

    // --- documents ---------------------------------------------------------
    if starts(b"%PDF-") {
        return sig("pdf", "Document PDF", &["pdf"], Family::Document);
    }
    if starts(b"{\\rtf") {
        return sig("rtf", "Document RTF", &["rtf"], Family::Document);
    }
    if starts(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) {
        return sig(
            "ole2",
            "Document Office historique (OLE2)",
            &["doc", "xls", "ppt", "msg"],
            Family::Document,
        );
    }

    // --- images ------------------------------------------------------------
    if starts(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return sig("png", "Image PNG", &["png"], Family::Image);
    }
    if starts(&[0xFF, 0xD8, 0xFF]) {
        return sig("jpg", "Image JPEG", &["jpg", "jpeg"], Family::Image);
    }
    if starts(b"GIF87a") || starts(b"GIF89a") {
        return sig("gif", "Image GIF", &["gif"], Family::Image);
    }
    if starts(b"BM") {
        return sig("bmp", "Image BMP", &["bmp"], Family::Image);
    }
    if starts(&[0x49, 0x49, 0x2A, 0x00]) || starts(&[0x4D, 0x4D, 0x00, 0x2A]) {
        return sig("tiff", "Image TIFF", &["tif", "tiff"], Family::Image);
    }
    if starts(&[0x00, 0x00, 0x01, 0x00]) {
        return sig("ico", "Icône Windows", &["ico"], Family::Image);
    }

    // --- audio / vidéo ------------------------------------------------------
    if starts(b"OggS") {
        return sig("ogg", "Conteneur Ogg", &["ogg", "oga", "opus"], Family::Audio);
    }
    if starts(b"fLaC") {
        return sig("flac", "Audio FLAC", &["flac"], Family::Audio);
    }
    if starts(b"ID3") || is_mpeg_frame(head) {
        return sig("mp3", "Audio MP3", &["mp3", "mp2"], Family::Audio);
    }
    if starts(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return sig("mkv", "Conteneur Matroska", &["mkv", "webm"], Family::Video);
    }

    // --- archives et compression -------------------------------------------
    if starts(&[0x50, 0x4B, 0x03, 0x04]) || starts(&[0x50, 0x4B, 0x05, 0x06]) {
        // Conteneur ZIP : c'est aussi la signature des formats Office récents,
        // d'OpenDocument, d'EPUB et des .jar.
        return sig(
            "zip",
            "Conteneur ZIP",
            &["zip", "docx", "xlsx", "pptx", "odt", "ods", "odp", "epub", "jar", "apk"],
            Family::Archive,
        );
    }
    if starts(&[0x1F, 0x8B]) {
        return sig("gz", "Flux GZIP", &["gz", "tgz"], Family::Archive);
    }
    if starts(&[0xFD, b'7', b'z', b'X', b'Z', 0x00]) {
        return sig("xz", "Flux XZ", &["xz", "txz"], Family::Archive);
    }
    if starts(&[0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]) {
        return sig("7z", "Archive 7z", &["7z"], Family::Archive);
    }
    if starts(b"Rar!") {
        return sig("rar", "Archive RAR", &["rar"], Family::Archive);
    }
    if starts(b"BZh") {
        return sig("bz2", "Flux BZIP2", &["bz2", "tbz2"], Family::Archive);
    }
    if starts(&[0x28, 0xB5, 0x2F, 0xFD]) {
        return sig("zst", "Flux Zstandard", &["zst"], Family::Archive);
    }

    // --- exécutables et données --------------------------------------------
    if starts(&[0x7F, b'E', b'L', b'F']) {
        return sig("elf", "Exécutable ELF (Linux)", &["", "so", "bin"], Family::Executable);
    }
    if starts(b"MZ") {
        return sig("exe", "Exécutable Windows (PE)", &["exe", "dll", "sys"], Family::Executable);
    }
    if starts(b"\xCA\xFE\xBA\xBE") {
        return sig("class", "Classe Java", &["class"], Family::Executable);
    }
    if starts(b"\0asm") {
        return sig("wasm", "Module WebAssembly", &["wasm"], Family::Executable);
    }
    if starts(b"SQLite format 3\0") {
        return sig("sqlite", "Base SQLite", &["sqlite", "db", "sqlite3"], Family::Data);
    }
    UNKNOWN
}

/// L'extension annoncée est-elle cohérente avec le contenu réel ?
///
/// Un format inconnu ne peut pas contredire une extension : on ne prétend pas
/// savoir. Un `.jpeg` contenant un JPEG est cohérent, un `.jpg` contenant un
/// PNG ne l'est pas.
pub fn extension_matches(signature: &Signature, extension: &str) -> bool {
    if signature.id == UNKNOWN.id {
        return true;
    }
    let extension = extension.to_ascii_lowercase();
    if extension.is_empty() {
        // Un exécutable Unix et un fichier texte (README, Makefile) n'ont
        // légitimement pas d'extension.
        return matches!(signature.family, Family::Executable | Family::Text);
    }
    signature.id == extension || signature.extensions.contains(&extension.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_common_formats() {
        assert_eq!(identify(b"%PDF-1.7").id, "pdf");
        assert_eq!(identify(&[0x89, b'P', b'N', b'G', 13, 10, 26, 10]).id, "png");
        assert_eq!(identify(&[0xFF, 0xD8, 0xFF, 0xE0]).id, "jpg");
        assert_eq!(identify(b"PK\x03\x04rest").id, "zip");
        assert_eq!(identify(&[0x1F, 0x8B, 0x08, 0x00]).id, "gz");
        assert_eq!(identify(&[0xFD, b'7', b'z', b'X', b'Z', 0x00]).id, "xz");
        assert_eq!(identify(&[0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]).id, "7z");
        assert_eq!(identify(b"SQLite format 3\0rest").id, "sqlite");
        assert_eq!(identify(&[0x7F, b'E', b'L', b'F', 2]).id, "elf");
        assert_eq!(identify(b"MZ\x90\x00").id, "exe");
        assert_eq!(identify(b"quelconque").id, "inconnu");
    }


    /// Un en-tête de trame MPEG audio valide, tel qu'en produit un encodeur :
    /// MPEG-1 Layer III, 128 kbit/s, 44,1 kHz.
    fn mp3_frame() -> Vec<u8> {
        let mut bytes = vec![0xFF, 0xFB, 0x90, 0x00];
        bytes.extend(std::iter::repeat_n(0_u8, 413));
        bytes
    }

    #[test]
    fn a_utf16_byte_order_mark_is_never_an_mp3() {
        // `FF FE` est le BOM UTF-16 petit-boutien. C'est aussi, bit pour bit,
        // un mot de synchronisation MPEG plausible : la confusion est la raison
        // d'être de ce test.
        let mut utf16le = vec![0xFF, 0xFE];
        for character in "Première ligne.".encode_utf16() {
            utf16le.extend_from_slice(&character.to_le_bytes());
        }
        let signature = identify(&utf16le);
        assert_eq!(signature.id, "utf16le");
        assert_eq!(signature.family, Family::Text);
        assert!(extension_matches(&signature, "txt"), "un .txt en UTF-16 est cohérent");

        let mut utf16be = vec![0xFE, 0xFF];
        for character in "Première ligne.".encode_utf16() {
            utf16be.extend_from_slice(&character.to_be_bytes());
        }
        assert_eq!(identify(&utf16be).id, "utf16be");

        let mut utf8bom = vec![0xEF, 0xBB, 0xBF];
        utf8bom.extend_from_slice("Première ligne.".as_bytes());
        let signature = identify(&utf8bom);
        assert_eq!(signature.id, "utf8bom");
        assert!(extension_matches(&signature, "csv"));
        assert!(extension_matches(&signature, ""), "un README sans extension reste cohérent");
    }

    #[test]
    fn recognises_a_real_mpeg_frame_and_refuses_the_look_alikes() {
        assert_eq!(identify(&mp3_frame()).id, "mp3");
        assert_eq!(identify(b"ID3\x03\x00\x00\x00\x00\x00\x21").id, "mp3");

        // Chacun de ces en-têtes porte le mot de synchronisation, mais viole un
        // champ que tout décodeur vérifierait.
        for (label, header) in [
            // 0xEB : synchronisation intacte, mais bits de version à 01.
            ("version réservée", [0xFF, 0xEB, 0x90, 0x00]),
            ("couche réservée", [0xFF, 0xF9, 0x90, 0x00]),
            ("débit libre", [0xFF, 0xFB, 0x00, 0x00]),
            ("débit interdit", [0xFF, 0xFB, 0xF0, 0x00]),
            ("fréquence réservée", [0xFF, 0xFB, 0x9C, 0x00]),
        ] {
            assert_ne!(identify(&header).id, "mp3", "accepté à tort : {label}");
        }

        // Un binaire commençant par FF FE n'est ni un MP3, ni du texte : la
        // marque d'ordre des octets est un indice, pas une preuve, et ce qui
        // la suit ne se décode pas en caractères lisibles.
        let mut binaire = vec![0xFF, 0xFE, 0x00, 0x01, 0x02, 0x03, 0x1B, 0x7F];
        // Octets quelconques mais reproductibles : décodés en UTF-16, ils
        // produisent aussitôt des paires de substitution orphelines.
        let mut state = 0x1234_5678_u32;
        for _ in 0..400 {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            binaire.push((state >> 16) as u8);
        }
        let signature = identify(&binaire);
        assert_ne!(signature.id, "mp3");
        assert_eq!(signature.id, "inconnu");
    }

    #[test]
    fn distinguishes_riff_containers() {
        let mut webp = b"RIFF\0\0\0\0WEBPVP8 ".to_vec();
        webp.truncate(16);
        assert_eq!(identify(&webp).id, "webp");
        let wav = b"RIFF\0\0\0\0WAVEfmt ".to_vec();
        assert_eq!(identify(&wav).id, "wav");
    }

    #[test]
    fn extension_mismatch_is_detected() {
        let png = identify(&[0x89, b'P', b'N', b'G', 13, 10, 26, 10]);
        assert!(extension_matches(&png, "png"));
        assert!(!extension_matches(&png, "jpg"));

        let jpeg = identify(&[0xFF, 0xD8, 0xFF, 0xE0]);
        assert!(extension_matches(&jpeg, "jpeg"));
        assert!(extension_matches(&jpeg, "JPG"));

        // Un ZIP couvre légitimement les formats Office et OpenDocument.
        let zip = identify(b"PK\x03\x04");
        assert!(extension_matches(&zip, "docx"));
        assert!(extension_matches(&zip, "epub"));
        assert!(!extension_matches(&zip, "pdf"));

        // Un contenu non reconnu ne contredit rien.
        assert!(extension_matches(&UNKNOWN, "quelconque"));
    }
}
