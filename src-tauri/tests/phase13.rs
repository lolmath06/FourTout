//! Les fixtures réelles du jalon, lues par les vrais moteurs.
//!
//! Elles sont ignorées proprement quand elles n'ont pas été générées
//! (`pnpm test:assets`), comme celles des phases précédentes.

use std::fs;
use std::path::{Path, PathBuf};

use fourtout_lib::files::iso::read::{extract, inspect};
use fourtout_lib::files::magic::{identify, Family};
use fourtout_lib::files::Reporter;
use fourtout_lib::imaging::{anim, heic};

fn assets() -> Option<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent()?.join("test-assets/generated");
    if root.join("sample.iso").exists() {
        Some(root)
    } else {
        eprintln!("fixtures absentes : lancez `pnpm test:assets` — test ignoré");
        None
    }
}

fn head(path: &Path) -> Vec<u8> {
    let bytes = fs::read(path).unwrap();
    bytes[..bytes.len().min(fourtout_lib::files::magic::HEAD_BYTES)].to_vec()
}

#[test]
fn identifies_every_format_by_content_not_by_name() {
    let Some(root) = assets() else { return };
    let cases: [(&str, &str, bool); 9] = [
        ("animated.webp", "webp", true),
        ("still.webp", "webp", false),
        ("animated.png", "apng", true),
        ("sample.png", "png", false),
        ("video.webm", "webm", false),
        ("sample.avif", "avif", false),
        ("sample.heic", "heic", false),
        ("sample.iso", "iso", false),
        ("sample-boot.iso", "iso", false),
    ];
    for (file, id, animated) in cases {
        let path = root.join(file);
        if !path.exists() {
            continue;
        }
        let signature = identify(&head(&path));
        assert_eq!((signature.id, signature.animated), (id, animated), "{file}");
    }
    // Un PNG qui se fait passer pour un JPEG, ou sans extension : le contenu fait foi.
    for file in ["photo-mislabeled.jpg", "photo-no-extension"] {
        let path = root.join(file);
        if path.exists() {
            assert_eq!(identify(&head(&path)).id, "png", "{file}");
        }
    }
    // Un WebM sans image reste un WebM, et reste de la famille vidéo.
    if root.join("audio-only.webm").exists() {
        let signature = identify(&head(&root.join("audio-only.webm")));
        assert_eq!((signature.id, signature.family), ("webm", Family::Video));
    }
}

#[test]
fn reads_the_generated_iso_and_extracts_it_faithfully() {
    let Some(root) = assets() else { return };
    let info = inspect(&root.join("sample.iso"), 1000, &Reporter::silent()).unwrap();
    assert_eq!(info.label, "FOURTOUT_ISO");
    assert_eq!(info.files, 6);
    assert!(info.entries.iter().any(|e| e.path == "documents/rapports/2026/été-à-la-mer.txt"));
    assert!(info.entries.iter().any(|e| e.path == "Photos de vacances/日本語のファイル.txt"));
    assert!(info.boot.is_none());

    let out = std::env::temp_dir().join(format!("fourtout-phase13-{}", std::process::id()));
    let _ = fs::remove_dir_all(&out);
    let summary = extract(&root.join("sample.iso"), &out, &[], false, &Reporter::silent()).unwrap();
    assert_eq!(summary.extracted, 6);
    assert_eq!(
        fs::read(out.join("données/aleatoire.bin")).unwrap(),
        fs::read(root.join("iso-source/données/aleatoire.bin")).unwrap()
    );
    assert_eq!(fs::read(out.join("vide.dat")).unwrap().len(), 0);
    let _ = fs::remove_dir_all(&out);

    let boot = root.join("sample-boot.iso");
    if boot.exists() {
        let info = inspect(&boot, 100, &Reporter::silent()).unwrap();
        let catalog = info.boot.expect("catalogue El Torito");
        assert!(catalog.validation_ok);
        assert_eq!(catalog.entries[0].path.as_deref(), Some("boot/loader.img"));
    }
}

#[test]
fn decodes_the_heic_fixture_natively() {
    let Some(root) = assets() else { return };
    let path = root.join("sample.heic");
    if !path.exists() {
        return;
    }
    let png = heic::to_png(&fs::read(path).unwrap()).unwrap();
    assert!(png.starts_with(&[0x89, b'P', b'N', b'G']));
}

#[test]
fn reads_the_animated_fixtures_frame_by_frame() {
    let Some(root) = assets() else { return };
    for file in ["animated.webp", "animated.png"] {
        let path = root.join(file);
        if !path.exists() {
            continue;
        }
        let info = anim::info(&path).unwrap();
        assert!(info.animated, "{file}");
        assert_eq!(info.frames, 12, "{file}");
        assert_eq!((info.width, info.height), (160, 120), "{file}");
        assert!((1000..=1400).contains(&info.duration_ms), "{file}: {}", info.duration_ms);
    }
    let still = root.join("still.webp");
    if still.exists() {
        assert!(!anim::info(&still).unwrap().animated);
    }
}
