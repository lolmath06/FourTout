// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    apply_linux_webkit_workarounds();
    fourtout_lib::run()
}

/// Contournements WebKitGTK spécifiques à Linux.
///
/// Sur cette pile (NVIDIA + Mesa/nouveau + Wayland, WebKitGTK 2.46), le
/// moteur de rendu DMABUF laisse des surfaces fantômes à l'écran (morceaux
/// d'anciens composants persistants) et peut faire planter le compositeur.
///
/// A/B testé sur la machine Fedora de développement : avec le rendu DMABUF
/// actif, une WebView hors-écran plante (SIGTRAP) ; avec
/// `WEBKIT_DISABLE_DMABUF_RENDERER=1`, elle fonctionne et les artefacts
/// disparaissent. On bascule donc sur le chemin de rendu de repli (toujours
/// accéléré, sans passer par DMABUF), à l'impact négligeable pour une interface
/// utilitaire.
///
/// On ne l'impose que si l'utilisateur n'a rien défini, pour rester surchargé.
/// Windows (WebView2) n'est jamais concerné.
#[cfg(target_os = "linux")]
fn apply_linux_webkit_workarounds() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

#[cfg(not(target_os = "linux"))]
fn apply_linux_webkit_workarounds() {}
