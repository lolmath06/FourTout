//! Téléchargeur HTTP/HTTPS : inspection préalable, reprise, finalisation.
//!
//! Règles de sécurité des données :
//!
//! * l'octet n'est écrit que dans un fichier **partiel** voisin de la
//!   destination ; le nom définitif n'apparaît qu'une fois le contenu complet,
//!   vérifié, et jamais par écrasement silencieux ;
//! * une reprise n'a lieu que si le serveur a donné un validateur (`ETag` ou
//!   `Last-Modified`) et le confirme par `If-Range` : on ne recolle jamais deux
//!   versions différentes d'une même ressource ;
//! * un serveur qui ignore `Range` n'est pas une erreur : on repart de zéro.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

use super::http::{
    self, agent, derive_filename, fetch, ClientOptions, ErrorKind, Fetched, InternetError,
};
use crate::files::Reporter;

const CHUNK: usize = 64 * 1024;
/// Intervalle minimal entre deux événements de progression.
const PROGRESS_EVERY: Duration = Duration::from_millis(120);

/* ----------------------------------------------------------- inspection */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    pub requested_url: String,
    pub final_url: String,
    pub redirects: usize,
    pub status: u16,
    pub mime: Option<String>,
    /// Taille connue, en octets.
    pub size: Option<u64>,
    /// Nom proposé (déjà assaini).
    pub filename: String,
    /// Le serveur annonce la reprise par plages.
    pub accepts_ranges: bool,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

fn header(response: &ureq::Response, name: &str) -> Option<String> {
    response.header(name).map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn total_from_content_range(value: &str) -> Option<u64> {
    value.rsplit('/').next()?.trim().parse().ok()
}

/// Interroge la ressource sans la télécharger : `HEAD`, puis, si le serveur
/// refuse, un `GET` limité au premier octet.
pub fn probe(raw_url: &str, options: &ClientOptions) -> Result<Probe, InternetError> {
    let url = http::parse_url(raw_url)?;
    let agent = agent(options);

    let head = fetch(&agent, "HEAD", &url, &[]);
    let (fetched, ranged) = match head {
        Ok(fetched) if fetched.response.status() < 400 => (fetched, false),
        _ => {
            let fetched = fetch(&agent, "GET", &url, &[("Range", "bytes=0-0".into())])?;
            (fetched, true)
        }
    };
    describe(raw_url, fetched, ranged)
}

fn describe(requested: &str, fetched: Fetched, ranged: bool) -> Result<Probe, InternetError> {
    let Fetched { response, final_url, redirects } = fetched;
    let status = response.status();
    if status >= 400 && status != 416 {
        return Err(InternetError::status(status));
    }
    let mime = header(&response, "Content-Type").map(|v| v.split(';').next().unwrap_or("").trim().to_lowercase());
    let content_length = header(&response, "Content-Length").and_then(|v| v.parse::<u64>().ok());
    let content_range = header(&response, "Content-Range");

    let (size, accepts_ranges) = if ranged {
        match status {
            206 => (content_range.as_deref().and_then(total_from_content_range), true),
            // 416 : plage vide ⇒ ressource vide, mais le serveur comprend `Range`.
            416 => (content_range.as_deref().and_then(total_from_content_range), true),
            _ => (content_length, false),
        }
    } else {
        let accepts = header(&response, "Accept-Ranges").is_some_and(|v| v.eq_ignore_ascii_case("bytes"));
        (content_length, accepts)
    };

    let filename = derive_filename(header(&response, "Content-Disposition").as_deref(), &final_url, mime.as_deref());
    Ok(Probe {
        requested_url: requested.trim().to_string(),
        final_url: final_url.to_string(),
        redirects,
        status,
        mime,
        size,
        filename,
        accepts_ranges,
        etag: header(&response, "ETag"),
        last_modified: header(&response, "Last-Modified"),
    })
}

/* ------------------------------------------------------- téléchargement */

#[derive(Debug, Clone)]
pub struct DownloadParams {
    pub url: String,
    pub destination: PathBuf,
    pub overwrite: bool,
    /// Reprendre un téléchargement interrompu s'il est reprenable.
    pub resume: bool,
    /// Empreinte SHA-256 attendue (hexadécimal), vérifiée avant finalisation.
    pub expected_sha256: Option<String>,
    pub options: ClientOptions,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSummary {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
    /// Octets déjà présents quand la reprise a commencé (0 sinon).
    pub resumed_from: u64,
    pub final_url: String,
    pub mime: Option<String>,
    pub elapsed_ms: u64,
    /// Débit moyen de cette session, octets par seconde.
    pub bytes_per_second: u64,
    /// Le serveur a ignoré la demande de reprise : le fichier a été repris à zéro.
    pub restarted: bool,
}

/// État conservé à côté du fichier partiel pour autoriser une reprise sûre.
#[derive(Debug, Serialize, Deserialize)]
struct PartialMeta {
    url: String,
    final_url: String,
    validator: String,
    total: Option<u64>,
}

fn partial_paths(destination: &Path) -> (PathBuf, PathBuf) {
    let name = destination.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    let with = |suffix: &str| {
        let mut file = name.clone();
        file.push(suffix);
        destination.with_file_name(file)
    };
    (with(".fourtout-part"), with(".fourtout-meta"))
}

fn validator_of(response: &ureq::Response) -> Option<String> {
    // Un ETag faible (`W/…`) ne garantit pas l'identité octet pour octet.
    header(response, "ETag")
        .filter(|etag| !etag.starts_with("W/"))
        .or_else(|| header(response, "Last-Modified"))
}

fn sha256_of_file(path: &Path, reporter: &Reporter) -> Result<Sha256, InternetError> {
    let mut hasher = Sha256::new();
    let mut file = File::open(path).map_err(|e| write_error(&e))?;
    let mut buffer = vec![0_u8; CHUNK];
    loop {
        reporter.check().map_err(|_| InternetError::cancelled())?;
        let read = file.read(&mut buffer).map_err(|e| write_error(&e))?;
        if read == 0 {
            return Ok(hasher);
        }
        hasher.update(&buffer[..read]);
    }
}

fn write_error(error: &std::io::Error) -> InternetError {
    InternetError::new(ErrorKind::Write, format!("Écriture impossible (disque plein ?) : {error}"))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Télécharge vers `params.destination`.
pub fn download(params: &DownloadParams, reporter: &Reporter) -> Result<DownloadSummary, InternetError> {
    let url = http::parse_url(&params.url)?;
    let destination = &params.destination;

    let parent = destination.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err(InternetError::new(ErrorKind::Destination, format!("Dossier de destination introuvable : {}", parent.display())));
    }
    if destination.is_dir() {
        return Err(InternetError::new(ErrorKind::Destination, "La destination est un dossier, pas un fichier."));
    }
    if destination.exists() && !params.overwrite {
        return Err(InternetError::new(ErrorKind::Destination, format!("« {} » existe déjà.", destination.display())));
    }

    let (part, meta_path) = partial_paths(destination);
    if !params.resume {
        let _ = fs::remove_file(&part);
        let _ = fs::remove_file(&meta_path);
    }

    let started = Instant::now();
    let mut attempt = download_once(params, &url, &part, &meta_path, params.resume, reporter);
    // Un contenu qui ne se recolle pas (plage incohérente) se refait une fois
    // depuis zéro : c'est la réponse sûre, pas une erreur à montrer.
    if matches!(&attempt, Err(e) if e.kind == ErrorKind::RangeMismatch) {
        let _ = fs::remove_file(&part);
        let _ = fs::remove_file(&meta_path);
        attempt = download_once(params, &url, &part, &meta_path, false, reporter).map(|mut s| {
            s.restarted = true;
            s
        });
    }

    let mut summary = match attempt {
        Ok(summary) => summary,
        Err(error) => {
            // Un partiel n'est conservé que s'il peut servir : reprenable, et
            // l'arrêt n'est pas dû à une corruption.
            let keep = matches!(error.kind, ErrorKind::Cancelled | ErrorKind::Timeout | ErrorKind::Incomplete)
                && meta_path.exists();
            if !keep {
                let _ = fs::remove_file(&part);
                let _ = fs::remove_file(&meta_path);
            }
            return Err(error);
        }
    };

    // Finalisation : à ce stade seulement le fichier prend son nom définitif.
    if let Some(expected) = &params.expected_sha256 {
        if !expected.trim().eq_ignore_ascii_case(&summary.sha256) {
            let _ = fs::remove_file(&part);
            let _ = fs::remove_file(&meta_path);
            return Err(InternetError::new(
                ErrorKind::Checksum,
                "L'empreinte SHA-256 du fichier ne correspond pas à celle attendue : le fichier a été supprimé.",
            ));
        }
    }
    if destination.exists() {
        fs::remove_file(destination)
            .map_err(|e| InternetError::new(ErrorKind::Destination, format!("Remplacement impossible : {e}")))?;
    }
    fs::rename(&part, destination)
        .map_err(|e| InternetError::new(ErrorKind::Destination, format!("Finalisation impossible : {e}")))?;
    let _ = fs::remove_file(&meta_path);

    let elapsed = started.elapsed();
    summary.path = destination.to_string_lossy().to_string();
    summary.elapsed_ms = elapsed.as_millis() as u64;
    let fetched = summary.bytes.saturating_sub(summary.resumed_from);
    summary.bytes_per_second = (fetched as f64 / elapsed.as_secs_f64().max(0.001)) as u64;
    Ok(summary)
}

fn download_once(
    params: &DownloadParams,
    url: &Url,
    part: &Path,
    meta_path: &Path,
    allow_resume: bool,
    reporter: &Reporter,
) -> Result<DownloadSummary, InternetError> {
    reporter.check().map_err(|_| InternetError::cancelled())?;
    let agent = agent(&params.options);

    // --- reprise possible ? -------------------------------------------------
    let mut offset = 0_u64;
    let mut headers: Vec<(&str, String)> = Vec::new();
    let mut known_validator: Option<String> = None;
    if allow_resume {
        let saved: Option<PartialMeta> =
            fs::read(meta_path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok());
        let length = fs::metadata(part).map(|m| m.len()).unwrap_or(0);
        if let Some(saved) = saved.filter(|m| m.url == url.as_str() && length > 0) {
            if saved.total.is_none_or(|total| length <= total) {
                offset = length;
                headers.push(("Range", format!("bytes={offset}-")));
                headers.push(("If-Range", saved.validator.clone()));
                known_validator = Some(saved.validator);
            }
        }
    }

    let fetched = fetch(&agent, "GET", url, &headers)?;
    let status = fetched.response.status();

    // 416 : on demandait au-delà de la fin. Si le fichier partiel a déjà
    // exactement la taille de la ressource, il est complet.
    if status == 416 {
        let total = header(&fetched.response, "Content-Range").and_then(|v| total_from_content_range(&v));
        if total == Some(offset) && offset > 0 {
            let hasher = sha256_of_file(part, reporter)?;
            return Ok(summary_of(&fetched, offset, offset, hex(&hasher.finalize())));
        }
        return Err(InternetError::new(ErrorKind::RangeMismatch, "Plage refusée par le serveur."));
    }
    if status >= 400 {
        return Err(InternetError::status(status));
    }

    // --- que répond le serveur à la demande de plage ? ---------------------
    let content_range = header(&fetched.response, "Content-Range");
    let content_length = header(&fetched.response, "Content-Length").and_then(|v| v.parse::<u64>().ok());
    let resuming = offset > 0 && status == 206;
    if resuming {
        let start = content_range
            .as_deref()
            .and_then(|v| v.strip_prefix("bytes "))
            .and_then(|v| v.split('-').next())
            .and_then(|v| v.trim().parse::<u64>().ok());
        if start != Some(offset) {
            return Err(InternetError::new(ErrorKind::RangeMismatch, "Le serveur a repris à un autre endroit que prévu."));
        }
    }
    // Reprise demandée mais réponse complète : la plage a été ignorée (ou le
    // contenu a changé). On repart de zéro, c'est toujours correct.
    let restarted_here = offset > 0 && !resuming;
    if restarted_here {
        offset = 0;
    }

    let total = if resuming {
        content_range.as_deref().and_then(total_from_content_range)
    } else {
        content_length
    };
    let validator = validator_of(&fetched.response).or(known_validator);
    let resumable = validator.is_some()
        && (status == 206 || header(&fetched.response, "Accept-Ranges").is_some_and(|v| v.eq_ignore_ascii_case("bytes")));

    // --- écriture ------------------------------------------------------------
    let mut hasher = if resuming { sha256_of_file(part, reporter)? } else { Sha256::new() };
    let mut file = if resuming {
        OpenOptions::new().append(true).open(part)
    } else {
        File::create(part)
    }
    .map_err(|e| InternetError::new(ErrorKind::Destination, format!("Création impossible : {e}")))?;

    if resumable {
        let meta = PartialMeta {
            url: url.to_string(),
            final_url: fetched.final_url.to_string(),
            validator: validator.clone().unwrap_or_default(),
            total,
        };
        let _ = fs::write(meta_path, serde_json::to_vec(&meta).unwrap_or_default());
    } else {
        let _ = fs::remove_file(meta_path);
    }

    let mime = mime_of(&fetched.response);
    let mut reader = fetched.response.into_reader();
    let mut buffer = vec![0_u8; CHUNK];
    let mut received = 0_u64;
    let mut last_report = Instant::now() - PROGRESS_EVERY;
    reporter.report(offset, total.unwrap_or(0), "download");

    loop {
        reporter.check().map_err(|_| InternetError::cancelled())?;
        let read = match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => read,
            Err(error) => {
                return Err(match error.kind() {
                    std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => {
                        InternetError::new(ErrorKind::Timeout, "Délai dépassé : le serveur ne répond plus.")
                    }
                    _ => InternetError::new(ErrorKind::Incomplete, format!("Connexion interrompue : {error}")),
                });
            }
        };
        hasher.update(&buffer[..read]);
        file.write_all(&buffer[..read]).map_err(|e| write_error(&e))?;
        received += read as u64;
        if last_report.elapsed() >= PROGRESS_EVERY {
            reporter.report(offset + received, total.unwrap_or(0), "download");
            last_report = Instant::now();
        }
    }
    file.flush().map_err(|e| write_error(&e))?;
    drop(file);

    let written = offset + received;
    if let Some(total) = total {
        if written != total {
            return Err(InternetError::new(
                ErrorKind::Incomplete,
                format!("Téléchargement incomplet : {written} octets reçus sur {total}."),
            ));
        }
    }
    reporter.report(written, total.unwrap_or(written), "download");

    Ok(DownloadSummary {
        path: String::new(),
        bytes: written,
        sha256: hex(&hasher.finalize()),
        resumed_from: if resuming { offset } else { 0 },
        final_url: fetched.final_url.to_string(),
        mime,
        elapsed_ms: 0,
        bytes_per_second: 0,
        restarted: restarted_here,
    })
}

fn mime_of(response: &ureq::Response) -> Option<String> {
    header(response, "Content-Type").map(|v| v.split(';').next().unwrap_or("").trim().to_lowercase())
}

fn summary_of(fetched: &Fetched, bytes: u64, resumed_from: u64, sha256: String) -> DownloadSummary {
    DownloadSummary {
        path: String::new(),
        bytes,
        sha256,
        resumed_from,
        final_url: fetched.final_url.to_string(),
        mime: mime_of(&fetched.response),
        elapsed_ms: 0,
        bytes_per_second: 0,
        restarted: false,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    use super::super::testserver::{serve_range, Body, Request, Response, TestServer};
    use super::*;

    fn content(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i * 31 % 251) as u8).collect()
    }

    fn workspace(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fourtout-dl-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn params(url: &str, destination: &Path) -> DownloadParams {
        DownloadParams {
            url: url.into(),
            destination: destination.to_path_buf(),
            overwrite: false,
            resume: true,
            expected_sha256: None,
            options: ClientOptions { connect_timeout: Duration::from_secs(2), read_timeout: Duration::from_secs(2) },
        }
    }

    fn sha(bytes: &[u8]) -> String {
        hex(&Sha256::digest(bytes))
    }

    #[test]
    fn probes_size_type_name_and_range_support() {
        let body = content(10_000);
        let served = body.clone();
        let server = TestServer::start(move |request: &Request| match request.path.as_str() {
            "/dl/rapport" => serve_range(request, &served, "\"v1\"")
                .with("Content-Type", "application/pdf")
                .with("Content-Disposition", "attachment; filename=\"Rapport final.pdf\""),
            _ => Response::status(404),
        });
        let probe = probe(&server.url("/dl/rapport"), &ClientOptions::default()).unwrap();
        assert_eq!(probe.size, Some(10_000));
        assert_eq!(probe.mime.as_deref(), Some("application/pdf"));
        assert_eq!(probe.filename, "Rapport final.pdf");
        assert!(probe.accepts_ranges);
        assert_eq!(probe.etag.as_deref(), Some("\"v1\""));
        assert_eq!(probe.status, 200);
    }

    #[test]
    fn probe_falls_back_to_a_ranged_get_when_head_is_refused() {
        let body = content(4321);
        let served = body.clone();
        let server = TestServer::start(move |request: &Request| {
            if request.method == "HEAD" {
                return Response::status(405);
            }
            serve_range(request, &served, "\"v1\"")
        });
        let probe = probe(&server.url("/x.bin"), &ClientOptions::default()).unwrap();
        assert_eq!(probe.size, Some(4321), "taille lue dans Content-Range");
        assert!(probe.accepts_ranges);
        assert_eq!(probe.filename, "x.bin");
    }

    #[test]
    fn follows_redirects_and_reports_the_final_address() {
        let server = TestServer::start(|request: &Request| match request.path.as_str() {
            "/a" => Response::redirect(302, "/b"),
            "/b" => Response::redirect(301, "/final/donn%C3%A9es.txt"),
            "/final/donn%C3%A9es.txt" | "/final/données.txt" => Response::ok(b"ok".to_vec()).with("Content-Type", "text/plain"),
            _ => Response::status(404),
        });
        let probe = probe(&server.url("/a"), &ClientOptions::default()).unwrap();
        assert_eq!(probe.redirects, 2);
        assert!(probe.final_url.ends_with("/final/donn%C3%A9es.txt"), "{}", probe.final_url);
        assert_eq!(probe.filename, "données.txt");
    }

    #[test]
    fn a_redirect_loop_and_a_redirect_to_another_scheme_are_refused() {
        let server = TestServer::start(|request: &Request| match request.path.as_str() {
            "/loop" => Response::redirect(302, "/loop"),
            "/ftp" => Response::redirect(302, "ftp://exemple.org/x"),
            "/file" => Response::redirect(302, "file:///etc/passwd"),
            _ => Response::status(404),
        });
        let looping = probe(&server.url("/loop"), &ClientOptions::default()).unwrap_err();
        assert_eq!(looping.kind, ErrorKind::Redirect);
        assert_eq!(probe(&server.url("/ftp"), &ClientOptions::default()).unwrap_err().kind, ErrorKind::Redirect);
        assert_eq!(probe(&server.url("/file"), &ClientOptions::default()).unwrap_err().kind, ErrorKind::Redirect);
    }

    #[test]
    fn maps_http_errors_dns_refusal_and_timeouts() {
        let server = TestServer::start(|request: &Request| match request.path.as_str() {
            "/hang" => Response { status: 200, headers: vec![], body: Body::Hang },
            "/forbidden" => Response::status(403),
            _ => Response::status(404),
        });
        let error = probe(&server.url("/absent"), &ClientOptions::default()).unwrap_err();
        assert_eq!((error.kind, error.status), (ErrorKind::Status, Some(404)));
        assert_eq!(probe(&server.url("/forbidden"), &ClientOptions::default()).unwrap_err().status, Some(403));

        let quick = ClientOptions { connect_timeout: Duration::from_secs(1), read_timeout: Duration::from_millis(300) };
        assert_eq!(probe(&server.url("/hang"), &quick).unwrap_err().kind, ErrorKind::Timeout);

        // Port fermé : on réserve un port libre puis on le relâche.
        let closed = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        let refused = probe(&format!("http://127.0.0.1:{closed}/"), &ClientOptions::default()).unwrap_err();
        assert_eq!(refused.kind, ErrorKind::Refused, "{refused}");

        let dns = probe("http://hote-inexistant.invalid/", &ClientOptions::default()).unwrap_err();
        assert_eq!(dns.kind, ErrorKind::Dns, "{dns}");
        assert_eq!(probe("ftp://exemple.org/", &ClientOptions::default()).unwrap_err().kind, ErrorKind::UnsupportedScheme);
    }

    #[test]
    fn downloads_with_known_length_progress_and_a_hash() {
        let body = content(300_000);
        let served = body.clone();
        let server = TestServer::start(move |request: &Request| serve_range(request, &served, "\"v1\""));
        let work = workspace("plain");
        let destination = work.join("fichier.bin");

        let summary = download(&params(&server.url("/f"), &destination), &Reporter::silent()).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), body);
        assert_eq!(summary.bytes, 300_000);
        assert_eq!(summary.sha256, sha(&body));
        assert_eq!(summary.resumed_from, 0);
        // Rien d'autre que le fichier final ne traîne.
        let names: Vec<_> = fs::read_dir(&work).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
        assert_eq!(names, vec!["fichier.bin"]);
        let _ = fs::remove_dir_all(&work);
    }

    #[test]
    fn downloads_a_body_of_unknown_length() {
        let body = content(50_000);
        let served = body.clone();
        let server = TestServer::start(move |_| Response { status: 200, headers: vec![], body: Body::Unsized(served.clone()) });
        let work = workspace("unsized");
        let destination = work.join("x.bin");
        let summary = download(&params(&server.url("/f"), &destination), &Reporter::silent()).unwrap();
        assert_eq!(summary.bytes, 50_000);
        assert_eq!(fs::read(&destination).unwrap(), body);
        let _ = fs::remove_dir_all(&work);
    }

    #[test]
    fn never_overwrites_silently_and_never_writes_into_a_missing_folder() {
        let server = TestServer::start(|_| Response::ok(b"nouveau".to_vec()));
        let work = workspace("overwrite");
        let destination = work.join("existant.txt");
        fs::write(&destination, "ancien").unwrap();

        let refused = download(&params(&server.url("/f"), &destination), &Reporter::silent()).unwrap_err();
        assert_eq!(refused.kind, ErrorKind::Destination);
        assert_eq!(fs::read_to_string(&destination).unwrap(), "ancien");
        assert_eq!(server.hits.load(Ordering::SeqCst), 0, "refusé avant tout échange");

        let mut replace = params(&server.url("/f"), &destination);
        replace.overwrite = true;
        download(&replace, &Reporter::silent()).unwrap();
        assert_eq!(fs::read_to_string(&destination).unwrap(), "nouveau");

        let inside_nothing = params(&server.url("/f"), &work.join("absent/sous/x.txt"));
        assert_eq!(download(&inside_nothing, &Reporter::silent()).unwrap_err().kind, ErrorKind::Destination);
        assert_eq!(download(&params(&server.url("/f"), &work), &Reporter::silent()).unwrap_err().kind, ErrorKind::Destination);
        let _ = fs::remove_dir_all(&work);
    }

    #[test]
    fn an_interrupted_download_resumes_and_matches_byte_for_byte() {
        let body = content(200_000);
        let served = body.clone();
        // Première réponse : coupée à 80 000 octets sur 200 000 annoncés.
        let cut = Arc::new(AtomicBool::new(true));
        let cut_flag = cut.clone();
        let server = TestServer::start(move |request: &Request| {
            if request.header("range").is_none() && cut_flag.load(Ordering::SeqCst) {
                return Response {
                    status: 200,
                    headers: vec![("ETag".into(), "\"v1\"".into()), ("Accept-Ranges".into(), "bytes".into())],
                    body: Body::Truncated { declared: served.len(), sent: served[..80_000].to_vec() },
                };
            }
            serve_range(request, &served, "\"v1\"")
        });
        let work = workspace("resume");
        let destination = work.join("gros.bin");

        let failed = download(&params(&server.url("/f"), &destination), &Reporter::silent()).unwrap_err();
        assert_eq!(failed.kind, ErrorKind::Incomplete, "{failed}");
        assert!(!destination.exists(), "un fichier incomplet n'a jamais son nom définitif");
        let (part, meta) = partial_paths(&destination);
        assert_eq!(fs::metadata(&part).unwrap().len(), 80_000);
        assert!(meta.exists());

        cut.store(false, Ordering::SeqCst);
        let summary = download(&params(&server.url("/f"), &destination), &Reporter::silent()).unwrap();
        assert_eq!(summary.resumed_from, 80_000);
        assert!(!summary.restarted);
        assert_eq!(summary.bytes, 200_000);
        assert_eq!(fs::read(&destination).unwrap(), body);
        assert_eq!(summary.sha256, sha(&body), "l'empreinte couvre le début déjà présent");
        assert!(!part.exists() && !meta.exists());
        let _ = fs::remove_dir_all(&work);
    }

    #[test]
    fn a_server_that_ignores_range_restarts_cleanly() {
        let body = content(120_000);
        let served = body.clone();
        let first = Arc::new(AtomicBool::new(true));
        let first_flag = first.clone();
        let server = TestServer::start(move |request: &Request| {
            if first_flag.swap(false, Ordering::SeqCst) {
                return Response {
                    status: 200,
                    headers: vec![("ETag".into(), "\"v1\"".into()), ("Accept-Ranges".into(), "bytes".into())],
                    body: Body::Truncated { declared: served.len(), sent: served[..50_000].to_vec() },
                };
            }
            // Ignore Range et If-Range : renvoie toujours tout.
            let _ = request;
            Response::ok(served.clone()).with("ETag", "\"v1\"").with("Accept-Ranges", "bytes")
        });
        let work = workspace("ignores-range");
        let destination = work.join("x.bin");
        assert!(download(&params(&server.url("/f"), &destination), &Reporter::silent()).is_err());
        let summary = download(&params(&server.url("/f"), &destination), &Reporter::silent()).unwrap();
        assert!(summary.restarted);
        assert_eq!(summary.resumed_from, 0);
        assert_eq!(fs::read(&destination).unwrap(), body, "pas de recollage de deux versions");
        let _ = fs::remove_dir_all(&work);
    }

    #[test]
    fn a_changed_resource_is_not_spliced_onto_a_stale_partial() {
        let old = content(100_000);
        let new: Vec<u8> = old.iter().map(|b| b.wrapping_add(1)).collect();
        let (served_old, served_new) = (old.clone(), new.clone());
        let changed = Arc::new(AtomicBool::new(false));
        let changed_flag = changed.clone();
        let server = TestServer::start(move |request: &Request| {
            if changed_flag.load(Ordering::SeqCst) {
                return serve_range(request, &served_new, "\"v2\"");
            }
            if request.header("range").is_none() {
                return Response {
                    status: 200,
                    headers: vec![("ETag".into(), "\"v1\"".into()), ("Accept-Ranges".into(), "bytes".into())],
                    body: Body::Truncated { declared: served_old.len(), sent: served_old[..40_000].to_vec() },
                };
            }
            serve_range(request, &served_old, "\"v1\"")
        });
        let work = workspace("changed");
        let destination = work.join("x.bin");
        assert!(download(&params(&server.url("/f"), &destination), &Reporter::silent()).is_err());
        changed.store(true, Ordering::SeqCst);
        let summary = download(&params(&server.url("/f"), &destination), &Reporter::silent()).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), new);
        assert_eq!(summary.sha256, sha(&new));
        let _ = fs::remove_dir_all(&work);
    }

    #[test]
    fn a_complete_partial_is_finalised_after_a_416() {
        let body = content(30_000);
        let served = body.clone();
        let server = TestServer::start(move |request: &Request| serve_range(request, &served, "\"v1\""));
        let work = workspace("416");
        let destination = work.join("x.bin");
        let (part, meta) = partial_paths(&destination);
        fs::write(&part, &body).unwrap();
        let saved = PartialMeta { url: server.url("/f"), final_url: server.url("/f"), validator: "\"v1\"".into(), total: Some(30_000) };
        fs::write(&meta, serde_json::to_vec(&saved).unwrap()).unwrap();

        let summary = download(&params(&server.url("/f"), &destination), &Reporter::silent()).unwrap();
        assert_eq!(summary.sha256, sha(&body));
        assert_eq!(fs::read(&destination).unwrap(), body);
        let _ = fs::remove_dir_all(&work);
    }

    #[test]
    fn a_wrong_checksum_deletes_the_result() {
        let server = TestServer::start(|_| Response::ok(b"contenu".to_vec()));
        let work = workspace("checksum");
        let destination = work.join("x.txt");
        let mut wrong = params(&server.url("/f"), &destination);
        wrong.expected_sha256 = Some("00".repeat(32));
        assert_eq!(download(&wrong, &Reporter::silent()).unwrap_err().kind, ErrorKind::Checksum);
        assert!(!destination.exists());
        assert_eq!(fs::read_dir(&work).unwrap().count(), 0, "ni fichier ni partiel");

        let mut right = params(&server.url("/f"), &destination);
        right.expected_sha256 = Some(sha(b"contenu").to_uppercase());
        download(&right, &Reporter::silent()).unwrap();
        let _ = fs::remove_dir_all(&work);
    }

    #[test]
    fn cancellation_stops_the_transfer_and_leaves_no_final_file() {
        let server = TestServer::start(|_| Response {
            status: 200,
            headers: vec![("Content-Length".into(), "100000000".into())],
            body: Body::Slow { chunk: vec![7; 1000], count: 100_000, delay: Duration::from_millis(5) },
        });
        let work = workspace("cancel");
        let destination = work.join("x.bin");
        let flag = Arc::new(AtomicBool::new(false));
        let remote = flag.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            remote.store(true, Ordering::SeqCst);
        });
        let started = Instant::now();
        let error = download(&params(&server.url("/f"), &destination), &Reporter::silent_with_flag(flag)).unwrap_err();
        assert!(error.is_cancelled(), "{error}");
        assert!(started.elapsed() < Duration::from_secs(5), "l'annulation doit être immédiate");
        assert!(!destination.exists());
        // Sans validateur, aucune reprise n'est possible : rien n'est conservé.
        assert_eq!(fs::read_dir(&work).unwrap().count(), 0);
        let _ = fs::remove_dir_all(&work);
    }

    #[test]
    fn a_hostile_server_filename_stays_inside_the_chosen_folder() {
        // Le nom proposé est assaini ; la destination, elle, vient toujours de
        // l'utilisateur : un en-tête ne peut pas la déplacer.
        let server = TestServer::start(|_| {
            Response::ok(b"x".to_vec()).with("Content-Disposition", "attachment; filename=\"../../../tmp/pirate.sh\"")
        });
        let probe = probe(&server.url("/f"), &ClientOptions::default()).unwrap();
        assert_eq!(probe.filename, "pirate.sh");
    }
}
