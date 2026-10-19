//! Recoupement des images ISO avec les outils de référence du système.
//!
//! Notre écrivain et notre lecteur s'éprouvent déjà l'un l'autre (tests
//! unitaires) ; ici on les confronte à des implémentations indépendantes :
//! `isoinfo`/`bsdtar` doivent lire nos images, et nous devons lire celles de
//! `genisoimage`, y compris amorçables (El Torito).
//!
//! Chaque outil absent du poste est signalé et son test saute : on ne simule
//! pas un outil de référence.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use fourtout_lib::exec::find_in_path;
use fourtout_lib::files::iso::read::{extract, inspect};
use fourtout_lib::files::iso::write::{create, CreateOptions};
use fourtout_lib::files::Reporter;

fn tool(name: &str) -> Option<PathBuf> {
    let path = find_in_path(name);
    if path.is_none() {
        eprintln!("{name} absent : test ignoré");
    }
    path
}

fn workspace(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("fourtout-iso-it-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn tree(root: &Path) {
    fs::create_dir_all(root.join("docs/nested")).unwrap();
    fs::write(root.join("readme.txt"), "Bonjour\n").unwrap();
    fs::write(root.join("docs/a.txt"), vec![b'a'; 5000]).unwrap();
    fs::write(root.join("docs/nested/été.txt"), "accentué\n").unwrap();
    fs::write(root.join("Nom Avec Espaces.md"), "# titre\n").unwrap();
}

#[test]
fn isoinfo_and_bsdtar_read_our_images() {
    let work = workspace("ours");
    let source = work.join("source");
    tree(&source);
    let image = work.join("ours.iso");
    let options = CreateOptions { label: "FOURTOUT_TEST".into(), ..CreateOptions::default() };
    create(&source, &image, &options, &Reporter::silent()).unwrap();

    if let Some(isoinfo) = tool("isoinfo") {
        let descriptor = Command::new(&isoinfo).args(["-d", "-i"]).arg(&image).output().unwrap();
        let text = String::from_utf8_lossy(&descriptor.stdout);
        assert!(descriptor.status.success(), "{text}{}", String::from_utf8_lossy(&descriptor.stderr));
        assert!(text.contains("Volume id: FOURTOUT_TEST"), "{text}");
        assert!(text.contains("Joliet with UCS level 3 found"), "{text}");
        assert!(text.contains("Rock Ridge signatures version 1 found"), "{text}");

        // Arborescence Rock Ridge, puis Joliet : les noms longs y sont intacts.
        let rock = Command::new(&isoinfo).args(["-R", "-f", "-i"]).arg(&image).output().unwrap();
        let rock = String::from_utf8_lossy(&rock.stdout);
        assert!(rock.contains("/Nom Avec Espaces.md"), "{rock}");
        assert!(rock.contains("/docs/nested/été.txt"), "{rock}");
        let joliet = Command::new(&isoinfo).args(["-J", "-f", "-i"]).arg(&image).output().unwrap();
        let joliet = String::from_utf8_lossy(&joliet.stdout);
        assert!(joliet.contains("/Nom Avec Espaces.md"), "{joliet}");

        // Le contenu d'un fichier, extrait par l'outil de référence.
        let extracted = Command::new(&isoinfo)
            .args(["-R", "-i"])
            .arg(&image)
            .args(["-x", "/docs/a.txt"])
            .output()
            .unwrap();
        assert_eq!(extracted.stdout, vec![b'a'; 5000]);
    }

    if let Some(bsdtar) = tool("bsdtar") {
        let listing = Command::new(&bsdtar).arg("-tf").arg(&image).output().unwrap();
        let listing = String::from_utf8_lossy(&listing.stdout);
        assert!(listing.lines().any(|l| l.trim_end_matches('/') == "docs/nested/été.txt"), "{listing}");
        assert!(listing.lines().any(|l| l == "Nom Avec Espaces.md"), "{listing}");

        let out = work.join("bsdtar-out");
        fs::create_dir_all(&out).unwrap();
        let status = Command::new(&bsdtar).arg("-xf").arg(&image).arg("-C").arg(&out).status().unwrap();
        assert!(status.success());
        assert_eq!(fs::read(out.join("docs/a.txt")).unwrap(), vec![b'a'; 5000]);
        assert_eq!(fs::read_to_string(out.join("docs/nested/été.txt")).unwrap(), "accentué\n");
    }
    let _ = fs::remove_dir_all(&work);
}

#[test]
fn we_read_images_written_by_genisoimage() {
    let Some(mkiso) = tool("genisoimage") else { return };
    let work = workspace("theirs");
    let source = work.join("source");
    tree(&source);
    let image = work.join("theirs.iso");
    let status = Command::new(&mkiso)
        .args(["-quiet", "-R", "-J", "-V", "THEIRS", "-o"])
        .arg(&image)
        .arg(&source)
        .status()
        .unwrap();
    assert!(status.success());

    let info = inspect(&image, 100, &Reporter::silent()).unwrap();
    assert_eq!(info.label, "THEIRS");
    assert!(info.features.contains(&"joliet".to_string()));
    assert!(info.features.contains(&"rock-ridge".to_string()));
    assert_eq!(info.files, 4);
    assert!(info.entries.iter().any(|e| e.path == "docs/nested/été.txt"));

    let out = work.join("out");
    assert_eq!(extract(&image, &out, &[], false, &Reporter::silent()).unwrap().extracted, 4);
    assert_eq!(fs::read(out.join("docs/a.txt")).unwrap(), vec![b'a'; 5000]);
    let _ = fs::remove_dir_all(&work);
}

#[test]
fn we_detect_el_torito_boot_data() {
    let Some(mkiso) = tool("genisoimage") else { return };
    let work = workspace("boot");
    let source = work.join("source");
    fs::create_dir_all(source.join("boot")).unwrap();
    fs::write(source.join("boot/loader.img"), vec![0x90_u8; 4096]).unwrap();
    fs::write(source.join("readme.txt"), "x").unwrap();
    let image = work.join("boot.iso");
    let status = Command::new(&mkiso)
        .args(["-quiet", "-R", "-J", "-b", "boot/loader.img", "-no-emul-boot", "-boot-load-size", "4", "-c", "boot/boot.cat", "-o"])
        .arg(&image)
        .arg(&source)
        .status()
        .unwrap();
    assert!(status.success());

    let info = inspect(&image, 100, &Reporter::silent()).unwrap();
    assert!(info.features.contains(&"el-torito".to_string()), "{:?}", info.features);
    let boot = info.boot.expect("catalogue de démarrage");
    assert!(boot.validation_ok);
    assert_eq!(boot.platforms, vec!["bios"]);
    assert_eq!(boot.entries.len(), 1);
    let entry = &boot.entries[0];
    assert!(entry.bootable);
    assert_eq!(entry.media, "no-emulation");
    assert_eq!(entry.sectors, 4);
    assert_eq!(entry.path.as_deref(), Some("boot/loader.img"));

    // Une image de données écrite par nos soins ne prétend pas démarrer.
    let ours = work.join("ours.iso");
    create(&source, &ours, &CreateOptions::default(), &Reporter::silent()).unwrap();
    assert!(inspect(&ours, 100, &Reporter::silent()).unwrap().boot.is_none());
    let _ = fs::remove_dir_all(&work);
}
