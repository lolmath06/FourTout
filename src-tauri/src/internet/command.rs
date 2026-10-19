//! Commandes Tauri des outils Internet.
//!
//! La progression et l'annulation passent par les mêmes canaux que le socle
//! « Fichiers » (`files://progress`, `files_cancel`) : un seul mécanisme
//! d'interruption pour toute opération longue.

use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;
use tauri::AppHandle;

use super::download::{self, DownloadParams, DownloadSummary, Probe};
use super::{shorten, speedtest};
use super::http::{ClientOptions, InternetError};
use crate::files::{FilesState, Reporter};

/// Exécute `body` avec un rapporteur enregistré, et le libère dans tous les cas.
pub fn with_reporter<T>(
    app: AppHandle,
    state: &tauri::State<'_, FilesState>,
    job_id: &str,
    body: impl FnOnce(&Reporter) -> Result<T, InternetError>,
) -> Result<T, InternetError> {
    let cancel = state.register(job_id);
    let reporter = Reporter::new(app, job_id.to_string(), cancel);
    let result = body(&reporter);
    state.release(job_id);
    result
}

fn options(timeout_secs: Option<u64>) -> ClientOptions {
    let read = Duration::from_secs(timeout_secs.unwrap_or(30).clamp(3, 300));
    ClientOptions { read_timeout: read, ..ClientOptions::default() }
}

/// Inspecte une adresse (type, taille, nom, reprise) sans rien télécharger.
#[tauri::command(async)]
pub fn internet_probe(url: String, timeout_secs: Option<u64>) -> Result<Probe, InternetError> {
    download::probe(&url, &options(timeout_secs))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadArgs {
    pub job_id: String,
    pub url: String,
    pub destination: String,
    pub overwrite: bool,
    pub resume: bool,
    pub expected_sha256: Option<String>,
    pub timeout_secs: Option<u64>,
}

/// Télécharge une ressource HTTP(S) vers un fichier choisi par l'utilisateur.
#[tauri::command(async)]
pub fn internet_download(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    params: DownloadArgs,
) -> Result<DownloadSummary, InternetError> {
    with_reporter(app, &state, &params.job_id.clone(), |reporter| {
        download::download(
            &DownloadParams {
                url: params.url.clone(),
                destination: PathBuf::from(&params.destination),
                overwrite: params.overwrite,
                resume: params.resume,
                expected_sha256: params.expected_sha256.clone().filter(|s| !s.trim().is_empty()),
                options: options(params.timeout_secs),
            },
            reporter,
        )
    })
}

/* --------------------------------------------------------------- débit */

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeedProgress {
    job_id: String,
    phase: speedtest::Phase,
    /// Débit courant en Mb/s (0 pendant la mesure de latence).
    mbps: f64,
    ratio: f64,
}

/// Mesure latence, gigue, débit descendant et montant auprès du service public
/// de mesure. Le trafic est généré : aucun fichier de l'utilisateur n'est envoyé.
#[tauri::command(async)]
pub fn internet_speedtest(
    app: AppHandle,
    state: tauri::State<'_, FilesState>,
    job_id: String,
) -> Result<speedtest::SpeedResult, InternetError> {
    use tauri::Emitter;
    let emitter = app.clone();
    let id = job_id.clone();
    with_reporter(app, &state, &job_id, |reporter| {
        speedtest::run(&speedtest::Plan::default(), reporter, &move |phase, mbps, ratio| {
            let _ = emitter.emit("internet://speed", SpeedProgress { job_id: id.clone(), phase, mbps, ratio });
        })
    })
}

/* -------------------------------------------------------- raccourcisseur */

/// Raccourcit une adresse auprès du service choisi. L'adresse d'origine est
/// envoyée à ce service ; elle n'est ni conservée ni journalisée ici.
#[tauri::command(async)]
pub fn internet_shorten(
    url: String,
    provider: shorten::Provider,
    timeout_secs: Option<u64>,
) -> Result<shorten::Shortened, InternetError> {
    shorten::shorten(&url, provider, None, Duration::from_secs(timeout_secs.unwrap_or(15).clamp(3, 60)))
}
