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
///
/// 512 octets suffisaient aux signatures d'origine. Deux formats exigent plus :
/// un APNG ne se distingue d'un PNG que par son bloc `acTL`, qui peut suivre un
/// profil colorimétrique de plusieurs kilo-octets, et une image ISO 9660 ne se
/// reconnaît qu'à son descripteur de volume, à l'octet 32 769.
pub const HEAD_BYTES: usize = 36 * 1024;

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
    /// Le contenu porte plusieurs images : WebP ou PNG animé, séquence HEIF ou
    /// AVIF. Un convertisseur qui l'ignore aplatit silencieusement l'animation.
    pub animated: bool,
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
    Signature { id, label, extensions, family, animated: false }
}

/// Variante animée (ou multi-images) d'une signature.
const fn animated(signature: Signature) -> Signature {
    Signature { animated: true, ..signature }
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

    // Une image ISO hybride (isohybrid) commence par un secteur de démarrage
    // MBR, voire un exécutable : seul son descripteur de volume la désigne, et
    // il est inattendu ailleurs, d'où le test avant les signatures courtes.
    // Descripteur de volume ISO 9660 : « CD001 » à l'octet 32 769, après les
    // seize secteurs de zone système.
    if at(32_769, b"CD001") {
        return sig("iso", "Image disque ISO 9660", &["iso", "img"], Family::Archive);
    }

    // --- conteneurs à en-tête composé -------------------------------------
    if starts(b"RIFF") && at(8, b"WEBP") {
        let still = sig("webp", "Image WebP", &["webp"], Family::Image);
        // Le bloc étendu `VP8X` porte les drapeaux ; le bit 0x02 annonce une
        // animation. Une WebP sans `VP8X` est forcément une image fixe.
        return if at(12, b"VP8X") && head.len() > 20 && head[20] & 0x02 != 0 {
            animated(sig("webp", "Image WebP animée", &["webp"], Family::Image))
        } else {
            still
        };
    }
    if starts(b"RIFF") && at(8, b"WAVE") {
        return sig("wav", "Audio WAV", &["wav"], Family::Audio);
    }
    if starts(b"RIFF") && at(8, b"AVI ") {
        return sig("avi", "Vidéo AVI", &["avi"], Family::Video);
    }
    if at(4, b"ftyp") {
        return identify_isobmff(head);
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
        return if png_is_animated(head) {
            animated(sig("apng", "Image PNG animée (APNG)", &["png", "apng"], Family::Image))
        } else {
            sig("png", "Image PNG", &["png"], Family::Image)
        };
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
        // Le DocType de l'en-tête EBML départage WebM (sous-ensemble de
        // Matroska : VP8/VP9/AV1, Vorbis/Opus) du Matroska général.
        return if ebml_doc_type(head) == Some(b"webm".as_slice()) {
            sig("webm", "Vidéo WebM", &["webm", "mkv"], Family::Video)
        } else {
            sig("mkv", "Conteneur Matroska", &["mkv", "mka", "webm"], Family::Video)
        };
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

/// Lit le DocType de l'en-tête EBML (`webm`, `matroska`).
///
/// L'élément DocType a l'identifiant `42 82` et une taille sur un octet pour
/// toute valeur réelle ; on le cherche dans l'en-tête, qui reste court.
fn ebml_doc_type(head: &[u8]) -> Option<&[u8]> {
    let window = &head[..head.len().min(80)];
    let at = window.windows(2).position(|pair| pair == [0x42, 0x82])?;
    let size_byte = *window.get(at + 2)?;
    if size_byte & 0x80 == 0 {
        return None;
    }
    let length = (size_byte & 0x7F) as usize;
    window.get(at + 3..at + 3 + length)
}

/// Un PNG contient-il un bloc `acTL` avant ses données d'image ?
///
/// C'est la définition de l'APNG : un PNG ordinaire s'ouvre dans tout lecteur
/// et n'affiche que sa première image si l'on ignore ce bloc, un APNG est un
/// PNG *dont le bloc de contrôle d'animation précède le premier `IDAT`*.
fn png_is_animated(head: &[u8]) -> bool {
    let mut offset = 8;
    while offset + 8 <= head.len() {
        let length = u32::from_be_bytes([head[offset], head[offset + 1], head[offset + 2], head[offset + 3]]) as usize;
        match &head[offset + 4..offset + 8] {
            b"acTL" => return true,
            b"IDAT" | b"IEND" => return false,
            _ => {}
        }
        // Données + CRC (4 octets) ; un débordement signifie un fichier tronqué.
        offset = match offset.checked_add(12).and_then(|n| n.checked_add(length)) {
            Some(next) => next,
            None => return false,
        };
    }
    false
}

/// Distingue les fichiers ISO-BMFF (MP4, MOV, HEIC, HEIF, AVIF…) d'après leur
/// boîte `ftyp` : marque principale, puis marques compatibles.
fn identify_isobmff(head: &[u8]) -> Signature {
    let major: [u8; 4] = head.get(8..12).and_then(|b| b.try_into().ok()).unwrap_or(*b"    ");
    let declared = head
        .get(0..4)
        .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize)
        .unwrap_or(0);
    let end = declared.clamp(16, head.len().max(16)).min(head.len());
    let compatible: Vec<[u8; 4]> = head
        .get(16..end)
        .unwrap_or(&[])
        .chunks_exact(4)
        .map(|c| [c[0], c[1], c[2], c[3]])
        .collect();
    let has = |brand: &[u8; 4]| major == *brand || compatible.contains(brand);

    let avif = sig("avif", "Image AVIF", &["avif"], Family::Image);
    let heic = sig("heic", "Image HEIC", &["heic", "heif"], Family::Image);
    let heif = sig("heif", "Image HEIF", &["heif", "heic"], Family::Image);

    match &major {
        b"qt  " => return sig("mov", "Vidéo QuickTime", &["mov"], Family::Video),
        b"M4A " | b"M4B " => return sig("m4a", "Audio M4A", &["m4a"], Family::Audio),
        _ => {}
    }
    // Les marques d'image priment sur « isom » : un AVIF annonce parfois
    // `mif1` en principale et `avif` en compatible.
    if has(b"avis") {
        return animated(sig("avif", "Image AVIF animée", &["avif"], Family::Image));
    }
    if has(b"avif") {
        return avif;
    }
    if has(b"hevc") || has(b"hevx") || has(b"hevm") || has(b"hevs") || has(b"heis") {
        return animated(sig("heic", "Séquence HEIC", &["heic", "heif"], Family::Image));
    }
    if has(b"heic") || has(b"heix") || has(b"heim") {
        return heic;
    }
    if has(b"msf1") {
        return animated(sig("heif", "Séquence HEIF", &["heif", "heic"], Family::Image));
    }
    if has(b"mif1") {
        return heif;
    }
    sig("mp4", "Vidéo MP4", &["mp4", "m4v", "m4a", "mov"], Family::Video)
}

/// Type MIME d'un format reconnu par signature (`None` s'il est inconnu).
pub fn mime_of_signature(signature: &Signature) -> Option<&'static str> {
    Some(match signature.id {
        "png" => "image/png",
        "apng" => "image/apng",
        "jpg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "bmp" => "image/bmp",
        "tiff" => "image/tiff",
        "ico" => "image/x-icon",
        "pdf" => "application/pdf",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        "zip" => "application/zip",
        "gz" => "application/gzip",
        "7z" => "application/x-7z-compressed",
        "rar" => "application/vnd.rar",
        "iso" => "application/x-iso9660-image",
        _ => return None,
    })
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

    // --- fixtures synthétiques : octets réels, pas de dépendance au disque ---

    fn riff_webp(chunk: &[u8; 4], flags: u8) -> Vec<u8> {
        let mut bytes = b"RIFF\0\0\0\0WEBP".to_vec();
        bytes.extend_from_slice(chunk);
        bytes.extend_from_slice(&10u32.to_le_bytes());
        bytes.push(flags);
        bytes.extend_from_slice(&[0; 9]);
        bytes
    }

    #[test]
    fn tells_static_from_animated_webp() {
        let still = identify(&riff_webp(b"VP8X", 0x10));
        assert_eq!(still.id, "webp");
        assert!(!still.animated);
        let lossy = identify(b"RIFF\0\0\0\0WEBPVP8 \x10\0\0\0");
        assert!(!lossy.animated);
        let moving = identify(&riff_webp(b"VP8X", 0x12));
        assert_eq!(moving.id, "webp");
        assert!(moving.animated);
        assert!(extension_matches(&moving, "webp"));
    }

    fn png_with(chunks: &[(&[u8; 4], usize)]) -> Vec<u8> {
        let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        for (kind, length) in chunks {
            bytes.extend_from_slice(&(*length as u32).to_be_bytes());
            bytes.extend_from_slice(*kind);
            bytes.extend(std::iter::repeat_n(0_u8, *length + 4));
        }
        bytes
    }

    #[test]
    fn tells_png_from_apng_by_the_animation_control_chunk() {
        let plain = identify(&png_with(&[(b"IHDR", 13), (b"IDAT", 20), (b"IEND", 0)]));
        assert_eq!(plain.id, "png");
        assert!(!plain.animated);

        // acTL après IDAT n'est pas une animation : la définition l'exige avant.
        let late = identify(&png_with(&[(b"IHDR", 13), (b"IDAT", 20), (b"acTL", 8)]));
        assert_eq!(late.id, "png");

        // Un profil colorimétrique volumineux ne doit pas cacher le bloc acTL.
        let apng = identify(&png_with(&[(b"IHDR", 13), (b"iCCP", 3000), (b"acTL", 8), (b"IDAT", 20)]));
        assert_eq!(apng.id, "apng");
        assert!(apng.animated);
        assert!(extension_matches(&apng, "png"), "un APNG s'appelle souvent .png");
    }

    fn ebml(doc_type: &[u8]) -> Vec<u8> {
        let mut bytes = vec![0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81, 0x01, 0x42, 0xF7, 0x81, 0x01];
        bytes.extend_from_slice(&[0x42, 0x82, 0x80 | doc_type.len() as u8]);
        bytes.extend_from_slice(doc_type);
        bytes
    }

    #[test]
    fn tells_webm_from_matroska() {
        assert_eq!(identify(&ebml(b"webm")).id, "webm");
        assert_eq!(identify(&ebml(b"matroska")).id, "mkv");
        // WebM est un sous-ensemble de Matroska : l'extension .mkv reste cohérente.
        assert!(extension_matches(&identify(&ebml(b"webm")), "mkv"));
    }

    fn ftyp(major: &[u8; 4], compatible: &[&[u8; 4]]) -> Vec<u8> {
        let size = 16 + 4 * compatible.len();
        let mut bytes = (size as u32).to_be_bytes().to_vec();
        bytes.extend_from_slice(b"ftyp");
        bytes.extend_from_slice(major);
        bytes.extend_from_slice(&[0; 4]);
        for brand in compatible {
            bytes.extend_from_slice(*brand);
        }
        bytes.extend_from_slice(&[0; 32]);
        bytes
    }

    #[test]
    fn reads_isobmff_brands_not_extensions() {
        assert_eq!(identify(&ftyp(b"avif", &[b"mif1", b"miaf"])).id, "avif");
        assert_eq!(identify(&ftyp(b"mif1", &[b"avif", b"miaf"])).id, "avif");
        assert!(identify(&ftyp(b"avis", &[b"avif"])).animated);
        assert_eq!(identify(&ftyp(b"heic", &[b"mif1", b"heic"])).id, "heic");
        // Majeure générique, compatible HEVC : c'est un HEIC.
        assert_eq!(identify(&ftyp(b"mif1", &[b"heic"])).id, "heic");
        // Majeure générique seule : un HEIF, que l'on ne prétend pas HEIC.
        assert_eq!(identify(&ftyp(b"mif1", &[b"miaf"])).id, "heif");
        let sequence = identify(&ftyp(b"msf1", &[b"hevc", b"iso8"]));
        assert_eq!(sequence.id, "heic");
        assert!(sequence.animated, "une séquence n'est pas une photo ordinaire");
        assert_eq!(identify(&ftyp(b"isom", &[b"mp42"])).id, "mp4");
        assert_eq!(identify(&ftyp(b"qt  ", &[])).id, "mov");
    }

    #[test]
    fn recognises_an_iso_9660_volume_descriptor() {
        let mut bytes = vec![0_u8; 40_000];
        bytes[32_768] = 1;
        bytes[32_769..32_774].copy_from_slice(b"CD001");
        let iso = identify(&bytes);
        assert_eq!(iso.id, "iso");
        assert_eq!(iso.family, Family::Archive);
        assert_eq!(mime_of_signature(&iso), Some("application/x-iso9660-image"));
        // Sans le descripteur, rien d'ISO — ni avec un en-tête trop court.
        assert_eq!(identify(&[0_u8; 40_000]).id, "inconnu");
        assert_eq!(identify(&bytes[..32_000]).id, "inconnu");
    }

    #[test]
    fn content_wins_over_a_misleading_extension() {
        let apng = identify(&png_with(&[(b"IHDR", 13), (b"acTL", 8), (b"IDAT", 4)]));
        assert!(!extension_matches(&apng, "jpg"));
        let avif = identify(&ftyp(b"avif", &[]));
        assert!(!extension_matches(&avif, "mp4"), "un AVIF renommé .mp4 est démasqué");
        // Sans extension : le contenu suffit, rien à comparer.
        assert_eq!(identify(&ebml(b"webm")).id, "webm");
    }
}
