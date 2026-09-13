//! Tests d'intégration de la phase 12, sur les fixtures réelles.
//!
//! Le test le plus important de tout ce fichier est [`sources_are_never_modified`] :
//! il calcule l'empreinte de chaque fixture, lance **toutes** les opérations de
//! diagnostic et de récupération, et vérifie qu'aucune empreinte n'a bougé. Une
//! phase entière consacrée à réparer des fichiers n'a de valeur que si elle ne
//! peut pas en abîmer.

use std::path::{Path, PathBuf};

use fourtout_lib::diagnostics::{
    self, generic, image as image_diag, pdf as pdf_diag, zip as zip_diag, Repairability, Severity,
};
use fourtout_lib::files::{magic, Reporter};

fn assets() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../test-assets/generated")
}

fn fixture(name: &str) -> Option<Vec<u8>> {
    let path = assets().join(name);
    match std::fs::read(&path) {
        Ok(bytes) => Some(bytes),
        Err(_) => {
            eprintln!("fixture absente ({name}) : lancer `pnpm test:assets`. Test ignoré.");
            None
        }
    }
}

fn workspace(name: &str) -> PathBuf {
    let directory = std::env::temp_dir().join(format!("fourtout-phase12-{name}"));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    directory
}

fn codes(findings: &[diagnostics::Finding]) -> Vec<&str> {
    findings.iter().map(|finding| finding.code.as_str()).collect()
}

/* ------------------------------------------------------------------------ */
/* ZIP                                                                       */
/* ------------------------------------------------------------------------ */

#[test]
fn a_healthy_archive_is_declared_healthy() {
    let Some(bytes) = fixture("zip-healthy.zip") else { return };
    let (findings, details) = zip_diag::diagnose(&bytes);

    assert_eq!(details.declared_entries, Some(4));
    assert_eq!(details.central_entries, 4);
    assert_eq!(details.local_headers, 4);
    assert_eq!(details.trailing_bytes, 0);
    assert!(!details.encrypted);
    assert_eq!(codes(&findings), vec!["zip.healthy"]);
}

#[test]
fn an_archive_without_its_directory_is_still_entirely_recoverable() {
    let Some(bytes) = fixture("zip-central-directory-missing.zip") else { return };
    let (findings, details) = zip_diag::diagnose(&bytes);

    // Le répertoire central a disparu ; les quatre en-têtes locaux sont là.
    assert!(codes(&findings).contains(&"zip.no-eocd"));
    assert_eq!(details.local_headers, 4);
    assert_eq!(details.central_entries, 0);

    let directory = workspace("zip-missing");
    let result = zip_diag::recover(
        &bytes,
        &directory.join("sortie"),
        zip_diag::RecoveryMode::Folder,
        &Reporter::silent(),
    )
    .unwrap();

    assert_eq!(result.recovered, 4, "les quatre entrées sont récupérables");
    assert_eq!(result.lost, 0);

    // Et le contenu est exactement celui d'origine, accents compris.
    let root = directory.join("sortie");
    assert_eq!(
        std::fs::read_to_string(root.join("alpha.txt")).unwrap(),
        "Première entrée, en clair.\n"
    );
    assert_eq!(
        std::fs::read_to_string(root.join("nested/bravo.txt")).unwrap(),
        "Deuxième entrée, dans un sous-dossier.\n"
    );
    assert_eq!(
        std::fs::read_to_string(root.join("unicode/été.txt")).unwrap(),
        "Troisième entrée : accents, été, çà et là.\n"
    );
    assert_eq!(std::fs::read_to_string(root.join("binary.bin")).unwrap().len(), 240);

    std::fs::remove_dir_all(&directory).ok();
}

#[test]
fn a_damaged_directory_does_not_cost_a_single_entry() {
    let Some(bytes) = fixture("zip-central-directory-corrupt.zip") else { return };
    let (findings, details) = zip_diag::diagnose(&bytes);

    // La fin d'archive annonce quatre entrées, le répertoire n'en livre qu'une.
    assert_eq!(details.declared_entries, Some(4));
    assert_eq!(details.central_entries, 1);
    assert!(codes(&findings).contains(&"zip.central-directory-corrupt"));
    assert_eq!(details.local_headers, 4);

    let directory = workspace("zip-corrupt-cd");
    let result = zip_diag::recover(
        &bytes,
        &directory.join("recuperee.zip"),
        zip_diag::RecoveryMode::Archive,
        &Reporter::silent(),
    )
    .unwrap();
    assert_eq!(result.recovered, 4);
    assert_eq!(result.lost, 0);

    // L'archive reconstruite est relisible par le moteur d'archives ordinaire.
    let listing = fourtout_lib::files::archive::list(&directory.join("recuperee.zip")).unwrap();
    assert_eq!(listing.files, 4);
    std::fs::remove_dir_all(&directory).ok();
}

#[test]
fn one_damaged_entry_does_not_condemn_the_others() {
    let Some(bytes) = fixture("zip-one-entry-corrupt.zip") else { return };
    let entries = zip_diag::scan_local_headers(&bytes, true);
    assert_eq!(entries.len(), 4);

    let broken = entries.iter().find(|entry| entry.name == "binary.bin").unwrap();
    assert_ne!(
        broken.state,
        zip_diag::EntryState::Recoverable,
        "une entrée dont les octets ont changé n'est pas récupérable telle quelle"
    );
    assert_eq!(broken.state, zip_diag::EntryState::ChecksumMismatch);
    assert!(broken.reason.as_ref().unwrap().contains("Somme de contrôle"));

    for name in ["alpha.txt", "nested/bravo.txt", "unicode/été.txt"] {
        let entry = entries.iter().find(|entry| entry.name == name).unwrap();
        assert_eq!(entry.state, zip_diag::EntryState::Recoverable, "{name}");
    }

    let directory = workspace("zip-one-corrupt");
    let result = zip_diag::recover(
        &bytes,
        &directory.join("sortie"),
        zip_diag::RecoveryMode::Folder,
        &Reporter::silent(),
    )
    .unwrap();
    // Trois entrées sortent, une est perdue, et le compte est dit tel quel.
    assert_eq!(result.recovered, 3);
    assert_eq!(result.lost, 1);
    assert!(!directory.join("sortie/binary.bin").exists());
    std::fs::remove_dir_all(&directory).ok();
}

#[test]
fn a_truncated_archive_yields_what_precedes_the_cut() {
    let Some(bytes) = fixture("zip-truncated.zip") else { return };
    let (findings, details) = zip_diag::diagnose(&bytes);
    assert!(codes(&findings).contains(&"zip.no-eocd"));
    assert!(details.local_headers >= 3);

    let directory = workspace("zip-truncated");
    let result = zip_diag::recover(
        &bytes,
        &directory.join("sortie"),
        zip_diag::RecoveryMode::Folder,
        &Reporter::silent(),
    )
    .unwrap();
    assert!(result.recovered >= 3, "les entrées complètes sortent");
    assert!(result.lost >= 1, "la dernière entrée est tronquée");
    assert_eq!(
        std::fs::read_to_string(directory.join("sortie/alpha.txt")).unwrap(),
        "Première entrée, en clair.\n"
    );
    std::fs::remove_dir_all(&directory).ok();
}

#[test]
fn trailing_garbage_is_removed_without_touching_a_single_entry() {
    let Some(bytes) = fixture("zip-trailing-garbage.zip") else { return };
    let Some(healthy) = fixture("zip-healthy.zip") else { return };

    let (findings, details) = zip_diag::diagnose(&bytes);
    assert_eq!(details.trailing_bytes, 25);
    let finding = findings.iter().find(|f| f.code == "zip.trailing-garbage").unwrap();
    assert_eq!(finding.repairability, Repairability::SafeRepair);

    let directory = workspace("zip-trailing");
    let out = directory.join("nettoye.zip");
    let removed = zip_diag::strip_trailing(&bytes, &out).unwrap();
    assert_eq!(removed, 25);
    // Le résultat est **exactement** l'archive saine d'origine.
    assert_eq!(std::fs::read(&out).unwrap(), healthy);
    std::fs::remove_dir_all(&directory).ok();
}

#[test]
fn a_broken_archive_never_relaxes_the_path_guards() {
    // L'archive piégée de la phase 9 : ses entrées remontent hors du dossier.
    let Some(bytes) = fixture("evil-zip-slip.zip") else { return };
    let directory = workspace("zip-slip");
    let destination = directory.join("sortie");

    let result = zip_diag::recover(
        &bytes,
        &destination,
        zip_diag::RecoveryMode::Folder,
        &Reporter::silent(),
    )
    .unwrap();

    assert!(
        result.entries.iter().any(|entry| entry.state == zip_diag::EntryState::Rejected),
        "au moins une entrée devait être refusée : {:?}",
        result.entries.iter().map(|e| (&e.name, e.state)).collect::<Vec<_>>()
    );
    // Rien n'a été écrit hors du dossier de destination.
    assert!(!directory.join("evil.txt").exists());
    assert!(!Path::new("/tmp/fourtout-zip-slip-escaped.txt").exists());
    std::fs::remove_dir_all(&directory).ok();
}

/* ------------------------------------------------------------------------ */
/* PDF                                                                       */
/* ------------------------------------------------------------------------ */

#[test]
fn a_healthy_pdf_is_declared_healthy() {
    let Some(bytes) = fixture("pdf-healthy.pdf") else { return };
    let (findings, details) = pdf_diag::diagnose(&bytes);
    assert_eq!(details.version.as_deref(), Some("1.4"));
    assert_eq!(details.objects, 5);
    assert_eq!(details.root_object, Some(1));
    assert_eq!(details.page_objects, 2);
    assert!(details.startxref_valid);
    assert!(!details.signed);
    assert_eq!(codes(&findings), vec!["pdf.healthy"]);
}

#[test]
fn a_wrong_startxref_is_corrected_by_changing_only_its_digits() {
    let Some(bytes) = fixture("pdf-wrong-startxref.pdf") else { return };
    let Some(healthy) = fixture("pdf-healthy.pdf") else { return };

    let (findings, details) = pdf_diag::diagnose(&bytes);
    assert!(!details.startxref_valid);
    let finding = findings.iter().find(|f| f.code == "pdf.bad-startxref").unwrap();
    assert_eq!(finding.repairability, Repairability::SafeRepair);

    let directory = workspace("pdf-startxref");
    let out = directory.join("repare.pdf");
    let report = pdf_diag::repair(&bytes, pdf_diag::PdfRepair::FixStartxref, &out).unwrap();
    assert_eq!(report.removed_bytes, 0);

    let repaired = std::fs::read(&out).unwrap();
    // La correction rend exactement le document sain d'origine.
    assert_eq!(repaired, healthy);
    let (after, details) = pdf_diag::diagnose(&repaired);
    assert!(details.startxref_valid);
    assert_eq!(codes(&after), vec!["pdf.healthy"]);
    std::fs::remove_dir_all(&directory).ok();
}

#[test]
fn trailing_garbage_after_eof_is_removed_exactly() {
    let Some(bytes) = fixture("pdf-trailing-garbage.pdf") else { return };
    let Some(healthy) = fixture("pdf-healthy.pdf") else { return };

    let (findings, details) = pdf_diag::diagnose(&bytes);
    assert_eq!(details.trailing_bytes, 39);
    assert!(codes(&findings).contains(&"pdf.trailing-garbage"));

    let directory = workspace("pdf-trailing");
    let out = directory.join("repare.pdf");
    let report = pdf_diag::repair(&bytes, pdf_diag::PdfRepair::StripTrailing, &out).unwrap();
    assert_eq!(report.removed_bytes, 39);
    assert_eq!(std::fs::read(&out).unwrap(), healthy);
    std::fs::remove_dir_all(&directory).ok();
}

#[test]
fn a_document_without_its_table_gets_one_rebuilt_from_its_objects() {
    let Some(bytes) = fixture("pdf-broken-xref-recoverable.pdf") else { return };
    let (findings, details) = pdf_diag::diagnose(&bytes);

    assert_eq!(details.objects, 5, "les cinq objets sont intacts");
    assert!(codes(&findings).contains(&"pdf.no-startxref"));
    assert!(codes(&findings).contains(&"pdf.no-eof"));
    assert!(!details.object_streams);

    let directory = workspace("pdf-rebuild");
    let out = directory.join("repare.pdf");
    let report = pdf_diag::repair(&bytes, pdf_diag::PdfRepair::RebuildXref, &out).unwrap();
    assert_eq!(report.indexed_objects, 5);
    assert!(report.added_bytes > 0);
    assert_eq!(report.removed_bytes, 0);

    let rebuilt = std::fs::read(&out).unwrap();
    // Le document d'origine est conservé en tête, octet pour octet.
    assert!(rebuilt.starts_with(&bytes));
    let (after, details) = pdf_diag::diagnose(&rebuilt);
    assert!(details.startxref_valid);
    assert_eq!(details.root_object, Some(1));
    assert_eq!(details.page_objects, 2);
    assert!(
        after.iter().all(|finding| finding.severity != Severity::Error),
        "constats restants : {after:?}"
    );
    std::fs::remove_dir_all(&directory).ok();
}

#[test]
fn a_pdf_truncated_mid_stream_is_declared_unreparable() {
    let Some(bytes) = fixture("pdf-truncated-stream.pdf") else { return };
    let (findings, details) = pdf_diag::diagnose(&bytes);

    assert!(codes(&findings).contains(&"pdf.no-eof"));
    assert!(codes(&findings).contains(&"pdf.no-startxref"));
    // Le flux de la première page est coupé : la page n'est plus complète.
    assert!(details.objects < 5, "{} objets trouvés", details.objects);

    // La reconstruction d'une table ne prétend pas rendre le contenu manquant :
    // elle échoue franchement quand il n'y a pas de catalogue identifiable, et
    // quand elle aboutit, elle n'indexe que ce qui existe réellement.
    let directory = workspace("pdf-truncated");
    let out = directory.join("tentative.pdf");
    match pdf_diag::repair(&bytes, pdf_diag::PdfRepair::RebuildXref, &out) {
        Ok(report) => {
            assert_eq!(report.indexed_objects, details.objects);
            assert!(report.indexed_objects < 5);
        }
        Err(message) => assert!(!message.is_empty()),
    }
    std::fs::remove_dir_all(&directory).ok();
}

#[test]
fn a_pdf_without_eof_is_diagnosed_as_truncated() {
    let Some(bytes) = fixture("pdf-missing-eof.pdf") else { return };
    let (findings, details) = pdf_diag::diagnose(&bytes);
    assert!(codes(&findings).contains(&"pdf.no-eof"));
    // Les objets et la table sont pourtant tous là.
    assert_eq!(details.objects, 5);
    assert!(details.startxref_valid);
}

/* ------------------------------------------------------------------------ */
/* Images                                                                    */
/* ------------------------------------------------------------------------ */

#[test]
fn healthy_images_are_declared_healthy() {
    for (name, format) in [("image-healthy.png", "png"), ("image-healthy.jpg", "jpg")] {
        let Some(bytes) = fixture(name) else { return };
        let (findings, details) = image_diag::diagnose(&bytes, format);
        assert_eq!(details.width, Some(64), "{name}");
        assert_eq!(details.height, Some(48), "{name}");
        assert!(details.decodes, "{name}");
        assert_eq!(codes(&findings), vec!["image.healthy"], "{name}");
    }
}

#[test]
fn a_png_named_jpg_is_named_wrong_not_damaged() {
    let Some(bytes) = fixture("image-wrong-extension.jpg") else { return };
    let signature = magic::identify(&bytes[..bytes.len().min(magic::HEAD_BYTES)]);
    assert_eq!(signature.id, "png");

    let (findings, _) = generic::diagnose(
        &assets().join("image-wrong-extension.jpg"),
        &bytes,
        &signature,
        "jpg",
    );
    let finding = findings.iter().find(|f| f.code == "file.extension-mismatch").unwrap();
    assert_eq!(finding.severity, Severity::Warning, "un nom trompeur n'est pas une perte");
    assert_eq!(finding.repairability, Repairability::SafeRepair);

    // Et l'image, elle, est parfaitement saine.
    let (image_findings, details) = image_diag::diagnose(&bytes, "png");
    assert!(details.decodes);
    assert_eq!(codes(&image_findings), vec!["image.healthy"]);
}

#[test]
fn a_broken_metadata_block_costs_metadata_and_nothing_else() {
    let Some(bytes) = fixture("image-png-bad-crc.png") else { return };
    let Some(healthy) = fixture("image-healthy.png") else { return };

    let (findings, details) = image_diag::diagnose(&bytes, "png");
    assert_eq!(details.broken_ancillary, 1);
    assert_eq!(details.broken_critical, 0);
    let finding = findings.iter().find(|f| f.code == "png.broken-ancillary-chunk").unwrap();
    assert_eq!(finding.repairability, Repairability::SafeRepair);

    let directory = workspace("png-crc");
    let out = directory.join("recuperee.png");
    let recovery = image_diag::recover(&bytes, "png", &out).unwrap();
    assert!(recovery.lossless, "aucun pixel n'est réencodé : {:?}", recovery.steps);
    assert_eq!((recovery.width, recovery.height), (64, 48));

    // Les pixels sont rigoureusement ceux de l'image saine.
    let before = image::load_from_memory(&healthy).unwrap().to_rgba8();
    let after = image::open(&out).unwrap().to_rgba8();
    assert_eq!(before.as_raw(), after.as_raw());
    std::fs::remove_dir_all(&directory).ok();
}

#[test]
fn trailing_garbage_on_an_image_is_removed_without_touching_pixels() {
    let Some(bytes) = fixture("image-png-trailing-garbage.png") else { return };
    let Some(healthy) = fixture("image-healthy.png") else { return };

    let (findings, details) = image_diag::diagnose(&bytes, "png");
    assert_eq!(details.trailing_bytes, 8);
    assert!(codes(&findings).contains(&"png.trailing-garbage"));
    // Le décodeur, lui, s'en accommodait déjà.
    assert!(details.decodes);

    let directory = workspace("png-trailing");
    let out = directory.join("recuperee.png");
    let recovery = image_diag::recover(&bytes, "png", &out).unwrap();
    assert!(recovery.lossless);
    assert_eq!(std::fs::read(&out).unwrap(), healthy, "l'image saine, à l'octet près");
    std::fs::remove_dir_all(&directory).ok();
}

#[test]
fn a_jpeg_missing_its_end_marker_is_closed_and_recovered_visually() {
    let Some(bytes) = fixture("image-jpeg-missing-eoi.jpg") else { return };
    let (findings, details) = image_diag::diagnose(&bytes, "jpg");
    assert!(!details.end_marker);
    assert!(codes(&findings).contains(&"jpeg.no-eoi"));

    let directory = workspace("jpeg-eoi");
    let out = directory.join("recuperee.png");
    let recovery = image_diag::recover(&bytes, "jpg", &out).unwrap();
    // Un JPEG passe par un décodage : ce n'est jamais annoncé comme sans perte.
    assert!(!recovery.lossless);
    assert_eq!((recovery.width, recovery.height), (64, 48));
    assert!(recovery.steps.iter().any(|step| step.contains("EOI")));
    assert!(image::open(&out).is_ok(), "la sortie est un PNG relisible");
    std::fs::remove_dir_all(&directory).ok();
}

#[test]
fn a_truncated_image_is_not_invented() {
    let Some(png) = fixture("image-png-truncated.png") else { return };
    let (findings, details) = image_diag::diagnose(&png, "png");
    assert!(!details.decodes);
    assert!(codes(&findings).contains(&"png.truncated"));

    let directory = workspace("png-truncated");
    let out = directory.join("recuperee.png");
    let error = image_diag::recover(&png, "png", &out).unwrap_err();
    assert!(error.contains("aucune image ne peut être reconstruite"), "{error}");
    assert!(!out.exists(), "aucun fichier ne doit être écrit");
    std::fs::remove_dir_all(&directory).ok();
}

/* ------------------------------------------------------------------------ */
/* La source n'est jamais modifiée                                           */
/* ------------------------------------------------------------------------ */

/// Le test qui fonde toute la phase.
///
/// Chaque fixture est hachée, puis soumise à toutes les opérations que FourTout
/// sait lui appliquer — diagnostic, réparation, récupération —, puis rehachée.
/// Une seule empreinte qui bougerait signifierait qu'un outil de réparation
/// peut détruire ce qu'il prétend sauver.
#[test]
fn sources_are_never_modified() {
    let names = [
        "zip-healthy.zip",
        "zip-central-directory-missing.zip",
        "zip-central-directory-corrupt.zip",
        "zip-one-entry-corrupt.zip",
        "zip-truncated.zip",
        "zip-trailing-garbage.zip",
        "pdf-healthy.pdf",
        "pdf-wrong-startxref.pdf",
        "pdf-trailing-garbage.pdf",
        "pdf-missing-eof.pdf",
        "pdf-broken-xref-recoverable.pdf",
        "pdf-truncated-stream.pdf",
        "image-healthy.png",
        "image-healthy.jpg",
        "image-wrong-extension.jpg",
        "image-png-trailing-garbage.png",
        "image-png-bad-crc.png",
        "image-png-truncated.png",
        "image-jpeg-trailing-garbage.jpg",
        "image-jpeg-missing-eoi.jpg",
        "image-jpeg-truncated.jpg",
    ];

    let directory = workspace("immutable");
    let mut checked = 0;

    for name in names {
        let source = assets().join(name);
        if !source.exists() {
            eprintln!("fixture absente ({name}) : lancer `pnpm test:assets`.");
            continue;
        }
        let before = diagnostics::sha256_of(&source).unwrap();
        let bytes = std::fs::read(&source).unwrap();
        let signature = magic::identify(&bytes[..bytes.len().min(magic::HEAD_BYTES)]);

        // Diagnostic générique, puis spécialisé.
        let _ = generic::diagnose(&source, &bytes, &signature, "");
        match signature.id {
            "zip" => {
                let _ = zip_diag::diagnose(&bytes);
                let _ = zip_diag::scan_local_headers(&bytes, true);
                let _ = zip_diag::recover(
                    &bytes,
                    &directory.join(format!("{name}-dossier")),
                    zip_diag::RecoveryMode::Folder,
                    &Reporter::silent(),
                );
                let _ = zip_diag::recover(
                    &bytes,
                    &directory.join(format!("{name}-archive.zip")),
                    zip_diag::RecoveryMode::Archive,
                    &Reporter::silent(),
                );
                let _ = zip_diag::strip_trailing(&bytes, &directory.join(format!("{name}-rogne.zip")));
            }
            "pdf" => {
                let _ = pdf_diag::diagnose(&bytes);
                for action in [
                    pdf_diag::PdfRepair::StripTrailing,
                    pdf_diag::PdfRepair::FixStartxref,
                    pdf_diag::PdfRepair::RebuildXref,
                ] {
                    let _ = pdf_diag::repair(&bytes, action, &directory.join(format!("{name}-{action:?}.pdf")));
                }
            }
            "png" | "jpg" => {
                let _ = image_diag::diagnose(&bytes, signature.id);
                let _ = image_diag::recover(
                    &bytes,
                    signature.id,
                    &directory.join(format!("{name}-recuperee.png")),
                );
            }
            _ => {}
        }

        let after = diagnostics::sha256_of(&source).unwrap();
        assert_eq!(before, after, "la source {name} a été modifiée");
        checked += 1;
    }

    assert!(checked >= 15, "seulement {checked} fixtures vérifiées");
    std::fs::remove_dir_all(&directory).ok();
}

/* ------------------------------------------------------------------------ */
/* Stockage                                                                  */
/* ------------------------------------------------------------------------ */

/// Inventaire réel de la machine qui exécute les tests.
///
/// Aucune assertion sur un nom de disque, une taille ou un numéro de série :
/// ces tests doivent passer sur n'importe quelle machine. On vérifie que
/// l'inventaire se dresse sans panique et que sa structure tient debout.
#[test]
#[cfg(target_os = "linux")]
fn the_real_machine_can_be_inventoried_without_writing_anything() {
    use fourtout_lib::disks::{self, linux};

    let inventory = linux::inventory(&linux::RealSys, &disks::mount_usage);
    assert!(inventory.provider.contains("Linux"));

    for disk in &inventory.disks {
        assert!(!disk.name.is_empty());
        assert!(disk.path.starts_with("/dev/"));
        for partition in &disk.partitions {
            assert!(!partition.name.is_empty());
            if let Some(volume) = &partition.volume {
                if let (Some(total), Some(available)) = (volume.total_bytes, volume.available_bytes)
                {
                    assert!(available <= total, "espace libre supérieur à la capacité");
                }
            }
        }
    }

    // Sur une Fedora, la racine est montée : elle doit apparaître quelque part.
    let mounts = std::fs::read_to_string("/proc/self/mountinfo").unwrap();
    let root_source = linux::parse_mountinfo(&mounts)
        .into_iter()
        .find(|mount| mount.mount_point == "/")
        .map(|mount| mount.source);
    if let Some(source) = root_source {
        if source.starts_with("/dev/") {
            let found = inventory
                .disks
                .iter()
                .flat_map(|disk| disk.partitions.iter())
                .filter_map(|partition| partition.volume.as_ref())
                .any(|volume| volume.mount_point.as_deref() == Some("/"))
                || inventory
                    .other_volumes
                    .iter()
                    .any(|volume| volume.mount_point.as_deref() == Some("/"));
            assert!(found, "le volume racine ({source}) devait figurer dans l'inventaire");
        }
    }
}

#[test]
fn asking_for_health_never_launches_a_self_test() {
    // Les arguments employés sont figés dans le code ; ce test verrouille le
    // fait qu'aucun d'eux ne demande un autotest au disque.
    let source = include_str!("../src/disks/smart.rs");
    for forbidden in ["--test", "-t short", "-t long", "selftest", "device-self-test"] {
        assert!(!source.contains(forbidden), "« {forbidden} » apparaît dans le fournisseur SMART");
    }
    assert!(source.contains("\"--json=c\", \"-i\", \"-H\", \"-A\""));
}

#[test]
fn nothing_in_the_storage_module_can_open_a_device_for_writing() {
    // Garde structurelle : aucune écriture, aucun montage, aucun formatage ne
    // doit pouvoir apparaître dans ce module sans faire échouer la suite.
    for source in [
        include_str!("../src/disks/mod.rs"),
        include_str!("../src/disks/linux.rs"),
        include_str!("../src/disks/smart.rs"),
        include_str!("../src/disks/windows.rs"),
        include_str!("../src/disks/command.rs"),
    ] {
        for forbidden in [
            "OpenOptions",
            "File::create",
            "fs::write",
            "fs::remove",
            "mkfs",
            "fsck",
            "chkdsk",
            "sgdisk",
            "parted",
            "mount(",
            "umount",
            "dd if=",
        ] {
            assert!(!source.contains(forbidden), "« {forbidden} » dans le module de stockage");
        }
    }
}
