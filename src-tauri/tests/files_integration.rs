//! Tests d'intégration du socle « Fichiers », exécutés contre les fixtures
//! réelles de `test-assets/generated/`.
//!
//! Ils vérifient ce que les tests unitaires ne peuvent pas : que les archives,
//! les documents et les dossiers **réellement produits par les générateurs**
//! sont lus correctement, et qu'une archive piégée ne peut rien écrire hors du
//! dossier choisi.
//!
//! Ils sont ignorés proprement si les fixtures n'ont pas été générées
//! (`pnpm test:assets`), pour ne pas bloquer un environnement neuf.

use std::fs;
use std::path::{Path, PathBuf};

use fourtout_lib::files::archive::{self, Format};
use fourtout_lib::files::docx;
use fourtout_lib::files::hash::{self, Algorithm};
use fourtout_lib::files::scan::{self, DuplicateOptions, TreeOptions};
use fourtout_lib::files::split;
use fourtout_lib::files::Reporter;

fn fixtures() -> Option<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent()?.join("test-assets/generated");
    if root.join("sample.zip").exists() {
        Some(root)
    } else {
        eprintln!("fixtures absentes : lancez `pnpm test:assets` — test ignoré");
        None
    }
}

fn workspace(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("fourtout-files-it-{name}"));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn reads_every_generated_archive_format() {
    let Some(root) = fixtures() else { return };

    for (file, expected) in [("sample.zip", 3), ("sample.tar", 3), ("sample.tar.gz", 3)] {
        let path = root.join(file);
        let listing = archive::list(&path).unwrap_or_else(|e| panic!("{file} : {e}"));
        assert_eq!(listing.files, expected, "{file}");
        assert_eq!(listing.rejected, 0, "{file}");

        let out = workspace(&format!("extract-{}", file.replace('.', "-")));
        let summary = archive::extract(&path, &out, true, &Reporter::silent()).unwrap();
        assert_eq!(summary.extracted, expected, "{file}");
        assert_eq!(
            fs::read_to_string(out.join("archive-source/nested/b.txt")).unwrap(),
            "Fichier B — dans un sous-dossier.\n",
            "{file}"
        );
        // Nom de fichier accentué : il doit survivre à l'aller-retour.
        assert!(out.join("archive-source/unicode-é.txt").exists(), "{file}");
    }
}

#[test]
fn round_trips_a_real_folder_through_every_format() {
    let Some(root) = fixtures() else { return };
    let source = root.join("archive-source");

    for format in [Format::Zip, Format::Tar, Format::TarGz] {
        let dir = workspace(&format!("roundtrip-{}", format.extension().replace('.', "-")));
        let members = archive::collect_members(&[source.clone()], &Reporter::silent()).unwrap();
        let output = dir.join(format!("archive.{}", format.extension()));
        archive::create(&members, &output, format, 6, &Reporter::silent()).unwrap();

        let extracted = dir.join("out");
        archive::extract(&output, &extracted, true, &Reporter::silent()).unwrap();

        // Contenu identique au bit près, fichier par fichier.
        for member in &members {
            let relative = &member.name;
            let original = hash::sha256_file(&member.source).unwrap();
            let rebuilt = hash::sha256_file(&extracted.join(relative)).unwrap();
            assert_eq!(original, rebuilt, "{relative} ({})", format.extension());
        }
    }
}

#[test]
fn refuses_the_zip_slip_fixture() {
    let Some(root) = fixtures() else { return };
    let archive_path = root.join("evil-zip-slip.zip");

    let listing = archive::list(&archive_path).unwrap();
    assert_eq!(listing.rejected, 2, "deux entrées piégées attendues");

    let dir = workspace("zip-slip");
    let destination = dir.join("out");
    let summary = archive::extract(&archive_path, &destination, true, &Reporter::silent()).unwrap();

    assert_eq!(summary.extracted, 1);
    assert_eq!(summary.skipped.len(), 2);
    assert!(destination.join("sain.txt").exists());
    // Rien n'a été écrit hors de la destination, à aucun niveau.
    assert!(!dir.join("evil.txt").exists());
    assert!(!dir.parent().unwrap().join("evil.txt").exists());
    assert!(!Path::new("/tmp/evil-absolu.txt").exists());
}

#[test]
fn hashes_a_fixture_deterministically() {
    let Some(root) = fixtures() else { return };
    let path = root.join("large-split.bin");

    let first = hash::hash_file(&path, &[Algorithm::Sha256, Algorithm::Md5], &Reporter::silent()).unwrap();
    let second = hash::hash_file(&path, &[Algorithm::Sha256, Algorithm::Md5], &Reporter::silent()).unwrap();

    assert_eq!(first.size, 2_500_000);
    assert_eq!(first.digests, second.digests, "empreinte non déterministe");
    assert_eq!(first.digests[0].0, "SHA-256");
    assert_eq!(first.digests[0].1.len(), 64);
    assert_eq!(first.digests[1].1.len(), 32);
}

#[test]
fn splits_and_rejoins_a_real_file() {
    let Some(root) = fixtures() else { return };
    let source = root.join("large-split.bin");
    let original = hash::sha256_file(&source).unwrap();

    let dir = workspace("split-join");
    let parts_dir = dir.join("parts");
    let summary = split::split_file(&source, &parts_dir, 500_000, &Reporter::silent()).unwrap();
    assert_eq!(summary.parts.len(), 5);
    assert_eq!(summary.sha256, original);

    let joined = split::join_parts(
        &parts_dir.join("large-split.bin.part001"),
        &dir.join("rebuilt"),
        &Reporter::silent(),
    )
    .unwrap();
    assert!(joined.verified);
    assert_eq!(joined.sha256, original);
    assert_eq!(hash::sha256_file(Path::new(&joined.path)).unwrap(), original);
}

#[test]
fn finds_the_expected_duplicate_group() {
    let Some(root) = fixtures() else { return };
    let report = scan::find_duplicates(
        &root.join("duplicate-folder"),
        &DuplicateOptions::default(),
        &Reporter::silent(),
    )
    .unwrap();

    assert_eq!(report.groups.len(), 1, "un seul groupe de doublons attendu");
    let names: Vec<&str> = report.groups[0].files.iter().map(|f| f.name.as_str()).collect();
    assert!(names.contains(&"original.bin"));
    assert!(names.contains(&"copy.bin"));
    assert!(names.contains(&"copy2.bin"));
    assert!(!names.contains(&"different.bin"));
    // Même taille mais contenu différent : l'empreinte complète doit trancher.
    assert!(!names.contains(&"same-size-different.bin"));
    assert_eq!(report.duplicate_files, 2);
    assert_eq!(report.reclaimable, 64 * 1024 * 2);
}

#[test]
fn analyses_the_tree_fixture() {
    let Some(root) = fixtures() else { return };
    let folder = root.join("folder-tree");

    let mut options = TreeOptions::default();
    options.max_depth = 2;
    let tree = scan::tree(&folder, &options, &Reporter::silent()).unwrap();
    assert!(tree.text.contains("src/"));
    assert!(tree.text.contains("package.json"));
    assert!(!tree.text.contains("node_modules"), "node_modules doit être ignoré");
    assert!(!tree.text.contains(".hidden-config"), "fichiers cachés masqués par défaut");
    assert!(tree.truncated, "la profondeur 2 doit tronquer l'arborescence");

    options.include_hidden = true;
    options.max_depth = 5;
    let complete = scan::tree(&folder, &options, &Reporter::silent()).unwrap();
    assert!(complete.text.contains(".hidden-config"));
    assert!(complete.text.contains("VeryDeep.tsx"));

    let stats = scan::folder_stats(&folder, &Reporter::silent()).unwrap();
    assert!(stats.files >= 8);
    assert!(stats.total_bytes > 0);
    assert!(stats.by_extension.iter().any(|entry| entry.extension == "tsx"));
}

#[test]
fn reads_the_generated_docx() {
    let Some(root) = fixtures() else { return };
    let document = docx::read(&root.join("sample.docx")).unwrap();

    let text = docx::to_text(&document);
    assert!(text.contains("Rapport FourTout"));
    assert!(text.contains("- Premier point de la liste"));
    assert!(text.contains("éàçùô"));
    // L'esperluette échappée dans le XML doit revenir en caractère.
    assert!(text.contains("esperluette &"));

    let html = docx::to_html(&document);
    assert!(html.contains("<h1>Rapport FourTout</h1>"));
    assert!(html.contains("<h2>Sous-titre</h2>"));
    assert!(html.contains("<strong>gras</strong>"));
    assert!(html.contains("<em>italique</em>"));
    assert!(html.contains("<ul>"));
    assert!(html.contains("<td>Colonne A</td>"));

    let markdown = docx::to_markdown(&document);
    assert!(markdown.contains("# Rapport FourTout"));
    assert!(markdown.contains("## Sous-titre"));
    assert!(markdown.contains("**gras**"));

    assert_eq!(document.tables, 1);
    assert_eq!(document.metadata.title.as_deref(), Some("Rapport de test FourTout"));
    assert_eq!(document.metadata.author.as_deref(), Some("Equipe FourTout"));
    assert_eq!(document.metadata.application.as_deref(), Some("FourTout test-assets"));
}

#[test]
fn detects_a_missing_part_on_a_real_split() {
    let Some(root) = fixtures() else { return };
    let dir = workspace("missing-part");
    let parts_dir = dir.join("parts");
    split::split_file(&root.join("large-split.bin"), &parts_dir, 500_000, &Reporter::silent()).unwrap();

    fs::remove_file(parts_dir.join("large-split.bin.part003")).unwrap();
    let error = split::join_parts(
        &parts_dir.join("large-split.bin.part001"),
        &dir.join("out"),
        &Reporter::silent(),
    )
    .unwrap_err();
    assert!(error.contains("manquant"), "message inattendu : {error}");
    assert!(!dir.join("out/large-split.bin").exists(), "aucun fichier trompeur ne doit rester");
}
