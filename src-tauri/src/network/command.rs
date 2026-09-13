//! Commandes Tauri des sondes réseau.
//!
//! Chaque sonde longue reçoit un identifiant de travail : c'est lui qui permet
//! à l'interface de suivre l'avancement et, surtout, d'arrêter réellement les
//! sondes en cours plutôt que d'ignorer leur résultat.

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
pub fn network_ping(
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
    let cancelled = {
        let flag = Arc::clone(&flag);
        move || flag.load(Ordering::SeqCst)
    };

    report(&app, &job_id, 0, options.count as usize, "Envoi des paquets…");
    let result = ping::ping(&host, options, &cancelled);
    state.release(&job_id);
    result
}

/// Test d'une liste de ports sur un hôte.
#[tauri::command]
pub fn network_check_ports(
    app: AppHandle,
    state: State<'_, NetworkState>,
    job_id: String,
    host: String,
    ports_spec: String,
    timeout_ms: Option<u64>,
) -> Result<PortScanSummary, String> {
    let list = ports::parse_ports(&ports_spec)?;
    let flag = state.register(&job_id);
    let cancelled: Arc<dyn Fn() -> bool + Send + Sync> = {
        let flag = Arc::clone(&flag);
        Arc::new(move || flag.load(Ordering::SeqCst))
    };

    let result = ports::scan(
        &host,
        &list,
        timeout_ms.unwrap_or(ports::DEFAULT_TIMEOUT_MS),
        cancelled,
        &|done, total| report(&app, &job_id, done, total, "Test des ports…"),
    );
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
pub fn network_lan_discover(
    app: AppHandle,
    state: State<'_, NetworkState>,
    job_id: String,
    name: String,
    address: String,
    netmask: String,
) -> Result<DiscoveryResult, String> {
    let plan = lan::plan(&interface_from(name, address, netmask)?)?;
    let flag = state.register(&job_id);
    let cancelled = {
        let flag = Arc::clone(&flag);
        move || flag.load(Ordering::SeqCst)
    };

    let probe = SystemProbe::new();
    let result = lan::discover(&plan, &probe, &cancelled, &|done, total| {
        report(&app, &job_id, done, total, "Examen des adresses…")
    });
    state.release(&job_id);
    result
}

/// Rappel du nombre d'appareils observés, pour les tests d'interface.
pub fn device_count(result: &DiscoveryResult) -> usize {
    result.devices.len()
}

/// Réexport pour les tests d'intégration.
pub type ObservedDevice = Device;
