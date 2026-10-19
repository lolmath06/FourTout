//! Capture de pages web : PDF, image pleine page, instantané MHTML.
//!
//! FourTout n'embarque pas de navigateur. Il pilote un navigateur
//! **Chromium déjà installé** (Chrome, Chromium, Edge) en mode sans fenêtre,
//! par le protocole DevTools, avec :
//!
//! * un **profil temporaire vierge** : ni cookies, ni historique, ni sessions
//!   de l'utilisateur — la page est vue comme par un visiteur anonyme ;
//! * une adresse `http`/`https` uniquement ;
//! * un délai, une annulation qui tue tout l'arbre de processus, et la
//!   suppression du profil quoi qu'il arrive.

pub mod browser;
pub mod cdp;
pub mod command;

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::internet::http::{parse_url, ErrorKind, InternetError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ImageFormat {
    Png,
    Jpeg,
    Webp,
}

impl ImageFormat {
    pub fn cdp_name(self) -> &'static str {
        match self {
            ImageFormat::Png => "png",
            ImageFormat::Jpeg => "jpeg",
            ImageFormat::Webp => "webp",
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            ImageFormat::Png => "png",
            ImageFormat::Jpeg => "jpg",
            ImageFormat::Webp => "webp",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOptions {
    /// Dimensions du papier en pouces (A4 = 8,27 × 11,69).
    pub paper_width: f64,
    pub paper_height: f64,
    pub landscape: bool,
    /// Marges en millimètres.
    pub margin_mm: f64,
    pub background: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageOptions {
    pub format: ImageFormat,
    pub quality: u32,
    pub viewport_width: u32,
    pub viewport_height: u32,
    pub full_page: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Capture {
    Pdf(PdfOptions),
    Image(ImageOptions),
    Mhtml,
}

impl Capture {
    pub fn extension(&self) -> &'static str {
        match self {
            Capture::Pdf(_) => "pdf",
            Capture::Image(o) => o.format.extension(),
            Capture::Mhtml => "mhtml",
        }
    }

    pub fn validate(&self) -> Result<(), InternetError> {
        let bad = |m: &str| Err(InternetError::new(ErrorKind::Other, m.to_string()));
        match self {
            Capture::Pdf(o) => {
                if !(1.0..=60.0).contains(&o.paper_width) || !(1.0..=60.0).contains(&o.paper_height) {
                    return bad("Dimensions de papier invalides.");
                }
                if !(0.0..=100.0).contains(&o.margin_mm) {
                    return bad("Marges invalides.");
                }
            }
            Capture::Image(o) => {
                if !(200..=7680).contains(&o.viewport_width) || !(200..=4320).contains(&o.viewport_height) {
                    return bad("Dimensions de fenêtre invalides.");
                }
            }
            Capture::Mhtml => {}
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSummary {
    pub path: String,
    pub bytes: u64,
    pub browser: String,
    pub final_url: String,
    /// Code HTTP de la page principale, quand le navigateur l'a rapporté.
    pub http_status: Option<u16>,
    /// Dimensions de l'image produite (images seulement).
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// Profil temporaire, supprimé à la destruction.
pub struct TempProfile(pub PathBuf);

impl TempProfile {
    pub fn create() -> std::io::Result<Self> {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("fourtout-web-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&dir)?;
        Ok(TempProfile(dir))
    }
}

impl Drop for TempProfile {
    fn drop(&mut self) {
        // Chromium peut mettre un instant à relâcher ses fichiers (Windows).
        for _ in 0..10 {
            if fs::remove_dir_all(&self.0).is_ok() || !self.0.exists() {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

/// Capture `url` avec le navigateur donné et écrit le résultat dans `output`
/// (fichier provisoire puis renommage ; refus d'écraser sauf demande).
pub fn run(
    browser: &browser::Browser,
    url: &str,
    capture: &Capture,
    output: &Path,
    overwrite: bool,
    timeout: Duration,
    cancelled: &dyn Fn() -> bool,
) -> Result<CaptureSummary, InternetError> {
    let page = parse_url(url)?;
    capture.validate()?;
    if output.exists() && !overwrite {
        return Err(InternetError::new(ErrorKind::Destination, format!("« {} » existe déjà.", output.display())));
    }
    let parent = output.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err(InternetError::new(ErrorKind::Destination, "Dossier de destination introuvable."));
    }

    let profile = TempProfile::create().map_err(|e| InternetError::new(ErrorKind::Destination, format!("Profil temporaire impossible : {e}")))?;
    let mut session = browser::launch(browser, &profile.0, timeout, cancelled)?;
    let result = cdp::capture(&mut session, page.as_str(), capture, timeout, cancelled);
    session.shutdown();
    let captured = result?;

    let mut part = output.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    part.push(".fourtout-part");
    let part = output.with_file_name(part);
    fs::write(&part, &captured.bytes).map_err(|e| {
        let _ = fs::remove_file(&part);
        InternetError::new(ErrorKind::Write, format!("Écriture impossible (disque plein ?) : {e}"))
    })?;
    if output.exists() {
        fs::remove_file(output).map_err(|e| InternetError::new(ErrorKind::Destination, format!("Remplacement impossible : {e}")))?;
    }
    fs::rename(&part, output).map_err(|e| {
        let _ = fs::remove_file(&part);
        InternetError::new(ErrorKind::Destination, format!("Finalisation impossible : {e}"))
    })?;
    Ok(CaptureSummary {
        path: output.to_string_lossy().to_string(),
        bytes: captured.bytes.len() as u64,
        browser: browser.label(),
        final_url: captured.final_url,
        http_status: captured.http_status,
        width: captured.width,
        height: captured.height,
    })
}
