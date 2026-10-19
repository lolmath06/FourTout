//! Raccourcisseur d'adresses.
//!
//! FourTout n'exploite aucun serveur de redirection : l'adresse est confiée à
//! un **service tiers**, choisi à l'écran, qui la conserve et la sert. Ces
//! services publient une API ouverte, sans compte ni clé, que l'on appelle ici
//! à l'identique de leur documentation :
//!
//! * **is.gd** et **v.gd** (même exploitant, v.gd affiche un aperçu avant la
//!   redirection) — `https://is.gd/apishorteningreference.php` ;
//! * **TinyURL** — point d'accès historique `api-create.php`.
//!
//! Aucun code de suivi n'est ajouté à l'adresse ni à la requête. L'adresse
//! d'origine **quitte l'appareil**, et rien ne l'en empêche ensuite d'être
//! indexée par le service : c'est dit à l'écran, et les adresses qui n'ont de
//! sens que sur le réseau local sont refusées avant tout envoi.

use std::net::IpAddr;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::http::{agent, fetch, parse_url, read_limited, ClientOptions, ErrorKind, InternetError};

const MAX_SOURCE: usize = 2000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Provider {
    IsGd,
    VGd,
    TinyUrl,
}

impl Provider {
    pub fn label(self) -> &'static str {
        match self {
            Provider::IsGd => "is.gd",
            Provider::VGd => "v.gd",
            Provider::TinyUrl => "TinyURL",
        }
    }

    /// Point d'accès de production.
    pub fn endpoint(self) -> &'static str {
        match self {
            Provider::IsGd => "https://is.gd/create.php",
            Provider::VGd => "https://v.gd/create.php",
            Provider::TinyUrl => "https://tinyurl.com/api-create.php",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shortened {
    pub provider: String,
    pub original: String,
    pub short_url: String,
    /// Point d'accès contacté, affiché tel quel.
    pub endpoint: String,
}

/// L'adresse n'a de sens que sur la machine ou le réseau local ?
///
/// L'envoyer à un service public ne la raccourcirait pas utilement et
/// divulguerait un nom de machine interne : on refuse avant d'émettre quoi que
/// ce soit.
pub fn is_private_host(host: &str) -> bool {
    let host = host.trim_matches(['[', ']']).to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") || host.ends_with(".internal")
        || host.ends_with(".lan") || host.ends_with(".home.arpa")
    {
        return true;
    }
    if !host.contains('.') && host.parse::<IpAddr>().is_err() {
        // Un nom sans point (« nas », « routeur ») n'existe pas sur Internet.
        return true;
    }
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => {
            ip.is_private() || ip.is_loopback() || ip.is_link_local() || ip.is_unspecified() || ip.is_broadcast()
                || ip.octets()[0] == 100 && (64..128).contains(&ip.octets()[1])
        }
        Ok(IpAddr::V6(ip)) => {
            ip.is_loopback() || ip.is_unspecified() || (ip.segments()[0] & 0xfe00) == 0xfc00 || (ip.segments()[0] & 0xffc0) == 0xfe80
        }
        Err(_) => false,
    }
}

/// Valide l'adresse à raccourcir.
pub fn validate_source(raw: &str) -> Result<url::Url, InternetError> {
    let url = parse_url(raw)?;
    if raw.trim().len() > MAX_SOURCE {
        return Err(InternetError::new(ErrorKind::InvalidUrl, "Adresse trop longue pour être raccourcie."));
    }
    if is_private_host(url.host_str().unwrap_or("")) {
        return Err(InternetError::new(
            ErrorKind::InvalidUrl,
            "Cette adresse n'est valable que sur votre réseau : elle ne peut pas être raccourcie par un service public.",
        ));
    }
    Ok(url)
}

/// Lit la réponse JSON d'is.gd / v.gd.
fn parse_isgd(body: &[u8], provider: Provider) -> Result<String, InternetError> {
    #[derive(Deserialize)]
    struct Reply {
        shorturl: Option<String>,
        errorcode: Option<i64>,
        errormessage: Option<String>,
    }
    let reply: Reply = serde_json::from_slice(body)
        .map_err(|_| InternetError::new(ErrorKind::Other, format!("Réponse inattendue de {}.", provider.label())))?;
    if let Some(short) = reply.shorturl.filter(|s| !s.is_empty()) {
        return check_short(&short, provider);
    }
    let detail = reply.errormessage.unwrap_or_default();
    let message = match reply.errorcode {
        Some(1) => format!("{} a refusé cette adresse : {detail}", provider.label()),
        Some(2) => format!("{} refuse temporairement les demandes de cette adresse IP : {detail}", provider.label()),
        Some(3) => format!("Limite de {} atteinte : réessayez plus tard. {detail}", provider.label()),
        _ => format!("{} n'a pas pu raccourcir l'adresse : {detail}", provider.label()),
    };
    Err(InternetError::new(ErrorKind::Other, message))
}

/// TinyURL répond en texte brut : l'adresse courte, ou « Error ».
fn parse_tinyurl(body: &[u8]) -> Result<String, InternetError> {
    let text = String::from_utf8_lossy(body).trim().to_string();
    if text.starts_with("http://") || text.starts_with("https://") {
        return check_short(&text, Provider::TinyUrl);
    }
    Err(InternetError::new(ErrorKind::Other, format!("{} n'a pas pu raccourcir l'adresse.", Provider::TinyUrl.label())))
}

/// Une adresse courte rendue par le service doit elle-même être http(s) : on
/// ne présente jamais un schéma exotique comme un lien à copier.
fn check_short(short: &str, provider: Provider) -> Result<String, InternetError> {
    parse_url(short)
        .map(|u| u.to_string())
        .map_err(|_| InternetError::new(ErrorKind::Other, format!("Réponse inattendue de {}.", provider.label())))
}

/// Raccourcit `source` auprès de `provider`.
///
/// `endpoint` permet de viser un faux service local dans les tests ; en
/// production c'est toujours `provider.endpoint()`.
pub fn shorten(
    source: &str,
    provider: Provider,
    endpoint: Option<&str>,
    timeout: Duration,
) -> Result<Shortened, InternetError> {
    let original = validate_source(source)?;
    let endpoint = endpoint.unwrap_or(provider.endpoint());
    let mut request = url::Url::parse(endpoint).map_err(|_| InternetError::new(ErrorKind::InvalidUrl, "Service invalide."))?;
    {
        let mut query = request.query_pairs_mut();
        match provider {
            Provider::IsGd | Provider::VGd => {
                // Pas de statistiques de clic demandées : `logstats` reste à sa valeur par défaut (désactivé).
                query.append_pair("format", "json").append_pair("url", original.as_str());
            }
            Provider::TinyUrl => {
                query.append_pair("url", original.as_str());
            }
        }
    }
    let options = ClientOptions { connect_timeout: timeout, read_timeout: timeout };
    let fetched = fetch(&agent(&options), "GET", &request, &[("Accept", "application/json, text/plain".into())]);
    let body = match fetched {
        Ok(fetched) => read_limited(fetched.response, 16 * 1024)?,
        // is.gd répond parfois en 4xx avec un JSON d'erreur exploitable.
        Err(error) if error.status.is_some() => return Err(error),
        Err(error) => return Err(error),
    };
    let short = match provider {
        Provider::IsGd | Provider::VGd => parse_isgd(&body, provider)?,
        Provider::TinyUrl => parse_tinyurl(&body)?,
    };
    Ok(Shortened {
        provider: provider.label().to_string(),
        original: original.to_string(),
        short_url: short,
        endpoint: endpoint.split('?').next().unwrap_or(endpoint).to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::super::testserver::{Body, Request, Response, TestServer};
    use super::*;

    #[test]
    fn refuses_private_and_malformed_sources_before_sending_anything() {
        for private in [
            "http://localhost:3000/x",
            "http://127.0.0.1/",
            "http://192.168.1.10/admin",
            "http://10.0.0.5/",
            "http://172.16.0.1/",
            "http://169.254.1.1/",
            "http://[::1]/",
            "http://nas/partage",
            "http://imprimante.local/",
            "http://serveur.internal/",
            "http://100.64.1.1/",
        ] {
            let error = validate_source(private).unwrap_err();
            assert_eq!(error.kind, ErrorKind::InvalidUrl, "{private}");
            assert!(error.message.contains("réseau"), "{private}");
        }
        for malformed in ["", "pas une url", "ftp://exemple.org/", "javascript:alert(1)"] {
            assert!(validate_source(malformed).is_err(), "{malformed}");
        }
        assert!(validate_source("https://exemple.org/page?x=1#y").is_ok());
        assert!(validate_source("http://93.184.216.34/").is_ok());
        assert!(validate_source(&format!("https://exemple.org/{}", "a".repeat(2100))).is_err());
    }

    #[test]
    fn parses_isgd_answers_and_errors() {
        assert_eq!(parse_isgd(br#"{"shorturl":"https://is.gd/abc123"}"#, Provider::IsGd).unwrap(), "https://is.gd/abc123");
        let refused = parse_isgd(br#"{"errorcode":1,"errormessage":"Please enter a valid URL to shorten"}"#, Provider::IsGd)
            .unwrap_err();
        assert!(refused.message.contains("is.gd") && refused.message.contains("valid URL"), "{refused}");
        assert!(parse_isgd(br#"{"errorcode":3,"errormessage":"Rate limit"}"#, Provider::VGd).unwrap_err().message.contains("Limite"));
        assert!(parse_isgd(b"<html>oops</html>", Provider::IsGd).is_err());
        // Un « lien court » qui n'est pas http(s) n'est jamais présenté.
        assert!(parse_isgd(br#"{"shorturl":"javascript:alert(1)"}"#, Provider::IsGd).is_err());
        assert!(parse_isgd(br#"{}"#, Provider::IsGd).is_err());
    }

    #[test]
    fn parses_tinyurl_plain_text() {
        assert_eq!(parse_tinyurl(b"https://tinyurl.com/y1abcd\n").unwrap(), "https://tinyurl.com/y1abcd");
        assert!(parse_tinyurl(b"Error").is_err());
        assert!(parse_tinyurl(b"").is_err());
        assert!(parse_tinyurl(b"ftp://tinyurl.com/x").is_err());
    }

    #[test]
    fn talks_to_the_provider_with_the_documented_request() {
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let log = seen.clone();
        let server = TestServer::start(move |request: &Request| {
            log.lock().unwrap().push(request.path.clone());
            Response::ok(br#"{"shorturl":"https://is.gd/xyz"}"#.to_vec())
        });
        let endpoint = server.url("/create.php");
        let result = shorten("https://exemple.org/a b?x=1&y=2", Provider::IsGd, Some(&endpoint), Duration::from_secs(3));
        // L'espace rend l'adresse invalide : rien n'est envoyé.
        assert!(result.is_err());
        assert!(seen.lock().unwrap().is_empty());

        let result = shorten("https://exemple.org/a?x=1&y=2", Provider::IsGd, Some(&endpoint), Duration::from_secs(3)).unwrap();
        assert_eq!(result.short_url, "https://is.gd/xyz");
        assert_eq!(result.provider, "is.gd");
        assert_eq!(result.original, "https://exemple.org/a?x=1&y=2");
        let path = seen.lock().unwrap()[0].clone();
        assert!(path.starts_with("/create.php?format=json&url="), "{path}");
        assert!(path.contains("https%3A%2F%2Fexemple.org%2Fa%3Fx%3D1%26y%3D2"), "l'adresse est encodée : {path}");
        assert!(!path.contains("logstats"), "aucun suivi demandé");
    }

    #[test]
    fn a_provider_that_times_out_or_fails_gives_a_structured_error() {
        let slow = TestServer::start(|_| Response { status: 200, headers: vec![], body: Body::Hang });
        let error = shorten("https://exemple.org/", Provider::TinyUrl, Some(&slow.url("/api-create.php")), Duration::from_millis(300))
            .unwrap_err();
        assert_eq!(error.kind, ErrorKind::Timeout);

        let failing = TestServer::start(|_| Response::status(503));
        let error = shorten("https://exemple.org/", Provider::IsGd, Some(&failing.url("/create.php")), Duration::from_secs(2))
            .unwrap_err();
        assert_eq!((error.kind, error.status), (ErrorKind::Status, Some(503)));

        let broken = TestServer::start(|_| Response::ok(b"n'importe quoi".to_vec()));
        assert!(shorten("https://exemple.org/", Provider::IsGd, Some(&broken.url("/c")), Duration::from_secs(2)).is_err());
    }

    #[test]
    fn production_endpoints_are_the_documented_ones() {
        assert_eq!(Provider::IsGd.endpoint(), "https://is.gd/create.php");
        assert_eq!(Provider::VGd.endpoint(), "https://v.gd/create.php");
        assert_eq!(Provider::TinyUrl.endpoint(), "https://tinyurl.com/api-create.php");
        assert!(Provider::IsGd.endpoint().starts_with("https://"));
    }
}
