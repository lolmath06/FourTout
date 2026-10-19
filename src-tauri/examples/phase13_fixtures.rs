//! Images ISO de référence du jalon Internet / ISO.
//!
//! `sample.iso` est écrite par l'écrivain de FourTout à partir du dossier
//! `iso-source/` (date figée : les octets sont identiques à chaque exécution).
//! `sample-boot.iso` est produite par un outil **indépendant** (genisoimage ou
//! xorriso) quand il est installé : une image amorçable ne se fabrique pas avec
//! l'écrivain de FourTout, qui n'en écrit pas.
//!
//! Usage : `cargo run --quiet --example phase13_fixtures` depuis `src-tauri/`.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use fourtout_lib::exec::find_in_path;
use fourtout_lib::files::iso::write::{create, CreateOptions};
use fourtout_lib::files::Reporter;

fn out_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../test-assets/generated")
}

fn main() {
    let out = out_dir();
    let source = out.join("iso-source");
    if !source.is_dir() {
        eprintln!("iso-source/ absent : lancez d'abord `node scripts/generate-phase13-assets.mjs`");
        return;
    }
    let options = CreateOptions {
        label: "FOURTOUT_ISO".into(),
        overwrite: true,
        fixed_time: Some(1_704_164_645),
        ..CreateOptions::default()
    };
    let summary = create(&source, &out.join("sample.iso"), &options, &Reporter::silent()).expect("sample.iso");
    println!("  sample.iso ({} fichiers, {} octets)", summary.files, summary.image_bytes);

    // Image amorçable : un « chargeur » factice de 4 Kio, détecté mais jamais exécuté.
    let boot_source = out.join("iso-boot-source");
    let _ = fs::remove_dir_all(&boot_source);
    fs::create_dir_all(boot_source.join("boot")).unwrap();
    fs::write(boot_source.join("boot/loader.img"), vec![0x90_u8; 4096]).unwrap();
    fs::write(boot_source.join("LISEZMOI.txt"), "Image avec catalogue El Torito (chargeur factice).\n").unwrap();
    let Some(tool) = find_in_path("genisoimage").or_else(|| find_in_path("xorriso")) else {
        println!("  (sample-boot.iso ignorée : ni genisoimage ni xorriso)");
        return;
    };
    let mut command = Command::new(&tool);
    if tool.file_stem().is_some_and(|n| n == "xorriso") {
        command.args(["-as", "mkisofs"]);
    }
    let status = command
        .args(["-quiet", "-R", "-J", "-V", "BOOT_TEST", "-b", "boot/loader.img", "-no-emul-boot", "-boot-load-size", "4", "-c", "boot/boot.cat", "-o"])
        .arg(out.join("sample-boot.iso"))
        .arg(&boot_source)
        .status()
        .expect("lancement de l'outil ISO");
    if status.success() {
        println!("  sample-boot.iso (El Torito)");
    }
}
