//! Découverte des appareils du réseau **local**.
//!
//! Le mot important est « local ». L'outil n'explore que le sous-réseau
//! directement connecté à une interface de la machine, borné à 256 adresses
//! (voir `cidr`), et uniquement sur demande explicite : rien ne part au
//! chargement de l'écran.
//!
//! Trois sources de renseignement, de la moins intrusive à la plus bavarde :
//!
//! 1. **La table de voisinage** (ARP sous Linux, `GetIpNetTable` sous Windows).
//!    Elle est déjà là : le système l'a remplie au fil des échanges. La lire
//!    n'envoie pas un seul paquet.
//! 2. **Un écho ICMP** par adresse, un seul, avec un délai court.
//! 3. **Une résolution inverse** du nom, quand le système sait la faire.
//!
//! Aucune reconnaissance de service, aucune empreinte de système
//! d'exploitation, aucune interrogation d'une base de fabricants sur Internet :
//! ce sont des techniques de reconnaissance offensive, et elles n'ont rien à
//! faire dans un utilitaire de bureau.
//!
//! Le résultat s'annonce pour ce qu'il est : **les appareils observés**. Un
//! équipement qui ignore les pings et n'a parlé à personne récemment reste
//! invisible, et prétendre lister « tous les appareils du réseau » serait faux.

use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;

use super::cidr::{bounded_range, prefix_from_mask, targets, ScanRange};

/// Une interface réseau de la machine, avec son adresse IPv4.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Interface {
    pub name: String,
    pub address: String,
    pub netmask: String,
    pub prefix: u8,
    pub cidr: String,
    pub loopback: bool,
}

/// Ce qui sera fait, annoncé **avant** de le faire.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryPlan {
    pub interface: Interface,
    pub range: ScanRange,
    /// Phrase de confirmation affichée à l'utilisateur.
    pub summary: String,
}

/// Un appareil **observé**, avec les seuls renseignements réellement obtenus.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub address: String,
    /// Nom résolu, quand le système a su le donner.
    pub hostname: Option<String>,
    /// Adresse matérielle, quand la table de voisinage la connaît.
    pub mac: Option<String>,
    /// Latence de l'écho ICMP, en millisecondes.
    pub latency_ms: Option<f64>,
    /// Comment cet appareil s'est manifesté.
    pub evidence: Vec<String>,
    /// Vrai s'il s'agit de l'adresse de la machine elle-même.
    pub is_self: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryResult {
    pub range: ScanRange,
    pub examined: usize,
    pub devices: Vec<Device>,
    pub cancelled: bool,
    /// Méthodes réellement employées pendant cette découverte.
    pub methods: Vec<String>,
    /// Avertissement sur l'exhaustivité, toujours présent.
    pub note: String,
}

pub const HONESTY_NOTE: &str =
    "Ces appareils sont ceux qui se sont manifestés : un équipement qui ignore les pings et \
     n'a échangé avec personne récemment n'apparaît pas. Cette liste n'est donc pas « tous les \
     appareils du réseau ».";

/// Une entrée de la table de voisinage du système.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Neighbour {
    pub address: Ipv4Addr,
    pub mac: String,
}

/// Ce dont la découverte a besoin du monde extérieur.
///
/// Séparer ce trait de l'orchestration permet de tester la logique — bornage,
/// fusion des sources, annulation, progression — avec des données
/// déterministes, sans qu'aucun paquet ne parte sur le réseau du développeur.
pub trait LanProbe: Sync {
    /// Table de voisinage du système, déjà remplie : aucune émission.
    fn neighbours(&self) -> Vec<Neighbour>;
    /// Un écho ICMP. Renvoie la latence en millisecondes si l'hôte répond.
    fn reachable(&self, address: Ipv4Addr, timeout: Duration) -> Option<f64>;
    /// Résolution inverse du nom, si le système la propose.
    fn hostname(&self, address: Ipv4Addr) -> Option<String>;
    /// Vrai si l'ICMP est utilisable ; sinon, seule la table sert.
    fn icmp_available(&self) -> bool {
        true
    }
}

/// Délai d'attente d'un écho sur un réseau local : court, c'est à côté.
pub const PROBE_TIMEOUT_MS: u64 = 400;
/// Sondes menées de front. Un réseau domestique n'apprécie pas mieux.
pub const MAX_CONCURRENCY: usize = 16;
/// Attente maximale d'une résolution inverse de nom.
///
/// Sur un réseau local, un nom arrive en quelques millisecondes ou n'arrive
/// pas : au-delà, l'adresse n'a pas d'enregistrement PTR et insister ne ferait
/// qu'allonger la découverte.
pub const HOSTNAME_TIMEOUT_MS: u64 = 1_500;

/// Prépare une découverte : interface, plage bornée, phrase de confirmation.
pub fn plan(interface: &Interface) -> Result<DiscoveryPlan, String> {
    let address: Ipv4Addr = interface
        .address
        .parse()
        .map_err(|_| format!("Adresse d'interface illisible : {}", interface.address))?;
    let range = bounded_range(address, interface.prefix)?;
    Ok(DiscoveryPlan {
        summary: format!(
            "FourTout va examiner {} adresses du réseau local {}, de {} à {}, depuis l'interface {}.",
            range.target_count, range.scanned_cidr, range.first, range.last, interface.name
        ),
        interface: interface.clone(),
        range,
    })
}

/// Parcourt la plage prévue et rassemble ce qui s'est manifesté.
pub fn discover(
    plan: &DiscoveryPlan,
    probe: &(dyn LanProbe + Send + Sync),
    cancelled: &(dyn Fn() -> bool + Send + Sync),
    progress: &(dyn Fn(usize, usize) + Send + Sync),
) -> Result<DiscoveryResult, String> {
    let list = targets(&plan.range)?;
    let local: Ipv4Addr = plan.interface.address.parse().unwrap_or(Ipv4Addr::UNSPECIFIED);

    // La table de voisinage est lue une fois, avant toute émission : les
    // appareils qui y figurent sont connus sans qu'un paquet soit envoyé.
    let neighbours = probe.neighbours();
    let known: std::collections::HashMap<Ipv4Addr, String> =
        neighbours.into_iter().map(|entry| (entry.address, entry.mac)).collect();

    let icmp = probe.icmp_available();
    let timeout = Duration::from_millis(PROBE_TIMEOUT_MS);

    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    let found: Mutex<Vec<Device>> = Mutex::new(Vec::new());
    let total = list.len();

    std::thread::scope(|scope| {
        let workers = MAX_CONCURRENCY.min(total.max(1));
        for _ in 0..workers {
            let next = &next;
            let done = &done;
            let found = &found;
            let list = &list;
            let known = &known;
            scope.spawn(move || loop {
                if cancelled() {
                    break;
                }
                let index = next.fetch_add(1, Ordering::SeqCst);
                let Some(address) = list.get(index).copied() else { break };

                let mac = known.get(&address).cloned();
                let latency = if icmp { probe.reachable(address, timeout) } else { None };
                done.fetch_add(1, Ordering::SeqCst);

                // Un appareil n'est retenu que s'il s'est effectivement
                // manifesté : figurer dans la plage ne suffit pas.
                if mac.is_none() && latency.is_none() && address != local {
                    continue;
                }

                let mut evidence = Vec::new();
                if mac.is_some() {
                    evidence.push("table de voisinage".to_string());
                }
                if latency.is_some() {
                    evidence.push("réponse à l'écho ICMP".to_string());
                }
                if address == local {
                    evidence.push("adresse de cette machine".to_string());
                }

                // La résolution du nom se fait **avant** de prendre le verrou.
                // L'écrire dans l'expression de construction de `Device` la
                // plaçait à l'intérieur du `lock()`, et sérialisait donc toutes
                // les résolutions des seize fils de travail derrière un seul
                // mutex — pour une opération qui peut durer une seconde.
                let hostname = probe.hostname(address);

                found.lock().unwrap().push(Device {
                    hostname,
                    address: address.to_string(),
                    mac,
                    latency_ms: latency,
                    evidence,
                    is_self: address == local,
                });
            });
        }

        while done.load(Ordering::SeqCst) < total && !cancelled() {
            progress(done.load(Ordering::SeqCst), total);
            std::thread::sleep(Duration::from_millis(60));
        }
        progress(done.load(Ordering::SeqCst), total);
    });

    let mut devices = found.into_inner().map_err(|_| "Résultats inaccessibles.".to_string())?;
    devices.sort_by_key(|device| {
        device.address.parse::<Ipv4Addr>().map(u32::from).unwrap_or(u32::MAX)
    });

    let mut methods = vec!["lecture de la table de voisinage".to_string()];
    if icmp {
        methods.push("écho ICMP borné".to_string());
    } else {
        methods.push(
            "écho ICMP indisponible sur ce système : seule la table de voisinage a servi"
                .to_string(),
        );
    }

    Ok(DiscoveryResult {
        range: plan.range.clone(),
        examined: done.load(Ordering::SeqCst),
        devices,
        cancelled: cancelled(),
        methods,
        note: HONESTY_NOTE.to_string(),
    })
}

/* ------------------------------------------------------------------------ */
/* Sonde réelle                                                              */
/* ------------------------------------------------------------------------ */

/// Interfaces IPv4 de la machine, boucle locale comprise.
pub fn interfaces() -> Result<Vec<Interface>, String> {
    let found = if_addrs::get_if_addrs()
        .map_err(|error| format!("Interfaces réseau illisibles : {error}"))?;

    let mut list = Vec::new();
    for entry in found {
        let if_addrs::IfAddr::V4(v4) = entry.addr else { continue };
        let prefix = prefix_from_mask(v4.netmask).unwrap_or(32);
        let network = super::cidr::Ipv4Network::new(v4.ip, prefix)?;
        list.push(Interface {
            name: entry.name,
            address: v4.ip.to_string(),
            netmask: v4.netmask.to_string(),
            prefix,
            cidr: network.to_string(),
            loopback: v4.ip.is_loopback(),
        });
    }
    list.sort_by(|a, b| a.loopback.cmp(&b.loopback).then(a.name.cmp(&b.name)));
    Ok(list)
}

/// La sonde qui parle réellement au système.
pub struct SystemProbe {
    icmp: bool,
}

impl Default for SystemProbe {
    fn default() -> Self {
        Self::new()
    }
}

impl SystemProbe {
    pub fn new() -> Self {
        // Un écho vers la boucle locale dit, sans rien envoyer sur le réseau,
        // si le système accepte d'ouvrir un socket ICMP.
        let probe = super::ping::ping(
            "127.0.0.1",
            super::ping::PingOptions { count: 1, timeout_ms: 200 },
            &|| false,
        );
        Self { icmp: probe.is_ok() }
    }
}

impl LanProbe for SystemProbe {
    fn neighbours(&self) -> Vec<Neighbour> {
        neighbour_table()
    }

    fn reachable(&self, address: Ipv4Addr, timeout: Duration) -> Option<f64> {
        let summary = super::ping::ping(
            &address.to_string(),
            super::ping::PingOptions { count: 1, timeout_ms: timeout.as_millis() as u64 },
            &|| false,
        )
        .ok()?;
        summary.attempts.first().and_then(|attempt| attempt.rtt_ms)
    }

    /// Résolution inverse **bornée dans le temps**.
    ///
    /// `getnameinfo` n'accepte aucun délai : face à une adresse sans
    /// enregistrement PTR, il attend le temps que le résolveur du système veut
    /// bien y mettre — souvent cinq secondes par serveur de noms, parfois deux
    /// tentatives. Une seule adresse muette immobiliserait ainsi un fil de
    /// travail pendant dix secondes, et la découverte entière avec lui.
    ///
    /// La résolution part donc dans un fil dédié et on l'attend au plus
    /// [`HOSTNAME_TIMEOUT_MS`]. Passé ce délai, l'appareil est simplement
    /// affiché **sans nom** : c'est ce que l'on sait, et le nom n'a jamais été
    /// la raison d'être de cet outil. Le fil abandonné se terminera de son côté,
    /// et son résultat sera ignoré ; leur nombre est borné par celui des
    /// appareils observés.
    fn hostname(&self, address: Ipv4Addr) -> Option<String> {
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let resolved = dns_lookup::lookup_addr(&std::net::IpAddr::V4(address)).ok();
            let _ = sender.send(resolved);
        });

        match receiver.recv_timeout(Duration::from_millis(HOSTNAME_TIMEOUT_MS)) {
            // Certains résolveurs rendent l'adresse elle-même faute de PTR :
            // ce n'est pas un nom, c'est la question reposée.
            Ok(Some(name)) if name != address.to_string() => Some(name),
            _ => None,
        }
    }

    fn icmp_available(&self) -> bool {
        self.icmp
    }
}

/// Table de voisinage du système, lue sans émettre le moindre paquet.
#[cfg(target_os = "linux")]
pub fn neighbour_table() -> Vec<Neighbour> {
    let Ok(text) = std::fs::read_to_string("/proc/net/arp") else {
        return Vec::new();
    };
    parse_proc_net_arp(&text)
}

/// Analyse `/proc/net/arp`.
///
/// Colonnes : adresse IP, type matériel, drapeaux, adresse matérielle, masque,
/// interface. Un drapeau `0x0` signale une entrée *incomplète* : le noyau a
/// posé la question et n'a pas eu de réponse. La retenir ferait apparaître des
/// appareils qui n'existent pas.
#[cfg(any(target_os = "linux", test))]
pub fn parse_proc_net_arp(text: &str) -> Vec<Neighbour> {
    let mut list = Vec::new();
    for line in text.lines().skip(1) {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 4 {
            continue;
        }
        let Ok(address) = fields[0].parse::<Ipv4Addr>() else { continue };
        let flags = u32::from_str_radix(fields[2].trim_start_matches("0x"), 16).unwrap_or(0);
        if flags == 0 {
            continue;
        }
        let mac = fields[3].to_ascii_lowercase();
        if mac == "00:00:00:00:00:00" {
            continue;
        }
        list.push(Neighbour { address, mac });
    }
    list
}

#[cfg(windows)]
pub fn neighbour_table() -> Vec<Neighbour> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetIpNetTable, MIB_IPNETROW_LH, MIB_IPNETTABLE,
    };

    unsafe {
        // Premier appel : on demande la taille nécessaire.
        let mut size: u32 = 0;
        GetIpNetTable(std::ptr::null_mut(), &mut size, 0);
        if size == 0 {
            return Vec::new();
        }
        let mut buffer = vec![0u8; size as usize];
        let table = buffer.as_mut_ptr() as *mut MIB_IPNETTABLE;
        if GetIpNetTable(table, &mut size, 0) != 0 {
            return Vec::new();
        }

        let count = (*table).dwNumEntries as usize;
        let rows = std::ptr::addr_of!((*table).table) as *const MIB_IPNETROW_LH;
        let rows = std::slice::from_raw_parts(rows, count);

        let mut list = Vec::new();
        for row in rows {
            let length = row.dwPhysAddrLen as usize;
            if length == 0 || length > row.bPhysAddr.len() {
                continue;
            }
            // `dwType` : 2 = invalide, 3 = dynamique, 4 = statique. Les entrées
            // invalides sont l'équivalent des entrées incomplètes de Linux.
            if row.Anonymous.dwType == 2 {
                continue;
            }
            let mac = row.bPhysAddr[..length]
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<Vec<_>>()
                .join(":");
            if mac.chars().all(|c| c == '0' || c == ':') {
                continue;
            }
            list.push(Neighbour {
                address: Ipv4Addr::from(row.dwAddr.to_ne_bytes()),
                mac,
            });
        }
        list
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
pub fn neighbour_table() -> Vec<Neighbour> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn interface(address: &str, prefix: u8) -> Interface {
        Interface {
            name: "test0".to_string(),
            address: address.to_string(),
            netmask: "255.255.255.0".to_string(),
            prefix,
            cidr: format!("{address}/{prefix}"),
            loopback: false,
        }
    }

    /// Sonde déterministe : rien ne part sur le réseau du développeur.
    struct FakeProbe {
        alive: Vec<Ipv4Addr>,
        table: Vec<Neighbour>,
        icmp: bool,
    }

    impl LanProbe for FakeProbe {
        fn neighbours(&self) -> Vec<Neighbour> {
            self.table.clone()
        }
        fn reachable(&self, address: Ipv4Addr, _timeout: Duration) -> Option<f64> {
            self.alive.contains(&address).then_some(1.5)
        }
        fn hostname(&self, address: Ipv4Addr) -> Option<String> {
            (address.octets()[3] == 1).then(|| "routeur.local".to_string())
        }
        fn icmp_available(&self) -> bool {
            self.icmp
        }
    }

    fn ip(text: &str) -> Ipv4Addr {
        text.parse().unwrap()
    }

    #[test]
    fn announces_the_range_before_scanning() {
        let plan = plan(&interface("192.168.1.42", 24)).unwrap();
        assert_eq!(plan.range.target_count, 254);
        assert!(plan.summary.contains("254 adresses"));
        assert!(plan.summary.contains("192.168.1.0/24"));
    }

    #[test]
    fn a_wide_interface_is_narrowed_in_the_plan() {
        let plan = plan(&interface("10.2.3.4", 16)).unwrap();
        assert_eq!(plan.range.scanned_cidr, "10.2.3.0/24");
        assert!(plan.range.narrowed);
        assert!(plan.range.target_count <= super::super::cidr::MAX_TARGETS);
    }

    #[test]
    fn keeps_only_devices_that_actually_answered() {
        let plan = plan(&interface("192.168.1.42", 24)).unwrap();
        let probe = FakeProbe {
            alive: vec![ip("192.168.1.1"), ip("192.168.1.77")],
            table: vec![Neighbour { address: ip("192.168.1.200"), mac: "aa:bb:cc:dd:ee:ff".into() }],
            icmp: true,
        };
        let result = discover(&plan, &probe, &|| false, &|_, _| {}).unwrap();

        let addresses: Vec<&str> = result.devices.iter().map(|d| d.address.as_str()).collect();
        assert_eq!(addresses, vec!["192.168.1.1", "192.168.1.42", "192.168.1.77", "192.168.1.200"]);
        assert_eq!(result.examined, 254);

        let router = &result.devices[0];
        assert_eq!(router.hostname.as_deref(), Some("routeur.local"));
        assert_eq!(router.latency_ms, Some(1.5));
        assert!(router.evidence.contains(&"réponse à l'écho ICMP".to_string()));

        let from_table = result.devices.last().unwrap();
        assert_eq!(from_table.mac.as_deref(), Some("aa:bb:cc:dd:ee:ff"));
        assert!(from_table.latency_ms.is_none());
        assert!(from_table.evidence.contains(&"table de voisinage".to_string()));

        // La machine elle-même figure dans la liste, marquée comme telle.
        assert!(result.devices.iter().any(|device| device.is_self));
        assert!(result.note.contains("n'apparaît pas"));
    }

    #[test]
    fn never_probes_outside_the_planned_range() {
        let plan = plan(&interface("192.168.1.42", 24)).unwrap();
        let seen = Mutex::new(Vec::new());
        struct Recorder<'a>(&'a Mutex<Vec<Ipv4Addr>>);
        impl LanProbe for Recorder<'_> {
            fn neighbours(&self) -> Vec<Neighbour> {
                Vec::new()
            }
            fn reachable(&self, address: Ipv4Addr, _timeout: Duration) -> Option<f64> {
                self.0.lock().unwrap().push(address);
                None
            }
            fn hostname(&self, _address: Ipv4Addr) -> Option<String> {
                None
            }
        }
        discover(&plan, &Recorder(&seen), &|| false, &|_, _| {}).unwrap();

        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 254);
        let network = super::super::cidr::Ipv4Network::new(ip("192.168.1.0"), 24).unwrap();
        for address in seen.iter() {
            assert!(network.contains(*address), "{address} hors de la plage");
            assert_ne!(*address, ip("192.168.1.0"));
            assert_ne!(*address, ip("192.168.1.255"));
        }
    }

    #[test]
    fn cancellation_stops_the_discovery() {
        let plan = plan(&interface("192.168.1.42", 24)).unwrap();
        let probe = FakeProbe { alive: Vec::new(), table: Vec::new(), icmp: true };
        let result = discover(&plan, &probe, &|| true, &|_, _| {}).unwrap();
        assert_eq!(result.examined, 0);
        assert!(result.cancelled);
        assert!(result.devices.is_empty());
    }

    #[test]
    fn cancellation_in_flight_stops_launching_probes() {
        // Annulation déclenchée **pendant** la découverte, et non avant : c'est
        // le cas réel du bouton « Arrêter ». Les fils de travail doivent cesser
        // d'ouvrir de nouvelles sondes au lieu de terminer la plage entière.
        let plan = plan(&interface("192.168.1.42", 24)).unwrap();
        let probed = std::sync::atomic::AtomicUsize::new(0);

        struct Counting<'a>(&'a std::sync::atomic::AtomicUsize);
        impl LanProbe for Counting<'_> {
            fn neighbours(&self) -> Vec<Neighbour> {
                Vec::new()
            }
            fn reachable(&self, _address: Ipv4Addr, _timeout: Duration) -> Option<f64> {
                self.0.fetch_add(1, Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(2));
                None
            }
            fn hostname(&self, _address: Ipv4Addr) -> Option<String> {
                None
            }
        }

        // Le drapeau bascule dès que trente-deux adresses ont été sondées.
        let cancelled = || probed.load(Ordering::SeqCst) >= 32;
        let result = discover(&plan, &Counting(&probed), &cancelled, &|_, _| {}).unwrap();

        assert!(result.cancelled, "la découverte doit se déclarer interrompue");
        assert!(
            result.examined < plan.range.target_count,
            "{} adresses examinées sur {} : l'annulation n'a rien arrêté",
            result.examined,
            plan.range.target_count
        );
        // Les seize fils en vol peuvent terminer la sonde commencée : on tolère
        // une sonde de plus par fil, pas la plage entière.
        assert!(
            probed.load(Ordering::SeqCst) <= 32 + MAX_CONCURRENCY,
            "trop de sondes lancées après l'annulation"
        );
    }

    #[test]
    fn says_so_when_icmp_is_unavailable() {
        let plan = plan(&interface("192.168.1.42", 24)).unwrap();
        let probe = FakeProbe {
            alive: vec![ip("192.168.1.1")],
            table: vec![Neighbour { address: ip("192.168.1.9"), mac: "00:11:22:33:44:55".into() }],
            icmp: false,
        };
        let result = discover(&plan, &probe, &|| false, &|_, _| {}).unwrap();
        // Sans ICMP, seule la table de voisinage (et la machine) remontent.
        let addresses: Vec<&str> = result.devices.iter().map(|d| d.address.as_str()).collect();
        assert_eq!(addresses, vec!["192.168.1.9", "192.168.1.42"]);
        assert!(result.methods.iter().any(|method| method.contains("indisponible")));
    }

    #[test]
    fn reports_progress_up_to_the_total() {
        let plan = plan(&interface("192.168.1.42", 28)).unwrap();
        let probe = FakeProbe { alive: Vec::new(), table: Vec::new(), icmp: true };
        let seen = Mutex::new(Vec::new());
        discover(&plan, &probe, &|| false, &|done, total| {
            seen.lock().unwrap().push((done, total));
        })
        .unwrap();
        let seen = seen.lock().unwrap();
        assert!(seen.iter().any(|(done, total)| *done == 14 && *total == 14));
    }

    #[test]
    fn reads_the_linux_neighbour_table() {
        let text = "IP address       HW type     Flags       HW address            Mask     Device\n\
                    192.168.1.1      0x1         0x2         a4:2b:b0:11:22:33     *        wlan0\n\
                    192.168.1.55     0x1         0x0         00:00:00:00:00:00     *        wlan0\n\
                    192.168.1.77     0x1         0x2         00:00:00:00:00:00     *        wlan0\n\
                    192.168.1.90     0x1         0x6         de:ad:be:ef:00:01     *        eth0\n";
        let table = parse_proc_net_arp(text);
        assert_eq!(table.len(), 2);
        assert_eq!(table[0], Neighbour { address: ip("192.168.1.1"), mac: "a4:2b:b0:11:22:33".into() });
        assert_eq!(table[1].address, ip("192.168.1.90"));
    }

    #[test]
    fn the_machine_lists_at_least_its_loopback() {
        let list = interfaces().unwrap();
        assert!(list.iter().any(|entry| entry.loopback), "aucune boucle locale : {list:?}");
        for entry in &list {
            assert!(entry.prefix <= 32);
            assert!(entry.cidr.contains('/'));
        }
    }
}
