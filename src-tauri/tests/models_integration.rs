//! Tests d'intégration du gestionnaire de modèles, contre le **vrai** serveur.
//!
//! Ils téléchargent un petit fichier réel (la configuration d'une voix Piper,
//! moins de 5 ko) pour valider ce qui ne se simule pas : la redirection du
//! serveur, la vérification par empreinte, le nettoyage d'un fichier partiel et
//! l'annulation. Ignorés automatiquement sans réseau.

use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use fourtout_lib::models::download;
use fourtout_lib::models::{Asset, AssetFile, AssetKind};

const CONFIG_URL: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json";
const CONFIG_SHA: &str = "39479916c2db192b5ac9764daddd0c744d83e023ad890c6976c0633ae4df8959";
const CONFIG_SIZE: u64 = 4_875;

fn asset(sha256: &'static str) -> Asset {
    // `Box::leak` : le catalogue réel est `'static`, on imite cette forme.
    let files: &'static [AssetFile] = Box::leak(Box::new([AssetFile {
        url: CONFIG_URL,
        sha256,
        size: CONFIG_SIZE,
        target: "voices/test-config.json",
        archive: None,
    }]));
    Asset {
        id: "test-config",
        kind: AssetKind::Voice,
        label: "Configuration de test",
        detail: "",
        language: Some("fr"),
        files,
        check: &["voices/test-config.json"],
        license: "MIT",
        source: "https://example.com",
    }
}

fn online() -> bool {
    ureq::get("https://huggingface.co/").timeout(std::time::Duration::from_secs(8)).call().is_ok()
}

fn workspace(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Reste-t-il un fichier de travail dans `.partial` ?
fn has_partials(root: &Path) -> bool {
    std::fs::read_dir(root.join(".partial"))
        .map(|entries| entries.flatten().next().is_some())
        .unwrap_or(false)
}

#[test]
fn installs_verifies_and_removes_a_real_file() {
    if !online() {
        eprintln!("hors ligne : test ignoré");
        return;
    }
    let root = workspace("fourtout-models-install");
    let entry = asset(CONFIG_SHA);
    let cancel = AtomicBool::new(false);
    let seen: RefCell<Vec<(u64, u64)>> = RefCell::new(Vec::new());

    download::install(&root, &entry, &cancel, &|received, total| {
        seen.borrow_mut().push((received, total));
    })
    .expect("l'installation doit réussir");
    let seen = seen.into_inner();

    let installed = root.join("voices/test-config.json");
    assert!(installed.exists(), "le fichier doit être en place");
    assert_eq!(std::fs::metadata(&installed).unwrap().len(), CONFIG_SIZE);
    assert!(fourtout_lib::models::is_installed(&root, &entry));

    // Progression : croissante, jusqu'au total annoncé.
    assert!(!seen.is_empty());
    assert_eq!(seen.last().unwrap(), &(CONFIG_SIZE, CONFIG_SIZE));
    assert!(!has_partials(&root), "aucun fichier de travail ne doit rester");

    download::remove(&root, &entry).expect("la suppression doit réussir");
    assert!(!installed.exists());
    assert!(!fourtout_lib::models::is_installed(&root, &entry));

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn refuses_a_file_whose_checksum_does_not_match() {
    if !online() {
        eprintln!("hors ligne : test ignoré");
        return;
    }
    let root = workspace("fourtout-models-corrupt");
    let entry = asset("0000000000000000000000000000000000000000000000000000000000000000");
    let cancel = AtomicBool::new(false);

    let error = download::install(&root, &entry, &cancel, &|_, _| {}).unwrap_err();
    assert!(error.contains("corrompu"), "message inattendu : {error}");

    // Rien d'installé, rien de partiel : l'échec ne laisse aucune trace.
    assert!(!root.join("voices/test-config.json").exists());
    assert!(!fourtout_lib::models::is_installed(&root, &entry));
    assert!(!has_partials(&root));

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_cancelled_install_leaves_nothing_behind() {
    if !online() {
        eprintln!("hors ligne : test ignoré");
        return;
    }
    let root = workspace("fourtout-models-cancel");
    let entry = asset(CONFIG_SHA);
    // Annulation demandée avant même le premier bloc lu.
    let cancel = AtomicBool::new(true);

    let error = download::install(&root, &entry, &cancel, &|_, _| {}).unwrap_err();
    assert_eq!(error, "cancelled");
    assert!(!root.join("voices/test-config.json").exists());
    assert!(!has_partials(&root));

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn an_asset_without_files_is_reported_as_unavailable() {
    let root = workspace("fourtout-models-unavailable");
    let entry = Asset {
        id: "engine-nowhere",
        kind: AssetKind::Engine,
        label: "Moteur imaginaire",
        detail: "",
        language: None,
        files: &[],
        check: &["engines/nowhere/bin"],
        license: "MIT",
        source: "https://example.com",
    };
    let error = download::install(&root, &entry, &AtomicBool::new(false), &|_, _| {}).unwrap_err();
    assert!(error.contains("pas disponible pour cette plateforme"));
    assert!(!fourtout_lib::models::is_installed(&root, &entry));
    let _ = std::fs::remove_dir_all(&root);
}
