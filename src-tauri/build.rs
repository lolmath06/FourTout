fn main() {
    // Le manifeste Windows n'est pas laissé à `tauri-build` : il est rattaché
    // ci-dessous à toutes les cibles, et non aux seules cibles `bin`.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest()),
    )
    .expect("tauri-build n'a pas pu préparer la caisse");

    link_windows_manifest();
}

/// Rattache `windows/app.manifest` à tout ce que la caisse produit.
///
/// Tout exécutable liant `fourtout_lib` lie la pile Tauri, et importe donc des
/// points d'entrée propres à `comctl32.dll` version 6. Sans manifeste déclarant
/// cette dépendance, le chargeur résout la version 5.82 de System32 et tue le
/// processus avant `main` : 0xC0000139, STATUS_ENTRYPOINT_NOT_FOUND.
///
/// `tauri-build` compile bien un manifeste, mais `embed-resource` ne le
/// rattache qu'aux cibles `bin` (`cargo:rustc-link-arg-bins=…`). Restent
/// découverts les exemples, les tests d'intégration, et surtout l'exécutable
/// des tests unitaires de la bibliothèque — que `cargo` ne sert *ni* par
/// `rustc-link-arg-bins` *ni* par `rustc-link-arg-tests` : aucune des portées
/// que sait viser un script de construction ne l'atteint. Seule
/// `cargo:rustc-link-arg`, qui vaut pour toute cible, le couvre.
///
/// On reprend donc la charge du manifeste : `tauri-build` n'en émet plus (voir
/// `new_without_app_manifest` ci-dessus, qui évite d'avoir deux ressources
/// RT_MANIFEST d'identifiant 1 dans le binaire distribué), et `windows/app.rc`
/// porte mot pour mot le contenu de son manifeste par défaut. Hors Windows,
/// `embed-resource` ne fait rien.
fn link_windows_manifest() {
    println!("cargo:rerun-if-changed=windows/app.rc");
    println!("cargo:rerun-if-changed=windows/app.manifest");

    embed_resource::compile_for_everything("windows/app.rc", embed_resource::NONE)
        .manifest_required()
        .expect("le manifeste Common Controls v6 n'a pas pu être compilé");
}
