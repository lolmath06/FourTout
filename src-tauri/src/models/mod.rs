//! Gestionnaire des moteurs et modèles de parole.
//!
//! La synthèse (Piper) et la reconnaissance (whisper.cpp) reposent sur des
//! binaires et des modèles trop volumineux pour être placés dans le dépôt.
//! Ils sont donc **déclarés ici** (URL officielle, empreinte SHA-256, taille)
//! et installés explicitement par l'utilisateur, avec progression et
//! annulation. Aucun téléchargement n'a lieu de la propre initiative de
//! FourTout, et une fois installés les moteurs fonctionnent hors ligne.
//!
//! Ordre de résolution d'un binaire : ressources de l'application (installateur
//! qui embarquerait le moteur) → dossier de modèles → PATH (développement).

pub mod command;
pub mod download;

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Format d'une archive à extraire (les moteurs sont distribués ainsi).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Archive {
    /// `.tar.gz`, avec le nombre de composants de chemin à retirer en tête.
    TarGz { strip: usize },
    /// `.zip`, idem.
    Zip { strip: usize },
}

/// Un fichier à télécharger, et où il atterrit sous la racine des modèles.
#[derive(Clone, Copy, Debug)]
pub struct AssetFile {
    pub url: &'static str,
    pub sha256: &'static str,
    pub size: u64,
    /// Chemin relatif à la racine : un fichier, ou un dossier si `archive`.
    pub target: &'static str,
    pub archive: Option<Archive>,
}

/// Nature d'un élément installable, pour le regroupement dans l'interface.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssetKind {
    /// Binaire du moteur (Piper, whisper.cpp).
    Engine,
    /// Voix de synthèse.
    Voice,
    /// Modèle de reconnaissance vocale.
    SttModel,
    /// Modèle de segmentation d'image (suppression d'arrière-plan).
    Segmentation,
}

/// Un élément installable, tel que présenté à l'utilisateur.
#[derive(Clone, Copy, Debug)]
pub struct Asset {
    pub id: &'static str,
    pub kind: AssetKind,
    /// Nom lisible, jamais un identifiant technique.
    pub label: &'static str,
    pub detail: &'static str,
    /// Langue pour une voix (`fr`, `en`), `None` pour un moteur.
    pub language: Option<&'static str>,
    pub files: &'static [AssetFile],
    /// Chemins (relatifs à la racine) qui doivent exister après installation.
    pub check: &'static [&'static str],
    pub license: &'static str,
    pub source: &'static str,
}

impl Asset {
    /// Octets à télécharger pour installer cet élément.
    pub fn size(&self) -> u64 {
        self.files.iter().map(|f| f.size).sum()
    }
}

// --- Moteur Piper (synthèse) ------------------------------------------------

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
const PIPER_FILES: &[AssetFile] = &[AssetFile {
    url: "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz",
    sha256: "a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992",
    size: 26_460_462,
    target: "engines/piper",
    archive: Some(Archive::TarGz { strip: 1 }),
}];

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const PIPER_FILES: &[AssetFile] = &[AssetFile {
    url: "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip",
    sha256: "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea",
    size: 22_477_236,
    target: "engines/piper",
    archive: Some(Archive::Zip { strip: 1 }),
}];

#[cfg(not(any(
    all(target_os = "linux", target_arch = "x86_64"),
    all(target_os = "windows", target_arch = "x86_64")
)))]
const PIPER_FILES: &[AssetFile] = &[];

// --- Moteur whisper.cpp (reconnaissance) ------------------------------------

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
const WHISPER_FILES: &[AssetFile] = &[AssetFile {
    url: "https://github.com/ggml-org/whisper.cpp/releases/download/b4938/whisper-bin-ubuntu-x64.tar.gz",
    sha256: "f4cfc1f969a13805908fb72043ce7cc896eb42e0b8afbe841dc8e7298923b061",
    size: 9_503_425,
    target: "engines/whisper",
    archive: Some(Archive::TarGz { strip: 1 }),
}];

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const WHISPER_FILES: &[AssetFile] = &[AssetFile {
    url: "https://github.com/ggml-org/whisper.cpp/releases/download/b4938/whisper-bin-x64.zip",
    sha256: "c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d",
    size: 8_361_840,
    target: "engines/whisper",
    archive: Some(Archive::Zip { strip: 1 }),
}];

#[cfg(not(any(
    all(target_os = "linux", target_arch = "x86_64"),
    all(target_os = "windows", target_arch = "x86_64")
)))]
const WHISPER_FILES: &[AssetFile] = &[];

#[cfg(windows)]
const PIPER_CHECK: &[&str] = &["engines/piper/piper.exe"];
#[cfg(not(windows))]
const PIPER_CHECK: &[&str] = &["engines/piper/piper"];

#[cfg(windows)]
const WHISPER_CHECK: &[&str] = &["engines/whisper/whisper-cli.exe"];
#[cfg(not(windows))]
const WHISPER_CHECK: &[&str] = &["engines/whisper/whisper-cli"];

// --- Voix et modèles (identiques sur toutes les plateformes) ----------------

const VOICE_FR_FILES: &[AssetFile] = &[
    AssetFile {
        url: "https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx",
        sha256: "641d1ab097da2b81128c076810edb052b385decc8be3381814802a64a73baf99",
        size: 63_201_294,
        target: "voices/fr_FR-siwis-medium.onnx",
        archive: None,
    },
    AssetFile {
        url: "https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json",
        sha256: "39479916c2db192b5ac9764daddd0c744d83e023ad890c6976c0633ae4df8959",
        size: 4_875,
        target: "voices/fr_FR-siwis-medium.onnx.json",
        archive: None,
    },
];

const VOICE_EN_FILES: &[AssetFile] = &[
    AssetFile {
        url: "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx",
        sha256: "5efe09e69902187827af646e1a6e9d269dee769f9877d17b16b1b46eeaaf019f",
        size: 63_201_294,
        target: "voices/en_US-lessac-medium.onnx",
        archive: None,
    },
    AssetFile {
        url: "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json",
        sha256: "efe19c417bed055f2d69908248c6ba650fa135bc868b0e6abb3da181dab690a0",
        size: 4_885,
        target: "voices/en_US-lessac-medium.onnx.json",
        archive: None,
    },
];

const STT_BASE_FILES: &[AssetFile] = &[AssetFile {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
    size: 128_462_848,
    target: "stt/ggml-base.bin",
    archive: None,
}];

const STT_SMALL_FILES: &[AssetFile] = &[AssetFile {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
    size: 487_601_967,
    target: "stt/ggml-small.bin",
    archive: None,
}];

// --- Segmentation d'image (suppression d'arrière-plan) ----------------------
//
// U²-Net, publié sous licence Apache 2.0 — code **et** poids. C'est ce qui l'a
// fait retenir : les modèles plus récents et souvent meilleurs (RMBG de BRIA,
// MODNet) interdisent l'usage commercial de leurs poids, ce qui est
// incompatible avec la distribution de FourTout.
//
// Les fichiers sont ceux publiés par le projet `rembg`, qui héberge les
// conversions ONNX officielles de U²-Net.

const SEG_U2NETP_FILES: &[AssetFile] = &[AssetFile {
    url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx",
    sha256: "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8",
    size: 4_574_861,
    target: "segmentation/u2netp.onnx",
    archive: None,
}];

const SEG_U2NET_FILES: &[AssetFile] = &[AssetFile {
    url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx",
    sha256: "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491",
    size: 175_997_641,
    target: "segmentation/u2net.onnx",
    archive: None,
}];

/// Catalogue complet des éléments installables.
pub const CATALOG: &[Asset] = &[
    Asset {
        id: "engine-piper",
        kind: AssetKind::Engine,
        label: "Moteur de synthèse vocale (Piper)",
        detail: "Nécessaire pour toute lecture à voix haute.",
        language: None,
        files: PIPER_FILES,
        check: PIPER_CHECK,
        license: "MIT",
        source: "https://github.com/rhasspy/piper",
    },
    Asset {
        id: "voice-fr-siwis",
        kind: AssetKind::Voice,
        label: "Voix française — Siwis",
        detail: "Voix féminine française, qualité medium.",
        language: Some("fr"),
        files: VOICE_FR_FILES,
        check: &["voices/fr_FR-siwis-medium.onnx", "voices/fr_FR-siwis-medium.onnx.json"],
        license: "CC BY 4.0 (corpus SIWIS)",
        source: "https://huggingface.co/rhasspy/piper-voices",
    },
    Asset {
        id: "voice-en-lessac",
        kind: AssetKind::Voice,
        label: "Voix anglaise — Lessac",
        detail: "Voix féminine américaine, qualité medium.",
        language: Some("en"),
        files: VOICE_EN_FILES,
        check: &["voices/en_US-lessac-medium.onnx", "voices/en_US-lessac-medium.onnx.json"],
        license: "BlizzardChallenge 2013 (usage libre, non commercial pour le corpus)",
        source: "https://huggingface.co/rhasspy/piper-voices",
    },
    Asset {
        id: "engine-whisper",
        kind: AssetKind::Engine,
        label: "Moteur de transcription (whisper.cpp)",
        detail: "Nécessaire pour la transcription et les sous-titres.",
        language: None,
        files: WHISPER_FILES,
        check: WHISPER_CHECK,
        license: "MIT",
        source: "https://github.com/ggml-org/whisper.cpp",
    },
    Asset {
        id: "stt-base",
        kind: AssetKind::SttModel,
        label: "Modèle de transcription — Rapide",
        detail: "Whisper « base » multilingue : bon compromis vitesse/qualité.",
        language: None,
        files: STT_BASE_FILES,
        check: &["stt/ggml-base.bin"],
        license: "MIT",
        source: "https://huggingface.co/ggerganov/whisper.cpp",
    },
    Asset {
        id: "stt-small",
        kind: AssetKind::SttModel,
        label: "Modèle de transcription — Précis",
        detail: "Whisper « small » : nettement meilleur en français, plus lent.",
        language: None,
        files: STT_SMALL_FILES,
        check: &["stt/ggml-small.bin"],
        license: "MIT",
        source: "https://huggingface.co/ggerganov/whisper.cpp",
    },
    Asset {
        id: "seg-u2netp",
        kind: AssetKind::Segmentation,
        label: "Détourage — Rapide",
        detail: "U²-Net allégé : quelques secondes par image, suffisant pour un sujet net.",
        language: None,
        files: SEG_U2NETP_FILES,
        check: &["segmentation/u2netp.onnx"],
        license: "Apache 2.0",
        source: "https://github.com/xuebinqin/U-2-Net",
    },
    Asset {
        id: "seg-u2net",
        kind: AssetKind::Segmentation,
        label: "Détourage — Précis",
        detail: "U²-Net complet : bords plus fins (cheveux, poils), nettement plus lourd.",
        language: None,
        files: SEG_U2NET_FILES,
        check: &["segmentation/u2net.onnx"],
        license: "Apache 2.0",
        source: "https://github.com/xuebinqin/U-2-Net",
    },
];

/// Cherche un élément par identifiant.
pub fn asset(id: &str) -> Option<&'static Asset> {
    CATALOG.iter().find(|a| a.id == id)
}

/// Racine de stockage des moteurs et modèles.
///
/// `FOURTOUT_MODELS_DIR` permet aux tests (et à un utilisateur avancé) de la
/// déplacer ; sinon les données vivent dans le dossier applicatif standard.
pub fn root(app: &AppHandle) -> PathBuf {
    if let Some(dir) = std::env::var_os("FOURTOUT_MODELS_DIR") {
        return PathBuf::from(dir);
    }
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("fourtout"))
        .join("models")
}

/// Tous les fichiers attendus de cet élément sont-ils présents ?
pub fn is_installed(root: &Path, asset: &Asset) -> bool {
    !asset.files.is_empty() && asset.check.iter().all(|rel| root.join(rel).exists())
}

/// Nom d'exécutable selon la plateforme.
pub fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Localise le binaire d'un moteur de parole : embarqué dans l'application,
/// puis installé par l'utilisateur, puis PATH (pratique en développement).
pub fn resolve_engine(app: &AppHandle, engine: &str) -> Option<PathBuf> {
    let file = exe(engine_binary(engine));

    if let Ok(dir) = app.path().resource_dir() {
        for candidate in [
            dir.join("resources/speech").join(engine).join(&file),
            dir.join(engine).join(&file),
        ] {
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    let installed = root(app).join("engines").join(engine).join(&file);
    if installed.exists() {
        return Some(installed);
    }

    which(&file)
}

/// Nom du binaire fourni par chaque moteur.
fn engine_binary(engine: &str) -> &str {
    match engine {
        "whisper" => "whisper-cli",
        other => other,
    }
}

/// Recherche dans le PATH, sans dépendance externe.
fn which(file: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(file))
        .find(|candidate| candidate.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_ids_are_unique_and_described() {
        let mut ids: Vec<&str> = CATALOG.iter().map(|a| a.id).collect();
        let count = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), count, "identifiants dupliqués dans le catalogue");

        for entry in CATALOG {
            assert!(!entry.label.is_empty());
            assert!(!entry.check.is_empty());
            assert!(!entry.license.is_empty());
            assert!(entry.source.starts_with("https://"));
        }
    }

    #[test]
    fn every_downloadable_file_is_pinned() {
        for entry in CATALOG {
            for file in entry.files {
                assert!(file.url.starts_with("https://"), "{} : URL non https", entry.id);
                assert_eq!(file.sha256.len(), 64, "{} : empreinte invalide", entry.id);
                assert!(file.size > 0, "{} : taille manquante", entry.id);
                assert!(!file.target.starts_with('/'), "{} : cible absolue", entry.id);
                assert!(!file.target.contains(".."), "{} : cible remontante", entry.id);
            }
        }
    }

    #[test]
    fn voices_declare_their_language() {
        for entry in CATALOG.iter().filter(|a| a.kind == AssetKind::Voice) {
            assert!(entry.language.is_some(), "{} : langue manquante", entry.id);
        }
    }

    #[test]
    fn nothing_is_installed_in_an_empty_root() {
        let dir = std::env::temp_dir().join("fourtout-models-empty-test");
        let _ = std::fs::create_dir_all(&dir);
        for entry in CATALOG {
            assert!(!is_installed(&dir, entry));
        }
    }
}
