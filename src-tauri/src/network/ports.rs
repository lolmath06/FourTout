//! Test de ports TCP sur **un** hôte choisi par l'utilisateur.
//!
//! L'outil répond à une question de diagnostic : « ce service écoute-t-il ? ».
//! Il n'est pas un scanner, et plusieurs choix le maintiennent de ce côté de la
//! ligne :
//!
//! - **Un seul hôte** à la fois, explicitement saisi.
//! - **256 ports au maximum** par lancement. Une demande de `1-65535` est
//!   refusée avec un message qui explique comment la réduire.
//! - **Une connexion TCP ordinaire** (`connect`), celle que ferait n'importe
//!   quel client. Ni SYN furtif, ni fragmentation, ni évasion : ces techniques
//!   n'existent que pour ne pas apparaître dans les journaux de la machine
//!   d'en face, ce qui n'a aucun rapport avec un diagnostic sur son propre
//!   réseau.
//! - **Seize connexions simultanées** au plus, et un délai d'attente borné.
//!
//! Le port est fermé immédiatement après l'établissement : aucune donnée n'est
//! envoyée, aucune bannière n'est lue. Un numéro de port ne permet d'ailleurs
//! pas d'affirmer quel service tourne derrière — d'où le libellé « service
//! habituellement associé », et jamais « service détecté ».

use std::net::{IpAddr, SocketAddr, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;

use super::ping::resolve;

/// Plafond de ports testés en un lancement.
pub const MAX_PORTS: usize = 256;
/// Connexions ouvertes en parallèle.
pub const MAX_CONCURRENCY: usize = 16;
pub const DEFAULT_TIMEOUT_MS: u64 = 1_000;
pub const MIN_TIMEOUT_MS: u64 = 100;
pub const MAX_TIMEOUT_MS: u64 = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PortStatus {
    /// La connexion a abouti : quelque chose écoute.
    Open,
    /// La machine a refusé la connexion : rien n'écoute sur ce port.
    Closed,
    /// Aucune réponse avant le délai : port filtré, ou hôte injoignable.
    Filtered,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortResult {
    pub port: u16,
    pub status: PortStatus,
    /// Durée de la tentative, en millisecondes.
    pub elapsed_ms: f64,
    /// Service **habituellement** associé à ce numéro. Jamais une détection.
    pub usual_service: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortScanSummary {
    pub host: String,
    pub resolved: String,
    pub tested: usize,
    pub open: usize,
    pub closed: usize,
    pub filtered: usize,
    pub results: Vec<PortResult>,
    /// Vrai si l'utilisateur a interrompu avant la fin.
    pub cancelled: bool,
}

/// Correspondances les plus courantes. Volontairement courte : elle sert à
/// reconnaître un port, pas à prétendre identifier un service.
const USUAL_SERVICES: &[(u16, &str)] = &[
    (20, "FTP (données)"),
    (21, "FTP"),
    (22, "SSH"),
    (23, "Telnet"),
    (25, "SMTP"),
    (53, "DNS"),
    (67, "DHCP"),
    (80, "HTTP"),
    (110, "POP3"),
    (123, "NTP"),
    (139, "NetBIOS"),
    (143, "IMAP"),
    (443, "HTTPS"),
    (445, "SMB (partage Windows)"),
    (465, "SMTP (TLS)"),
    (587, "SMTP (soumission)"),
    (631, "IPP (impression)"),
    (993, "IMAPS"),
    (995, "POP3S"),
    (1433, "SQL Server"),
    (1883, "MQTT"),
    (3000, "serveur de développement"),
    (3306, "MySQL / MariaDB"),
    (3389, "Bureau à distance"),
    (5000, "serveur de développement"),
    (5173, "Vite"),
    (5432, "PostgreSQL"),
    (5900, "VNC"),
    (6379, "Redis"),
    (8000, "HTTP alternatif"),
    (8080, "HTTP alternatif"),
    (8443, "HTTPS alternatif"),
    (9000, "HTTP alternatif"),
    (27017, "MongoDB"),
];

pub fn usual_service(port: u16) -> Option<String> {
    USUAL_SERVICES
        .iter()
        .find(|(number, _)| *number == port)
        .map(|(_, name)| (*name).to_string())
}

/// Phrase affichée à côté de la colonne des services.
pub const SERVICE_DISCLAIMER: &str =
    "« Service habituellement associé » vient d'une table de numéros, pas d'une détection : \
     n'importe quel logiciel peut écouter sur n'importe quel port.";

/// Lit une liste de ports : `22, 80, 443, 8000-8010`.
pub fn parse_ports(spec: &str) -> Result<Vec<u16>, String> {
    let mut ports: Vec<u16> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for chunk in spec.split([',', ';', ' ', '\n', '\t']).filter(|part| !part.trim().is_empty()) {
        let piece = chunk.trim();
        let (start, end) = match piece.split_once('-') {
            Some((left, right)) => (parse_port(left)?, parse_port(right)?),
            None => {
                let single = parse_port(piece)?;
                (single, single)
            }
        };
        if start > end {
            return Err(format!("Plage inversée : « {piece} ». Écrivez {end}-{start}."));
        }
        let width = usize::from(end - start) + 1;
        if width > MAX_PORTS {
            return Err(format!(
                "La plage « {piece} » contient {width} ports. FourTout en teste {MAX_PORTS} au \
                 maximum par lancement : c'est un outil de diagnostic, pas un scanner. Réduisez \
                 la plage, ou lancez plusieurs tests successifs."
            ));
        }
        for port in start..=end {
            if seen.insert(port) {
                ports.push(port);
            }
        }
    }

    if ports.is_empty() {
        return Err("Indiquez au moins un port, par exemple « 22, 80, 443 ».".to_string());
    }
    if ports.len() > MAX_PORTS {
        return Err(format!(
            "{} ports demandés. FourTout en teste {MAX_PORTS} au maximum par lancement : \
             réduisez la liste.",
            ports.len()
        ));
    }
    Ok(ports)
}

fn parse_port(text: &str) -> Result<u16, String> {
    let cleaned = text.trim();
    let value: u32 = cleaned
        .parse()
        .map_err(|_| format!("« {cleaned} » n'est pas un numéro de port."))?;
    if value == 0 || value > 65535 {
        return Err(format!("Port hors limites : {value}. Les ports vont de 1 à 65535."));
    }
    Ok(value as u16)
}

/// Teste un port unique par une connexion TCP ordinaire.
pub fn probe_port(address: IpAddr, port: u16, timeout: Duration) -> PortResult {
    let target = SocketAddr::new(address, port);
    let started = Instant::now();
    let status = match TcpStream::connect_timeout(&target, timeout) {
        Ok(stream) => {
            // Rien n'est lu ni écrit : la connexion est refermée aussitôt.
            let _ = stream.shutdown(std::net::Shutdown::Both);
            PortStatus::Open
        }
        Err(error) => match error.kind() {
            std::io::ErrorKind::TimedOut => PortStatus::Filtered,
            std::io::ErrorKind::ConnectionRefused => PortStatus::Closed,
            _ => {
                // `connect_timeout` rend parfois `WouldBlock` au lieu de
                // `TimedOut` : on tranche sur le temps écoulé.
                if started.elapsed() >= timeout {
                    PortStatus::Filtered
                } else {
                    PortStatus::Closed
                }
            }
        },
    };
    PortResult {
        port,
        status,
        elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
        usual_service: usual_service(port),
    }
}

/// Teste une liste de ports, avec parallélisme borné, progression et annulation.
pub fn scan(
    host: &str,
    ports: &[u16],
    timeout_ms: u64,
    cancelled: Arc<dyn Fn() -> bool + Send + Sync>,
    progress: &dyn Fn(usize, usize),
) -> Result<PortScanSummary, String> {
    if ports.len() > MAX_PORTS {
        return Err(format!("{MAX_PORTS} ports au maximum par lancement."));
    }
    let address = resolve(host)?;
    let timeout = Duration::from_millis(timeout_ms.clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS));

    let total = ports.len();
    let next = Arc::new(AtomicUsize::new(0));
    let done = Arc::new(AtomicUsize::new(0));
    let results: Arc<std::sync::Mutex<Vec<PortResult>>> =
        Arc::new(std::sync::Mutex::new(Vec::with_capacity(total)));

    let workers = MAX_CONCURRENCY.min(total.max(1));
    std::thread::scope(|scope| {
        for _ in 0..workers {
            let next = Arc::clone(&next);
            let done = Arc::clone(&done);
            let results = Arc::clone(&results);
            let cancelled = Arc::clone(&cancelled);
            scope.spawn(move || loop {
                if cancelled() {
                    break;
                }
                let index = next.fetch_add(1, Ordering::SeqCst);
                let Some(port) = ports.get(index) else { break };
                let result = probe_port(address, *port, timeout);
                results.lock().unwrap().push(result);
                done.fetch_add(1, Ordering::SeqCst);
            });
        }

        // Le fil principal se contente de publier l'avancement : les sondes
        // tournent dans les fils de travail, et l'annulation les arrête avant
        // d'ouvrir une connexion de plus.
        while done.load(Ordering::SeqCst) < total && !cancelled() {
            progress(done.load(Ordering::SeqCst), total);
            std::thread::sleep(Duration::from_millis(50));
        }
        progress(done.load(Ordering::SeqCst), total);
    });

    let mut results = Arc::try_unwrap(results)
        .map_err(|_| "Résultats inaccessibles.".to_string())?
        .into_inner()
        .map_err(|_| "Résultats inaccessibles.".to_string())?;
    results.sort_by_key(|result| result.port);

    let count = |status: PortStatus| results.iter().filter(|r| r.status == status).count();
    Ok(PortScanSummary {
        host: host.to_string(),
        resolved: address.to_string(),
        tested: results.len(),
        open: count(PortStatus::Open),
        closed: count(PortStatus::Closed),
        filtered: count(PortStatus::Filtered),
        cancelled: cancelled(),
        results,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::sync::atomic::AtomicBool;

    fn never_cancelled() -> Arc<dyn Fn() -> bool + Send + Sync> {
        Arc::new(|| false)
    }

    #[test]
    fn reads_lists_and_ranges() {
        assert_eq!(parse_ports("22").unwrap(), vec![22]);
        assert_eq!(parse_ports("22, 80,443").unwrap(), vec![22, 80, 443]);
        assert_eq!(parse_ports("8000-8003").unwrap(), vec![8000, 8001, 8002, 8003]);
        assert_eq!(parse_ports("80 80 80").unwrap(), vec![80]);
    }

    #[test]
    fn refuses_the_whole_port_space() {
        let error = parse_ports("1-65535").unwrap_err();
        assert!(error.contains("256"), "message obtenu : {error}");
        assert!(error.contains("diagnostic"));
    }

    #[test]
    fn refuses_nonsense() {
        assert!(parse_ports("").unwrap_err().contains("au moins un port"));
        assert!(parse_ports("0").unwrap_err().contains("hors limites"));
        assert!(parse_ports("70000").unwrap_err().contains("hors limites"));
        assert!(parse_ports("abc").unwrap_err().contains("n'est pas un numéro"));
        assert!(parse_ports("90-80").unwrap_err().contains("inversée"));
    }

    #[test]
    fn refuses_an_aggregate_above_the_ceiling() {
        // Deux plages licites isolément, trop larges ensemble.
        assert!(parse_ports("1000-1200,2000-2200").unwrap_err().contains("réduisez"));
    }

    #[test]
    fn names_only_well_known_ports() {
        assert_eq!(usual_service(443).as_deref(), Some("HTTPS"));
        assert_eq!(usual_service(44444), None);
    }

    /// Banc d'essai local : un vrai serveur TCP sur un port attribué par le
    /// système, et un port dont on sait qu'il vient d'être libéré.
    #[test]
    fn finds_an_open_port_and_a_closed_one() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let open_port = listener.local_addr().unwrap().port();

        // Un second socket, refermé aussitôt : son port n'écoute plus.
        let closed_port = {
            let temporary = TcpListener::bind("127.0.0.1:0").unwrap();
            temporary.local_addr().unwrap().port()
        };

        let summary = scan(
            "127.0.0.1",
            &[open_port, closed_port],
            500,
            never_cancelled(),
            &|_, _| {},
        )
        .unwrap();

        assert_eq!(summary.tested, 2);
        let open = summary.results.iter().find(|r| r.port == open_port).unwrap();
        assert_eq!(open.status, PortStatus::Open);
        let closed = summary.results.iter().find(|r| r.port == closed_port).unwrap();
        assert_eq!(closed.status, PortStatus::Closed, "port {closed_port}");

        drop(listener);
    }

    #[test]
    fn reports_progress_for_every_port() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen = std::sync::Mutex::new(Vec::new());
        let summary = scan("127.0.0.1", &[port], 500, never_cancelled(), &|done, total| {
            seen.lock().unwrap().push((done, total));
        })
        .unwrap();
        assert_eq!(summary.tested, 1);
        let seen = seen.lock().unwrap();
        assert!(seen.iter().any(|(done, total)| *done == 1 && *total == 1));
    }

    #[test]
    fn cancellation_stops_before_opening_more_connections() {
        let flag = Arc::new(AtomicBool::new(true));
        let cancelled: Arc<dyn Fn() -> bool + Send + Sync> = {
            let flag = Arc::clone(&flag);
            Arc::new(move || flag.load(Ordering::SeqCst))
        };
        // Déjà annulé : aucune sonde ne doit partir.
        let summary =
            scan("127.0.0.1", &[1, 2, 3, 4, 5], 500, cancelled, &|_, _| {}).unwrap();
        assert_eq!(summary.tested, 0);
        assert!(summary.cancelled);
    }

    #[test]
    fn refuses_an_unresolvable_host() {
        let error = scan(
            "hôte-qui-n-existe-pas.invalid",
            &[80],
            300,
            never_cancelled(),
            &|_, _| {},
        )
        .unwrap_err();
        assert!(error.contains("introuvable"), "message obtenu : {error}");
    }
}
