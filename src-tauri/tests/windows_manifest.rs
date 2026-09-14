//! Garde contre le retour du crash 0xC0000139 sous Windows.
//!
//! Tout exécutable de cette caisse lie `fourtout_lib`, donc la pile Tauri, et
//! importe des symboles que seule la version 6 de `comctl32.dll` exporte
//! (`TaskDialogIndirect`, `SetWindowSubclass`…). Sans manifeste déclarant la
//! dépendance Common Controls v6, le chargeur Windows résout la version 5.82 de
//! System32 et tue le processus avant `main`, sur STATUS_ENTRYPOINT_NOT_FOUND.
//!
//! `build.rs` rattache donc `windows/app.manifest` à *toutes* les cibles.
//! Ce fichier vérifie les deux bouts : la source du manifeste, partout, et sous
//! Windows le contenu réel des exécutables construits — les exemples, et le
//! binaire de test lui-même, qui prouve que la portée dépasse les cibles `bin`
//! et `example`.

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
    let manifest = std::fs::read_to_string(manifest_dir().join("windows/app.manifest"))
        .expect("windows/app.manifest est introuvable");

    assert!(
        manifest.contains(r#"name="Microsoft.Windows.Common-Controls""#),
        "le manifeste ne déclare plus Common Controls"
    );
    assert!(
        manifest.contains(r#"version="6.0.0.0""#),
        "le manifeste ne demande plus la version 6 : \
         la version 5.82 n'exporte pas TaskDialogIndirect"
    );

    let rc = std::fs::read_to_string(manifest_dir().join("windows/app.rc"))
        .expect("windows/app.rc est introuvable");
    assert!(
        rc.contains("app.manifest"),
        "windows/app.rc ne référence plus le manifeste"
    );
    let declaration = rc
        .lines()
        .map(str::trim)
        .find(|line| line.contains("app.manifest"))
        .expect("aucune déclaration de ressource dans windows/app.rc");
    assert!(
        declaration
            .split_whitespace()
            .collect::<Vec<_>>()
            .starts_with(&["1", "24"]),
        "le manifeste doit être la ressource RT_MANIFEST (24) d'identifiant 1, \
         sans quoi le chargeur l'ignore : {declaration}"
    );
}

/// Le manifeste doit être rattaché à *toute* cible, pas aux seules `bin`.
///
/// C'est la leçon du CI : `rustc-link-arg-bins` laissait les exemples à
/// découvert, et `rustc-link-arg-tests` ne couvre toujours pas l'exécutable des
/// tests unitaires de la bibliothèque. Seule `cargo:rustc-link-arg` les atteint
/// tous ; un retour à une portée plus étroite fait tomber cet essai.
#[test]
fn le_manifeste_est_rattache_a_toutes_les_cibles() {
    let build = std::fs::read_to_string(manifest_dir().join("build.rs"))
        .expect("build.rs est introuvable");

    assert!(
        build.contains("compile_for_everything"),
        "build.rs a repris une portée étroite : l'exécutable des tests \
         unitaires de la bibliothèque n'aurait plus de manifeste"
    );
    assert!(
        build.contains("new_without_app_manifest"),
        "tauri-build émettrait de nouveau son propre manifeste : le binaire \
         distribué porterait deux ressources RT_MANIFEST d'identifiant 1"
    );
}

/// Cherche le manifeste Common Controls v6 dans les octets d'un exécutable.
#[cfg(windows)]
fn exige_le_manifeste(exe: &Path) {
    let bytes =
        std::fs::read(exe).unwrap_or_else(|error| panic!("{} illisible : {error}", exe.display()));

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

/// Sous Windows, ce sont les **exécutables produits** qui doivent porter le
/// manifeste — pas seulement le dépôt.
///
/// `cargo test` construit les exemples ; ils sont donc à côté du binaire de
/// test. On lit leurs octets et on cherche le manifeste dans leur section de
/// ressources : si `build.rs` cesse d'émettre le lien, le motif disparaît et ce
/// test tombe, là où un test de la seule source passerait encore.
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
        exige_le_manifeste(&examples.join(format!("{name}.exe")));
    }
}

/// Le binaire de test lui-même doit porter le manifeste.
///
/// Il n'est ni `bin` ni `example` : c'est la preuve, sur un exécutable
/// réellement construit, que la portée du rattachement les dépasse. Le seul
/// exécutable qui manquait encore — celui des tests unitaires de la
/// bibliothèque — n'est atteignable par aucun test, puisqu'il se tue avant
/// `main` quand il est nu ; c'est `cargo test` qui l'éprouve.
#[cfg(windows)]
#[test]
fn le_binaire_de_test_embarque_le_manifeste() {
    exige_le_manifeste(&std::env::current_exe().expect("chemin du binaire de test"));
}
