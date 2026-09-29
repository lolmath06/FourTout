//! Ping ICMP, sans lire la sortie d'un programme.
//!
//! La tentation serait d'appeler `/bin/ping` ou `ping.exe` et de lire ce qu'ils
//! affichent. C'est une mauvaise idée : leur sortie est **traduite**. « 4 paquets
//! transmis, 4 reçus » sur une Fedora française, « 4 packets transmitted » en
//! anglais, un tableau entièrement différent sous Windows, et les chiffres
//! changent de place d'une version à l'autre. Un analyseur de texte fondé
//! là-dessus se casse au premier changement de langue de l'utilisateur.
//!
//! FourTout fabrique donc lui-même les paquets ICMP :
//!
//! - **Linux, macOS** : un socket `SOCK_DGRAM` de protocole ICMP. C'est la
//!   variante *non privilégiée* : le noyau accepte de l'ouvrir sans
//!   `CAP_NET_RAW` lorsque `net.ipv4.ping_group_range` le permet, ce qui est le
//!   réglage par défaut de Fedora. Aucun `sudo`, aucun bit setuid.
//! - **Windows** : `IcmpSendEcho`, l'API de l'IP Helper, qui ne demande aucun
//!   privilège administrateur là où un socket brut en exigerait.
//!
//! Si le système refuse malgré tout, l'outil le dit et s'arrête. Il ne remplace
//! **jamais** l'ICMP par une connexion TCP en silence : « l'hôte répond au
//! ping » et « le port 80 est ouvert » sont deux affirmations différentes, et
//! les confondre serait mentir sur ce qui a été mesuré.

use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::time::{Duration, Instant};

use serde::Serialize;

/// Bornes volontairement étroites : cet outil diagnostique, il n'inonde pas.
pub const MAX_PACKETS: u32 = 20;
pub const DEFAULT_PACKETS: u32 = 4;
pub const MIN_TIMEOUT_MS: u64 = 100;
pub const MAX_TIMEOUT_MS: u64 = 10_000;
pub const DEFAULT_TIMEOUT_MS: u64 = 1_000;

/// Contenu du paquet : de quoi reconnaître nos propres échos.
const PAYLOAD: &[u8] = b"FourTout-ping---";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingAttempt {
    pub sequence: u32,
    /// Durée aller-retour en millisecondes, absente si le paquet s'est perdu.
    pub rtt_ms: Option<f64>,
    /// Adresse qui a répondu, quand une réponse est arrivée.
    pub from: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingSummary {
    /// Ce que l'utilisateur a saisi.
    pub host: String,
    /// Adresse IP effectivement contactée.
    pub resolved: String,
    /// Méthode réellement employée, pour que l'affichage ne puisse pas mentir.
    pub method: String,
    pub sent: u32,
    pub received: u32,
    pub lost: u32,
    pub loss_percent: f64,
    pub min_ms: Option<f64>,
    pub avg_ms: Option<f64>,
    pub max_ms: Option<f64>,
    pub attempts: Vec<PingAttempt>,
}

#[derive(Debug, Clone, Copy)]
pub struct PingOptions {
    pub count: u32,
    pub timeout_ms: u64,
}

impl Default for PingOptions {
    fn default() -> Self {
        Self { count: DEFAULT_PACKETS, timeout_ms: DEFAULT_TIMEOUT_MS }
    }
}

impl PingOptions {
    fn clamped(self) -> Self {
        Self {
            count: self.count.clamp(1, MAX_PACKETS),
            timeout_ms: self.timeout_ms.clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
        }
    }
}

/// Résout un nom d'hôte en une adresse IP unique.
///
/// Le port 0 n'a aucune importance : `to_socket_addrs` est simplement la seule
/// résolution DNS de la bibliothèque standard, et elle exige un port.
pub fn resolve(host: &str) -> Result<IpAddr, String> {
    let cleaned = host.trim();
    if cleaned.is_empty() {
        return Err("Indiquez un nom d'hôte ou une adresse IP.".to_string());
    }
    if let Ok(address) = cleaned.parse::<IpAddr>() {
        return Ok(address);
    }
    // Une adresse littérale IPv6 peut arriver entre crochets.
    let bare = cleaned.trim_start_matches('[').trim_end_matches(']');
    if let Ok(address) = bare.parse::<IpAddr>() {
        return Ok(address);
    }

    match (cleaned, 0u16).to_socket_addrs() {
        Ok(mut addresses) => addresses
            .next()
            .map(|address: SocketAddr| address.ip())
            .ok_or_else(|| format!("« {cleaned} » n'a donné aucune adresse.")),
        Err(_) => Err(format!(
            "Nom introuvable : « {cleaned} » n'a pas pu être résolu. Vérifiez l'orthographe et \
             votre configuration DNS."
        )),
    }
}

fn summarize(host: &str, target: IpAddr, method: &str, attempts: Vec<PingAttempt>) -> PingSummary {
    let times: Vec<f64> = attempts.iter().filter_map(|attempt| attempt.rtt_ms).collect();
    let sent = attempts.len() as u32;
    let received = times.len() as u32;
    PingSummary {
        host: host.to_string(),
        resolved: target.to_string(),
        method: method.to_string(),
        sent,
        lost: sent - received,
        loss_percent: if sent == 0 {
            0.0
        } else {
            ((sent - received) as f64 / sent as f64) * 100.0
        },
        min_ms: times.iter().copied().reduce(f64::min),
        max_ms: times.iter().copied().reduce(f64::max),
        avg_ms: if times.is_empty() {
            None
        } else {
            Some(times.iter().sum::<f64>() / times.len() as f64)
        },
        received,
        attempts,
    }
}

/// Envoie une série d'échos ICMP et résume ce qui est revenu.
pub fn ping(host: &str, options: PingOptions, cancelled: &dyn Fn() -> bool) -> Result<PingSummary, String> {
    let options = options.clamped();
    let target = resolve(host)?;
    let attempts = platform::echo_series(target, options, cancelled)?;
    Ok(summarize(host, target, platform::METHOD, attempts))
}

/* ------------------------------------------------------------------------ */
/* Fabrication et lecture des paquets ICMP                                   */
/* ------------------------------------------------------------------------ */

/// Somme de contrôle Internet (RFC 1071).
#[cfg_attr(windows, allow(dead_code))]
pub fn checksum(data: &[u8]) -> u16 {
    let mut sum: u32 = 0;
    let mut chunks = data.chunks_exact(2);
    for chunk in &mut chunks {
        sum += u32::from(u16::from_be_bytes([chunk[0], chunk[1]]));
    }
    if let [last] = chunks.remainder() {
        sum += u32::from(u16::from_be_bytes([*last, 0]));
    }
    while sum >> 16 != 0 {
        sum = (sum & 0xffff) + (sum >> 16);
    }
    !(sum as u16)
}

/// Construit une requête d'écho ICMP (v4 : type 8, v6 : type 128).
#[cfg_attr(windows, allow(dead_code))]
pub fn echo_request(v6: bool, identifier: u16, sequence: u16) -> Vec<u8> {
    let mut packet = Vec::with_capacity(8 + PAYLOAD.len());
    packet.push(if v6 { 128 } else { 8 }); // type
    packet.push(0); // code
    packet.extend_from_slice(&[0, 0]); // somme de contrôle, calculée ensuite
    packet.extend_from_slice(&identifier.to_be_bytes());
    packet.extend_from_slice(&sequence.to_be_bytes());
    packet.extend_from_slice(PAYLOAD);

    if !v6 {
        // En ICMPv6, la somme de contrôle couvre un pseudo-en-tête que seul le
        // noyau connaît : c'est lui qui la remplit, et la calculer ici donnerait
        // un paquet rejeté.
        let sum = checksum(&packet);
        packet[2..4].copy_from_slice(&sum.to_be_bytes());
    }
    packet
}

/// Extrait le numéro de séquence d'une réponse d'écho, s'il s'agit bien d'une.
///
/// Un socket brut rend le datagramme IP complet, un socket `SOCK_DGRAM` rend
/// seulement la partie ICMP : on reconnaît le premier cas au numéro de version
/// dans le premier octet, et on saute l'en-tête IP.
#[cfg_attr(windows, allow(dead_code))]
pub fn echo_reply_sequence(buffer: &[u8], v6: bool) -> Option<u16> {
    let icmp = if !v6 && buffer.first().map(|byte| byte >> 4) == Some(4) {
        let header_length = usize::from(buffer[0] & 0x0f) * 4;
        buffer.get(header_length..)?
    } else {
        buffer
    };
    if icmp.len() < 8 {
        return None;
    }
    let expected_type = if v6 { 129 } else { 0 }; // echo reply
    if icmp[0] != expected_type {
        return None;
    }
    Some(u16::from_be_bytes([icmp[6], icmp[7]]))
}

/* ------------------------------------------------------------------------ */
/* Implémentations par plateforme                                            */
/* ------------------------------------------------------------------------ */

#[cfg(not(windows))]
mod platform {
    use super::*;
    use std::io::ErrorKind;
    use std::mem::MaybeUninit;

    use socket2::{Domain, Protocol, SockAddr, Socket, Type};

    pub const METHOD: &str = "ICMP (socket non privilégié)";

    pub fn echo_series(
        target: IpAddr,
        options: PingOptions,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<Vec<PingAttempt>, String> {
        let v6 = target.is_ipv6();
        let socket = Socket::new(
            if v6 { Domain::IPV6 } else { Domain::IPV4 },
            Type::DGRAM,
            Some(if v6 { Protocol::ICMPV6 } else { Protocol::ICMPV4 }),
        )
        .map_err(|error| unavailable(error.kind()))?;

        socket
            .set_read_timeout(Some(Duration::from_millis(options.timeout_ms)))
            .map_err(|error| format!("Délai d'attente impossible à régler : {error}"))?;

        let destination = SockAddr::from(SocketAddr::new(target, 0));
        // Identifiant arbitraire : sur un socket non privilégié, le noyau le
        // réécrit de toute façon. C'est le numéro de séquence qui apparie.
        let identifier = std::process::id() as u16;

        let mut attempts = Vec::with_capacity(options.count as usize);
        for sequence in 0..options.count {
            if cancelled() {
                break;
            }
            let packet = echo_request(v6, identifier, sequence as u16);
            let started = Instant::now();
            if let Err(error) = socket.send_to(&packet, &destination) {
                if error.kind() == ErrorKind::PermissionDenied {
                    return Err(unavailable(error.kind()));
                }
                attempts.push(PingAttempt { sequence, rtt_ms: None, from: None });
                continue;
            }

            attempts.push(wait_for_reply(&socket, v6, sequence, started, options.timeout_ms));

            // Rythme d'un paquet par seconde, comme le `ping` du système, mais
            // sans attendre après le dernier.
            if sequence + 1 < options.count && !cancelled() {
                std::thread::sleep(Duration::from_millis(600));
            }
        }
        Ok(attempts)
    }

    fn wait_for_reply(
        socket: &Socket,
        v6: bool,
        sequence: u32,
        started: Instant,
        timeout_ms: u64,
    ) -> PingAttempt {
        let deadline = started + Duration::from_millis(timeout_ms);
        let mut buffer = [MaybeUninit::<u8>::uninit(); 1500];
        loop {
            if Instant::now() >= deadline {
                return PingAttempt { sequence, rtt_ms: None, from: None };
            }
            match socket.recv_from(&mut buffer) {
                Ok((length, from)) => {
                    let bytes: Vec<u8> =
                        buffer[..length].iter().map(|slot| unsafe { slot.assume_init() }).collect();
                    // Une réponse peut appartenir à un écho antérieur : on
                    // n'accepte que celle qui porte la séquence attendue.
                    if echo_reply_sequence(&bytes, v6) != Some(sequence as u16) {
                        continue;
                    }
                    return PingAttempt {
                        sequence,
                        rtt_ms: Some(started.elapsed().as_secs_f64() * 1000.0),
                        from: from.as_socket().map(|address| address.ip().to_string()),
                    };
                }
                Err(error)
                    if error.kind() == ErrorKind::WouldBlock
                        || error.kind() == ErrorKind::TimedOut =>
                {
                    return PingAttempt { sequence, rtt_ms: None, from: None };
                }
                Err(_) => return PingAttempt { sequence, rtt_ms: None, from: None },
            }
        }
    }

    fn unavailable(kind: ErrorKind) -> String {
        if kind == ErrorKind::PermissionDenied {
            "ICMP indisponible : le système refuse d'ouvrir un socket ICMP pour cette \
             application. Sous Linux, cela se règle par la variable noyau \
             `net.ipv4.ping_group_range`, qui autorise le ping non privilégié. FourTout ne \
             remplace pas le ping par une connexion TCP : le résultat ne voudrait pas dire la \
             même chose. Pour tester si un service répond, utilisez « Tester des ports »."
                .to_string()
        } else {
            format!("ICMP indisponible sur ce système ({kind:?}).")
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::net::Ipv4Addr;

    use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        Icmp6CreateFile, Icmp6SendEcho2, IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho,
        ICMPV6_ECHO_REPLY_LH, ICMP_ECHO_REPLY, IP_OPTION_INFORMATION,
    };
    use windows_sys::Win32::Networking::WinSock::{AF_INET6, SOCKADDR_IN6};

    pub const METHOD: &str = "ICMP (API IcmpSendEcho)";

    /// Ferme le descripteur ICMP quoi qu'il arrive.
    ///
    /// `IcmpCloseHandle`, et non `CloseHandle` : un descripteur ICMP n'est pas
    /// un objet noyau ordinaire, et le refermer avec la mauvaise fonction fuit.
    struct IcmpHandle(HANDLE);

    impl Drop for IcmpHandle {
        fn drop(&mut self) {
            unsafe { IcmpCloseHandle(self.0) };
        }
    }

    pub fn echo_series(
        target: IpAddr,
        options: PingOptions,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<Vec<PingAttempt>, String> {
        match target {
            IpAddr::V4(address) => echo_v4(address, options, cancelled),
            IpAddr::V6(address) => echo_v6(address, options, cancelled),
        }
    }

    fn open(v6: bool) -> Result<IcmpHandle, String> {
        let handle = unsafe { if v6 { Icmp6CreateFile() } else { IcmpCreateFile() } };
        if handle == INVALID_HANDLE_VALUE || handle.is_null() {
            return Err(
                "ICMP indisponible : Windows a refusé d'ouvrir le service d'écho. Un pare-feu ou \
                 une stratégie de sécurité peut l'interdire. FourTout ne remplace pas le ping par \
                 une connexion TCP : pour tester si un service répond, utilisez « Tester des \
                 ports »."
                    .to_string(),
            );
        }
        Ok(IcmpHandle(handle))
    }

    fn echo_v4(
        target: Ipv4Addr,
        options: PingOptions,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<Vec<PingAttempt>, String> {
        let handle = open(false)?;
        let payload = PAYLOAD.to_vec();
        // La mémoire de réponse doit contenir au moins une structure de réponse
        // plus la charge utile renvoyée ; Microsoft recommande une marge.
        let mut reply = vec![0u8; std::mem::size_of::<ICMP_ECHO_REPLY>() + payload.len() + 64];
        let destination = u32::from_ne_bytes(target.octets());

        let mut attempts = Vec::with_capacity(options.count as usize);
        for sequence in 0..options.count {
            if cancelled() {
                break;
            }
            let count = unsafe {
                IcmpSendEcho(
                    handle.0,
                    destination,
                    payload.as_ptr() as *const _,
                    payload.len() as u16,
                    std::ptr::null_mut::<IP_OPTION_INFORMATION>(),
                    reply.as_mut_ptr() as *mut _,
                    reply.len() as u32,
                    options.timeout_ms as u32,
                )
            };
            attempts.push(if count == 0 {
                PingAttempt { sequence, rtt_ms: None, from: None }
            } else {
                let echo = unsafe { &*(reply.as_ptr() as *const ICMP_ECHO_REPLY) };
                PingAttempt {
                    sequence,
                    rtt_ms: Some(f64::from(echo.RoundTripTime)),
                    from: Some(Ipv4Addr::from(echo.Address.to_ne_bytes()).to_string()),
                }
            });
            if sequence + 1 < options.count && !cancelled() {
                std::thread::sleep(Duration::from_millis(600));
            }
        }
        Ok(attempts)
    }

    fn echo_v6(
        target: std::net::Ipv6Addr,
        options: PingOptions,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<Vec<PingAttempt>, String> {
        let handle = open(true)?;
        let payload = PAYLOAD.to_vec();
        let mut reply = vec![0u8; std::mem::size_of::<ICMPV6_ECHO_REPLY_LH>() + payload.len() + 64];

        let mut source: SOCKADDR_IN6 = unsafe { std::mem::zeroed() };
        source.sin6_family = AF_INET6;
        let mut destination: SOCKADDR_IN6 = unsafe { std::mem::zeroed() };
        destination.sin6_family = AF_INET6;
        destination.sin6_addr.u.Byte = target.octets();

        let mut attempts = Vec::with_capacity(options.count as usize);
        for sequence in 0..options.count {
            if cancelled() {
                break;
            }
            let started = Instant::now();
            let count = unsafe {
                Icmp6SendEcho2(
                    handle.0,
                    std::ptr::null_mut(),
                    None,
                    std::ptr::null(),
                    &source,
                    &destination,
                    payload.as_ptr() as *const _,
                    payload.len() as u16,
                    std::ptr::null_mut::<IP_OPTION_INFORMATION>(),
                    reply.as_mut_ptr() as *mut _,
                    reply.len() as u32,
                    options.timeout_ms as u32,
                )
            };
            attempts.push(if count == 0 {
                PingAttempt { sequence, rtt_ms: None, from: None }
            } else {
                PingAttempt {
                    sequence,
                    rtt_ms: Some(started.elapsed().as_secs_f64() * 1000.0),
                    from: Some(target.to_string()),
                }
            });
            if sequence + 1 < options.count && !cancelled() {
                std::thread::sleep(Duration::from_millis(600));
            }
        }
        Ok(attempts)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_the_internet_checksum() {
        // Une somme de contrôle correcte rend la vérification du paquet nulle.
        let packet = echo_request(false, 0x1234, 1);
        assert_eq!(checksum(&packet), 0);
    }

    #[test]
    fn builds_the_right_echo_type() {
        assert_eq!(echo_request(false, 1, 1)[0], 8);
        assert_eq!(echo_request(true, 1, 1)[0], 128);
    }

    #[test]
    fn reads_the_sequence_of_a_reply() {
        // Réponse ICMPv4 telle qu'un socket SOCK_DGRAM la rend : sans en-tête IP.
        let mut reply = vec![0u8, 0, 0, 0, 0x12, 0x34, 0x00, 0x07];
        assert_eq!(echo_reply_sequence(&reply, false), Some(7));

        // La même, précédée d'un en-tête IP de 20 octets (socket brut).
        let mut raw = vec![0x45u8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        raw.append(&mut reply);
        assert_eq!(echo_reply_sequence(&raw, false), Some(7));
    }

    #[test]
    fn ignores_anything_that_is_not_an_echo_reply() {
        // Type 3 = destination inaccessible : ce n'est pas une réponse d'écho.
        let unreachable = vec![3u8, 0, 0, 0, 0, 0, 0, 1];
        assert_eq!(echo_reply_sequence(&unreachable, false), None);
        assert_eq!(echo_reply_sequence(&[0u8, 0], false), None);
    }

    #[test]
    fn resolves_literal_addresses_without_dns() {
        assert_eq!(resolve("127.0.0.1").unwrap().to_string(), "127.0.0.1");
        assert_eq!(resolve(" ::1 ").unwrap().to_string(), "::1");
        assert_eq!(resolve("[::1]").unwrap().to_string(), "::1");
        assert!(resolve("   ").unwrap_err().contains("Indiquez"));
    }

    #[test]
    fn clamps_options_to_sane_bounds() {
        let options = PingOptions { count: 9999, timeout_ms: 1 }.clamped();
        assert_eq!(options.count, MAX_PACKETS);
        assert_eq!(options.timeout_ms, MIN_TIMEOUT_MS);
    }

    #[test]
    fn summarizes_losses_and_latencies() {
        let attempts = vec![
            PingAttempt { sequence: 0, rtt_ms: Some(1.0), from: Some("127.0.0.1".into()) },
            PingAttempt { sequence: 1, rtt_ms: None, from: None },
            PingAttempt { sequence: 2, rtt_ms: Some(3.0), from: Some("127.0.0.1".into()) },
        ];
        let summary =
            summarize("localhost", "127.0.0.1".parse().unwrap(), "test", attempts);
        assert_eq!(summary.sent, 3);
        assert_eq!(summary.received, 2);
        assert_eq!(summary.lost, 1);
        assert!((summary.loss_percent - 33.333).abs() < 0.01);
        assert_eq!(summary.min_ms, Some(1.0));
        assert_eq!(summary.max_ms, Some(3.0));
        assert_eq!(summary.avg_ms, Some(2.0));
    }

    #[test]
    fn summarizes_a_total_loss_without_inventing_latency() {
        let attempts = vec![PingAttempt { sequence: 0, rtt_ms: None, from: None }];
        let summary = summarize("x", "10.0.0.1".parse().unwrap(), "test", attempts);
        assert_eq!(summary.loss_percent, 100.0);
        assert!(summary.avg_ms.is_none());
    }
}
