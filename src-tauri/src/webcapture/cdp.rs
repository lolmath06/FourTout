//! Client minimal du protocole Chrome DevTools (JSON sur WebSocket).
//!
//! Seulement ce qu'il faut pour trois captures : ouvrir un onglet, naviguer,
//! attendre le chargement, puis demander un PDF, une capture ou un instantané.

use std::collections::VecDeque;
use std::net::TcpStream;
use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::{json, Value};
use tungstenite::{Message, WebSocket};

use super::browser::Session;
use super::Capture;
use crate::internet::http::{ErrorKind, InternetError};

/// Pixels maximum d'une capture pleine page (hauteur bornée aussi).
const MAX_PIXELS: u64 = 100_000_000;
const MAX_HEIGHT: u32 = 20_000;
/// Pause après l'événement de chargement : laisse les images tardives s'afficher.
const SETTLE: Duration = Duration::from_millis(600);

pub struct Captured {
    pub bytes: Vec<u8>,
    pub final_url: String,
    pub http_status: Option<u16>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

struct Connection<'a> {
    socket: WebSocket<TcpStream>,
    next_id: u64,
    events: VecDeque<Value>,
    deadline: Instant,
    cancelled: &'a dyn Fn() -> bool,
}

fn other(message: impl Into<String>) -> InternetError {
    InternetError::new(ErrorKind::Other, message)
}

impl<'a> Connection<'a> {
    fn connect(ws_url: &str, timeout: Duration, cancelled: &'a dyn Fn() -> bool) -> Result<Self, InternetError> {
        let authority = ws_url
            .strip_prefix("ws://")
            .and_then(|r| r.split('/').next())
            .ok_or_else(|| other("Point d'accès DevTools invalide."))?;
        let stream = TcpStream::connect(authority).map_err(|e| other(format!("Connexion DevTools impossible : {e}")))?;
        let _ = stream.set_nodelay(true);
        stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
        let (socket, _) = tungstenite::client(ws_url, stream).map_err(|e| other(format!("Poignée de main DevTools refusée : {e}")))?;
        let mut connection = Connection { socket, next_id: 0, events: VecDeque::new(), deadline: Instant::now() + timeout, cancelled };
        connection.socket.get_mut().set_read_timeout(Some(Duration::from_millis(100))).ok();
        Ok(connection)
    }

    /// Lit un message, ou `None` si rien n'est arrivé pendant 100 ms.
    fn read(&mut self) -> Result<Option<Value>, InternetError> {
        if (self.cancelled)() {
            return Err(InternetError::cancelled());
        }
        if Instant::now() >= self.deadline {
            return Err(InternetError::new(ErrorKind::Timeout, "Délai dépassé : la page met trop de temps à répondre."));
        }
        match self.socket.read() {
            Ok(Message::Text(text)) => Ok(serde_json::from_str(text.as_str()).ok()),
            Ok(Message::Close(_)) => Err(other("Le navigateur a fermé la connexion.")),
            Ok(_) => Ok(None),
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => Ok(None),
            Err(tungstenite::Error::ConnectionClosed | tungstenite::Error::AlreadyClosed) => Err(other("Le navigateur s'est arrêté.")),
            Err(e) => Err(other(format!("Erreur DevTools : {e}"))),
        }
    }

    fn call(&mut self, method: &str, params: Value, session: Option<&str>) -> Result<Value, InternetError> {
        self.next_id += 1;
        let id = self.next_id;
        let mut message = json!({ "id": id, "method": method, "params": params });
        if let Some(session) = session {
            message["sessionId"] = json!(session);
        }
        self.socket
            .send(Message::text(message.to_string()))
            .map_err(|e| other(format!("Envoi DevTools impossible : {e}")))?;
        loop {
            let Some(value) = self.read()? else { continue };
            if value["id"].as_u64() == Some(id) {
                if let Some(error) = value["error"]["message"].as_str() {
                    return Err(other(format!("Le navigateur a refusé « {method} » : {error}")));
                }
                return Ok(value["result"].clone());
            }
            if value["method"].is_string() {
                self.events.push_back(value);
            }
        }
    }

    /// Attend un événement de la session ; rend ceux déjà reçus d'abord.
    fn wait_event(&mut self, name: &str, session: &str) -> Result<Value, InternetError> {
        loop {
            if let Some(pos) = self.events.iter().position(|e| e["method"] == name && e["sessionId"] == session) {
                return Ok(self.events.remove(pos).unwrap_or(Value::Null)["params"].clone());
            }
            if let Some(value) = self.read()? {
                if value["method"].is_string() {
                    self.events.push_back(value);
                }
            }
        }
    }

    /// Laisse passer `duration` en continuant à écouter (et à annuler).
    fn settle(&mut self, duration: Duration) -> Result<(), InternetError> {
        let until = Instant::now() + duration;
        while Instant::now() < until {
            if let Some(value) = self.read()? {
                if value["method"].is_string() {
                    self.events.push_back(value);
                }
            }
        }
        Ok(())
    }
}

/// Traduit l'erreur de navigation de Chromium.
pub fn navigation_error(text: &str) -> InternetError {
    let kind = |k, m: &str| InternetError::new(k, m.to_string());
    match text {
        t if t.contains("NAME_NOT_RESOLVED") => kind(ErrorKind::Dns, "Serveur introuvable : ce nom de site n'existe pas."),
        t if t.contains("CONNECTION_REFUSED") => kind(ErrorKind::Refused, "Connexion refusée par le serveur."),
        t if t.contains("TIMED_OUT") => kind(ErrorKind::Timeout, "Délai dépassé : le serveur ne répond pas."),
        t if t.contains("CERT") || t.contains("SSL") => kind(ErrorKind::Tls, "Connexion sécurisée impossible (certificat ou chiffrement)."),
        t if t.contains("ABORTED") => kind(ErrorKind::Other, "Cette adresse déclenche un téléchargement et non l'affichage d'une page."),
        t if t.contains("INTERNET_DISCONNECTED") => kind(ErrorKind::Other, "Aucune connexion Internet."),
        t => InternetError::new(ErrorKind::Other, format!("La page n'a pas pu être chargée : {t}")),
    }
}

fn decode(data: &Value) -> Result<Vec<u8>, InternetError> {
    base64::engine::general_purpose::STANDARD
        .decode(data.as_str().unwrap_or(""))
        .map_err(|_| other("Réponse du navigateur illisible."))
}

pub fn capture(
    session: &mut Session,
    url: &str,
    capture: &Capture,
    timeout: Duration,
    cancelled: &dyn Fn() -> bool,
) -> Result<Captured, InternetError> {
    let mut c = Connection::connect(&session.ws_url, timeout, cancelled)?;
    let target = c.call("Target.createTarget", json!({ "url": "about:blank" }), None)?;
    let target_id = target["targetId"].as_str().ok_or_else(|| other("Onglet non créé."))?.to_string();
    let attached = c.call("Target.attachToTarget", json!({ "targetId": target_id, "flatten": true }), None)?;
    let sid = attached["sessionId"].as_str().ok_or_else(|| other("Onglet inaccessible."))?.to_string();
    let s = Some(sid.as_str());

    c.call("Page.enable", json!({}), s)?;
    c.call("Network.enable", json!({}), s)?;
    if let Capture::Image(o) = capture {
        c.call(
            "Emulation.setDeviceMetricsOverride",
            json!({ "width": o.viewport_width, "height": o.viewport_height, "deviceScaleFactor": 1, "mobile": false }),
            s,
        )?;
    }

    let navigated = c.call("Page.navigate", json!({ "url": url }), s)?;
    if let Some(error) = navigated["errorText"].as_str().filter(|e| !e.is_empty()) {
        return Err(navigation_error(error));
    }
    c.wait_event("Page.loadEventFired", &sid)?;
    c.settle(SETTLE)?;

    let http_status = c
        .events
        .iter()
        .find(|e| e["method"] == "Network.responseReceived" && e["params"]["type"] == "Document")
        .and_then(|e| e["params"]["response"]["status"].as_u64())
        .map(|s| s as u16);
    let history = c.call("Page.getNavigationHistory", json!({}), s)?;
    let current = history["currentIndex"].as_u64().unwrap_or(0) as usize;
    let final_url = history["entries"][current]["url"].as_str().unwrap_or(url).to_string();

    let (bytes, width, height) = match capture {
        Capture::Pdf(o) => {
            let margin = o.margin_mm / 25.4;
            let result = c.call(
                "Page.printToPDF",
                json!({
                    "landscape": o.landscape, "printBackground": o.background,
                    "paperWidth": o.paper_width, "paperHeight": o.paper_height,
                    "marginTop": margin, "marginBottom": margin, "marginLeft": margin, "marginRight": margin,
                    "preferCSSPageSize": false, "displayHeaderFooter": false,
                }),
                s,
            )?;
            (decode(&result["data"])?, None, None)
        }
        Capture::Image(o) => {
            let (mut width, mut height) = (o.viewport_width, o.viewport_height);
            let mut params = json!({ "format": o.format.cdp_name() });
            if o.format != super::ImageFormat::Png {
                params["quality"] = json!(o.quality.clamp(1, 100));
            }
            if o.full_page {
                let metrics = c.call("Page.getLayoutMetrics", json!({}), s)?;
                let size = &metrics["cssContentSize"];
                width = size["width"].as_f64().unwrap_or(f64::from(width)).ceil().max(1.0) as u32;
                height = size["height"].as_f64().unwrap_or(f64::from(height)).ceil().max(1.0) as u32;
                height = height.min(MAX_HEIGHT);
                if u64::from(width) * u64::from(height) > MAX_PIXELS {
                    return Err(other("La page est trop grande pour une capture pleine page."));
                }
                params["captureBeyondViewport"] = json!(true);
                params["clip"] = json!({ "x": 0, "y": 0, "width": width, "height": height, "scale": 1 });
            }
            let result = c.call("Page.captureScreenshot", params, s)?;
            (decode(&result["data"])?, Some(width), Some(height))
        }
        Capture::Mhtml => {
            let result = c.call("Page.captureSnapshot", json!({ "format": "mhtml" }), s)?;
            let text = result["data"].as_str().ok_or_else(|| other("Instantané vide."))?;
            (text.as_bytes().to_vec(), None, None)
        }
    };

    // Fermeture polie ; l'arrêt du processus est de toute façon garanti ensuite.
    let _ = c.call("Target.closeTarget", json!({ "targetId": target_id }), None);
    let _ = c.call("Browser.close", json!({}), None);
    if bytes.is_empty() {
        return Err(other("Le navigateur n'a rien produit."));
    }
    Ok(Captured { bytes, final_url, http_status, width, height })
}

#[cfg(all(test, unix))]
mod tests {
    use std::io::Write;
    use std::net::TcpListener;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    use super::super::browser::{Browser, Family};
    use super::super::{run, ImageFormat, ImageOptions, PdfOptions};
    use super::*;

    /// Faux navigateur DevTools : répond au script, journalise les appels.
    struct FakeCdp {
        port: u16,
        log: Arc<Mutex<Vec<(String, Value)>>>,
    }

    struct Script {
        load_event: bool,
        navigate_error: Option<&'static str>,
        content: Value,
    }

    fn fake_cdp(script: Script) -> FakeCdp {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let log = Arc::new(Mutex::new(Vec::new()));
        let journal = log.clone();
        std::thread::spawn(move || {
            let Ok((stream, _)) = listener.accept() else { return };
            let Ok(mut ws) = tungstenite::accept(stream) else { return };
            while let Ok(Message::Text(text)) = ws.read() {
                let request: Value = serde_json::from_str(text.as_str()).unwrap();
                let (id, method) = (request["id"].clone(), request["method"].as_str().unwrap().to_string());
                journal.lock().unwrap().push((method.clone(), request["params"].clone()));
                let session = request["sessionId"].clone();
                let mut events: Vec<Value> = Vec::new();
                let result = match method.as_str() {
                    "Target.createTarget" => json!({ "targetId": "T1" }),
                    "Target.attachToTarget" => json!({ "sessionId": "S1" }),
                    "Page.navigate" => {
                        if let Some(error) = script.navigate_error {
                            json!({ "errorText": error })
                        } else {
                            if script.load_event {
                                events.push(json!({ "method": "Network.responseReceived", "sessionId": session,
                                    "params": { "type": "Document", "response": { "status": 200 } } }));
                                events.push(json!({ "method": "Page.loadEventFired", "sessionId": session, "params": {} }));
                            }
                            json!({ "frameId": "F" })
                        }
                    }
                    "Page.getNavigationHistory" => {
                        json!({ "currentIndex": 0, "entries": [{ "url": "http://127.0.0.1/final" }] })
                    }
                    "Page.getLayoutMetrics" => json!({ "cssContentSize": { "width": 1000.4, "height": 3000.0 } }),
                    "Page.printToPDF" | "Page.captureScreenshot" | "Page.captureSnapshot" => script.content.clone(),
                    _ => json!({}),
                };
                let reply = json!({ "id": id, "result": result });
                if ws.send(Message::text(reply.to_string())).is_err() {
                    return;
                }
                for event in events {
                    let _ = ws.send(Message::text(event.to_string()));
                }
            }
        });
        FakeCdp { port, log }
    }

    fn session(port: u16) -> Session {
        Session {
            group: None,
            ws_url: format!("ws://127.0.0.1:{port}/devtools/browser/x"),
            browser: Browser { family: Family::Chromium, path: PathBuf::new(), version: None },
        }
    }

    fn b64(bytes: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    fn pdf_options() -> PdfOptions {
        PdfOptions { paper_width: 8.27, paper_height: 11.69, landscape: true, margin_mm: 25.4, background: true }
    }

    #[test]
    fn prints_a_pdf_with_the_requested_page_setup() {
        let fake = fake_cdp(Script { load_event: true, navigate_error: None, content: json!({ "data": b64(b"%PDF-1.4 test") }) });
        let mut s = session(fake.port);
        let captured = capture(&mut s, "http://127.0.0.1/page", &Capture::Pdf(pdf_options()), Duration::from_secs(10), &|| false).unwrap();
        assert_eq!(captured.bytes, b"%PDF-1.4 test");
        assert_eq!(captured.http_status, Some(200));
        assert_eq!(captured.final_url, "http://127.0.0.1/final");

        let log = fake.log.lock().unwrap();
        let order: Vec<&str> = log.iter().map(|(m, _)| m.as_str()).collect();
        assert_eq!(&order[..4], ["Target.createTarget", "Target.attachToTarget", "Page.enable", "Network.enable"]);
        let (_, print) = log.iter().find(|(m, _)| m == "Page.printToPDF").unwrap();
        assert_eq!(print["landscape"], true);
        assert_eq!(print["printBackground"], true);
        assert_eq!(print["paperWidth"], 8.27);
        assert_eq!(print["marginTop"], 1.0, "25,4 mm = 1 pouce");
        let (_, navigate) = log.iter().find(|(m, _)| m == "Page.navigate").unwrap();
        assert_eq!(navigate["url"], "http://127.0.0.1/page");
    }

    #[test]
    fn a_full_page_screenshot_clips_to_the_whole_document_within_limits() {
        let fake = fake_cdp(Script { load_event: true, navigate_error: None, content: json!({ "data": b64(b"\x89PNGfake") }) });
        let options = ImageOptions { format: ImageFormat::Webp, quality: 80, viewport_width: 1280, viewport_height: 800, full_page: true };
        let captured = capture(&mut session(fake.port), "http://127.0.0.1/", &Capture::Image(options), Duration::from_secs(10), &|| false).unwrap();
        assert_eq!((captured.width, captured.height), (Some(1001), Some(3000)));
        let log = fake.log.lock().unwrap();
        let (_, shot) = log.iter().find(|(m, _)| m == "Page.captureScreenshot").unwrap();
        assert_eq!(shot["format"], "webp");
        assert_eq!(shot["quality"], 80);
        assert_eq!(shot["captureBeyondViewport"], true);
        assert_eq!(shot["clip"]["height"], 3000);
        let (_, metrics) = log.iter().find(|(m, _)| m == "Emulation.setDeviceMetricsOverride").unwrap();
        assert_eq!((metrics["width"].as_u64(), metrics["height"].as_u64()), (Some(1280), Some(800)));

        // PNG : pas de paramètre de qualité (il serait ignoré, ou refusé).
        let fake = fake_cdp(Script { load_event: true, navigate_error: None, content: json!({ "data": b64(b"x") }) });
        let png = ImageOptions { format: ImageFormat::Png, quality: 80, viewport_width: 800, viewport_height: 600, full_page: false };
        capture(&mut session(fake.port), "http://127.0.0.1/", &Capture::Image(png), Duration::from_secs(10), &|| false).unwrap();
        let log = fake.log.lock().unwrap();
        let (_, shot) = log.iter().find(|(m, _)| m == "Page.captureScreenshot").unwrap();
        assert!(shot.get("quality").is_none() && shot.get("clip").is_none());
    }

    #[test]
    fn saves_an_mhtml_snapshot_as_text() {
        let fake = fake_cdp(Script { load_event: true, navigate_error: None, content: json!({ "data": "MIME-Version: 1.0\r\nContent-Type: multipart/related\r\n" }) });
        let captured = capture(&mut session(fake.port), "http://127.0.0.1/", &Capture::Mhtml, Duration::from_secs(10), &|| false).unwrap();
        assert!(String::from_utf8(captured.bytes).unwrap().starts_with("MIME-Version"));
        let log = fake.log.lock().unwrap();
        assert_eq!(log.iter().find(|(m, _)| m == "Page.captureSnapshot").unwrap().1["format"], "mhtml");
    }

    #[test]
    fn navigation_failures_are_mapped_to_clear_errors() {
        for (text, kind) in [
            ("net::ERR_NAME_NOT_RESOLVED", ErrorKind::Dns),
            ("net::ERR_CONNECTION_REFUSED", ErrorKind::Refused),
            ("net::ERR_CERT_AUTHORITY_INVALID", ErrorKind::Tls),
            ("net::ERR_ABORTED", ErrorKind::Other),
        ] {
            let fake = fake_cdp(Script { load_event: false, navigate_error: Some(text), content: json!({}) });
            let error = capture(&mut session(fake.port), "http://x.invalid/", &Capture::Mhtml, Duration::from_secs(5), &|| false).err().unwrap();
            assert_eq!(error.kind, kind, "{text}");
        }
    }

    #[test]
    fn a_page_that_never_finishes_loading_times_out() {
        let fake = fake_cdp(Script { load_event: false, navigate_error: None, content: json!({}) });
        let started = Instant::now();
        let error = capture(&mut session(fake.port), "http://127.0.0.1/", &Capture::Mhtml, Duration::from_millis(800), &|| false).err().unwrap();
        assert_eq!(error.kind, ErrorKind::Timeout);
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn cancellation_interrupts_the_wait() {
        let fake = fake_cdp(Script { load_event: false, navigate_error: None, content: json!({}) });
        let flag = Arc::new(AtomicBool::new(false));
        let remote = flag.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            remote.store(true, Ordering::SeqCst);
        });
        let error = capture(&mut session(fake.port), "http://127.0.0.1/", &Capture::Mhtml, Duration::from_secs(30), &|| flag.load(Ordering::SeqCst)).err().unwrap();
        assert!(error.is_cancelled());
    }

    /// Faux exécutable de navigateur : annonce le port du faux DevTools, puis dort.
    fn fake_browser(dir: &std::path::Path, port: u16) -> Browser {
        let path = dir.join("fake-chromium");
        let mut file = std::fs::File::create(&path).unwrap();
        writeln!(
            file,
            "#!/bin/sh\nfor a in \"$@\"; do case \"$a\" in --user-data-dir=*) echo \"$a\" > \"{d}/profile-arg.txt\";; esac; done\necho \"DevTools listening on ws://127.0.0.1:{port}/devtools/browser/abc\" >&2\nsleep 60",
            d = dir.display()
        )
        .unwrap();
        drop(file);
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        Browser { family: Family::Chromium, path, version: Some("126.0".into()) }
    }

    #[test]
    fn a_whole_capture_uses_a_throwaway_profile_and_leaves_nothing_behind() {
        let dir = std::env::temp_dir().join(format!("fourtout-web-run-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let fake = fake_cdp(Script { load_event: true, navigate_error: None, content: json!({ "data": b64(b"%PDF-1.4 ok") }) });
        let browser = fake_browser(&dir, fake.port);
        let output = dir.join("page.pdf");

        let summary = run(&browser, "http://127.0.0.1/p", &Capture::Pdf(pdf_options()), &output, false, Duration::from_secs(20), &|| false).unwrap();
        assert_eq!(std::fs::read(&output).unwrap(), b"%PDF-1.4 ok");
        assert_eq!(summary.bytes, 11);
        assert!(summary.browser.contains("Chromium 126.0"));

        // Le profil passé au navigateur est un dossier jetable de FourTout, et il a disparu.
        let arg = std::fs::read_to_string(dir.join("profile-arg.txt")).unwrap();
        let profile = PathBuf::from(arg.trim().trim_start_matches("--user-data-dir="));
        assert!(profile.starts_with(std::env::temp_dir()) && profile.to_string_lossy().contains("fourtout-web-"));
        assert!(!profile.exists(), "profil temporaire supprimé");
        // Aucun fichier provisoire ne reste, et le fichier existant n'est pas écrasé sans demande.
        assert!(!dir.join("page.pdf.fourtout-part").exists());
        let again = run(&browser, "http://127.0.0.1/p", &Capture::Pdf(pdf_options()), &output, false, Duration::from_secs(5), &|| false);
        assert_eq!(again.err().unwrap().kind, ErrorKind::Destination);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unsafe_addresses_never_reach_the_browser() {
        let browser = Browser { family: Family::Chromium, path: PathBuf::from("/bin/false"), version: None };
        let out = std::env::temp_dir().join("never.pdf");
        for url in ["file:///etc/passwd", "chrome://settings", "javascript:alert(1)", "data:text/html,x", "about:blank", "ftp://x.org/"] {
            let error = run(&browser, url, &Capture::Mhtml, &out, true, Duration::from_secs(1), &|| false).err().unwrap();
            assert!(matches!(error.kind, ErrorKind::InvalidUrl | ErrorKind::UnsupportedScheme), "{url}");
        }
        assert!(!out.exists());
    }
}
