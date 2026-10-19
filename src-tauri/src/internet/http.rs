//! Primitives HTTP communes aux outils Internet.
//!
//! Volontairement petit : validation d'adresse, requêtes avec redirections
//! suivies **à la main** (chaque saut est revalidé), erreurs structurées, et
//! dérivation d'un nom de fichier sûr. Rien ici ne sait ce qu'on télécharge.

use std::io::Read;
use std::time::Duration;

use serde::Serialize;
use url::Url;

/// Nombre maximal de redirections suivies.
pub const MAX_REDIRECTS: usize = 10;
/// Longueur maximale d'une adresse acceptée.
const MAX_URL: usize = 8192;

/// `FourTout/<version>` : s'annonce honnêtement, sans se faire passer pour un
/// navigateur.
pub fn user_agent() -> String {
    format!("FourTout/{}", env!("CARGO_PKG_VERSION"))
}

/* -------------------------------------------------------------- erreurs */

/// Catégorie d'une erreur, lisible par l'interface sans analyser un texte.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorKind {
    InvalidUrl,
    UnsupportedScheme,
    Dns,
    Timeout,
    Refused,
    Tls,
    Status,
    Redirect,
    RangeMismatch,
    Destination,
    Write,
    Incomplete,
    Checksum,
    Cancelled,
    /// L'adresse n'est pas prise en charge par le service (site, liste de lecture…).
    Unsupported,
    /// Le contenu n'existe plus, est privé, ou limité géographiquement.
    Unavailable,
    /// Le contenu exige un compte : FourTout n'en gère pas.
    LoginRequired,
    /// Le contenu est protégé par un DRM : FourTout ne le contourne pas.
    Drm,
    /// Un composant à installer à la demande est absent (yt-dlp).
    ToolMissing,
    /// FFmpeg est absent ou ne sait pas produire ce format.
    FfmpegMissing,
    Other,
}

/// Erreur structurée : un genre stable, un message affichable (en français,
/// traduit à l'affichage comme les autres messages natifs), un code HTTP
/// éventuel.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InternetError {
    pub kind: ErrorKind,
    pub message: String,
    pub status: Option<u16>,
}

impl InternetError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into(), status: None }
    }

    pub fn cancelled() -> Self {
        Self::new(ErrorKind::Cancelled, crate::files::CANCELLED)
    }

    pub fn is_cancelled(&self) -> bool {
        self.kind == ErrorKind::Cancelled
    }

    pub fn status(code: u16) -> Self {
        let message = match code {
            401 | 403 => format!("Accès refusé par le serveur (HTTP {code})."),
            404 | 410 => format!("Fichier introuvable sur le serveur (HTTP {code})."),
            429 => format!("Trop de requêtes : le serveur demande de patienter (HTTP {code})."),
            500..=599 => format!("Erreur du serveur (HTTP {code})."),
            _ => format!("Le serveur a répondu par une erreur (HTTP {code})."),
        };
        Self { kind: ErrorKind::Status, message, status: Some(code) }
    }
}

impl std::fmt::Display for InternetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl From<InternetError> for String {
    fn from(error: InternetError) -> String {
        error.message
    }
}

/// Convertit une erreur de transport en erreur structurée.
pub fn from_ureq(error: ureq::Error, host: &str) -> InternetError {
    match error {
        ureq::Error::Status(code, _) => InternetError::status(code),
        ureq::Error::Transport(transport) => {
            // Le genre d'E/S sous-jacent vaut mieux que le texte de l'erreur,
            // qui varie d'une plateforme à l'autre.
            let mut io_kind = None;
            let mut source: Option<&(dyn std::error::Error + 'static)> = std::error::Error::source(&transport);
            while let Some(inner) = source {
                if let Some(io) = inner.downcast_ref::<std::io::Error>() {
                    io_kind = Some(io.kind());
                    break;
                }
                source = inner.source();
            }
            let text = transport.to_string().to_lowercase();
            match transport.kind() {
                ureq::ErrorKind::Dns => {
                    InternetError::new(ErrorKind::Dns, format!("Serveur introuvable : « {host} » ne répond à aucun nom connu."))
                }
                ureq::ErrorKind::InvalidUrl | ureq::ErrorKind::UnknownScheme => {
                    InternetError::new(ErrorKind::InvalidUrl, "Adresse invalide.")
                }
                ureq::ErrorKind::TooManyRedirects => {
                    InternetError::new(ErrorKind::Redirect, "Trop de redirections : l'adresse boucle probablement.")
                }
                _ if io_kind == Some(std::io::ErrorKind::ConnectionRefused) => {
                    InternetError::new(ErrorKind::Refused, format!("Connexion refusée par « {host} »."))
                }
                _ if matches!(io_kind, Some(std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock))
                    || text.contains("timed out") =>
                {
                    InternetError::new(ErrorKind::Timeout, "Délai dépassé : le serveur ne répond pas.")
                }
                _ if text.contains("tls") || text.contains("certificate") || text.contains("handshake") => {
                    InternetError::new(
                        ErrorKind::Tls,
                        format!("Connexion sécurisée impossible avec « {host} » (certificat ou chiffrement)."),
                    )
                }
                _ => InternetError::new(ErrorKind::Other, format!("Connexion impossible à « {host} » : {transport}")),
            }
        }
    }
}

/* ------------------------------------------------------------- adresses */

/// Valide une adresse saisie : `http` et `https` seulement, un hôte, pas
/// d'identifiants incrustés.
pub fn parse_url(raw: &str) -> Result<Url, InternetError> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err(InternetError::new(ErrorKind::InvalidUrl, "Saisissez une adresse."));
    }
    if raw.len() > MAX_URL {
        return Err(InternetError::new(ErrorKind::InvalidUrl, "Adresse trop longue."));
    }
    if raw.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(InternetError::new(ErrorKind::InvalidUrl, "L'adresse contient des espaces ou des caractères de contrôle."));
    }
    let url = Url::parse(raw)
        .map_err(|_| InternetError::new(ErrorKind::InvalidUrl, "Adresse invalide : elle doit ressembler à https://exemple.org/fichier."))?;
    check_scheme(&url)?;
    if url.host_str().is_none_or(str::is_empty) {
        return Err(InternetError::new(ErrorKind::InvalidUrl, "Adresse invalide : aucun nom de serveur."));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(InternetError::new(
            ErrorKind::InvalidUrl,
            "Les identifiants incrustés dans l'adresse ne sont pas pris en charge.",
        ));
    }
    Ok(url)
}

fn check_scheme(url: &Url) -> Result<(), InternetError> {
    match url.scheme() {
        "http" | "https" => Ok(()),
        other => Err(InternetError::new(
            ErrorKind::UnsupportedScheme,
            format!("Protocole non pris en charge : « {other} » (seuls http et https le sont)."),
        )),
    }
}

/* ---------------------------------------------------------------- client */

#[derive(Debug, Clone)]
pub struct ClientOptions {
    pub connect_timeout: Duration,
    pub read_timeout: Duration,
}

impl Default for ClientOptions {
    fn default() -> Self {
        Self { connect_timeout: Duration::from_secs(15), read_timeout: Duration::from_secs(30) }
    }
}

pub fn agent(options: &ClientOptions) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .redirects(0)
        .timeout_connect(options.connect_timeout)
        .timeout_read(options.read_timeout)
        .timeout_write(options.read_timeout)
        .user_agent(&user_agent())
        .build()
}

/// Réponse finale, après redirections.
pub struct Fetched {
    pub response: ureq::Response,
    pub final_url: Url,
    pub redirects: usize,
}

/// Envoie une requête et suit les redirections en revalidant chaque saut.
///
/// Un saut de HTTPS vers HTTP est refusé : une redirection ne doit jamais
/// dégrader silencieusement la protection de la connexion.
pub fn fetch(
    agent: &ureq::Agent,
    method: &str,
    start: &Url,
    headers: &[(&str, String)],
) -> Result<Fetched, InternetError> {
    let mut url = start.clone();
    for hop in 0..=MAX_REDIRECTS {
        let host = url.host_str().unwrap_or("").to_string();
        let mut request = agent.request(method, url.as_str()).set("Accept-Encoding", "identity");
        for (name, value) in headers {
            request = request.set(name, value);
        }
        let response = match request.call() {
            Ok(response) => response,
            Err(ureq::Error::Status(code, response)) if code == 416 => {
                // Plage non satisfaisable : ce n'est pas une faute du serveur,
                // l'appelant sait quoi en faire.
                return Ok(Fetched { response, final_url: url, redirects: hop });
            }
            Err(error) => return Err(from_ureq(error, &host)),
        };
        if matches!(response.status(), 301 | 302 | 303 | 307 | 308) {
            let location = response
                .header("Location")
                .ok_or_else(|| InternetError::new(ErrorKind::Redirect, "Redirection sans destination."))?;
            let next = url
                .join(location)
                .map_err(|_| InternetError::new(ErrorKind::Redirect, "Redirection vers une adresse invalide."))?;
            check_scheme(&next).map_err(|e| InternetError::new(ErrorKind::Redirect, e.message))?;
            if url.scheme() == "https" && next.scheme() == "http" {
                return Err(InternetError::new(
                    ErrorKind::Redirect,
                    "Redirection de HTTPS vers HTTP refusée : la connexion ne serait plus protégée.",
                ));
            }
            url = next;
            continue;
        }
        return Ok(Fetched { response, final_url: url, redirects: hop });
    }
    Err(InternetError::new(ErrorKind::Redirect, "Trop de redirections : l'adresse boucle probablement."))
}

/// Lit au plus `limit` octets d'une réponse (corps de petites réponses JSON).
pub fn read_limited(response: ureq::Response, limit: u64) -> Result<Vec<u8>, InternetError> {
    let mut body = Vec::new();
    response
        .into_reader()
        .take(limit + 1)
        .read_to_end(&mut body)
        .map_err(|e| InternetError::new(ErrorKind::Other, format!("Lecture de la réponse impossible : {e}")))?;
    if body.len() as u64 > limit {
        return Err(InternetError::new(ErrorKind::Other, "Réponse démesurée ignorée."));
    }
    Ok(body)
}

/* ------------------------------------------------------- noms de fichier */

const RESERVED_WINDOWS: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1",
    "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Rend un nom de fichier **inoffensif** : sans séparateur, sans caractère
/// réservé sous Windows, sans nom de périphérique, sans point en tête, borné.
/// Ce qui n'est pas récupérable devient `fallback`.
pub fn sanitize_filename(raw: &str, fallback: &str) -> String {
    // Seule la dernière composante compte, quel que soit le séparateur envoyé.
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_control() || "<>:\"|?*".contains(c) { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').trim_end_matches(['.', ' ']).to_string();
    if cleaned.is_empty() {
        return fallback.to_string();
    }

    // Les noms de périphériques de Windows restent dangereux avec une extension.
    let stem = cleaned.split('.').next().unwrap_or("").to_ascii_uppercase();
    let cleaned = if RESERVED_WINDOWS.contains(&stem.as_str()) { format!("_{cleaned}") } else { cleaned };

    // 180 octets au plus, en gardant l'extension et sans couper un caractère.
    if cleaned.len() <= 180 {
        return cleaned;
    }
    let (stem, extension) = match cleaned.rfind('.') {
        Some(dot) if cleaned.len() - dot <= 12 => (&cleaned[..dot], &cleaned[dot..]),
        _ => (cleaned.as_str(), ""),
    };
    let mut end = 180 - extension.len();
    while !stem.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{extension}", &stem[..end])
}

fn percent_decode(text: &str) -> Vec<u8> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let high = (bytes[i + 1] as char).to_digit(16);
            let low = (bytes[i + 2] as char).to_digit(16);
            if let (Some(high), Some(low)) = (high, low) {
                out.push((high * 16 + low) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    out
}

/// Nom proposé par l'en-tête `Content-Disposition`, quand il est exploitable.
///
/// `filename*=UTF-8''…` (RFC 6266 / 5987) prime sur `filename="…"`. Un en-tête
/// mal formé n'est jamais une erreur : il est simplement ignoré.
pub fn content_disposition_filename(header: &str) -> Option<String> {
    let mut plain: Option<String> = None;
    let mut extended: Option<String> = None;

    for part in split_parameters(header).into_iter().skip(1) {
        let Some((name, value)) = part.split_once('=') else { continue };
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim();
        match name.as_str() {
            "filename*" => {
                // charset'langue'valeur-encodée
                let mut pieces = value.splitn(3, '\'');
                let charset = pieces.next()?.to_ascii_lowercase();
                let _language = pieces.next();
                let encoded = pieces.next()?;
                let decoded = percent_decode(encoded);
                extended = match charset.as_str() {
                    "utf-8" => String::from_utf8(decoded).ok(),
                    "iso-8859-1" => Some(decoded.iter().map(|&b| b as char).collect()),
                    _ => None,
                };
            }
            "filename" => {
                plain = Some(unquote(value));
            }
            _ => {}
        }
    }
    extended.or(plain).filter(|name| !name.trim().is_empty())
}

/// Sépare les paramètres d'un en-tête sur `;`, sans couper une chaîne entre guillemets.
fn split_parameters(header: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut quoted = false;
    let mut escaped = false;
    for (index, c) in header.char_indices() {
        match c {
            _ if escaped => escaped = false,
            '\\' if quoted => escaped = true,
            '"' => quoted = !quoted,
            ';' if !quoted => {
                parts.push(&header[start..index]);
                start = index + 1;
            }
            _ => {}
        }
    }
    parts.push(&header[start..]);
    parts
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    let Some(inner) = value.strip_prefix('"') else { return value.to_string() };
    let mut out = String::new();
    let mut escaped = false;
    for c in inner.chars() {
        if escaped {
            out.push(c);
            escaped = false;
        } else if c == '\\' {
            escaped = true;
        } else if c == '"' {
            break;
        } else {
            out.push(c);
        }
    }
    out
}

/// Extension usuelle pour un type MIME courant (dernier recours de nommage).
pub fn extension_for_mime(mime: &str) -> Option<&'static str> {
    Some(match mime.split(';').next()?.trim().to_ascii_lowercase().as_str() {
        "application/pdf" => "pdf",
        "application/zip" => "zip",
        "application/gzip" => "gz",
        "application/json" => "json",
        "application/x-iso9660-image" => "iso",
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/avif" => "avif",
        "image/svg+xml" => "svg",
        "audio/mpeg" => "mp3",
        "audio/ogg" => "ogg",
        "audio/wav" | "audio/x-wav" => "wav",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "text/plain" => "txt",
        "text/html" => "html",
        "text/csv" => "csv",
        _ => return None,
    })
}

/// Nom de fichier proposé : `Content-Disposition`, puis chemin de l'adresse,
/// puis `download`. Toujours passé par `sanitize_filename`.
pub fn derive_filename(content_disposition: Option<&str>, url: &Url, mime: Option<&str>) -> String {
    if let Some(name) = content_disposition.and_then(content_disposition_filename) {
        let name = sanitize_filename(&name, "");
        if !name.is_empty() {
            return name;
        }
    }
    if let Some(segment) = url.path_segments().and_then(|mut s| s.next_back()) {
        let decoded = String::from_utf8_lossy(&percent_decode(segment)).to_string();
        let name = sanitize_filename(&decoded, "");
        if !name.is_empty() {
            return name;
        }
    }
    match mime.and_then(extension_for_mime) {
        Some(extension) => format!("download.{extension}"),
        None => "download".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_http_and_https() {
        assert!(parse_url("https://exemple.org/a.zip").is_ok());
        assert!(parse_url("  http://exemple.org  ").is_ok());
        for (bad, kind) in [
            ("", ErrorKind::InvalidUrl),
            ("pas une adresse", ErrorKind::InvalidUrl),
            ("exemple.org/a.zip", ErrorKind::InvalidUrl),
            ("ftp://exemple.org/a", ErrorKind::UnsupportedScheme),
            ("file:///etc/passwd", ErrorKind::UnsupportedScheme),
            ("javascript:alert(1)", ErrorKind::UnsupportedScheme),
            ("data:text/plain,hello", ErrorKind::UnsupportedScheme),
            ("https://", ErrorKind::InvalidUrl),
            ("https://user:secret@exemple.org/", ErrorKind::InvalidUrl),
            ("https://exemple.org/a b", ErrorKind::InvalidUrl),
            ("https://exemple.org/\u{0}", ErrorKind::InvalidUrl),
        ] {
            let error = parse_url(bad).unwrap_err();
            assert_eq!(error.kind, kind, "{bad:?} → {error}");
        }
        assert_eq!(parse_url(&format!("https://exemple.org/{}", "a".repeat(9000))).unwrap_err().kind, ErrorKind::InvalidUrl);
    }

    #[test]
    fn sanitizes_hostile_filenames() {
        assert_eq!(sanitize_filename("../../etc/passwd", "x"), "passwd");
        assert_eq!(sanitize_filename("..\\..\\windows\\system32\\evil.dll", "x"), "evil.dll");
        assert_eq!(sanitize_filename("a:b*c?.txt", "x"), "a_b_c_.txt");
        assert_eq!(sanitize_filename("..", "repli"), "repli");
        assert_eq!(sanitize_filename("", "repli"), "repli");
        assert_eq!(sanitize_filename("   ", "repli"), "repli");
        assert_eq!(sanitize_filename(".bashrc", "x"), "bashrc");
        assert_eq!(sanitize_filename("fichier.txt. .", "x"), "fichier.txt");
        assert_eq!(sanitize_filename("CON", "x"), "_CON");
        assert_eq!(sanitize_filename("nul.txt", "x"), "_nul.txt");
        assert_eq!(sanitize_filename("com1.log", "x"), "_com1.log");
        assert_eq!(sanitize_filename("tab\tet\nretour.txt", "x"), "tab_et_retour.txt");
        assert_eq!(sanitize_filename("café — été.pdf", "x"), "café — été.pdf");
        let long = sanitize_filename(&format!("{}.tar.gz", "é".repeat(200)), "x");
        assert!(long.len() <= 180 && long.ends_with(".gz"), "{}", long.len());
    }

    #[test]
    fn reads_content_disposition_in_all_its_forms() {
        let cases = [
            (r#"attachment; filename="rapport.pdf""#, Some("rapport.pdf")),
            ("attachment; filename=rapport.pdf", Some("rapport.pdf")),
            ("attachment; filename=\"a;b.txt\"", Some("a;b.txt")),
            (r#"attachment; filename="a\"b.txt""#, Some("a\"b.txt")),
            ("attachment; filename*=UTF-8''caf%C3%A9%20%C3%A9t%C3%A9.txt", Some("café été.txt")),
            // Le paramètre étendu prime, quel que soit l'ordre.
            ("attachment; filename*=UTF-8''vrai.txt; filename=\"repli.txt\"", Some("vrai.txt")),
            ("attachment; filename=\"repli.txt\"; filename*=UTF-8''vrai.txt", Some("vrai.txt")),
            ("attachment; filename*=iso-8859-1''caf%E9.txt", Some("café.txt")),
            ("inline", None),
            ("attachment; filename=", None),
            ("attachment; filename=\"\"", None),
            // Mal formés : ignorés sans paniquer.
            ("attachment; filename*=UTF-8''%ff%fe.txt", None),
            ("attachment; filename*=bizarre", None),
            (";;;=;=", None),
        ];
        for (header, expected) in cases {
            assert_eq!(content_disposition_filename(header).as_deref(), expected, "{header}");
        }
    }

    #[test]
    fn derives_a_safe_name_in_priority_order() {
        let url = |s: &str| Url::parse(s).unwrap();
        // 1. Content-Disposition, même hostile.
        assert_eq!(
            derive_filename(Some("attachment; filename=\"../../evil.sh\""), &url("https://x.org/a/b.zip"), None),
            "evil.sh"
        );
        // 2. Chemin de l'adresse, décodé, sans la requête.
        assert_eq!(derive_filename(None, &url("https://x.org/dl/mon%20fichier.zip?token=1#top"), None), "mon fichier.zip");
        // 3. Repli, avec l'extension du type MIME quand on la connaît.
        assert_eq!(derive_filename(None, &url("https://x.org/"), Some("application/pdf; charset=binary")), "download.pdf");
        assert_eq!(derive_filename(None, &url("https://x.org/"), None), "download");
        assert_eq!(derive_filename(Some("attachment"), &url("https://x.org/%2e%2e"), None), "download");
    }

    #[test]
    fn status_errors_carry_the_code() {
        let error = InternetError::status(404);
        assert_eq!(error.kind, ErrorKind::Status);
        assert_eq!(error.status, Some(404));
        assert!(error.message.contains("404"));
        assert!(InternetError::status(503).message.contains("serveur"));
    }
}
