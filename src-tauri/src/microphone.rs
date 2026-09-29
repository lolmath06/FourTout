//! Autorisation microphone.
//!
//! Sous Linux, la WebView de FourTout est WebKitGTK. Deux verrous y bloquent
//! `getUserMedia` avant même que l'utilisateur puisse répondre :
//!
//! 1. `WebKitSettings:enable-media-stream` vaut `FALSE` par défaut ; sans lui,
//!    la capture est purement et simplement désactivée ;
//! 2. WebKitGTK n'affiche aucun dialogue de permission : il délègue la décision
//!    à l'application hôte via le signal `permission-request`. Sans
//!    gestionnaire, la demande est refusée d'office et la page reçoit un
//!    `NotAllowedError` — exactement le symptôme observé.
//!
//! Ce module branche les deux : la capture est activée au démarrage (sans rien
//! demander), et la demande est arbitrée par un état de session que seul
//! l'utilisateur peut faire passer à « autorisé », via un vrai dialogue natif
//! déclenché par la commande `mic_request_permission`.
//!
//! Rien n'est demandé au lancement : l'outil « Enregistrer au micro » est le
//! seul déclencheur. Sur les autres systèmes, la WebView (WKWebView, WebView2)
//! s'appuie sur les réglages de l'OS : FourTout n'ajoute pas son propre filtre.

use std::sync::atomic::{AtomicU8, Ordering};

const PROMPT: u8 = 0;
const GRANTED: u8 = 1;
const DENIED: u8 = 2;

/// Décision de l'utilisateur pour la session en cours. Volontairement non
/// persistée : un refus ne condamne pas l'outil au prochain démarrage.
static STATE: AtomicU8 = AtomicU8::new(PROMPT);

fn label(state: u8) -> &'static str {
    match state {
        GRANTED => "granted",
        DENIED => "denied",
        _ => "prompt",
    }
}

/// État courant : `"granted"`, `"denied"` ou `"prompt"`.
#[tauri::command]
pub fn mic_permission_state() -> String {
    if cfg!(target_os = "linux") {
        label(STATE.load(Ordering::SeqCst)).to_string()
    } else {
        // L'OS pose lui-même la question lors du `getUserMedia`.
        "granted".to_string()
    }
}

/// Pose la question à l'utilisateur et mémorise sa réponse. Renvoie `true` si
/// l'accès est accordé.
#[tauri::command]
pub async fn mic_request_permission(app: tauri::AppHandle) -> bool {
    if !cfg!(target_os = "linux") {
        return true;
    }

    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    // `blocking_show` ne doit pas tourner sur le thread principal : il y
    // attendrait une réponse que seule la boucle GTK peut produire.
    let granted = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .message(
                "FourTout souhaite utiliser votre microphone pour enregistrer un son.\n\n\
                 L'enregistrement reste sur votre appareil : rien n'est envoyé sur le réseau.",
            )
            .title("Autoriser le microphone ?")
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Autoriser".into(),
                "Refuser".into(),
            ))
            .blocking_show()
    })
    .await
    .unwrap_or(false);

    STATE.store(if granted { GRANTED } else { DENIED }, Ordering::SeqCst);
    granted
}

/// Autorise la capture côté WebKitGTK et arbitre les demandes de permission.
/// Appelé une fois au démarrage ; n'ouvre aucun micro par lui-même.
#[cfg(target_os = "linux")]
pub fn attach<R: tauri::Runtime>(webview: &tauri::WebviewWindow<R>) {
    use webkit2gtk::glib::prelude::Cast;
    use webkit2gtk::{
        DeviceInfoPermissionRequest, PermissionRequestExt, SettingsExt, UserMediaPermissionRequest,
        UserMediaPermissionRequestExt, WebViewExt,
    };

    let _ = webview.with_webview(|platform| {
        let view = platform.inner();

        // Sans ce réglage, WebKitGTK n'émet même pas de demande de permission.
        if let Some(settings) = WebViewExt::settings(&view) {
            settings.set_enable_media_stream(true);
        }

        view.connect_permission_request(|_, request| {
            let allowed = STATE.load(Ordering::SeqCst) == GRANTED;

            if let Some(media) = request.dynamic_cast_ref::<UserMediaPermissionRequest>() {
                // FourTout n'a besoin que du micro : toute demande incluant la
                // caméra est refusée, même micro autorisé.
                let audio_only = media.is_for_audio_device() && !media.is_for_video_device();
                if audio_only && allowed {
                    request.allow();
                } else {
                    request.deny();
                }
                return true;
            }

            // `enumerateDevices` ne révèle le nom des micros qu'une fois
            // l'accès accordé ; cette demande suit donc la même décision.
            if request
                .dynamic_cast_ref::<DeviceInfoPermissionRequest>()
                .is_some()
            {
                if allowed {
                    request.allow();
                } else {
                    request.deny();
                }
                return true;
            }

            // Géolocalisation, notifications, etc. : non gérées ici, WebKit
            // applique son refus par défaut.
            false
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_cover_every_state() {
        assert_eq!(label(PROMPT), "prompt");
        assert_eq!(label(GRANTED), "granted");
        assert_eq!(label(DENIED), "denied");
    }

    #[test]
    fn starts_without_any_permission() {
        // Aucune autorisation implicite au démarrage : le micro n'est jamais
        // ouvert tant que l'utilisateur n'a pas répondu.
        assert_eq!(STATE.load(Ordering::SeqCst), PROMPT);
        assert_eq!(mic_permission_state(), if cfg!(target_os = "linux") { "prompt" } else { "granted" });
    }
}
