//! yt-dlp : téléchargement de médias publics depuis des services en ligne.
//!
//! **Pourquoi pas dans le dépôt.** yt-dlp évolue chaque semaine parce que les
//! sites changent : un binaire figé cesserait de fonctionner. Il est donc
//! installé **à la demande**, par une action explicite de l'utilisateur, dans le
//! dossier de données de FourTout — jamais ailleurs, jamais en arrière-plan.
//!
//! **Ce que FourTout ne fait pas.** Pas de contournement de DRM, de
//! restriction d'accès ou de paiement ; pas de cookies de navigateur (la
//! configuration utilisateur de yt-dlp est ignorée) ; pas d'identifiants.
//!
//! **Confiance.** Le binaire vient de la page officielle des publications de
//! yt-dlp, et son empreinte SHA-256 est comparée à celle du fichier
//! `SHA2-256SUMS` de la même publication, avant d'être mis en place. Cela
//! garantit l'intégrité du transfert, pas l'honnêteté de GitHub.

pub mod command;
pub mod info;
pub mod plan;
pub mod run;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::exec::{exe, find_in_path};
use crate::files::Reporter;
use crate::internet::download::{self, DownloadParams};
use crate::internet::http::{self, agent, fetch, read_limited, ClientOptions, ErrorKind, InternetError};

/// Page des dernières publications, et préfixe des fichiers publiés.
#[derive(Debug, Clone)]
pub struct Source {
    pub latest_page: String,
    pub download_base: String,
}

impl Default for Source {
    fn default() -> Self {
        Self {
            latest_page: "https://github.com/yt-dlp/yt-dlp/releases/latest".into(),
            download_base: "https://github.com/yt-dlp/yt-dlp/releases/download".into(),
        }
    }
}

/// Fichier de la publication qui convient à cette plateforme.
pub fn asset_name() -> Option<&'static str> {
    if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Some("yt-dlp_linux")
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Some("yt-dlp.exe")
    } else {
        None
    }
}

pub fn install_dir(models_root: &Path) -> PathBuf {
    models_root.join("engines").join("yt-dlp")
}

pub fn binary_path(models_root: &Path) -> PathBuf {
    install_dir(models_root).join(exe("yt-dlp"))
}

pub fn cache_dir(models_root: &Path) -> PathBuf {
    install_dir(models_root).join("cache")
}

#[derive(Debug, Serialize, Deserialize)]
struct Installed {
    version: String,
    sha256: String,
}

/// D'où vient l'exécutable utilisé.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Origin {
    /// Installé par FourTout.
    Managed,
    /// Trouvé dans le PATH du système (installé par l'utilisateur).
    System,
}

/// Exécutable à utiliser : celui de FourTout d'abord, sinon celui du système.
pub fn resolve(models_root: &Path) -> Option<(PathBuf, Origin)> {
    let managed = binary_path(models_root);
    if managed.is_file() {
        return Some((managed, Origin::Managed));
    }
    find_in_path("yt-dlp").map(|p| (p, Origin::System))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub installed: bool,
    pub origin: Option<Origin>,
    pub path: Option<String>,
    pub version: Option<String>,
    /// Cette plateforme dispose d'un binaire officiel autonome.
    pub supported: bool,
    pub directory: String,
    /// Un moteur JavaScript est présent : certains formats YouTube en dépendent.
    pub js_runtime: Option<String>,
}

fn run_version(binary: &Path) -> Option<String> {
    let mut command = Command::new(binary);
    command.arg("--version");
    let (status, out) = crate::proc::capture(&mut command, Duration::from_secs(30)).ok()?;
    status.success().then(|| out.trim().to_string()).filter(|v| !v.is_empty())
}

pub fn status(models_root: &Path) -> Status {
    let resolved = resolve(models_root);
    let version = resolved.as_ref().and_then(|(path, origin)| match origin {
        Origin::Managed => fs::read(install_dir(models_root).join("version.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Installed>(&b).ok())
            .map(|i| i.version)
            .or_else(|| run_version(path)),
        Origin::System => run_version(path),
    });
    Status {
        installed: resolved.is_some(),
        origin: resolved.as_ref().map(|r| r.1),
        path: resolved.as_ref().map(|r| r.0.to_string_lossy().to_string()),
        version,
        supported: asset_name().is_some(),
        directory: install_dir(models_root).to_string_lossy().to_string(),
        js_runtime: ["deno", "node", "bun"].into_iter().find(|n| find_in_path(n).is_some()).map(str::to_string),
    }
}

/// Ligne `<sha256>  <fichier>` de `SHA2-256SUMS`.
pub fn parse_sums(text: &str, file: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next()?.trim_start_matches('*');
        (name == file && hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit())).then(|| hash.to_ascii_lowercase())
    })
}

/// Une étiquette de publication yt-dlp : `2025.10.22` ou `2025.10.22.1`.
pub fn is_release_tag(tag: &str) -> bool {
    let parts: Vec<&str> = tag.split('.').collect();
    (3..=4).contains(&parts.len())
        && parts[0].len() == 4
        && parts.iter().all(|p| !p.is_empty() && p.len() <= 4 && p.chars().all(|c| c.is_ascii_digit()))
}

/// Dernière version publiée, lue dans l'adresse vers laquelle GitHub redirige
/// « /releases/latest » (aucune API, donc aucune limite de débit anonyme).
pub fn latest_tag(source: &Source, options: &ClientOptions) -> Result<String, InternetError> {
    let url = http::parse_url(&source.latest_page)?;
    let fetched = fetch(&agent(options), "GET", &url, &[])?;
    let tag = fetched.final_url.path_segments().and_then(|mut s| s.next_back()).unwrap_or("").to_string();
    if is_release_tag(&tag) {
        Ok(tag)
    } else {
        Err(InternetError::new(ErrorKind::Other, "La dernière version de yt-dlp n'a pas pu être identifiée."))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallSummary {
    pub version: String,
    pub sha256: String,
    pub path: String,
}

/// Installe (ou met à jour) yt-dlp.
///
/// `validate` lance le binaire téléchargé et rend sa version : un fichier dont
/// l'empreinte est juste mais qui ne s'exécute pas ne remplace jamais l'ancien.
pub fn install(
    models_root: &Path,
    source: &Source,
    options: &ClientOptions,
    validate: &dyn Fn(&Path) -> Option<String>,
    reporter: &Reporter,
) -> Result<InstallSummary, InternetError> {
    let asset = asset_name()
        .ok_or_else(|| InternetError::new(ErrorKind::Unsupported, "Aucun binaire yt-dlp officiel n'existe pour cette plateforme."))?;
    reporter.check().map_err(|_| InternetError::cancelled())?;

    let tag = latest_tag(source, options)?;
    let base = source.download_base.trim_end_matches('/');

    // 1. L'empreinte officielle de cette publication.
    let sums_url = http::parse_url(&format!("{base}/{tag}/SHA2-256SUMS"))?;
    let fetched = fetch(&agent(options), "GET", &sums_url, &[])?;
    if fetched.response.status() >= 400 {
        return Err(InternetError::status(fetched.response.status()));
    }
    let sums = String::from_utf8_lossy(&read_limited(fetched.response, 256 * 1024)?).to_string();
    let expected = parse_sums(&sums, asset)
        .ok_or_else(|| InternetError::new(ErrorKind::Checksum, "L'empreinte officielle de yt-dlp est introuvable : installation annulée."))?;

    // 2. Téléchargement dans un fichier provisoire, vérifié par empreinte.
    let dir = install_dir(models_root);
    fs::create_dir_all(&dir).map_err(|e| InternetError::new(ErrorKind::Destination, format!("Dossier d'installation inaccessible : {e}")))?;
    let staged = dir.join(format!("{}.new", exe("yt-dlp")));
    let _ = fs::remove_file(&staged);
    let summary = download::download(
        &DownloadParams {
            url: format!("{base}/{tag}/{asset}"),
            destination: staged.clone(),
            overwrite: true,
            resume: false,
            expected_sha256: Some(expected.clone()),
            options: options.clone(),
        },
        reporter,
    )?;

    // 3. Il doit s'exécuter, et annoncer la version attendue.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&staged, fs::Permissions::from_mode(0o755));
    }
    let announced = validate(&staged);
    if announced.as_deref() != Some(tag.as_str()) {
        let _ = fs::remove_file(&staged);
        return Err(InternetError::new(
            ErrorKind::Other,
            "Le fichier téléchargé ne s'exécute pas correctement : l'installation précédente est conservée.",
        ));
    }

    // 4. Remplacement : l'ancien est mis de côté, restauré en cas d'échec.
    let target = binary_path(models_root);
    let backup = dir.join(format!("{}.old", exe("yt-dlp")));
    let _ = fs::remove_file(&backup);
    if target.exists() {
        fs::rename(&target, &backup)
            .map_err(|e| InternetError::new(ErrorKind::Destination, format!("Remplacement impossible (yt-dlp est-il en cours d'utilisation ?) : {e}")))?;
    }
    if let Err(error) = fs::rename(&staged, &target) {
        let _ = fs::rename(&backup, &target);
        let _ = fs::remove_file(&staged);
        return Err(InternetError::new(ErrorKind::Destination, format!("Mise en place impossible : {error}")));
    }
    let _ = fs::remove_file(&backup);
    let record = Installed { version: tag.clone(), sha256: summary.sha256.clone() };
    let _ = fs::write(dir.join("version.json"), serde_json::to_vec_pretty(&record).unwrap_or_default());

    Ok(InstallSummary { version: tag, sha256: summary.sha256, path: target.to_string_lossy().to_string() })
}

/// Production : le binaire se valide en demandant sa version.
pub fn validate_by_running(path: &Path) -> Option<String> {
    run_version(path)
}

/// Supprime yt-dlp et son cache.
pub fn remove(models_root: &Path) -> Result<(), InternetError> {
    let dir = install_dir(models_root);
    if dir.exists() {
        fs::remove_dir_all(&dir)
            .map_err(|e| InternetError::new(ErrorKind::Destination, format!("Suppression impossible : {e}")))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_official_checksums() {
        let sums = "\
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  yt-dlp\n\
5d41402abc4b2a76b9719d911017c592e3b0c44298fc1c149afbf4c8996fb92 *yt-dlp.exe\n\
ABCDEF0123456789abcdef0123456789ABCDEF0123456789abcdef0123456789  yt-dlp_linux\n\
tropcourt  yt-dlp_macos\n";
        assert_eq!(parse_sums(sums, "yt-dlp").unwrap().len(), 64);
        assert_eq!(parse_sums(sums, "yt-dlp_linux").unwrap(), "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
        assert!(parse_sums(sums, "yt-dlp.exe").is_none(), "empreinte de 63 caractères : refusée");
        assert!(parse_sums(sums, "yt-dlp_macos").is_none());
        assert!(parse_sums(sums, "inexistant").is_none());
        assert!(parse_sums("", "yt-dlp").is_none());
    }

    #[test]
    fn only_release_tags_are_accepted_as_versions() {
        for good in ["2025.10.22", "2024.01.01.1", "2026.10.19"] {
            assert!(is_release_tag(good), "{good}");
        }
        for bad in ["latest", "", "2025.10", "v2025.10.22", "2025.10.22.1.5", "../../etc", "2025.10.2x", "20251.1.1"] {
            assert!(!is_release_tag(bad), "{bad}");
        }
    }

    #[test]
    fn the_install_location_is_inside_the_given_root() {
        let root = Path::new("/données/fourtout/models");
        assert!(binary_path(root).starts_with(root));
        assert!(cache_dir(root).starts_with(root));
        assert_eq!(binary_path(root).file_name().unwrap().to_string_lossy(), exe("yt-dlp"));
    }

    #[test]
    fn status_without_any_install_is_an_honest_absence() {
        let empty = std::env::temp_dir().join(format!("fourtout-ytdlp-empty-{}", std::process::id()));
        let status = status(&empty);
        // Hors PATH, rien n'est installé ; si l'utilisateur en a un système, on le dit.
        assert_eq!(status.installed, status.origin.is_some());
        assert!(status.directory.contains("yt-dlp"));
        assert_eq!(status.supported, asset_name().is_some());
        if status.origin != Some(Origin::System) {
            assert!(!status.installed && status.version.is_none() && status.path.is_none());
        }
    }

    use crate::internet::testserver::{Request, Response, TestServer};
    use sha2::{Digest, Sha256};

    fn release_server(binary: Vec<u8>, sums_hash: Option<String>) -> (TestServer, Source) {
        let asset = asset_name().unwrap_or("yt-dlp_linux").to_string();
        let hash = sums_hash.unwrap_or_else(|| Sha256::digest(&binary).iter().map(|b| format!("{b:02x}")).collect());
        let sums = format!("{hash}  {asset}\n");
        let route = asset.clone();
        let server = TestServer::start(move |r: &Request| match r.path.as_str() {
            "/releases/latest" => Response::redirect(302, "/releases/tag/2099.01.01"),
            "/releases/tag/2099.01.01" => Response::ok(b"<html></html>".to_vec()),
            "/dl/2099.01.01/SHA2-256SUMS" => Response::ok(sums.clone().into_bytes()),
            p if p == format!("/dl/2099.01.01/{route}") => Response::ok(binary.clone()),
            _ => Response::status(404),
        });
        let source = Source { latest_page: server.url("/releases/latest"), download_base: server.url("/dl") };
        (server, source)
    }

    fn root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fourtout-ytdlp-install-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn installs_a_verified_binary_and_records_its_version() {
        if asset_name().is_none() {
            return;
        }
        let (_server, source) = release_server(b"binaire factice".to_vec(), None);
        let dir = root("ok");
        let summary = install(&dir, &source, &ClientOptions::default(), &|_| Some("2099.01.01".into()), &Reporter::silent()).unwrap();
        assert_eq!(summary.version, "2099.01.01");
        assert_eq!(fs::read(binary_path(&dir)).unwrap(), b"binaire factice");
        assert_eq!(status(&dir).version.as_deref(), Some("2099.01.01"));
        // Rien d'autre que le binaire, son cache éventuel et la version.
        let names: Vec<_> = fs::read_dir(install_dir(&dir)).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
        assert!(!names.iter().any(|n| n.ends_with(".new") || n.ends_with(".old") || n.contains("part")), "{names:?}");

        // Mise à jour : l'ancien est remplacé.
        let (_server2, source2) = release_server(b"nouvelle version".to_vec(), None);
        install(&dir, &source2, &ClientOptions::default(), &|_| Some("2099.01.01".into()), &Reporter::silent()).unwrap();
        assert_eq!(fs::read(binary_path(&dir)).unwrap(), b"nouvelle version");
        remove(&dir).unwrap();
        assert!(!install_dir(&dir).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_wrong_checksum_or_a_binary_that_will_not_run_never_replaces_the_current_one() {
        if asset_name().is_none() {
            return;
        }
        let dir = root("bad");
        let (_s, good) = release_server(b"bon".to_vec(), None);
        install(&dir, &good, &ClientOptions::default(), &|_| Some("2099.01.01".into()), &Reporter::silent()).unwrap();

        let (_s, tampered) = release_server(b"piege".to_vec(), Some("00".repeat(32)));
        let error = install(&dir, &tampered, &ClientOptions::default(), &|_| Some("2099.01.01".into()), &Reporter::silent()).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Checksum);
        assert_eq!(fs::read(binary_path(&dir)).unwrap(), b"bon");

        let (_s, broken) = release_server(b"ne marche pas".to_vec(), None);
        let error = install(&dir, &broken, &ClientOptions::default(), &|_| None, &Reporter::silent()).unwrap_err();
        assert!(error.message.contains("conservée"), "{error}");
        assert_eq!(fs::read(binary_path(&dir)).unwrap(), b"bon");

        // Version annoncée différente de la publication : refusé.
        let (_s, liar) = release_server(b"autre".to_vec(), None);
        assert!(install(&dir, &liar, &ClientOptions::default(), &|_| Some("1999.01.01".into()), &Reporter::silent()).is_err());
        assert_eq!(fs::read(binary_path(&dir)).unwrap(), b"bon");
        let _ = fs::remove_dir_all(&dir);
    }
}
