//! Commandes Tauri des sondes réseau.
//!
//! Chaque sonde longue reçoit un identifiant de travail : c'est lui qui permet
//! à l'interface de suivre l'avancement et, surtout, d'arrêter réellement les
//! sondes en cours plutôt que d'ignorer leur résultat.
//!
//! # Pourquoi ces commandes sont `async`
//!
//! Une commande Tauri déclarée `pub fn` est exécutée **en ligne, sur le fil qui
//! traite le message IPC** — c'est-à-dire, sous Linux, la boucle d'événements
//! GTK. Tant qu'elle n'a pas rendu la main, la WebView ne repeint plus, la
//! fenêtre ne se déplace plus, et le gestionnaire de bureau finit par afficher
//! « l'application ne répond pas ». Une découverte de 254 adresses met
//! plusieurs secondes : elle gelait donc l'interface du début à la fin.
//!
//! Les trois sondes longues sont donc déclarées `pub async fn`, et leur travail
//! bloquant part dans `tauri::async_runtime::spawn_blocking`. Deux conséquences
//! voulues :
//!
//! - le fil d'interface reste libre, donc les événements `network://progress`
//!   émis par les fils de travail arrivent réellement jusqu'à React, et
//!   `network_cancel` est traité immédiatement ;
//! - le travail bloquant occupe le vivier de fils prévu pour cela, et non un
//!   fil d'exécution asynchrone, qu'il affamerait.
//!
//! `network_cancel`, `network_parse_ports`, `network_interfaces` et
//! `network_lan_plan` restent synchrones : ils sont immédiats, et l'annulation
//! doit justement être traitée sans attendre son tour.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, State};

use super::lan::{self, Device, DiscoveryPlan, DiscoveryResult, Interface, SystemProbe};
use super::ping::{self, PingOptions, PingSummary};
use super::ports::{self, PortScanSummary};
use super::{report, NetworkState};

/// Interrompt une sonde en cours.
#[tauri::command]
pub fn network_cancel(state: State<'_, NetworkState>, job_id: String) {
    state.cancel(&job_id);
}

/// Ping ICMP d'un hôte.
#[tauri::command]
pub async fn network_ping(
    app: AppHandle,
    state: State<'_, NetworkState>,
    job_id: String,
    host: String,
    count: Option<u32>,
    timeout_ms: Option<u64>,
) -> Result<PingSummary, String> {
    let flag = state.register(&job_id);
    let options = PingOptions {
        count: count.unwrap_or(ping::DEFAULT_PACKETS),
        timeout_ms: timeout_ms.unwrap_or(ping::DEFAULT_TIMEOUT_MS),
    };

    report(&app, &job_id, 0, options.count as usize, "Envoi des paquets…");

    let result = tauri::async_runtime::spawn_blocking(move || {
        let cancelled = move || flag.load(Ordering::SeqCst);
        ping::ping(&host, options, &cancelled)
    })
    .await
    .unwrap_or_else(|error| Err(format!("Ping interrompu : {error}")));

    state.release(&job_id);
    result
}

/// Test d'une liste de ports sur un hôte.
#[tauri::command]
pub async fn network_check_ports(
    app: AppHandle,
    state: State<'_, NetworkState>,
    job_id: String,
    host: String,
    ports_spec: String,
    timeout_ms: Option<u64>,
) -> Result<PortScanSummary, String> {
    // La liste est validée avant d'occuper un fil : une plage trop large doit
    // être refusée tout de suite, pas au terme d'un aller-retour.
    let list = ports::parse_ports(&ports_spec)?;
    let flag = state.register(&job_id);
    let timeout = timeout_ms.unwrap_or(ports::DEFAULT_TIMEOUT_MS);

    let emitter = app.clone();
    let worker_job = job_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let cancelled: Arc<dyn Fn() -> bool + Send + Sync> =
            Arc::new(move || flag.load(Ordering::SeqCst));
        ports::scan(&host, &list, timeout, cancelled, &|done, total| {
            report(&emitter, &worker_job, done, total, "Test des ports…")
        })
    })
    .await
    .unwrap_or_else(|error| Err(format!("Test des ports interrompu : {error}")));

    state.release(&job_id);
    result
}

/// Ports analysables d'après une saisie, sans rien sonder.
///
/// Sert à afficher « 12 ports seront testés » avant le lancement, et à refuser
/// une plage trop large au moment où elle est écrite plutôt qu'au lancement.
#[tauri::command]
pub fn network_parse_ports(spec: String) -> Result<Vec<u16>, String> {
    ports::parse_ports(&spec)
}

/// Interfaces IPv4 de la machine.
#[tauri::command]
pub fn network_interfaces() -> Result<Vec<Interface>, String> {
    lan::interfaces()
}

/// Reconstruit une interface à partir de ce que l'interface graphique en dit.
///
/// La plage à sonder n'est **jamais** reprise telle quelle depuis le frontend :
/// seuls le nom, l'adresse et le masque traversent le pont, et la plage est
/// recalculée ici. Ce qui vient de la WebView ne décide pas de l'étendue d'une
/// sonde réseau.
fn interface_from(name: String, address: String, netmask: String) -> Result<Interface, String> {
    let parsed: std::net::Ipv4Addr = address
        .parse()
        .map_err(|_| format!("Adresse d'interface illisible : {address}."))?;
    let mask: std::net::Ipv4Addr = netmask
        .parse()
        .map_err(|_| format!("Masque de sous-réseau illisible : {netmask}."))?;
    let prefix = super::cidr::prefix_from_mask(mask)?;
    let network = super::cidr::Ipv4Network::new(parsed, prefix)?;
    Ok(Interface {
        name,
        address: parsed.to_string(),
        netmask: mask.to_string(),
        prefix,
        cidr: network.to_string(),
        loopback: parsed.is_loopback(),
    })
}

/// Ce qu'une découverte examinerait, **avant** de l'examiner.
#[tauri::command]
pub fn network_lan_plan(
    name: String,
    address: String,
    netmask: String,
) -> Result<DiscoveryPlan, String> {
    lan::plan(&interface_from(name, address, netmask)?)
}

/// Découverte des appareils du réseau local, dans la plage annoncée.
#[tauri::command]
pub async fn network_lan_discover(
    app: AppHandle,
    state: State<'_, NetworkState>,
    job_id: String,
    name: String,
    address: String,
    netmask: String,
) -> Result<DiscoveryResult, String> {
    // La plage est recalculée ici, avant tout travail : une interface illisible
    // est refusée immédiatement plutôt qu'au bout d'une sonde.
    let plan = lan::plan(&interface_from(name, address, netmask)?)?;
    let flag = state.register(&job_id);

    report(&app, &job_id, 0, plan.range.target_count, "Examen des adresses…");

    let emitter = app.clone();
    let worker_job = job_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let cancelled = move || flag.load(Ordering::SeqCst);
        let probe = SystemProbe::new();
        lan::discover(&plan, &probe, &cancelled, &|done, total| {
            report(&emitter, &worker_job, done, total, "Examen des adresses…")
        })
    })
    .await
    .unwrap_or_else(|error| Err(format!("Découverte interrompue : {error}")));

    state.release(&job_id);
    result
}

/// Rappel du nombre d'appareils observés, pour les tests d'interface.
pub fn device_count(result: &DiscoveryResult) -> usize {
    result.devices.len()
}

/// Réexport pour les tests d'intégration.
pub type ObservedDevice = Device;
