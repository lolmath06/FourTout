//! Garde contre le retour du crash 0xC0000139 des exemples sous Windows.
//!
//! Les exemples `phase9_fixtures` et `phase11_fixtures` produisent des fixtures
//! que Node ne sait pas écrire. Ils lient `fourtout_lib`, donc la pile Tauri,
//! et importent des symboles que seule la version 6 de `comctl32.dll` exporte
//! (`TaskDialogIndirect`, `SetWindowSubclass`…). Sans manifeste déclarant la
//! dépendance Common Controls v6, le chargeur Windows résout la version 5.82 de
//! System32 et tue le processus avant `main`, sur STATUS_ENTRYPOINT_NOT_FOUND.
//!
//! `build.rs` rattache donc `windows/examples.manifest` aux cibles `example`.
//! Ce fichier vérifie les deux bouts : la source du manifeste, partout, et
//! sous Windows le contenu réel des exécutables construits.

use std::path::{Path, PathBuf};

fn manifest_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf()
}

/// La source du manifeste doit exister et déclarer Common Controls **v6**.
///
/// Vérification faite partout : sous Linux, c'est la seule chose qui empêche la
/// suppression accidentelle du fichier de passer inaperçue jusqu'au CI Windows.
#[test]
fn la_source_du_manifeste_declare_common_controls_v6() {
    let manifest = std::fs::read_to_string(manifest_dir().join("windows/examples.manifest"))
        .expect("windows/examples.manifest est introuvable");

    assert!(
        manifest.contains(r#"name="Microsoft.Windows.Common-Controls""#),
        "le manifeste des exemples ne déclare plus Common Controls"
    );
    assert!(
        manifest.contains(r#"version="6.0.0.0""#),
        "le manifeste des exemples ne demande plus la version 6 : \
         la version 5.82 n'exporte pas TaskDialogIndirect"
    );

    let rc = std::fs::read_to_string(manifest_dir().join("windows/examples.rc"))
        .expect("windows/examples.rc est introuvable");
    assert!(
        rc.contains("examples.manifest"),
        "windows/examples.rc ne référence plus le manifeste"
    );
    let declaration = rc
        .lines()
        .map(str::trim)
        .find(|line| line.contains("examples.manifest"))
        .expect("aucune déclaration de ressource dans windows/examples.rc");
    assert!(
        declaration.split_whitespace().collect::<Vec<_>>().starts_with(&["1", "24"]),
        "le manifeste doit être la ressource RT_MANIFEST (24) d'identifiant 1, \
         sans quoi le chargeur l'ignore : {declaration}"
    );
}

/// Sous Windows, ce sont les **exécutables produits** qui doivent porter le
/// manifeste — pas seulement le dépôt.
///
/// `cargo test` construit les exemples ; ils sont donc à côté du binaire de
/// test. On lit leurs octets et on cherche le manifeste dans leur section de
/// ressources : si `build.rs` cesse d'émettre `rustc-link-arg-examples`, le
/// motif disparaît et ce test tombe, là où un test de la seule source passerait
/// encore.
#[cfg(windows)]
#[test]
fn les_exemples_construits_embarquent_le_manifeste() {
    let examples = std::env::current_exe()
        .expect("chemin du binaire de test")
        .parent()
        .and_then(Path::parent)
        .expect("dossier de profil")
        .join("examples");

    for name in ["phase9_fixtures", "phase11_fixtures"] {
        let exe = examples.join(format!("{name}.exe"));
        let bytes = std::fs::read(&exe)
            .unwrap_or_else(|error| panic!("{} illisible : {error}", exe.display()));

        let needle = b"Microsoft.Windows.Common-Controls";
        let at = bytes
            .windows(needle.len())
            .position(|window| window == needle)
            .unwrap_or_else(|| {
                panic!(
                    "{} n'embarque aucun manifeste Common Controls : il mourra sur \
                     STATUS_ENTRYPOINT_NOT_FOUND avant d'atteindre main",
                    exe.display()
                )
            });

        // La version compte autant que le nom : c'est elle qui écarte la 5.82.
        let end = (at + needle.len() + 256).min(bytes.len());
        assert!(
            bytes[at..end].windows(7).any(|window| window == b"6.0.0.0"),
            "{} déclare Common Controls sans exiger la version 6",
            exe.display()
        );
    }
}
