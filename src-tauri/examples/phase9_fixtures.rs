//! Fixtures d'archives que Node ne sait pas écrire sans dépendance : 7z, XZ et
//! TAR.XZ, plus leurs variantes abîmées.
//!
//! Le reste des fixtures de la phase 9 est produit par
//! `scripts/generate-phase9-assets.mjs`, en JavaScript pur — une archive écrite
//! par le moteur qu'on veut éprouver ne prouverait pas grand-chose. Pour ces
//! trois formats, aucun écrivain indépendant n'existe en Node : on assume donc
//! d'employer le moteur de FourTout, et les tests d'intégrité compensent en
//! vérifiant que les variantes abîmées sont bien refusées.
//!
//! Usage : `cargo run --release --example phase9_fixtures` depuis `src-tauri/`.

use std::fs;
use std::path::{Path, PathBuf};

use fourtout_lib::files::archive::{self, Format};
use fourtout_lib::files::compress::{self, StreamFormat};
use fourtout_lib::files::Reporter;

fn out_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../test-assets/generated")
}

/// Retourne quelques bits au milieu, là où se trouvent les données.
fn corrupt(bytes: &[u8]) -> Vec<u8> {
    let mut copy = bytes.to_vec();
    let middle = copy.len() / 2;
    copy[middle] ^= 0xFF;
    copy[middle + 1] ^= 0x0F;
    copy[middle + 2] ^= 0xF0;
    copy
}

fn truncate(bytes: &[u8]) -> Vec<u8> {
    bytes[..bytes.len() * 6 / 10].to_vec()
}

fn main() -> Result<(), String> {
    let out = out_dir();
    let source = out.join("archive-sample");
    if !source.is_dir() {
        return Err(format!(
            "Le dossier « {} » est absent. Lancez d'abord `node scripts/generate-phase9-assets.mjs`.",
            source.display()
        ));
    }

    let reporter = Reporter::silent();
    let members = archive::collect_members(std::slice::from_ref(&source), &reporter)?;
    let mut produced: Vec<(String, u64)> = Vec::new();
    let mut record = |path: &Path| {
        let size = fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
        produced.push((
            path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            size,
        ));
    };

    // --- archives saines -----------------------------------------------
    for (format, name) in
        [(Format::SevenZ, "archive-sample.7z"), (Format::TarXz, "archive-sample.tar.xz")]
    {
        let path = out.join(name);
        let _ = fs::remove_file(&path);
        archive::create(&members, &path, format, 6, &reporter)?;
        record(&path);

        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        let stem = name.split('.').next().unwrap_or("archive");
        let extension = name.trim_start_matches(stem).trim_start_matches('.');

        let corrupted = out.join(format!("archive-corrupt.{extension}"));
        fs::write(&corrupted, corrupt(&bytes)).map_err(|e| e.to_string())?;
        record(&corrupted);

        let truncated = out.join(format!("archive-truncated.{extension}"));
        fs::write(&truncated, truncate(&bytes)).map_err(|e| e.to_string())?;
        record(&truncated);
    }

    // --- archive 7z piégée (traversée de dossier) -----------------------
    // `push_archive_entry` accepte le nom tel quel : c'est exactement ce que
    // ferait un outil malveillant, et c'est ce que l'extraction doit refuser.
    let traversal = out.join("archive-traversal.7z");
    let _ = fs::remove_file(&traversal);
    {
        let mut writer =
            sevenz_rust2::ArchiveWriter::create(&traversal).map_err(|e| e.to_string())?;
        for (name, content) in [
            ("../../evade-7z.txt", &b"Ce fichier ne doit jamais etre ecrit.\n"[..]),
            ("sain.txt", b"Cette entree-la est legitime.\n"),
        ] {
            writer
                .push_archive_entry(sevenz_rust2::ArchiveEntry::new_file(name), Some(content))
                .map_err(|e| e.to_string())?;
        }
        writer.finish().map_err(|e| e.to_string())?;
    }
    record(&traversal);

    // --- flux XZ d'un fichier seul --------------------------------------
    let lone = out.join("lone-file.txt");
    if lone.is_file() {
        let xz = out.join("lone-file.txt.xz");
        let _ = fs::remove_file(&xz);
        compress::compress(&lone, &xz, StreamFormat::Xz, 6, &reporter)?;
        record(&xz);

        let bytes = fs::read(&xz).map_err(|e| e.to_string())?;
        let truncated = out.join("lone-file-truncated.txt.xz");
        fs::write(&truncated, truncate(&bytes)).map_err(|e| e.to_string())?;
        record(&truncated);
        let corrupted = out.join("lone-file-corrupt.txt.xz");
        fs::write(&corrupted, corrupt(&bytes)).map_err(|e| e.to_string())?;
        record(&corrupted);
    }

    let total: u64 = produced.iter().map(|(_, size)| *size).sum();
    println!("Fixtures 7z/XZ : {} fichiers, {} Ko", produced.len(), total / 1024);
    for (name, size) in &produced {
        println!("  {name} — {size} o");
    }
    Ok(())
}
