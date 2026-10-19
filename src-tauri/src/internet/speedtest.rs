//! Test de débit : latence, gigue, débit descendant, débit montant.
//!
//! **Ce que cet outil contacte** : le service de mesure public de Cloudflare
//! (`speed.cloudflare.com`), celui qu'utilise la bibliothèque ouverte
//! `@cloudflare/speedtest`. Aucune clé n'est nécessaire. Le trafic est
//! synthétique dans les deux sens : le serveur fabrique les octets descendants,
//! et les octets montants sont générés ici. **Aucun fichier de l'utilisateur
//! n'est jamais envoyé.**
//!
//! Méthode, courte et lisible :
//!
//! * **Latence** — plusieurs requêtes minuscules sur une connexion déjà
//!   ouverte (la première, qui paie la poignée de main, est écartée). On
//!   rapporte la **médiane**. La **gigue** est la variation moyenne entre deux
//!   mesures consécutives (RFC 3550).
//! * **Débit** — des transferts de tailles croissantes, arrêtés dès qu'un
//!   transfert dure assez pour que la mesure soit stable. Les gros transferts
//!   utilisent plusieurs connexions, comme le font les navigateurs. On retient
//!   le **90ᵉ centile** des mesures utilisables : un débit de pointe soutenu,
//!   pas la moyenne des transferts de démarrage.
//!
//! Les résultats varient : VPN, Wi-Fi, distance au serveur et trafic
//! concurrent les modifient. Le débit est exprimé en mégabits par seconde
//! décimaux (1 Mb/s = 1 000 000 bits/s), l'unité des opérateurs.

use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::http::{agent, fetch, ClientOptions, ErrorKind, InternetError};
use crate::files::Reporter;

/// Point d'accès de mesure par défaut.
pub const DEFAULT_ENDPOINT: &str = "https://speed.cloudflare.com";

/// Un transfert plus court que cela mesure surtout la latence, pas le débit.
const MIN_USABLE: Duration = Duration::from_millis(100);

#[derive(Debug, Clone)]
pub struct Plan {
    pub endpoint: String,
    pub latency_samples: usize,
    pub down: Vec<(u64, usize)>,
    pub up: Vec<(u64, usize)>,
    /// Connexions parallèles pour les transferts d'au moins `parallel_from` octets.
    pub streams: usize,
    pub parallel_from: u64,
    /// Un transfert au moins aussi long suffit : on n'escalade plus.
    pub enough: Duration,
    pub options: ClientOptions,
}

impl Default for Plan {
    fn default() -> Self {
        Self {
            endpoint: DEFAULT_ENDPOINT.into(),
            latency_samples: 12,
            down: vec![(100_000, 6), (1_000_000, 5), (10_000_000, 4), (25_000_000, 3), (100_000_000, 2)],
            up: vec![(100_000, 5), (1_000_000, 4), (10_000_000, 3), (25_000_000, 2)],
            streams: 4,
            parallel_from: 10_000_000,
            enough: Duration::from_millis(1500),
            options: ClientOptions { connect_timeout: Duration::from_secs(10), read_timeout: Duration::from_secs(20) },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    Latency,
    Download,
    Upload,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedResult {
    pub endpoint: String,
    /// Lieu du serveur, quand le service l'annonce.
    pub server: Option<String>,
    pub latency_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub latency_samples: usize,
    /// Mégabits par seconde (décimaux).
    pub download_mbps: Option<f64>,
    pub upload_mbps: Option<f64>,
    pub download_bytes: u64,
    pub upload_bytes: u64,
    pub duration_ms: u64,
}

/* ---------------------------------------------------------------- calculs */

/// Mégabits par seconde pour `bytes` transférés en `elapsed`.
pub fn mbps(bytes: u64, elapsed: Duration) -> f64 {
    bytes as f64 * 8.0 / elapsed.as_secs_f64().max(1e-9) / 1_000_000.0
}

/// Centile par interpolation linéaire (`p` entre 0 et 1).
pub fn percentile(values: &[f64], p: f64) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let rank = p.clamp(0.0, 1.0) * (sorted.len() - 1) as f64;
    let (low, high) = (rank.floor() as usize, rank.ceil() as usize);
    Some(sorted[low] + (sorted[high] - sorted[low]) * (rank - low as f64))
}

/// Médiane des latences et gigue (variation moyenne entre mesures consécutives).
/// La gigue exige au moins quatre mesures pour avoir un sens.
pub fn latency_stats(samples_ms: &[f64]) -> Option<(f64, Option<f64>)> {
    let median = percentile(samples_ms, 0.5)?;
    let jitter = (samples_ms.len() >= 4).then(|| {
        let deltas: Vec<f64> = samples_ms.windows(2).map(|w| (w[1] - w[0]).abs()).collect();
        deltas.iter().sum::<f64>() / deltas.len() as f64
    });
    Some((median, jitter))
}

/// Débit retenu : 90ᵉ centile des transferts assez longs pour être fiables, ou
/// à défaut de tous les transferts.
pub fn throughput(samples: &[(u64, Duration)]) -> Option<f64> {
    let speeds = |keep: &dyn Fn(&Duration) -> bool| -> Vec<f64> {
        samples.iter().filter(|(_, d)| keep(d)).map(|(b, d)| mbps(*b, *d)).collect()
    };
    let usable = speeds(&|d| *d >= MIN_USABLE);
    let chosen = if usable.is_empty() { speeds(&|_| true) } else { usable };
    percentile(&chosen, 0.9)
}

/// Octets montants incompressibles et reproductibles : un lien qui compresse
/// ne doit pas fausser la mesure, et aucune donnée réelle n'est utilisée.
pub fn upload_payload(len: usize) -> Vec<u8> {
    let mut state = 0x9E37_79B9_7F4A_7C15_u64;
    let mut out = Vec::with_capacity(len);
    while out.len() < len {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        out.extend_from_slice(&state.to_le_bytes());
    }
    out.truncate(len);
    out
}

/* ------------------------------------------------------------- mesures */

fn cancelled(reporter: &Reporter) -> Result<(), InternetError> {
    reporter.check().map_err(|_| InternetError::cancelled())
}

fn url_for(plan: &Plan, path: &str) -> Result<url::Url, InternetError> {
    super::http::parse_url(&format!("{}{path}", plan.endpoint.trim_end_matches('/')))
}

/// Une requête descendante de `bytes` octets. Rend la durée de transfert du
/// corps et le nombre d'octets reçus.
fn download_once(
    plan: &Plan,
    bytes: u64,
    reporter: &Reporter,
    counter: &AtomicU64,
) -> Result<(u64, Duration, Option<String>), InternetError> {
    let url = url_for(plan, &format!("/__down?bytes={bytes}"))?;
    let agent = agent(&plan.options);
    let fetched = fetch(&agent, "GET", &url, &[("Cache-Control", "no-cache".into())])?;
    if fetched.response.status() >= 400 {
        return Err(InternetError::status(fetched.response.status()));
    }
    let server = server_location(&fetched.response);
    let mut reader = fetched.response.into_reader();
    let mut buffer = vec![0_u8; 64 * 1024];
    let started = Instant::now();
    let mut received = 0_u64;
    loop {
        cancelled(reporter)?;
        let read = reader
            .read(&mut buffer)
            .map_err(|e| InternetError::new(ErrorKind::Incomplete, format!("Mesure interrompue : {e}")))?;
        if read == 0 {
            break;
        }
        received += read as u64;
        counter.fetch_add(read as u64, Ordering::Relaxed);
    }
    Ok((received, started.elapsed(), server))
}

fn server_location(response: &ureq::Response) -> Option<String> {
    let city = response.header("cf-meta-city");
    let colo = response.header("cf-meta-colo");
    let country = response.header("cf-meta-country");
    let parts: Vec<&str> = [city, colo.or(None), country].into_iter().flatten().filter(|s| !s.is_empty()).collect();
    (!parts.is_empty()).then(|| parts.join(" · "))
}

fn upload_once(plan: &Plan, payload: &[u8], reporter: &Reporter, counter: &AtomicU64) -> Result<Duration, InternetError> {
    cancelled(reporter)?;
    let url = url_for(plan, "/__up")?;
    let agent = agent(&plan.options);
    // Envoi par blocs : l'annulation et la progression restent fines.
    struct Slice<'a> {
        data: &'a [u8],
        at: usize,
        reporter: &'a Reporter,
        counter: &'a AtomicU64,
    }
    impl Read for Slice<'_> {
        fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
            if self.reporter.cancelled() {
                return Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "annulé"));
            }
            let n = out.len().min(64 * 1024).min(self.data.len() - self.at);
            out[..n].copy_from_slice(&self.data[self.at..self.at + n]);
            self.at += n;
            self.counter.fetch_add(n as u64, Ordering::Relaxed);
            Ok(n)
        }
    }
    let started = Instant::now();
    let result = agent
        .post(url.as_str())
        .set("Content-Type", "application/octet-stream")
        .set("Content-Length", &payload.len().to_string())
        .send(Slice { data: payload, at: 0, reporter, counter });
    cancelled(reporter)?;
    match result {
        Ok(response) => {
            let _ = std::io::copy(&mut response.into_reader().take(1024), &mut std::io::sink());
            Ok(started.elapsed())
        }
        Err(error) => Err(super::http::from_ureq(error, url.host_str().unwrap_or(""))),
    }
}

/// Phase de débit : exécute le plan, escalade jusqu'à un transfert « assez long ».
fn run_throughput(
    plan: &Plan,
    sizes: &[(u64, usize)],
    upload: bool,
    reporter: &Reporter,
    on_progress: &(dyn Fn(Phase, f64, f64) + Sync),
    server: &mut Option<String>,
) -> Result<(Option<f64>, u64), InternetError> {
    let phase = if upload { Phase::Upload } else { Phase::Download };
    let mut samples: Vec<(u64, Duration)> = Vec::new();
    let mut total_bytes = 0_u64;
    let counter = AtomicU64::new(0);
    let blocks = sizes.len().max(1);

    'sizes: for (index, &(size, repeats)) in sizes.iter().enumerate() {
        let streams = if size >= plan.parallel_from { plan.streams.max(1) } else { 1 };
        let mut longest = Duration::ZERO;
        for _ in 0..repeats {
            cancelled(reporter)?;
            let wall = Instant::now();
            let results: Vec<Result<(u64, Duration, Option<String>), InternetError>> = std::thread::scope(|scope| {
                let handles: Vec<_> = (0..streams)
                    .map(|_| {
                        scope.spawn(|| {
                            if upload {
                                let payload = upload_payload(size as usize);
                                upload_once(plan, &payload, reporter, &counter).map(|d| (size, d, None))
                            } else {
                                download_once(plan, size, reporter, &counter)
                            }
                        })
                    })
                    .collect();
                handles.into_iter().map(|h| h.join().unwrap_or_else(|_| Err(InternetError::new(ErrorKind::Other, "Mesure interrompue.")))).collect()
            });
            let elapsed = wall.elapsed();
            let mut bytes = 0_u64;
            for result in results {
                let (b, _, location) = result?;
                bytes += b;
                if server.is_none() {
                    *server = location;
                }
            }
            // Les flux parallèles partagent la même durée de mur : leur somme
            // d'octets sur cette durée est le débit agrégé.
            samples.push((bytes, elapsed));
            total_bytes += bytes;
            longest = longest.max(elapsed);
            let current = throughput(&samples).unwrap_or(0.0);
            let ratio = (index as f64 + 0.5) / blocks as f64;
            on_progress(phase, current, ratio.min(1.0));
            if longest >= plan.enough {
                break 'sizes;
            }
        }
    }
    Ok((throughput(&samples), total_bytes))
}

/// Exécute le test complet. `on_progress(phase, mbps_courant, avancement 0..1)`.
pub fn run(
    plan: &Plan,
    reporter: &Reporter,
    on_progress: &(dyn Fn(Phase, f64, f64) + Sync),
) -> Result<SpeedResult, InternetError> {
    let started = Instant::now();
    let mut server = None;

    // --- latence ------------------------------------------------------------
    let agent = agent(&plan.options);
    let url = url_for(plan, "/__down?bytes=0")?;
    let mut samples_ms = Vec::new();
    for index in 0..=plan.latency_samples {
        cancelled(reporter)?;
        let begin = Instant::now();
        let fetched = fetch(&agent, "GET", &url, &[("Cache-Control", "no-cache".into())])?;
        if server.is_none() {
            server = server_location(&fetched.response);
        }
        let mut sink = Vec::new();
        let _ = fetched.response.into_reader().take(1024).read_to_end(&mut sink);
        // La première requête paie la résolution DNS et la poignée de main.
        if index > 0 {
            samples_ms.push(begin.elapsed().as_secs_f64() * 1000.0);
        }
        on_progress(Phase::Latency, 0.0, index as f64 / plan.latency_samples.max(1) as f64);
    }
    let latency = latency_stats(&samples_ms);

    // --- débits ---------------------------------------------------------------
    let (download_mbps, download_bytes) = run_throughput(plan, &plan.down, false, reporter, on_progress, &mut server)?;
    let (upload_mbps, upload_bytes) = run_throughput(plan, &plan.up, true, reporter, on_progress, &mut server)?;

    Ok(SpeedResult {
        endpoint: plan.endpoint.clone(),
        server,
        latency_ms: latency.map(|l| l.0),
        jitter_ms: latency.and_then(|l| l.1),
        latency_samples: samples_ms.len(),
        download_mbps,
        upload_mbps,
        download_bytes,
        upload_bytes,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::super::testserver::{Body, Request, Response, TestServer};
    use super::*;

    #[test]
    fn converts_bytes_and_time_to_megabits_per_second() {
        // 1 000 000 octets en 1 s = 8 Mb/s ; la conversion est décimale.
        assert!((mbps(1_000_000, Duration::from_secs(1)) - 8.0).abs() < 1e-9);
        assert!((mbps(125_000_000, Duration::from_secs(1)) - 1000.0).abs() < 1e-9);
        assert!((mbps(12_500, Duration::from_millis(10)) - 10.0).abs() < 1e-9);
        assert!(mbps(1, Duration::ZERO).is_finite());
    }

    #[test]
    fn percentiles_interpolate() {
        assert_eq!(percentile(&[], 0.5), None);
        assert_eq!(percentile(&[7.0], 0.9), Some(7.0));
        assert_eq!(percentile(&[1.0, 2.0, 3.0, 4.0, 5.0], 0.5), Some(3.0));
        assert_eq!(percentile(&[4.0, 1.0, 3.0, 2.0], 0.5), Some(2.5));
        let p90 = percentile(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0], 0.9).unwrap();
        assert!((p90 - 9.1).abs() < 1e-9, "{p90}");
    }

    #[test]
    fn latency_is_the_median_and_jitter_the_mean_consecutive_delta() {
        let (median, jitter) = latency_stats(&[10.0, 12.0, 10.0, 14.0, 10.0]).unwrap();
        assert_eq!(median, 10.0);
        // |12-10| + |10-12| + |14-10| + |10-14| = 2+2+4+4 = 12, sur 4 écarts.
        assert_eq!(jitter, Some(3.0));
        // Une valeur aberrante ne déplace pas la médiane.
        assert_eq!(latency_stats(&[10.0, 10.0, 900.0, 10.0, 10.0]).unwrap().0, 10.0);
        // Trop peu de mesures : pas de gigue plutôt qu'une gigue trompeuse.
        assert_eq!(latency_stats(&[10.0, 30.0]).unwrap().1, None);
        assert_eq!(latency_stats(&[]), None);
    }

    #[test]
    fn throughput_ignores_transfers_too_short_to_measure_bandwidth() {
        let samples = vec![
            (100_000, Duration::from_millis(5)),     // 160 Mb/s mais dominé par la latence
            (10_000_000, Duration::from_millis(800)), // 100 Mb/s
            (10_000_000, Duration::from_millis(1000)), // 80 Mb/s
        ];
        let value = throughput(&samples).unwrap();
        assert!((80.0..=100.0).contains(&value), "{value}");
        // Que des transferts courts : mieux vaut une estimation qu'un vide.
        assert!(throughput(&[(100_000, Duration::from_millis(5))]).is_some());
        assert_eq!(throughput(&[]), None);
    }

    #[test]
    fn upload_bytes_are_generated_not_taken_from_the_user() {
        let a = upload_payload(100_000);
        assert_eq!(a.len(), 100_000);
        assert_eq!(a, upload_payload(100_000), "reproductible");
        assert!(a.iter().collect::<std::collections::HashSet<_>>().len() > 200, "incompressible, pas des zéros");
        assert_eq!(upload_payload(0).len(), 0);
        assert_eq!(upload_payload(13).len(), 13);
    }

    fn fake_service() -> (TestServer, Arc<Mutex<Vec<usize>>>) {
        let uploads = Arc::new(Mutex::new(Vec::new()));
        let seen = uploads.clone();
        let server = TestServer::start(move |request: &Request| {
            if request.path.starts_with("/__down?bytes=") {
                let bytes: usize = request.path.rsplit('=').next().unwrap().parse().unwrap();
                return Response::ok(vec![0xAB; bytes])
                    .with("cf-meta-city", "Paris")
                    .with("cf-meta-colo", "CDG")
                    .with("cf-meta-country", "FR");
            }
            if request.path == "/__up" && request.method == "POST" {
                seen.lock().unwrap().push(request.body.len());
                return Response::ok(b"ok".to_vec());
            }
            Response::status(404)
        });
        (server, uploads)
    }

    fn small_plan(server: &TestServer) -> Plan {
        Plan {
            endpoint: format!("http://{}", server.addr),
            latency_samples: 6,
            down: vec![(50_000, 2), (200_000, 2)],
            up: vec![(30_000, 2)],
            streams: 2,
            parallel_from: 100_000,
            enough: Duration::from_secs(60),
            options: ClientOptions { connect_timeout: Duration::from_secs(2), read_timeout: Duration::from_secs(5) },
        }
    }

    #[test]
    fn runs_a_whole_measurement_against_a_local_service() {
        let (server, uploads) = fake_service();
        let phases = Arc::new(Mutex::new(Vec::new()));
        let seen = phases.clone();
        let result = run(&small_plan(&server), &Reporter::silent(), &move |p, _, _| seen.lock().unwrap().push(p)).unwrap();

        assert_eq!(result.latency_samples, 6);
        assert!(result.latency_ms.unwrap() >= 0.0);
        assert!(result.jitter_ms.is_some());
        assert!(result.download_mbps.unwrap() > 0.0);
        assert!(result.upload_mbps.unwrap() > 0.0);
        assert_eq!(result.server.as_deref(), Some("Paris · CDG · FR"));
        // Les octets montants ont la taille du plan : générés, pas lus ailleurs.
        assert!(uploads.lock().unwrap().iter().all(|&n| n == 30_000));
        assert_eq!(uploads.lock().unwrap().len(), 2 /* essais */);
        let phases = phases.lock().unwrap();
        assert!(phases.contains(&Phase::Latency) && phases.contains(&Phase::Download) && phases.contains(&Phase::Upload));
        // 50 000 ×2 + 200 000 ×2 (200 000 en 2 flux) = 100 000 + 800 000.
        assert_eq!(result.download_bytes, 100_000 + 2 * 2 * 200_000);
    }

    #[test]
    fn stops_escalating_once_a_transfer_is_long_enough() {
        let (server, _) = fake_service();
        let mut plan = small_plan(&server);
        plan.enough = Duration::ZERO; // le tout premier transfert suffit
        let result = run(&plan, &Reporter::silent(), &|_, _, _| {}).unwrap();
        assert_eq!(result.download_bytes, 50_000, "un seul transfert, pas d'escalade");
    }

    #[test]
    fn cancellation_interrupts_a_running_measurement() {
        let server = TestServer::start(|request: &Request| {
            if request.path.contains("bytes=0") {
                return Response::ok(vec![]);
            }
            Response {
                status: 200,
                headers: vec![("Content-Length".into(), "100000000".into())],
                body: Body::Slow { chunk: vec![1; 1000], count: 100_000, delay: Duration::from_millis(5) },
            }
        });
        let mut plan = small_plan(&server);
        plan.down = vec![(100_000_000, 1)];
        let flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let remote = flag.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            remote.store(true, Ordering::SeqCst);
        });
        let started = Instant::now();
        let error = run(&plan, &Reporter::silent_with_flag(flag), &|_, _, _| {}).unwrap_err();
        assert!(error.is_cancelled(), "{error}");
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn an_unreachable_service_gives_a_clear_error_not_a_zero() {
        let closed = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        let plan = Plan { endpoint: format!("http://127.0.0.1:{closed}"), ..Plan::default() };
        let error = run(&plan, &Reporter::silent(), &|_, _, _| {}).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Refused);
    }
}
