//! Commandes du gestionnaire de modèles.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::{asset, download, is_installed, root, Asset, AssetKind, CATALOG};

#[derive(Default)]
pub struct ModelsState {
    installs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

/// Élément installable, tel que l'interface l'affiche.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDto {
    id: String,
    kind: AssetKind,
    label: String,
    detail: String,
    language: Option<String>,
    /// Octets à télécharger.
    size: u64,
    installed: bool,
    /// Disponible pour cette plateforme (un moteur peut ne pas l'être).
    available: bool,
    license: String,
    source: String,
}

fn to_dto(entry: &Asset, installed: bool) -> AssetDto {
    AssetDto {
        id: entry.id.into(),
        kind: entry.kind,
        label: entry.label.into(),
        detail: entry.detail.into(),
        language: entry.language.map(Into::into),
        size: entry.size(),
        installed,
        available: !entry.files.is_empty(),
        license: entry.license.into(),
        source: entry.source.into(),
    }
}

/// Catalogue complet, avec l'état d'installation réel sur le disque.
#[tauri::command]
pub fn models_list(app: AppHandle) -> Vec<AssetDto> {
    let dir = root(&app);
    CATALOG
        .iter()
        .map(|entry| to_dto(entry, is_installed(&dir, entry)))
        .collect()
}

/// Emplacement de stockage, affiché dans l'interface.
#[tauri::command]
pub fn models_dir(app: AppHandle) -> String {
    root(&app).to_string_lossy().to_string()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallProgress {
    job_id: String,
    received: u64,
    total: u64,
}

/// Installe un élément : téléchargement vérifié, puis mise en place.
/// Progression par `models://progress`, annulation par `models_cancel`.
#[tauri::command]
pub async fn models_install(
    app: AppHandle,
    state: tauri::State<'_, ModelsState>,
    id: String,
    job_id: String,
) -> Result<(), String> {
    let entry = asset(&id).ok_or_else(|| format!("Élément inconnu : {id}"))?;
    let dir = root(&app);

    let cancel = Arc::new(AtomicBool::new(false));
    state.installs.lock().unwrap().insert(job_id.clone(), cancel.clone());

    let emitter = app.clone();
    let progress_job = job_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        download::install(&dir, entry, &cancel, &|received, total| {
            let _ = emitter.emit(
                "models://progress",
                InstallProgress { job_id: progress_job.clone(), received, total },
            );
        })
    })
    .await
    .unwrap_or_else(|e| Err(format!("Installation interrompue : {e}")));

    state.installs.lock().unwrap().remove(&job_id);
    result
}

/// Demande l'arrêt d'une installation ; le fichier partiel est supprimé.
#[tauri::command]
pub fn models_cancel(state: tauri::State<'_, ModelsState>, job_id: String) {
    if let Some(flag) = state.installs.lock().unwrap().get(&job_id) {
        flag.store(true, Ordering::SeqCst);
    }
}

/// Désinstalle un élément (libère la place disque).
#[tauri::command]
pub fn models_remove(app: AppHandle, id: String) -> Result<(), String> {
    let entry = asset(&id).ok_or_else(|| format!("Élément inconnu : {id}"))?;
    download::remove(&root(&app), entry)
}

/// Lit le contenu d'un fichier appartenant à un élément installé.
///
/// Les moteurs de parole s'exécutent côté natif : ils lisent leurs modèles
/// eux-mêmes. La suppression d'arrière-plan, elle, fait tourner son modèle
/// dans la WebView — il lui faut donc les octets.
///
/// Cette commande ne prend **pas** un chemin : elle prend un identifiant du
/// catalogue et un chemin déclaré par cet élément. Elle ne peut donc lire que
/// des fichiers que FourTout a lui-même installés, et jamais un fichier
/// quelconque du disque, ce qu'aurait autorisé une permission de lecture large
/// donnée au greffon système de fichiers.
#[tauri::command]
pub fn models_read_file(app: AppHandle, id: String, relative: String) -> Result<Vec<u8>, String> {
    let entry = asset(&id).ok_or_else(|| format!("Élément inconnu : {id}"))?;
    if !entry.check.contains(&relative.as_str()) {
        return Err(format!("« {relative} » n'appartient pas à l'élément {id}."));
    }
    let path = root(&app).join(&relative);
    std::fs::read(&path).map_err(|error| {
        format!("Modèle « {} » illisible : {error}. Réinstallez-le depuis Paramètres.", entry.label)
    })
}
