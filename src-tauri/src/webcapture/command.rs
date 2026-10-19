//! Commandes Tauri de la capture web.

use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;
use tauri::AppHandle;

use super::{browser, Capture, CaptureSummary};
use crate::files::FilesState;
use crate::internet::command::with_reporter;
use crate::internet::http::{ErrorKind, InternetError};

/// Navigateurs Chromium détectés sur cette machine.
#[tauri::command(async)]
pub fn web_browsers() -> Vec<browser::Browser> {
    browser::detect()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureArgs {
    pub job_id: String,
    pub url: String,
    pub capture: Capture,
    pub output: String,
    pub overwrite: bool,
    /// Chemin du navigateur choisi ; sinon le premier détecté.
    pub browser_path: Option<String>,
    pub timeout_secs: Option<u64>,
}

#[tauri::command(async)]
pub fn web_capture(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    params: CaptureArgs,
) -> Result<CaptureSummary, InternetError> {
    let detected = browser::detect();
    let chosen = match &params.browser_path {
        // Seul un navigateur que la détection a trouvé peut être lancé : le
        // frontend ne peut pas désigner un exécutable arbitraire.
        Some(path) => detected.into_iter().find(|b| b.path == PathBuf::from(path)),
        None => detected.into_iter().next(),
    }
    .ok_or_else(|| {
        InternetError::new(ErrorKind::ToolMissing, "Aucun navigateur Chromium (Chrome, Chromium ou Edge) n'est installé.")
    })?;
    let timeout = Duration::from_secs(params.timeout_secs.unwrap_or(60).clamp(10, 300));
    with_reporter(app, &state, &params.job_id.clone(), |reporter| {
        super::run(
            &chosen,
            &params.url,
            &params.capture,
            &PathBuf::from(&params.output),
            params.overwrite,
            timeout,
            &|| reporter.cancelled(),
        )
    })
}
