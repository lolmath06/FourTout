//! Aller-retour création → inspection → extraction, sur des dossiers réels.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::read::{extract, inspect};
use super::write::{create, CreateOptions};
use crate::files::Reporter;

/// Date fixe (2024-01-02 03:04:05 UTC) : l'image est reproductible.
const FIXED: i64 = 1_704_164_645;

fn workspace(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("fourtout-iso-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// Contenu pseudo-aléatoire mais reproductible, de taille quelconque.
fn bytes(len: usize, seed: u32) -> Vec<u8> {
    let mut state = seed;
    (0..len)
        .map(|_| {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (state >> 16) as u8
        })
        .collect()
}

fn sample_tree(root: &Path) {
    fs::create_dir_all(root.join("docs/nested/deep")).unwrap();
    fs::create_dir_all(root.join("Photos de vacances")).unwrap();
    fs::write(root.join("readme.txt"), "Bonjour FourTout\n").unwrap();
    fs::write(root.join("empty.bin"), b"").unwrap();
    fs::write(root.join("docs/a.txt"), bytes(5000, 1)).unwrap();
    fs::write(root.join("docs/nested/b.dat"), bytes(2048, 2)).unwrap();
    fs::write(root.join("docs/nested/deep/c.bin"), bytes(2049, 3)).unwrap();
    fs::write(root.join("Photos de vacances/été-à-la-mer.txt"), "accentué\n").unwrap();
    fs::write(root.join("日本語のファイル.txt"), "unicode\n").unwrap();
    fs::write(root.join("big.bin"), bytes(300_000, 4)).unwrap();
    fs::write(root.join("Makefile"), "all:\n").unwrap();
}

fn options() -> CreateOptions {
    CreateOptions { label: "Mon volume".into(), fixed_time: Some(FIXED), ..CreateOptions::default() }
}

fn assert_same_tree(a: &Path, b: &Path) {
    let mut left: Vec<_> = walk(a);
    let mut right: Vec<_> = walk(b);
    left.sort();
    right.sort();
    assert_eq!(left.len(), right.len(), "{left:?} / {right:?}");
    for (x, y) in left.iter().zip(&right) {
        assert_eq!(x.0, y.0);
        assert_eq!(fs::read(a.join(&x.0)).ok(), fs::read(b.join(&y.0)).ok(), "{}", x.0);
    }
}

fn walk(root: &Path) -> Vec<(String, bool)> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            let relative = path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
            let is_dir = path.is_dir();
            if is_dir {
                stack.push(path);
            }
            out.push((relative, is_dir));
        }
    }
    out
}

#[test]
fn round_trips_a_tree_with_nesting_unicode_and_empty_files() {
    let work = workspace("roundtrip");
    let source = work.join("source");
    sample_tree(&source);
    let image = work.join("out.iso");

    let summary = create(&source, &image, &options(), &Reporter::silent()).unwrap();
    assert_eq!(summary.files, 9);
    assert_eq!(summary.directories, 4);
    assert_eq!(summary.label, "MON_VOLUME");
    assert_eq!(fs::metadata(&image).unwrap().len(), summary.image_bytes);
    assert_eq!(summary.image_bytes % 2048, 0);

    let info = inspect(&image, 1000, &Reporter::silent()).unwrap();
    assert_eq!(info.label, "MON_VOLUME");
    assert_eq!(info.tree, "rock-ridge");
    assert!(info.features.contains(&"joliet".to_string()));
    assert!(info.features.contains(&"rock-ridge".to_string()));
    assert!(info.boot.is_none(), "une image de données n'est pas amorçable");
    assert_eq!(info.files, 9);
    assert_eq!(info.directories, 4);
    assert_eq!(info.total_bytes, 5000 + 2048 + 2049 + 300_000 + 17 + 5 + 10 + 8);
    let paths: Vec<_> = info.entries.iter().map(|e| e.path.as_str()).collect();
    assert!(paths.contains(&"docs/nested/deep/c.bin"));
    assert!(paths.contains(&"Photos de vacances/été-à-la-mer.txt"));
    assert!(paths.contains(&"日本語のファイル.txt"));
    assert!(info.entries.iter().all(|e| e.modified == FIXED), "dates reproductibles");

    let out = work.join("out");
    let result = extract(&image, &out, &[], false, &Reporter::silent()).unwrap();
    assert_eq!(result.extracted, 9);
    assert!(result.skipped.is_empty());
    assert_same_tree(&source, &out);
    let _ = fs::remove_dir_all(&work);
}

#[test]
fn every_tree_reads_back_the_same_content() {
    let work = workspace("trees");
    let source = work.join("source");
    sample_tree(&source);

    for (joliet, rock_ridge, tree) in [(true, true, "rock-ridge"), (true, false, "joliet"), (false, false, "iso9660")] {
        let image = work.join(format!("{tree}.iso"));
        let opts = CreateOptions { joliet, rock_ridge, ..options() };
        create(&source, &image, &opts, &Reporter::silent()).unwrap();
        let info = inspect(&image, 1000, &Reporter::silent()).unwrap();
        assert_eq!(info.tree, tree);
        let out = work.join(format!("out-{tree}"));
        let result = extract(&image, &out, &[], false, &Reporter::silent()).unwrap();
        assert_eq!(result.extracted, 9, "{tree}");
        if tree == "iso9660" {
            // Sans extension de noms, seuls les noms ISO simplifiés survivent :
            // le contenu est intact, les noms sont ceux de la norme.
            assert!(out.join("README.TXT").exists());
        } else {
            assert_same_tree(&source, &out);
        }
    }
    let _ = fs::remove_dir_all(&work);
}

#[test]
fn the_same_input_gives_the_same_bytes() {
    let work = workspace("determinism");
    let source = work.join("source");
    sample_tree(&source);
    create(&source, &work.join("a.iso"), &options(), &Reporter::silent()).unwrap();
    create(&source, &work.join("b.iso"), &options(), &Reporter::silent()).unwrap();
    assert_eq!(fs::read(work.join("a.iso")).unwrap(), fs::read(work.join("b.iso")).unwrap());
    let _ = fs::remove_dir_all(&work);
}

#[test]
fn a_directory_with_many_entries_spans_sectors_without_straddling() {
    let work = workspace("many");
    let source = work.join("source");
    fs::create_dir_all(&source).unwrap();
    for i in 0..400 {
        fs::write(source.join(format!("fichier-numero-{i:04}-avec-un-nom-assez-long.txt")), format!("{i}")).unwrap();
    }
    let image = work.join("many.iso");
    create(&source, &image, &options(), &Reporter::silent()).unwrap();
    let info = inspect(&image, 1000, &Reporter::silent()).unwrap();
    assert_eq!(info.files, 400);
    let out = work.join("out");
    assert_eq!(extract(&image, &out, &[], false, &Reporter::silent()).unwrap().extracted, 400);
    assert_eq!(fs::read_to_string(out.join("fichier-numero-0399-avec-un-nom-assez-long.txt")).unwrap(), "399");
    let _ = fs::remove_dir_all(&work);
}

#[test]
fn extracts_only_the_selection() {
    let work = workspace("selection");
    let source = work.join("source");
    sample_tree(&source);
    let image = work.join("s.iso");
    create(&source, &image, &options(), &Reporter::silent()).unwrap();
    let out = work.join("out");
    let result = extract(
        &image,
        &out,
        &["docs/nested".to_string(), "readme.txt".to_string()],
        false,
        &Reporter::silent(),
    )
    .unwrap();
    assert_eq!(result.extracted, 3);
    assert!(out.join("docs/nested/deep/c.bin").exists());
    assert!(out.join("readme.txt").exists());
    assert!(!out.join("docs/a.txt").exists());
    assert!(!out.join("big.bin").exists());
    let _ = fs::remove_dir_all(&work);
}

#[test]
fn refuses_to_overwrite_unless_asked_and_never_silently() {
    let work = workspace("overwrite");
    let source = work.join("source");
    fs::create_dir_all(&source).unwrap();
    fs::write(source.join("a.txt"), "image").unwrap();
    let image = work.join("o.iso");
    create(&source, &image, &options(), &Reporter::silent()).unwrap();

    // La création refuse un fichier existant…
    assert!(create(&source, &image, &options(), &Reporter::silent()).unwrap_err().contains("existe déjà"));
    // …sauf demande explicite.
    let replace = CreateOptions { overwrite: true, ..options() };
    create(&source, &image, &replace, &Reporter::silent()).unwrap();

    // L'extraction écrit à côté plutôt que d'écraser.
    let out = work.join("out");
    fs::create_dir_all(&out).unwrap();
    fs::write(out.join("a.txt"), "à moi").unwrap();
    extract(&image, &out, &[], false, &Reporter::silent()).unwrap();
    assert_eq!(fs::read_to_string(out.join("a.txt")).unwrap(), "à moi");
    assert_eq!(fs::read_to_string(out.join("a (2).txt")).unwrap(), "image");
    extract(&image, &out, &[], true, &Reporter::silent()).unwrap();
    assert_eq!(fs::read_to_string(out.join("a.txt")).unwrap(), "image");
    let _ = fs::remove_dir_all(&work);
}

#[test]
fn the_image_cannot_be_written_inside_its_own_source() {
    let work = workspace("inside");
    let source = work.join("source");
    fs::create_dir_all(&source).unwrap();
    fs::write(source.join("a.txt"), "x").unwrap();
    let error = create(&source, &source.join("self.iso"), &options(), &Reporter::silent()).unwrap_err();
    assert!(error.contains("dossier qu'elle contient"), "{error}");
    assert!(!source.join("self.iso").exists());
    let _ = fs::remove_dir_all(&work);
}

#[cfg(unix)]
#[test]
fn symbolic_links_are_not_followed() {
    let work = workspace("symlink");
    let source = work.join("source");
    fs::create_dir_all(&source).unwrap();
    fs::write(source.join("a.txt"), "x").unwrap();
    std::os::unix::fs::symlink("/etc", source.join("etc-link")).unwrap();
    let image = work.join("l.iso");
    let summary = create(&source, &image, &options(), &Reporter::silent()).unwrap();
    assert_eq!(summary.files, 1);
    assert!(summary.warnings.iter().any(|w| w.contains("etc-link")));
    let _ = fs::remove_dir_all(&work);
}

#[test]
fn cancellation_leaves_no_partial_image() {
    let work = workspace("cancel-create");
    let source = work.join("source");
    sample_tree(&source);
    let image = work.join("c.iso");
    let error = create(&source, &image, &options(), &Reporter::silent_cancelled()).unwrap_err();
    assert_eq!(error, crate::files::CANCELLED);
    assert!(!image.exists());
    assert!(fs::read_dir(&work).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().contains("part")));
    let _ = fs::remove_dir_all(&work);
}

#[test]
fn cancelling_an_extraction_removes_what_it_created() {
    let work = workspace("cancel-extract");
    let source = work.join("source");
    sample_tree(&source);
    let image = work.join("c.iso");
    create(&source, &image, &options(), &Reporter::silent()).unwrap();

    let out = work.join("out");
    let flag = Arc::new(AtomicBool::new(false));
    // Annulation immédiate : rien ne doit rester, même le dossier de travail.
    flag.store(true, Ordering::SeqCst);
    let error = extract(&image, &out, &[], false, &Reporter::silent_with_flag(flag)).unwrap_err();
    assert_eq!(error, crate::files::CANCELLED);
    assert!(fs::read_dir(&out).map(|mut d| d.next().is_none()).unwrap_or(true));
    let _ = fs::remove_dir_all(&work);
}

#[test]
fn corrupted_images_fail_cleanly() {
    let work = workspace("corrupt");
    let source = work.join("source");
    sample_tree(&source);
    let image = work.join("good.iso");
    create(&source, &image, &options(), &Reporter::silent()).unwrap();
    let good = fs::read(&image).unwrap();

    // Pas une image du tout.
    let junk = work.join("junk.iso");
    fs::write(&junk, bytes(100_000, 9)).unwrap();
    assert!(inspect(&junk, 10, &Reporter::silent()).unwrap_err().contains("ISO 9660"));
    let tiny = work.join("tiny.iso");
    fs::write(&tiny, b"x").unwrap();
    assert!(inspect(&tiny, 10, &Reporter::silent()).is_err());

    // Descripteur détruit.
    let mut broken = good.clone();
    broken[16 * 2048 + 1..16 * 2048 + 6].copy_from_slice(b"XXXXX");
    let path = work.join("no-pvd.iso");
    fs::write(&path, &broken).unwrap();
    assert!(inspect(&path, 10, &Reporter::silent()).is_err());

    // Image tronquée en plein milieu des données : la lecture doit échouer
    // proprement, et l'extraction ne rien laisser derrière elle.
    let cut = work.join("cut.iso");
    fs::write(&cut, &good[..good.len() - 100_000]).unwrap();
    let out = work.join("out-cut");
    let error = extract(&cut, &out, &[], false, &Reporter::silent()).unwrap_err();
    assert!(error.contains("tronqué") || error.contains("dépasse"), "{error}");
    assert!(fs::read_dir(&out).map(|mut d| d.next().is_none()).unwrap_or(true), "restes laissés");
    let info = inspect(&cut, 10, &Reporter::silent());
    if let Ok(info) = info {
        assert!(info.warnings.iter().any(|w| w.contains("tronquée")));
    }
    let _ = fs::remove_dir_all(&work);
}

#[test]
fn hostile_names_cannot_escape_the_destination() {
    let work = workspace("traversal");
    let source = work.join("source");
    fs::create_dir_all(&source).unwrap();
    // Noms de même longueur que les noms hostiles, remplacés dans l'image.
    fs::write(source.join("zzzzzz"), "pirate").unwrap();
    fs::write(source.join("ok.txt"), "sain").unwrap();
    let image = work.join("evil.iso");
    let opts = CreateOptions { joliet: false, ..options() };
    create(&source, &image, &opts, &Reporter::silent()).unwrap();

    // Le nom Rock Ridge « zzzzzz » devient « ../../ » dans l'image.
    let mut data = fs::read(&image).unwrap();
    let needle = b"NM\x0b\x01\x00zzzzzz";
    let position = data.windows(needle.len()).position(|w| w == needle).expect("entrée NM");
    data[position + 5..position + 11].copy_from_slice(b"../../");
    let evil = work.join("evil-patched.iso");
    fs::write(&evil, &data).unwrap();

    let inner = work.join("jail/inner");
    let result = extract(&evil, &inner, &[], false, &Reporter::silent()).unwrap();
    assert_eq!(result.extracted, 1, "seul le fichier sain est extrait");
    assert_eq!(result.skipped.len(), 1, "{:?}", result.skipped);
    assert!(inner.join("ok.txt").exists());
    // Rien n'a été écrit ailleurs que dans le dossier choisi.
    let mut outside: Vec<_> = walk(&work.join("jail")).into_iter().map(|(p, _)| p).collect();
    outside.sort();
    assert_eq!(outside, vec!["inner", "inner/ok.txt"]);
    assert!(!work.join("pirate").exists());
    let _ = fs::remove_dir_all(&work);
}

#[test]
fn a_directory_loop_is_detected_instead_of_followed_forever() {
    let work = workspace("loop");
    let source = work.join("source");
    fs::create_dir_all(source.join("a")).unwrap();
    fs::write(source.join("a/f.txt"), "x").unwrap();
    let image = work.join("loop.iso");
    let opts = CreateOptions { joliet: false, rock_ridge: false, ..options() };
    create(&source, &image, &opts, &Reporter::silent()).unwrap();

    // Fait pointer le répertoire « A » sur la racine : une boucle.
    let mut data = fs::read(&image).unwrap();
    let pvd = 16 * 2048;
    let root_extent = u32::from_le_bytes(data[pvd + 158..pvd + 162].try_into().unwrap());
    let root_start = root_extent as usize * 2048;
    let needle = b"\x01A";
    let at = root_start + data[root_start..root_start + 2048].windows(2).position(|w| w == needle).unwrap() - 32;
    // Octets 2..6 de l'enregistrement : extension en petit-boutien.
    data[at + 2..at + 6].copy_from_slice(&root_extent.to_le_bytes());
    data[at + 6..at + 10].copy_from_slice(&root_extent.to_be_bytes());
    let looped = work.join("looped.iso");
    fs::write(&looped, &data).unwrap();

    let info = inspect(&looped, 100, &Reporter::silent()).unwrap();
    assert!(info.warnings.iter().any(|w| w.contains("se référence")), "{:?}", info.warnings);
    let _ = fs::remove_dir_all(&work);
}

#[test]
fn the_inspected_listing_is_capped_but_the_totals_are_not() {
    let work = workspace("cap");
    let source = work.join("source");
    fs::create_dir_all(&source).unwrap();
    for i in 0..30 {
        fs::write(source.join(format!("f{i}.txt")), "x").unwrap();
    }
    let image = work.join("cap.iso");
    create(&source, &image, &options(), &Reporter::silent()).unwrap();
    let info = inspect(&image, 10, &Reporter::silent()).unwrap();
    assert_eq!(info.entries.len(), 10);
    assert!(info.truncated);
    assert_eq!(info.files, 30);
    let _ = fs::remove_dir_all(&work);
}

#[test]
fn long_names_are_preserved_where_the_format_allows_and_reported_where_not() {
    let work = workspace("long");
    let source = work.join("source");
    fs::create_dir_all(&source).unwrap();
    let name = format!("{}.pdf", "nom-vraiment-trop-long-".repeat(5)); // 119 caractères
    let huge = format!("{}.txt", "x".repeat(150));
    fs::write(source.join(&name), "long").unwrap();
    fs::write(source.join(&huge), "énorme").unwrap();

    let image = work.join("long.iso");
    let summary = create(&source, &image, &options(), &Reporter::silent()).unwrap();
    // 119 octets : conservé par Rock Ridge, tronqué en Joliet (64 caractères).
    // 154 octets : trop long pour Rock Ridge sans zone de continuation.
    assert!(summary.warnings.iter().any(|w| w.contains("Joliet")), "{:?}", summary.warnings);
    assert!(summary.warnings.iter().any(|w| w.contains("Rock Ridge")), "{:?}", summary.warnings);
    assert!(summary.warning_count >= 3);

    let info = inspect(&image, 100, &Reporter::silent()).unwrap();
    assert!(info.entries.iter().any(|e| e.name == name), "nom de 119 octets conservé par Rock Ridge");
    // Le contenu survit dans tous les cas, sous un nom simplifié si nécessaire.
    let out = work.join("out");
    assert_eq!(extract(&image, &out, &[], false, &Reporter::silent()).unwrap().extracted, 2);
    assert_eq!(fs::read_to_string(out.join(&name)).unwrap(), "long");
    let _ = fs::remove_dir_all(&work);
}
