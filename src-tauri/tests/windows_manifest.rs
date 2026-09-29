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

/// La déclaration Common Controls telle qu'elle est écrite dans le manifeste,
/// du nom jusqu'à la version — le motif que doit porter un exécutable.
///
/// Elle est **lue dans le fichier**, jamais écrite ici en toutes lettres, et
/// elle couvre les deux attributs d'un seul tenant. Les deux points comptent.
///
/// Une chaîne littérale de ce fichier atterrit dans les données du binaire de
/// test, et c'est elle que la recherche trouvait : sous Windows, le nom du
/// premier test de ce fichier était rencontré avant la ressource, sans version
/// à portée, et l'essai annonçait un manifeste sans version 6 alors qu'il
/// n'avait lu que son propre texte. Sous Fedora, les deux littéraux tombaient
/// à 88 octets l'un de l'autre et l'essai passait sans rien prouver. Un motif
/// qui enjambe le nom *et* la version ne peut venir d'aucun littéral d'ici :
/// il n'existe que dans le manifeste et dans ce qui l'embarque.
fn declaration_attendue() -> Vec<u8> {
    let source = std::fs::read_to_string(manifest_dir().join("windows/app.manifest"))
        .expect("windows/app.manifest est introuvable");

    let nom = r#"name="Microsoft.Windows.Common-Controls""#;
    let version = r#"version="6.0.0.0""#;
    let debut = source.find(nom).expect("le manifeste ne déclare plus Common Controls");
    let fin = source[debut..]
        .find(version)
        .map(|offset| debut + offset + version.len())
        .expect("le manifeste ne demande plus la version 6 après le nom de l'assemblage");

    source.as_bytes()[debut..fin].to_vec()
}

/// `haystack` contient-il exactement cette suite d'octets ?
fn contient(haystack: &[u8], needle: &[u8]) -> bool {
    needle.len() <= haystack.len() && haystack.windows(needle.len()).any(|w| w == needle)
}

/// Le motif doit enjamber le nom et la version, et se retrouver tel quel dans
/// le manifeste — sans quoi la recherche dans les exécutables ne prouve rien.
///
/// Le piège reproduit ici est celui qui a fait tomber le CI : un nom suivi
/// d'une version trop lointaine pour être la sienne.
#[test]
fn le_motif_enjambe_le_nom_et_la_version() {
    let motif = declaration_attendue();
    let texte = String::from_utf8(motif.clone()).expect("le motif est du texte");
    assert!(texte.starts_with(r#"name="Microsoft.Windows.Common-Controls""#), "{texte}");
    assert!(texte.ends_with(r#"version="6.0.0.0""#), "{texte}");

    let source = std::fs::read(manifest_dir().join("windows/app.manifest")).unwrap();
    assert!(contient(&source, &motif), "le motif n'est pas une tranche du manifeste");

    let mut piege = Vec::new();
    piege.extend_from_slice(r#"name="Microsoft.Windows.Common-Controls""#.as_bytes());
    piege.extend_from_slice(&[b'.'; 300]);
    piege.extend_from_slice(r#"version="6.0.0.0""#.as_bytes());
    assert!(
        !contient(&piege, &motif),
        "un nom et une version qui ne se touchent pas ne sont pas une déclaration",
    );
}

/// Cherche la déclaration Common Controls v6 dans les octets d'un exécutable.
#[cfg(windows)]
fn exige_le_manifeste(exe: &Path) {
    let bytes =
        std::fs::read(exe).unwrap_or_else(|error| panic!("{} illisible : {error}", exe.display()));

    assert!(
        contient(&bytes, &declaration_attendue()),
        "{} n'embarque pas la déclaration Common Controls v6 du manifeste : il \
         mourra sur STATUS_ENTRYPOINT_NOT_FOUND avant d'atteindre main",
        exe.display(),
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
