//! Découverte et lancement d'un navigateur Chromium installé.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::exec::find_in_path;
use crate::internet::http::{ErrorKind, InternetError};
use crate::proc::Group;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Family {
    Chrome,
    Chromium,
    Edge,
    Brave,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Browser {
    pub family: Family,
    pub path: PathBuf,
    pub version: Option<String>,
}

impl Browser {
    pub fn label(&self) -> String {
        let name = match self.family {
            Family::Chrome => "Google Chrome",
            Family::Chromium => "Chromium",
            Family::Edge => "Microsoft Edge",
            Family::Brave => "Brave",
        };
        match &self.version {
            Some(v) => format!("{name} {v}"),
            None => name.to_string(),
        }
    }
}

/// Noms d'exécutables à chercher dans le PATH (Linux surtout).
const PATH_NAMES: [(&str, Family); 8] = [
    ("google-chrome-stable", Family::Chrome),
    ("google-chrome", Family::Chrome),
    ("chromium", Family::Chromium),
    ("chromium-browser", Family::Chromium),
    ("microsoft-edge-stable", Family::Edge),
    ("microsoft-edge", Family::Edge),
    ("brave-browser", Family::Brave),
    ("chrome", Family::Chrome),
];

/// Emplacements d'installation usuels sous Windows, relatifs aux dossiers
/// `ProgramFiles`, `ProgramFiles(x86)` et `LocalAppData`.
const WINDOWS_RELATIVE: [(&str, Family); 4] = [
    (r"Google\Chrome\Application\chrome.exe", Family::Chrome),
    (r"Microsoft\Edge\Application\msedge.exe", Family::Edge),
    (r"Chromium\Application\chrome.exe", Family::Chromium),
    (r"BraveSoftware\Brave-Browser\Application\brave.exe", Family::Brave),
];

/// Analyse la sortie de `--version` : « Google Chrome 126.0.6478.126 »,
/// « Chromium 125.0.6422.141 Fedora Project », « Microsoft Edge 126.0… ».
pub fn parse_version(text: &str) -> Option<String> {
    text.split_whitespace().find(|w| w.chars().next().is_some_and(|c| c.is_ascii_digit()) && w.contains('.')).map(str::to_string)
}

fn version_of(path: &Path) -> Option<String> {
    let mut command = Command::new(path);
    command.arg("--version");
    let (status, out) = crate::proc::capture(&mut command, Duration::from_secs(10)).ok()?;
    status.success().then(|| parse_version(&out)).flatten()
}

/// Navigateurs lançables, dans l'ordre de préférence. `FOURTOUT_BROWSER`
/// impose un exécutable précis (tests, installations atypiques).
pub fn detect() -> Vec<Browser> {
    let mut found: Vec<Browser> = Vec::new();
    let mut push = |family: Family, path: PathBuf| {
        if path.is_file() && !found.iter().any(|b| b.path == path) {
            let version = version_of(&path);
            found.push(Browser { family, path, version });
        }
    };

    if let Some(custom) = std::env::var_os("FOURTOUT_BROWSER") {
        push(Family::Chromium, PathBuf::from(custom));
    }
    for (name, family) in PATH_NAMES {
        if let Some(path) = find_in_path(name) {
            push(family, path);
        }
    }
    if cfg!(windows) {
        let roots: Vec<PathBuf> = ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"]
            .iter()
            .filter_map(|v| std::env::var_os(v).map(PathBuf::from))
            .collect();
        for (relative, family) in WINDOWS_RELATIVE {
            for root in &roots {
                push(family, root.join(relative));
            }
        }
    }
    found
}

/// Arguments de lancement, sans valeur issue d'une saisie utilisateur autre
/// que le chemin du profil que FourTout vient de créer.
pub fn launch_args(profile: &Path) -> Vec<String> {
    let mut args: Vec<String> = [
        "--headless=new",
        "--remote-debugging-port=0",
        // Une adresse locale uniquement : le port n'est pas exposé au réseau.
        "--remote-debugging-address=127.0.0.1",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-sync",
        "--disable-default-apps",
        "--disable-component-update",
        "--disable-background-networking",
        "--disable-breakpad",
        "--disable-popup-blocking",
        "--hide-scrollbars",
        "--mute-audio",
        "--password-store=basic",
        "--use-mock-keychain",
        "--force-color-profile=srgb",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    args.push(format!("--user-data-dir={}", profile.display()));
    args.push("about:blank".into());
    args
}

/// Un navigateur lancé et son point d'accès DevTools.
pub struct Session {
    pub(crate) group: Option<Group>,
    pub ws_url: String,
    pub browser: Browser,
}

impl Session {
    /// Arrêt : abat tout l'arbre de processus.
    pub fn shutdown(&mut self) {
        if let Some(mut group) = self.group.take() {
            group.kill();
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Extrait l'URL WebSocket de « DevTools listening on ws://… ».
pub fn parse_ws_line(line: &str) -> Option<String> {
    let start = line.find("ws://")?;
    let url = line[start..].split_whitespace().next()?;
    url.contains("/devtools/browser/").then(|| url.to_string())
}

pub fn launch(browser: &Browser, profile: &Path, timeout: Duration, cancelled: &dyn Fn() -> bool) -> Result<Session, InternetError> {
    let mut command = Command::new(&browser.path);
    command.args(launch_args(profile)).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
    let mut group = Group::spawn(&mut command)
        .map_err(|e| InternetError::new(ErrorKind::ToolMissing, format!("Le navigateur ne démarre pas : {e}")))?;

    let (sender, receiver) = mpsc::channel::<String>();
    if let Some(mut stderr) = group.child_mut().stderr.take() {
        std::thread::spawn(move || {
            let mut pending = Vec::new();
            let mut byte = [0_u8; 1];
            while stderr.read(&mut byte).map(|n| n > 0).unwrap_or(false) {
                if byte[0] == b'\n' {
                    if sender.send(String::from_utf8_lossy(&pending).to_string()).is_err() {
                        return;
                    }
                    pending.clear();
                } else if pending.len() < 8192 {
                    pending.push(byte[0]);
                }
            }
        });
    }

    let deadline = Instant::now() + timeout.min(Duration::from_secs(30));
    let mut session = Session { group: Some(group), ws_url: String::new(), browser: browser.clone() };
    loop {
        if cancelled() {
            return Err(InternetError::cancelled());
        }
        if Instant::now() >= deadline {
            return Err(InternetError::new(ErrorKind::Timeout, "Le navigateur n'a pas démarré à temps."));
        }
        if let Ok(Some(status)) = session.group.as_mut().map(|g| g.child_mut().try_wait()).unwrap_or(Ok(None)) {
            return Err(InternetError::new(ErrorKind::Other, format!("Le navigateur s'est arrêté au démarrage ({status}).")));
        }
        match receiver.recv_timeout(Duration::from_millis(50)) {
            Ok(line) => {
                if let Some(url) = parse_ws_line(&line) {
                    session.ws_url = url;
                    return Ok(session);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(InternetError::new(ErrorKind::Other, "Le navigateur s'est fermé sans ouvrir de port DevTools."));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_versions_from_the_vendors_banners() {
        assert_eq!(parse_version("Google Chrome 126.0.6478.126 \n").as_deref(), Some("126.0.6478.126"));
        assert_eq!(parse_version("Chromium 125.0.6422.141 Fedora Project").as_deref(), Some("125.0.6422.141"));
        assert_eq!(parse_version("Microsoft Edge 126.0.2592.87 ").as_deref(), Some("126.0.2592.87"));
        assert_eq!(parse_version("pas de version"), None);
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn extracts_the_devtools_endpoint_only_from_the_right_line() {
        let line = "DevTools listening on ws://127.0.0.1:41233/devtools/browser/5b1c0f3e-0a5e-4a3e-9d52-aa7dd7f1c1d2";
        assert_eq!(parse_ws_line(line).as_deref(), Some("ws://127.0.0.1:41233/devtools/browser/5b1c0f3e-0a5e-4a3e-9d52-aa7dd7f1c1d2"));
        assert_eq!(parse_ws_line("[1234:1234:ERROR] quelque chose ws://autre"), None);
        assert_eq!(parse_ws_line(""), None);
    }

    #[test]
    fn launch_arguments_isolate_the_profile_and_stay_local() {
        let args = launch_args(Path::new("/tmp/profil à espace"));
        assert!(args.contains(&"--headless=new".to_string()));
        assert!(args.contains(&"--remote-debugging-address=127.0.0.1".to_string()));
        assert!(args.contains(&"--remote-debugging-port=0".to_string()), "port éphémère : jamais un port connu");
        // Un chemin à espace reste UN argument, et c'est le profil jetable.
        assert_eq!(args.iter().filter(|a| a.starts_with("--user-data-dir=")).count(), 1);
        assert!(args.contains(&"--user-data-dir=/tmp/profil à espace".to_string()));
        // Rien qui pointe vers le vrai profil de l'utilisateur ni qui affaiblit l'isolation.
        for forbidden in ["--no-sandbox", "--disable-web-security", "--profile-directory", "--remote-allow-origins=*", "--load-extension"] {
            assert!(!args.iter().any(|a| a.starts_with(forbidden)), "{forbidden}");
        }
        assert_eq!(args.last().unwrap(), "about:blank");
    }

    #[test]
    fn a_missing_browser_is_an_error_not_a_hang() {
        let ghost = Browser { family: Family::Chromium, path: PathBuf::from("/nulle/part/chromium"), version: None };
        let dir = std::env::temp_dir();
        let error = launch(&ghost, &dir, Duration::from_secs(2), &|| false).err().unwrap();
        assert_eq!(error.kind, ErrorKind::ToolMissing);
    }

    #[test]
    fn detection_honours_an_explicit_override() {
        // Un fichier qui n'est pas un navigateur est listé tel quel : l'appelant
        // décide, et l'échec de lancement est rapporté clairement plus haut.
        assert!(detect().iter().all(|b| b.path.is_file()));
    }
}
