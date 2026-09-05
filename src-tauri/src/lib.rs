//! Cœur natif de FourTout.
//!
//! Phase 1 : l'application est entièrement rendue par le frontend. Ce module
//! n'expose donc qu'une commande d'information, utilisée pour vérifier que le
//! pont IPC fonctionne. Les phases suivantes y brancheront les traitements qui
//! doivent être natifs (ffmpeg, OCR, chiffrement, accès disque), en gardant la
//! règle : tout se fait localement, rien n'est envoyé sur le réseau.

pub mod image_native;
pub mod media;
pub mod microphone;
pub mod models;
pub mod recovery;
pub mod speech;

use serde::Serialize;

#[derive(Serialize)]
pub struct AppInfo {
    name: String,
    version: String,
    os: String,
    arch: String,
}

/// Informations d'exécution, affichables dans les Paramètres.
#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "FourTout".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // WebKitGTK refuse toute capture tant que l'hôte n'arbitre pas les
            // demandes de permission : on branche l'arbitrage dès le départ.
            // Aucune autorisation n'est demandée ici (voir `microphone`).
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    microphone::attach(&window);
                }
            }
            let _ = app;
            Ok(())
        })
        .manage(recovery::command::RecoveryState::default())
        .manage(media::command::MediaState::default())
        .manage(models::command::ModelsState::default())
        .manage(speech::command::SpeechState::default())
        .invoke_handler(tauri::generate_handler![
            app_info,
            image_native::encode_webp,
            media::command::media_available,
            media::command::media_temp,
            media::command::media_encoders,
            media::command::media_probe_encoders,
            media::command::media_reset_encoder_probes,
            media::command::media_stage,
            media::command::media_probe,
            media::command::media_read,
            media::command::media_cleanup,
            media::command::media_exec,
            media::command::media_cancel,
            microphone::mic_permission_state,
            microphone::mic_request_permission,
            models::command::models_list,
            models::command::models_dir,
            models::command::models_install,
            models::command::models_cancel,
            models::command::models_remove,
            speech::command::tts_speak,
            speech::command::tts_concat,
            speech::command::stt_transcribe,
            speech::command::speech_cancel,
            recovery::command::recover_password,
            recovery::command::recover_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au démarrage de FourTout");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_reports_current_build() {
        let info = app_info();
        assert_eq!(info.name, "FourTout");
        assert!(!info.version.is_empty());
        assert!(!info.os.is_empty());
        assert!(!info.arch.is_empty());
    }
}
