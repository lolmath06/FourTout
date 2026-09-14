fn main() {
    tauri_build::build();
    link_examples_manifest();
}

/// Rattache un manifeste Windows aux exécutables `example`.
///
/// `tauri-build` compile bien un manifeste — celui de l'application — mais
/// `embed-resource` ne le rattache qu'aux cibles `bin`
/// (`cargo:rustc-link-arg-bins=…`). Les exemples, qui lient pourtant la même
/// pile Tauri et importent donc des points d'entrée propres à
/// `comctl32.dll` version 6, se retrouvent sans dépendance Common Controls v6
/// et meurent avant `main` sur 0xC0000139 (STATUS_ENTRYPOINT_NOT_FOUND).
///
/// On leur rattache donc, et à eux seuls, `windows/examples.manifest`.
/// Hors Windows, `embed-resource` ne fait rien.
fn link_examples_manifest() {
    println!("cargo:rerun-if-changed=windows/examples.rc");
    println!("cargo:rerun-if-changed=windows/examples.manifest");

    embed_resource::compile_for_examples("windows/examples.rc", embed_resource::NONE)
        .manifest_required()
        .expect("le manifeste Common Controls v6 des exemples n'a pas pu être compilé");
}
