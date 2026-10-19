//! Petit serveur HTTP local pour les tests : aucun test n'atteint Internet.
//!
//! Il comprend juste ce qu'il faut — requête, en-têtes, corps, réponses avec
//! ou sans `Content-Length`, lentes ou qui ne répondent jamais — et se ferme
//! quand la valeur est abandonnée.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

pub struct Request {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(&name.to_ascii_lowercase()).map(String::as_str)
    }
}

pub enum Body {
    /// Corps complet avec `Content-Length`.
    Bytes(Vec<u8>),
    /// Corps annoncé de `declared` octets, mais coupé après `sent` : une
    /// connexion interrompue en cours de route.
    Truncated { declared: usize, sent: Vec<u8> },
    /// Sans `Content-Length` : le corps se termine à la fermeture.
    Unsized(Vec<u8>),
    /// Envoi par morceaux séparés par un délai (pour annuler en cours de route).
    Slow { chunk: Vec<u8>, count: usize, delay: Duration },
    /// Accepte la connexion puis ne répond jamais.
    Hang,
}

pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Body,
}

impl Response {
    pub fn ok(body: Vec<u8>) -> Self {
        Self { status: 200, headers: Vec::new(), body: Body::Bytes(body) }
    }

    pub fn status(status: u16) -> Self {
        Self { status, headers: Vec::new(), body: Body::Bytes(Vec::new()) }
    }

    pub fn with(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }

    pub fn redirect(status: u16, location: &str) -> Self {
        Self::status(status).with("Location", location)
    }
}

pub struct TestServer {
    pub addr: SocketAddr,
    stop: Arc<AtomicBool>,
    pub hits: Arc<AtomicUsize>,
}

impl TestServer {
    pub fn start(handler: impl Fn(&Request) -> Response + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let addr = listener.local_addr().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let hits = Arc::new(AtomicUsize::new(0));
        let handler = Arc::new(handler);

        let (stop_flag, hit_counter) = (stop.clone(), hits.clone());
        std::thread::spawn(move || {
            while !stop_flag.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let handler = handler.clone();
                        let hit_counter = hit_counter.clone();
                        let stop_flag = stop_flag.clone();
                        std::thread::spawn(move || {
                            let _ = stream.set_nonblocking(false);
                            serve(stream, &*handler, &hit_counter, &stop_flag);
                        });
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(5)),
                }
            }
        });
        Self { addr, stop, hits }
    }

    pub fn url(&self, path: &str) -> String {
        format!("http://{}{path}", self.addr)
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

fn read_request(stream: &mut TcpStream) -> Option<Request> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let mut raw = Vec::new();
    let mut buffer = [0_u8; 4096];
    let header_end = loop {
        let read = stream.read(&mut buffer).ok()?;
        if read == 0 {
            return None;
        }
        raw.extend_from_slice(&buffer[..read]);
        if let Some(position) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
            break position + 4;
        }
    };
    let head = String::from_utf8_lossy(&raw[..header_end]).to_string();
    let mut lines = head.lines();
    let mut first = lines.next()?.split_whitespace();
    let method = first.next()?.to_string();
    let path = first.next()?.to_string();
    let headers: HashMap<String, String> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    let length: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut body = raw[header_end..].to_vec();
    while body.len() < length {
        let read = stream.read(&mut buffer).ok()?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&buffer[..read]);
    }
    Some(Request { method, path, headers, body })
}

fn serve(
    mut stream: TcpStream,
    handler: &(dyn Fn(&Request) -> Response + Send + Sync),
    hits: &AtomicUsize,
    stop: &AtomicBool,
) {
    let Some(request) = read_request(&mut stream) else { return };
    hits.fetch_add(1, Ordering::SeqCst);
    let response = handler(&request);
    let head_only = request.method == "HEAD";
    if matches!(response.body, Body::Hang) {
        // Ne répond jamais, pas même un en-tête.
        std::thread::sleep(Duration::from_secs(30));
        return;
    }

    let reason = match response.status {
        200 => "OK",
        206 => "Partial Content",
        301 => "Moved Permanently",
        302 => "Found",
        404 => "Not Found",
        416 => "Range Not Satisfiable",
        _ => "Status",
    };
    let mut head = format!("HTTP/1.1 {} {reason}\r\nConnection: close\r\n", response.status);
    for (name, value) in &response.headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    match &response.body {
        Body::Bytes(bytes) => head.push_str(&format!("Content-Length: {}\r\n", bytes.len())),
        Body::Truncated { declared, .. } => head.push_str(&format!("Content-Length: {declared}\r\n")),
        _ => {}
    }
    head.push_str("\r\n");
    if stream.write_all(head.as_bytes()).is_err() || head_only {
        return;
    }
    match response.body {
        Body::Bytes(bytes) => {
            let _ = stream.write_all(&bytes);
        }
        Body::Truncated { sent, .. } | Body::Unsized(sent) => {
            let _ = stream.write_all(&sent);
        }
        Body::Slow { chunk, count, delay } => {
            for _ in 0..count {
                if stop.load(Ordering::SeqCst) || stream.write_all(&chunk).is_err() || stream.flush().is_err() {
                    return;
                }
                std::thread::sleep(delay);
            }
        }
        Body::Hang => {}
    }
    let _ = stream.flush();
}

/// Exécute une réponse conforme à `Range: bytes=start-` sur un contenu connu.
pub fn serve_range(request: &Request, content: &[u8], validator: &str) -> Response {
    let total = content.len();
    let Some(range) = request.header("range") else {
        return Response::ok(content.to_vec()).with("Accept-Ranges", "bytes").with("ETag", validator);
    };
    // « If-Range » différent du validateur : le contenu a changé, on renvoie tout.
    if request.header("if-range").is_some_and(|v| v != validator) {
        return Response::ok(content.to_vec()).with("Accept-Ranges", "bytes").with("ETag", validator);
    }
    let spec = range.trim_start_matches("bytes=");
    let (from, to) = spec.split_once('-').unwrap_or((spec, ""));
    let start: usize = from.parse().unwrap_or(0);
    if start >= total {
        return Response::status(416).with("Content-Range", &format!("bytes */{total}"));
    }
    let end = to.parse::<usize>().map(|e| e.min(total - 1)).unwrap_or(total - 1);
    Response {
        status: 206,
        headers: vec![
            ("Content-Range".into(), format!("bytes {start}-{end}/{total}")),
            ("Accept-Ranges".into(), "bytes".into()),
            ("ETag".into(), validator.into()),
        ],
        body: Body::Bytes(content[start..=end].to_vec()),
    }
}
