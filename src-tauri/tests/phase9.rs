//! Tests d'intégration de la phase 9, sur les **vraies fixtures** du dépôt.
//!
//! Les tests unitaires de chaque module fabriquent leurs propres données : ils
//! vérifient une logique. Ceux-ci vérifient autre chose — que les moteurs
//! s'entendent avec des fichiers produits **ailleurs**, par du code JavaScript
//! indépendant : une archive ZIP écrite par Node, un manifeste au format
//! `sha256sum`, une arborescence Unicode sur un vrai disque.
//!
//! Ils supposent `pnpm test:assets` passé. En son absence, ils s'annoncent
//! ignorés plutôt que de mentir en passant à vide.

use std::fs;
use std::path::{Path, PathBuf};

use fourtout_lib::files::archive::{self, Verdict};
use fourtout_lib::files::backup::{self, RestoreMode};
use fourtout_lib::files::compare::{self, CompareMode, EntryStatus};
use fourtout_lib::files::compress::{self, StreamFormat};
use fourtout_lib::files::hash::sha256_file;
use fourtout_lib::files::hex::{self, HexPatch};
use fourtout_lib::files::manifest::{self, CheckStatus};
use fourtout_lib::files::search::{self, SearchQuery};
use fourtout_lib::files::sync::{self, ChangeTest, SyncMode, SyncRequest};
use fourtout_lib::files::walk::{self, WalkOptions};
use fourtout_lib::files::Reporter;

fn assets() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../test-assets/generated")
}

/// Fixtures présentes ? Sinon le test s'abstient, bruyamment.
fn require(relative: &str) -> Option<PathBuf> {
    let path = assets().join(relative);
    if path.exists() {
        Some(path)
    } else {
        eprintln!(
            "fixture absente : {} — lancez `pnpm test:assets`, test ignoré",
            path.display()
        );
        None
    }
}

/// Dossier de travail jetable, distinct par test.
fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join("fourtout-phase9-integration").join(name);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// Copie récursive, pour ne jamais modifier une fixture en place.
fn copy_tree(source: &Path, destination: &Path) {
    fs::create_dir_all(destination).unwrap();
    for entry in fs::read_dir(source).unwrap().flatten() {
        let target = destination.join(entry.file_name());
        if entry.path().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), &target).unwrap();
        }
    }
}

/// Les deux arborescences ont-elles exactement les mêmes fichiers, au contenu
/// près ? C'est le seul contrôle qui vaille après une copie ou une restauration.
fn assert_identical(left: &Path, right: &Path) {
    let options = WalkOptions::default();
    let (a, _) = walk::collect(left, &options, &Reporter::silent()).unwrap();
    let (b, _) = walk::collect(right, &options, &Reporter::silent()).unwrap();
    let names = |entries: &[walk::WalkEntry]| {
        entries.iter().map(|entry| entry.relative.clone()).collect::<Vec<_>>()
    };
    assert_eq!(names(&a), names(&b), "arborescences différentes");
    for entry in a.iter().filter(|entry| !entry.is_dir) {
        assert_eq!(
            sha256_file(&left.join(&entry.relative)).unwrap(),
            sha256_file(&right.join(&entry.relative)).unwrap(),
            "contenu différent pour {}",
            entry.relative
        );
    }
}

/* ------------------------------------------------------- comparaison */

#[test]
fn compares_the_fixture_folders_in_both_modes() {
    let (Some(left), Some(right)) =
        (require("folder-compare-left"), require("folder-compare-right"))
    else {
        return;
    };
    let request = |mode| compare::CompareRequest {
        left: left.to_string_lossy().to_string(),
        right: right.to_string_lossy().to_string(),
        mode,
        walk: WalkOptions::default(),
    };

    let quick = compare::compare(&request(CompareMode::Quick), &Reporter::silent()).unwrap();
    assert_eq!(quick.left_only, 1, "only-left.txt");
    assert_eq!(quick.right_only, 1, "only-right.txt");
    assert_eq!(quick.hashed_bytes, 0, "le mode rapide ne lit aucun octet");
    // Les deux pièges de la fixture passent inaperçus en mode rapide.
    for trap in ["changed.txt", "nested/same-size.bin"] {
        let entry = quick.entries.iter().find(|entry| entry.relative == trap).unwrap();
        assert_eq!(entry.status, EntryStatus::Same, "{trap}");
        assert!(!entry.content_checked);
    }
    // La taille différente, elle, se voit sans rien lire.
    let resized =
        quick.entries.iter().find(|entry| entry.relative == "nested/changed-size.bin").unwrap();
    assert_eq!(resized.status, EntryStatus::Different);

    let reliable = compare::compare(&request(CompareMode::Reliable), &Reporter::silent()).unwrap();
    for trap in ["changed.txt", "nested/same-size.bin"] {
        let entry = reliable.entries.iter().find(|entry| entry.relative == trap).unwrap();
        assert_eq!(entry.status, EntryStatus::Different, "{trap}");
        assert!(entry.content_checked);
    }
    assert_eq!(reliable.different, 3, "deux pièges + la taille différente");
    let same = reliable.entries.iter().find(|entry| entry.relative == "same.txt").unwrap();
    assert_eq!(same.status, EntryStatus::Same);
    // L'entrée accentuée est rapprochée des deux côtés.
    assert!(reliable
        .entries
        .iter()
        .any(|entry| entry.relative == "dossier accentué/fichier é à ü.txt"
            && entry.status == EntryStatus::Same));
}

/* ---------------------------------------------------- synchronisation */

fn sync_request(source: &Path, destination: &Path, mode: SyncMode) -> SyncRequest {
    SyncRequest {
        source: source.to_string_lossy().to_string(),
        destination: destination.to_string_lossy().to_string(),
        mode,
        test: ChangeTest::Content,
        walk: WalkOptions::default(),
    }
}

#[test]
fn update_sync_on_real_folders_keeps_extra_files() {
    let (Some(source), Some(fixture)) =
        (require("sync-source"), require("sync-destination-update"))
    else {
        return;
    };
    let workspace = scratch("sync-update");
    let destination = workspace.join("destination");
    copy_tree(&fixture, &destination);

    let plan =
        sync::build_plan(&sync_request(&source, &destination, SyncMode::Update), &Reporter::silent())
            .unwrap();
    assert_eq!(plan.deletions, 0, "le mode mise à jour ne supprime jamais");
    assert!(plan.copies >= 4);
    assert_eq!(plan.replacements, 1, "modifie.txt");
    assert_eq!(plan.unchanged, 1, "identique.txt");

    // Le plan seul n'a rien touché.
    assert_eq!(fs::read(destination.join("modifie.txt")).unwrap(), b"Vieille version.\n");

    let outcome =
        sync::execute(&source, &destination, &plan.operations, &Reporter::silent()).unwrap();
    assert!(outcome.complete(), "{:?}", outcome.failed);
    assert_eq!(
        fs::read(destination.join("modifie.txt")).unwrap(),
        fs::read(source.join("modifie.txt")).unwrap()
    );
    assert!(destination.join("en-trop.txt").exists(), "fichier supplémentaire conservé");
    assert!(destination.join("dossier-en-trop/orphelin.txt").exists());
    assert_eq!(
        fs::read(destination.join("accents éàü çñ.txt")).unwrap(),
        fs::read(source.join("accents éàü çñ.txt")).unwrap()
    );
}

#[test]
fn mirror_sync_makes_the_destination_byte_identical() {
    let (Some(source), Some(fixture)) =
        (require("sync-source"), require("sync-destination-mirror"))
    else {
        return;
    };
    let workspace = scratch("sync-mirror");
    let destination = workspace.join("destination");
    copy_tree(&fixture, &destination);

    let plan =
        sync::build_plan(&sync_request(&source, &destination, SyncMode::Mirror), &Reporter::silent())
            .unwrap();
    assert!(plan.deletions >= 3, "en-trop.txt, orphelin.txt et son dossier");
    assert!(plan.freed_bytes > 0);

    let outcome =
        sync::execute(&source, &destination, &plan.operations, &Reporter::silent()).unwrap();
    assert!(outcome.complete(), "{:?}", outcome.failed);
    assert!(!destination.join("en-trop.txt").exists());
    assert!(!destination.join("dossier-en-trop").exists());
    assert_identical(&source, &destination);

    // Rejouer le miroir ne trouve plus rien à faire.
    let again =
        sync::build_plan(&sync_request(&source, &destination, SyncMode::Mirror), &Reporter::silent())
            .unwrap();
    assert!(again.is_empty(), "{:?}", again.operations);
}

/* -------------------------------------------------------------- recherche */

#[test]
fn searches_the_fixture_tree_by_name_size_and_content() {
    let Some(root) = require("search-tree") else { return };
    let base = || SearchQuery { root: root.to_string_lossy().to_string(), ..Default::default() };

    let mut by_name = base();
    by_name.name = "facture".into();
    let hits = search::search(&by_name, &Reporter::silent()).unwrap();
    assert_eq!(hits.hits.len(), 1);
    assert_eq!(hits.hits[0].name, "facture-2024.md");

    let mut by_extension = base();
    by_extension.extensions = vec!["csv".into(), "json".into()];
    assert_eq!(search::search(&by_extension, &Reporter::silent()).unwrap().hits.len(), 2);

    let mut by_size = base();
    by_size.min_size = Some(1024 * 1024);
    let big = search::search(&by_size, &Reporter::silent()).unwrap();
    assert_eq!(big.hits.len(), 1);
    assert_eq!(big.hits[0].relative, "sous-dossier/gros.bin");

    let mut by_content = base();
    by_content.content = "FourTout".into();
    let found = search::search(&by_content, &Reporter::silent()).unwrap();
    let names: Vec<&str> = found.hits.iter().map(|hit| hit.relative.as_str()).collect();
    assert!(names.contains(&"notes.txt"));
    assert!(names.contains(&"config.json"));
    // Les trois encodages sont lus correctement.
    assert!(names.contains(&"encodages/utf16le.txt"));
    assert!(names.contains(&"encodages/utf8-bom.txt"));
    assert!(names.contains(&"encodages/windows-1252.txt"));
    // Et le binaire qui contient pourtant le mot n'est jamais retenu.
    assert!(
        !names.contains(&"piege-binaire.bin"),
        "un binaire ne doit jamais être interprété comme du texte"
    );
    assert!(found.binary_skipped >= 1);

    let utf16 = found.hits.iter().find(|hit| hit.relative == "encodages/utf16le.txt").unwrap();
    assert_eq!(utf16.encoding.as_deref(), Some("utf-16le"));

    // Recherche non récursive : le sous-dossier disparaît.
    let mut flat = base();
    flat.name = "rapport".into();
    assert_eq!(search::search(&flat, &Reporter::silent()).unwrap().hits.len(), 1);
    flat.walk.recursive = false;
    assert!(search::search(&flat, &Reporter::silent()).unwrap().hits.is_empty());
}

/* --------------------------------------------------------- analyse d'espace */

#[test]
fn space_analysis_totals_match_the_fixture_to_the_byte() {
    let Some(root) = require("space-analysis") else { return };
    let stats =
        fourtout_lib::files::scan::folder_stats(&root, &Reporter::silent()).unwrap();
    // 5 + 2 + 1 + 1,5 Mio + 64 + 512 + 32 Kio
    let expected = (5 + 2 + 1) * 1024 * 1024 + 1536 * 1024 + (64 + 512 + 32) * 1024;
    assert_eq!(stats.total_bytes, expected as u64);
    assert_eq!(stats.files, 7);
    assert_eq!(stats.directories, 3);
    assert_eq!(stats.largest[0].name, "large.bin");
    let children: Vec<&str> = stats.children.iter().map(|c| c.name.as_str()).collect();
    assert!(children.contains(&"images"));
    assert!(children.contains(&"documents"));
    assert!(stats.by_extension.iter().any(|entry| entry.extension == "bin"));
}

/* ------------------------------------------------------------ hexadécimal */

#[test]
fn hex_reads_finds_and_writes_without_touching_the_original() {
    let Some(source) = require("hex-pattern.bin") else { return };
    let before = fs::read(&source).unwrap();

    // La fixture porte 00..FF, puis « FourTout », puis DE AD BE EF.
    let window = hex::read_window(&source, 0, 256).unwrap();
    assert_eq!(window.bytes.len(), 256);
    assert_eq!(window.bytes[0], 0x00);
    assert_eq!(window.bytes[255], 0xFF);

    assert_eq!(hex::find(&source, b"FourTout", 0, &Reporter::silent()).unwrap(), Some(256));
    assert_eq!(
        hex::find(&source, &[0xDE, 0xAD, 0xBE, 0xEF], 0, &Reporter::silent()).unwrap(),
        Some(264)
    );

    let workspace = scratch("hex");
    let destination = workspace.join("modifie.bin");
    let summary = hex::write_patched(
        &source,
        &destination,
        &[HexPatch { offset: 256, bytes: b"QUATRE!!".to_vec() }],
        &Reporter::silent(),
    )
    .unwrap();
    assert!(!summary.in_place);

    assert_eq!(fs::read(&source).unwrap(), before, "l'original doit rester intact");
    let after = fs::read(&destination).unwrap();
    assert_eq!(after.len(), before.len(), "la taille ne change jamais");
    assert_eq!(&after[256..264], b"QUATRE!!");
    assert_eq!(&after[..256], &before[..256]);
    assert_eq!(&after[264..], &before[264..]);

    // Une modification hors du fichier est refusée, et ne produit rien.
    let refused = workspace.join("jamais.bin");
    assert!(hex::write_patched(
        &source,
        &refused,
        &[HexPatch { offset: before.len() as u64, bytes: vec![1] }],
        &Reporter::silent(),
    )
    .is_err());
    assert!(!refused.exists());
}

/* ------------------------------------------------ sauvegarde et restauration */

#[test]
fn backup_verify_restore_round_trip_on_the_fixture() {
    let Some(source) = require("backup-source") else { return };
    let workspace = scratch("backup");
    let backup_root = workspace.join("sauvegarde");
    let restored = workspace.join("restaure");

    let summary = backup::create(
        &backup::BackupRequest {
            source: source.to_string_lossy().to_string(),
            destination: backup_root.to_string_lossy().to_string(),
            walk: WalkOptions::default(),
        },
        &Reporter::silent(),
    )
    .unwrap();
    assert!(summary.complete());
    assert_eq!(summary.files, 5);

    // Le manifeste ne contient aucun chemin absolu : il reste portable.
    let manifest_text = fs::read_to_string(backup_root.join(backup::MANIFEST_NAME)).unwrap();
    assert!(!manifest_text.contains(&source.to_string_lossy().to_string()));

    let report = backup::verify(&backup_root, &Reporter::silent()).unwrap();
    assert!(report.intact());
    assert_eq!(report.ok, 5);

    let restore =
        backup::restore(&backup_root, &restored, RestoreMode::Overwrite, &Reporter::silent())
            .unwrap();
    assert!(restore.complete());
    assert_identical(&source, &restored);

    // Une sauvegarde abîmée doit être désignée précisément.
    fs::write(
        backup_root.join(backup::DATA_DIRECTORY).join("notes.txt"),
        b"contenu falsifie",
    )
    .unwrap();
    let broken = backup::verify(&backup_root, &Reporter::silent()).unwrap();
    assert!(!broken.intact());
    assert_eq!(broken.modified, 1);
    assert_eq!(
        broken
            .checks
            .iter()
            .find(|check| check.state == backup::EntryState::Modified)
            .unwrap()
            .path,
        "notes.txt"
    );
}

/// La sauvegarde déjà abîmée du dépôt : un fichier modifié, un autre disparu.
/// La vérification doit les désigner nommément, et non se contenter d'un
/// « quelque chose ne va pas ».
#[test]
fn names_the_damaged_files_of_the_broken_backup_fixture() {
    let Some(root) = require("backup-corrompu") else { return };
    let report = backup::verify(&root, &Reporter::silent()).unwrap();

    assert!(!report.intact());
    assert_eq!(report.modified, 1);
    assert_eq!(report.missing, 1);
    assert_eq!(report.ok, 3);
    assert_eq!(
        report.checks.iter().find(|c| c.state == backup::EntryState::Modified).unwrap().path,
        "notes.txt"
    );
    assert_eq!(
        report.checks.iter().find(|c| c.state == backup::EntryState::Missing).unwrap().path,
        "binaire.bin"
    );

    // Et la restauration d'une telle sauvegarde le dit, plutôt que de remettre
    // le fichier abîmé en place en silence.
    let destination = scratch("restore-broken");
    let summary =
        backup::restore(&root, &destination, RestoreMode::Overwrite, &Reporter::silent()).unwrap();
    assert!(!summary.complete());
    assert_eq!(summary.corrupted, vec!["notes.txt".to_string()]);
    assert!(summary.failed.iter().any(|entry| entry.starts_with("binaire.bin")));
}

/* -------------------------------------------------------------- manifestes */

#[test]
fn verifies_the_reference_checksum_manifests() {
    let Some(root) = require("checksum-set") else { return };

    let valid = require("checksums-valid.sha256").unwrap();
    let report = manifest::verify(&valid, &root, &Reporter::silent()).unwrap();
    assert!(report.valid(), "{:?}", report.results);
    assert_eq!(report.ok, 4);
    assert_eq!(report.algorithm, "SHA-256");

    let bad = require("checksums-one-bad.sha256").unwrap();
    let report = manifest::verify(&bad, &root, &Reporter::silent()).unwrap();
    assert_eq!(report.mismatched, 1);
    assert_eq!(
        report.results.iter().find(|r| r.status == CheckStatus::Mismatch).unwrap().relative,
        "readme.txt"
    );

    let missing = require("checksums-missing.sha256").unwrap();
    let report = manifest::verify(&missing, &root, &Reporter::silent()).unwrap();
    assert_eq!(report.missing, 1);

    // Les deux entrées hostiles sont refusées, et rien n'est lu hors du dossier.
    let traversal = require("checksums-traversal.sha256").unwrap();
    let report = manifest::verify(&traversal, &root, &Reporter::silent()).unwrap();
    assert_eq!(report.refused, 2);
    assert_eq!(report.ok, 4, "les entrées légitimes restent vérifiées");
}

#[test]
fn creates_a_manifest_that_verifies_against_the_fixture() {
    let Some(root) = require("checksum-set") else { return };
    let workspace = scratch("manifest");
    let output = workspace.join("produit.sha256");

    let summary = manifest::create(
        &manifest::ManifestRequest {
            root: root.to_string_lossy().to_string(),
            files: Vec::new(),
            algorithm: fourtout_lib::files::hash::Algorithm::Sha256,
            format: manifest::ManifestFormat::Text,
            output: output.to_string_lossy().to_string(),
            walk: WalkOptions::default(),
        },
        &Reporter::silent(),
    )
    .unwrap();
    assert_eq!(summary.files, 4);

    // Le manifeste produit et celui de référence désignent les mêmes empreintes.
    let reference = fs::read_to_string(require("checksums-valid.sha256").unwrap()).unwrap();
    let produced = fs::read_to_string(&output).unwrap();
    let digests = |text: &str| {
        let mut lines: Vec<String> =
            text.lines().filter(|line| !line.trim().is_empty()).map(str::to_string).collect();
        lines.sort();
        lines
    };
    assert_eq!(digests(&produced), digests(&reference));

    assert!(manifest::verify(&output, &root, &Reporter::silent()).unwrap().valid());
}

/* ----------------------------------------------------------------- archives */

/// Formats d'archive dont une fixture saine existe.
fn archive_fixtures() -> Vec<(&'static str, &'static str)> {
    vec![
        ("archive-sample.zip", "zip"),
        ("archive-sample.tar", "tar"),
        ("archive-sample.tar.gz", "tar.gz"),
        ("archive-sample.tar.xz", "tar.xz"),
        ("archive-sample.7z", "7z"),
    ]
}

#[test]
fn lists_tests_and_extracts_every_archive_fixture() {
    let Some(original) = require("archive-sample") else { return };

    for (name, extension) in archive_fixtures() {
        let Some(path) = require(name) else { continue };

        // 1. Lister : rien n'est décompressé, et rien n'est refusé.
        let listing = archive::list(&path).unwrap();
        assert_eq!(listing.files, 4, "{name}");
        assert_eq!(listing.rejected, 0, "{name}");
        assert!(listing.entries.iter().any(|entry| entry.name.contains("unicode")), "{name}");

        // 2. Tester : tout se décompresse et les sommes de contrôle passent.
        let report = archive::test(&path, None, &Reporter::silent()).unwrap();
        assert_eq!(report.verdict, Verdict::Valid, "{name} : {}", report.detail);
        assert_eq!(report.checked, 4, "{name}");

        // 3. Extraire, et comparer octet par octet au dossier d'origine.
        let destination = scratch(&format!("archive-{extension}")).join("out");
        let summary = archive::extract(&path, &destination, true, &Reporter::silent()).unwrap();
        assert_eq!(summary.extracted, 4, "{name}");
        assert!(summary.skipped.is_empty(), "{name}");
        assert_identical(&original, &destination.join("archive-sample"));
    }
}

#[test]
fn refuses_every_damaged_archive_fixture() {
    for name in [
        "archive-corrupt.zip",
        "archive-truncated.zip",
        "archive-truncated.tar",
        "archive-corrupt.tar.gz",
        "archive-truncated.tar.gz",
        "archive-corrupt.tar.xz",
        "archive-truncated.tar.xz",
        "archive-corrupt.7z",
        "archive-truncated.7z",
    ] {
        let Some(path) = require(name) else { continue };
        let report = archive::test(&path, None, &Reporter::silent()).unwrap();
        assert_ne!(report.verdict, Verdict::Valid, "{name} acceptée à tort : {}", report.detail);
        assert!(!report.failures.is_empty() || report.verdict == Verdict::Incomplete, "{name}");
    }
}

/// Le TAR nu n'a aucune somme de contrôle de contenu : une altération des
/// données y est **indétectable**, et FourTout doit le dire plutôt que de
/// laisser croire à une garantie qu'il ne peut pas offrir.
#[test]
fn says_plainly_what_a_tar_test_cannot_prove() {
    let Some(path) = require("archive-corrupt.tar") else { return };
    let report = archive::test(&path, None, &Reporter::silent()).unwrap();
    assert_eq!(report.verdict, Verdict::Valid, "la structure, elle, reste conforme");
    assert!(
        report.detail.contains("aucune somme de contrôle du contenu"),
        "le verdict doit énoncer la limite du format : {}",
        report.detail
    );

    // Le même contenu, en TAR.GZ, est bel et bien détecté comme abîmé.
    if let Some(compressed) = require("archive-corrupt.tar.gz") {
        let report = archive::test(&compressed, None, &Reporter::silent()).unwrap();
        assert_ne!(report.verdict, Verdict::Valid);
    }
}

#[test]
fn never_writes_a_traversal_entry_outside_the_destination() {
    for name in ["archive-traversal.zip", "archive-traversal.tar", "archive-traversal.7z"] {
        let Some(path) = require(name) else { continue };

        let listing = archive::list(&path).unwrap();
        assert!(listing.rejected >= 1, "{name} : entrée piégée non détectée");

        let workspace = scratch(&format!("traversal-{}", name.replace('.', "-")));
        let destination = workspace.join("profond/destination");
        let summary = archive::extract(&path, &destination, true, &Reporter::silent()).unwrap();

        assert_eq!(summary.extracted, 1, "{name} : seule l'entrée saine doit sortir");
        assert!(destination.join("sain.txt").exists(), "{name}");
        // Rien n'a été écrit au-dessus de la destination.
        for depth in [workspace.as_path(), workspace.join("profond").as_path()] {
            for entry in fs::read_dir(depth).unwrap().flatten() {
                let file = entry.file_name().to_string_lossy().to_string();
                assert!(
                    !file.contains("evade"),
                    "{name} : « {file} » écrit hors de la destination"
                );
            }
        }
    }
}

#[test]
fn warns_about_an_absurd_compression_ratio() {
    let Some(path) = require("archive-bombe.zip") else { return };
    let listing = archive::list(&path).unwrap();
    assert!(
        listing.suspicious,
        "un rapport de {} pour 1 devrait alerter",
        listing.total_size / listing.archive_size.max(1)
    );
}

/* ------------------------------------------------- compression d'un fichier */

#[test]
fn round_trips_the_lone_file_through_gz_and_xz() {
    let Some(source) = require("lone-file.txt") else { return };
    let expected = sha256_file(&source).unwrap();
    let workspace = scratch("stream");

    for (fixture, format) in
        [("lone-file.txt.gz", StreamFormat::Gz), ("lone-file.txt.xz", StreamFormat::Xz)]
    {
        let Some(compressed) = require(fixture) else { continue };

        // Le flux se teste sans rien écrire…
        let produced = compress::test_stream(&compressed, format, &Reporter::silent()).unwrap();
        assert_eq!(produced, fs::metadata(&source).unwrap().len(), "{fixture}");

        // … puis se décompresse à l'identique.
        let restored = workspace.join(format!("restaure-{}.txt", format.extension()));
        compress::decompress(&compressed, &restored, format, &Reporter::silent()).unwrap();
        assert_eq!(sha256_file(&restored).unwrap(), expected, "{fixture}");

        // Et un aller-retour complet par nos propres soins redonne les mêmes octets.
        let again = workspace.join(format!("aller.{}", format.extension()));
        compress::compress(&source, &again, format, 6, &Reporter::silent()).unwrap();
        let back = workspace.join(format!("retour-{}.txt", format.extension()));
        compress::decompress(&again, &back, format, &Reporter::silent()).unwrap();
        assert_eq!(sha256_file(&back).unwrap(), expected, "{fixture}");
    }
}

#[test]
fn refuses_damaged_streams() {
    for (fixture, format) in [
        ("lone-file-truncated.txt.gz", StreamFormat::Gz),
        ("lone-file-corrupt.txt.gz", StreamFormat::Gz),
        ("lone-file-truncated.txt.xz", StreamFormat::Xz),
        ("lone-file-corrupt.txt.xz", StreamFormat::Xz),
    ] {
        let Some(path) = require(fixture) else { continue };
        assert!(
            compress::test_stream(&path, format, &Reporter::silent()).is_err(),
            "{fixture} accepté à tort"
        );
    }
}

/* ----------------------------------------------------------- non-régression */

#[test]
fn phase_8_zip_reader_still_reads_a_docx() {
    let Some(path) = require("compare.docx").or_else(|| {
        let legacy = Path::new(env!("CARGO_MANIFEST_DIR")).join("../test-assets/compare.docx");
        legacy.exists().then_some(legacy)
    }) else {
        return;
    };
    // Le lecteur ZIP ajouté en phase 8 pour DOCX ne doit pas avoir souffert de
    // la restructuration des archives.
    let document = fourtout_lib::files::docx::read(&path).unwrap();
    assert!(!document.blocks.is_empty());
}

/* ------------------------------------------------------------ performance */

/// Mesures sur une arborescence de 5 000 fichiers.
///
/// Volontairement `#[ignore]` : ce n'est pas une assertion de justesse mais une
/// mesure, et un seuil de temps dans une suite de tests finit toujours par
/// échouer sur une machine chargée. Elle se lance à la demande :
/// `cargo test --test phase9 -- --ignored --nocapture`.
///
/// Les bornes posées ici sont larges d'un ordre de grandeur : elles ne
/// signalent pas une lenteur, elles attrapent un O(n²) ou une allocation
/// absurde qui se serait glissée quelque part.
#[test]
#[ignore]
fn measures_five_thousand_files() {
    let Some(root) = require("perf-tree") else { return };
    let reporter = Reporter::silent();

    let started = std::time::Instant::now();
    let (entries, _) = walk::collect(&root, &WalkOptions::default(), &reporter).unwrap();
    let walked = started.elapsed();
    let files = entries.iter().filter(|entry| !entry.is_dir).count();
    assert_eq!(files, 5000);
    println!("parcours          : {files} fichiers en {walked:?}");

    let started = std::time::Instant::now();
    let mut query = SearchQuery { root: root.to_string_lossy().to_string(), ..Default::default() };
    query.content = "FourTout".into();
    let found = search::search(&query, &reporter).unwrap();
    println!(
        "recherche contenu : {} résultats sur {} fichiers lus en {:?}",
        found.hits.len(),
        found.read_files,
        started.elapsed()
    );
    assert_eq!(found.hits.len(), 50, "un fichier sur cent porte le mot");

    let workspace = scratch("perf");
    let copy = workspace.join("copie");
    copy_tree(&root, &copy);

    let started = std::time::Instant::now();
    let report = compare::compare(
        &compare::CompareRequest {
            left: root.to_string_lossy().to_string(),
            right: copy.to_string_lossy().to_string(),
            mode: CompareMode::Reliable,
            walk: WalkOptions::default(),
        },
        &reporter,
    )
    .unwrap();
    println!("comparaison fiable: {} entrées en {:?}", report.entries.len(), started.elapsed());
    assert_eq!(report.different, 0);

    let started = std::time::Instant::now();
    let manifest_path = workspace.join("perf.sha256");
    let summary = manifest::create(
        &manifest::ManifestRequest {
            root: root.to_string_lossy().to_string(),
            files: Vec::new(),
            algorithm: fourtout_lib::files::hash::Algorithm::Sha256,
            format: manifest::ManifestFormat::Text,
            output: manifest_path.to_string_lossy().to_string(),
            walk: WalkOptions::default(),
        },
        &reporter,
    )
    .unwrap();
    println!("manifeste         : {} empreintes en {:?}", summary.files, started.elapsed());

    let started = std::time::Instant::now();
    let stats = fourtout_lib::files::scan::folder_stats(&root, &reporter).unwrap();
    println!("analyse d'espace  : {} octets en {:?}", stats.total_bytes, started.elapsed());
    assert_eq!(stats.files, 5000);
}

/// Mesure sur un **gros fichier**, produit puis supprimé : il ne doit jamais
/// être commité, et l'empreinte comme l'aperçu doivent s'en accommoder sans
/// charger un octet de plus que leur bloc de lecture.
#[test]
#[ignore]
fn measures_a_large_file() {
    let workspace = scratch("perf-large");
    let large = workspace.join("gros.bin");

    // 512 Mio écrits par blocs : le générateur lui-même ne doit pas tout tenir
    // en mémoire, sans quoi la mesure porterait sur lui.
    let block = vec![0x5A_u8; 4 * 1024 * 1024];
    {
        use std::io::Write;
        let mut file = std::io::BufWriter::new(fs::File::create(&large).unwrap());
        for _ in 0..128 {
            file.write_all(&block).unwrap();
        }
        file.flush().unwrap();
    }
    let size = fs::metadata(&large).unwrap().len();
    assert_eq!(size, 512 * 1024 * 1024);

    let started = std::time::Instant::now();
    let digest = sha256_file(&large).unwrap();
    println!("SHA-256 de 512 Mio : {:?} ({digest:.16}…)", started.elapsed());

    let started = std::time::Instant::now();
    let window = hex::read_window(&large, size - 4096, 4096).unwrap();
    println!("fenêtre hex en fin : {:?}", started.elapsed());
    assert_eq!(window.bytes.len(), 4096);

    // Copie réelle du gros fichier par le moteur de synchronisation : elle doit
    // passer par des blocs, pas par un `read_to_end`.
    let source_dir = workspace.join("source");
    fs::create_dir_all(&source_dir).unwrap();
    fs::rename(&large, source_dir.join("gros.bin")).unwrap();
    let destination = workspace.join("copie");
    let started = std::time::Instant::now();
    let plan = sync::build_plan(
        &sync_request(&source_dir, &destination, SyncMode::Update),
        &Reporter::silent(),
    )
    .unwrap();
    let outcome =
        sync::execute(&source_dir, &destination, &plan.operations, &Reporter::silent()).unwrap();
    println!("copie de 512 Mio   : {:?}", started.elapsed());
    assert!(outcome.complete());
    assert_eq!(
        sha256_file(&destination.join("gros.bin")).unwrap(),
        digest,
        "la copie doit être identique à l'octet près"
    );

    // Le gros fichier ne survit pas au test : il n'a rien à faire sur le disque
    // de qui que ce soit, et encore moins dans le dépôt.
    fs::remove_dir_all(&workspace).unwrap();
}

/// Les plages divergentes entre deux fichiers de la fixture de comparaison.
/// C'est ce qui permet de répondre à « pourquoi ces deux fichiers
/// diffèrent-ils ? » sans charger un octet de plus qu'un bloc.
#[test]
fn locates_the_differing_ranges_of_the_compare_fixture() {
    let (Some(left), Some(right)) =
        (require("folder-compare-left"), require("folder-compare-right"))
    else {
        return;
    };

    // `changed.txt` : même longueur, un mot différent au même endroit.
    let diff = fourtout_lib::files::command::binary_diff(
        &left.join("changed.txt"),
        &right.join("changed.txt"),
        16,
        &Reporter::silent(),
    )
    .unwrap();
    assert_eq!(diff.size_a, diff.size_b);
    assert!(!diff.ranges.is_empty());
    assert!(diff.differing_bytes > 0);
    assert!(!diff.truncated);
    // La première divergence tombe bien à l'endroit du mot changé.
    let first = diff.ranges[0].offset as usize;
    let a = fs::read(left.join("changed.txt")).unwrap();
    let b = fs::read(right.join("changed.txt")).unwrap();
    assert_ne!(a[first], b[first]);
    assert_eq!(&a[..first], &b[..first]);

    // `nested/changed-size.bin` : longueurs différentes. La divergence de
    // taille est une plage à part entière, qui commence où le plus court finit.
    let diff = fourtout_lib::files::command::binary_diff(
        &left.join("nested/changed-size.bin"),
        &right.join("nested/changed-size.bin"),
        16,
        &Reporter::silent(),
    )
    .unwrap();
    assert_ne!(diff.size_a, diff.size_b);
    let tail = diff.ranges.last().unwrap();
    assert_eq!(tail.offset, diff.size_a.min(diff.size_b));
    assert_eq!(tail.length, diff.size_a.max(diff.size_b) - diff.size_a.min(diff.size_b));

    // Deux fichiers identiques n'ont aucune plage.
    let diff = fourtout_lib::files::command::binary_diff(
        &left.join("same.txt"),
        &right.join("same.txt"),
        16,
        &Reporter::silent(),
    )
    .unwrap();
    assert!(diff.ranges.is_empty());
    assert_eq!(diff.differing_bytes, 0);
}

/* ------------------------------------------------------- contrat de fixtures */

/// Les moteurs sont-ils d'accord avec ce que les fixtures contiennent
/// réellement ?
///
/// `scripts/fixture-contract.mjs` observe le disque et écrit ce constat dans
/// `CONTRAT.json`. Ce test compare la sortie des moteurs à ce constat. Il
/// existe parce qu'une recette manuelle avait dérivé des fixtures — elle
/// annonçait quatre fichiers `.txt` là où il y en avait six, et un total
/// d'octets faux. Désormais, aucune valeur attendue ne se recopie : elle se
/// dérive, et l'écart se voit ici.
#[test]
fn engines_agree_with_the_fixture_contract() {
    let Some(path) = require("CONTRAT.json") else { return };
    let contract: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    let reporter = Reporter::silent();

    let number = |pointer: &str| -> u64 {
        contract.pointer(pointer).and_then(|v| v.as_u64()).unwrap_or_else(|| {
            panic!("contrat incomplet : {pointer}");
        })
    };
    let list = |pointer: &str| -> Vec<String> {
        contract
            .pointer(pointer)
            .and_then(|v| v.as_array())
            .unwrap_or_else(|| panic!("contrat incomplet : {pointer}"))
            .iter()
            .filter_map(|entry| entry.as_str().map(str::to_string))
            .collect()
    };

    // --- recherche -------------------------------------------------------
    let search_root = assets().join("search-tree");
    let query = |build: &dyn Fn(&mut SearchQuery)| {
        let mut query =
            SearchQuery { root: search_root.to_string_lossy().to_string(), ..Default::default() };
        build(&mut query);
        let mut names: Vec<String> = search::search(&query, &reporter)
            .unwrap()
            .hits
            .into_iter()
            .map(|hit| hit.relative)
            .collect();
        names.sort();
        names
    };

    let txt = query(&|q| q.extensions = vec!["txt".into()]);
    assert_eq!(txt.len() as u64, number("/rechercheArborescence/fichiersTxt"));
    assert_eq!(txt, list("/rechercheArborescence/listeTxt"));

    let containing = query(&|q| q.content = "FourTout".into());
    assert_eq!(
        containing,
        list("/rechercheArborescence/contenantFourTout"),
        "la recherche de contenu doit trouver exactement les fichiers qui portent le mot"
    );
    // Et jamais le binaire qui le contient pourtant.
    let trap = contract
        .pointer("/rechercheArborescence/piegeBinaire")
        .and_then(|v| v.as_str())
        .unwrap();
    assert!(!containing.iter().any(|entry| entry == trap));

    let large = query(&|q| q.min_size = Some(1024 * 1024));
    assert_eq!(large, list("/rechercheArborescence/fichiersAuMoins1Mio"));

    // --- comparaison de dossiers ----------------------------------------
    let report = compare::compare(
        &compare::CompareRequest {
            left: assets().join("folder-compare-left").to_string_lossy().to_string(),
            right: assets().join("folder-compare-right").to_string_lossy().to_string(),
            mode: CompareMode::Reliable,
            walk: WalkOptions::default(),
        },
        &reporter,
    )
    .unwrap();
    let status_paths = |status: EntryStatus| {
        let mut names: Vec<String> = report
            .entries
            .iter()
            .filter(|entry| entry.status == status && !entry.is_dir)
            .map(|entry| entry.relative.clone())
            .collect();
        names.sort();
        names
    };
    assert_eq!(status_paths(EntryStatus::Different), list("/comparaisonDossiers/differents"));
    assert_eq!(status_paths(EntryStatus::LeftOnly), list("/comparaisonDossiers/gaucheUniquement"));
    assert_eq!(status_paths(EntryStatus::RightOnly), list("/comparaisonDossiers/droiteUniquement"));
    assert_eq!(report.hashed_bytes, number("/comparaisonDossiers/octetsRelusEnModeFiable"));

    // --- synchronisation -------------------------------------------------
    let workspace = scratch("contract-sync");
    let destination = workspace.join("destination");
    copy_tree(&assets().join("sync-destination-update"), &destination);
    let plan = sync::build_plan(
        &sync_request(&assets().join("sync-source"), &destination, SyncMode::Update),
        &reporter,
    )
    .unwrap();
    assert_eq!(plan.copies as u64, list("/synchronisation/aCopier").len() as u64);
    assert_eq!(plan.replacements as u64, list("/synchronisation/aRemplacer").len() as u64);
    assert_eq!(plan.unchanged as u64, list("/synchronisation/inchanges").len() as u64);
    assert_eq!(plan.directories as u64, list("/synchronisation/dossiersACreer").len() as u64);
    assert_eq!(plan.bytes, number("/synchronisation/octetsAEcrire"));
    assert_eq!(
        plan.operations.len(),
        plan.copies + plan.replacements + plan.directories,
        "le total d'opérations est la somme des trois, pas un quatrième chiffre"
    );

    let mirror_destination = workspace.join("miroir");
    copy_tree(&assets().join("sync-destination-mirror"), &mirror_destination);
    let mirror = sync::build_plan(
        &sync_request(&assets().join("sync-source"), &mirror_destination, SyncMode::Mirror),
        &reporter,
    )
    .unwrap();
    assert_eq!(mirror.deletions as u64, list("/synchronisation/aSupprimerEnMiroir").len() as u64);

    // --- analyse d'espace ------------------------------------------------
    let stats = fourtout_lib::files::scan::folder_stats(&assets().join("space-analysis"), &reporter)
        .unwrap();
    assert_eq!(stats.total_bytes, number("/analyseEspace/octetsTotal"));
    assert_eq!(stats.files as u64, number("/analyseEspace/fichiers"));
    assert_eq!(stats.directories as u64, number("/analyseEspace/dossiers"));

    // --- archives ---------------------------------------------------------
    let listing = archive::list(&assets().join("archive-sample.zip")).unwrap();
    assert_eq!(listing.files as u64, number("/archive/fichiers"));

    // --- inspection par signature ----------------------------------------
    let expected = contract.pointer("/inspection/attendus").unwrap().as_object().unwrap();
    for (relative, attente) in expected {
        let target = assets().join(relative);
        let head = fs::read(&target).unwrap_or_default();
        let head = &head[..head.len().min(fourtout_lib::files::magic::HEAD_BYTES)];
        let signature = fourtout_lib::files::magic::identify(head);
        let extension = target
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        assert_eq!(
            signature.id,
            attente.get("typeReel").and_then(|v| v.as_str()).unwrap(),
            "type détecté pour {relative}"
        );
        assert_eq!(
            fourtout_lib::files::magic::extension_matches(&signature, &extension),
            attente.get("extensionCoherente").and_then(|v| v.as_bool()).unwrap(),
            "cohérence d'extension pour {relative}"
        );
    }
}
