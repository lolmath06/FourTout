//! Compression d'un **fichier seul** : GZIP et XZ.
//!
//! La distinction vaut d'être répétée, parce qu'elle fait trébucher tout le
//! monde : `.gz` et `.xz` ne sont pas des archives. Ils ne contiennent qu'un
//! flux d'octets — un seul fichier, sans nom de dossier, sans permissions,
//! sans arborescence. `archive.tar.gz`, lui, est une archive TAR *ensuite*
//! compressée en GZIP ; c'est le TAR qui porte l'arborescence.
//!
//! Tout passe en flux : compresser un fichier de 8 Go ne consomme ici que
//! quelques mégaoctets de mémoire.

use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use lzma_rust2::{XzOptions, XzReader, XzWriter};
use serde::{Deserialize, Serialize};

use super::Reporter;

const CHUNK: usize = 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum StreamFormat {
    Gz,
    Xz,
}

impl StreamFormat {
    pub fn extension(self) -> &'static str {
        match self {
            StreamFormat::Gz => "gz",
            StreamFormat::Xz => "xz",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            StreamFormat::Gz => "GZIP",
            StreamFormat::Xz => "XZ",
        }
    }

    /// Format déduit de l'extension d'un fichier existant.
    pub fn detect(path: &Path) -> Option<StreamFormat> {
        let name = path.file_name()?.to_string_lossy().to_lowercase();
        if name.ends_with(".gz") || name.ends_with(".tgz") {
            Some(StreamFormat::Gz)
        } else if name.ends_with(".xz") || name.ends_with(".txz") {
            Some(StreamFormat::Xz)
        } else {
            None
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamSummary {
    pub input: String,
    pub output: String,
    pub format: String,
    pub input_bytes: u64,
    pub output_bytes: u64,
    /// Taille finale rapportée à la taille d'origine, en pourcentage.
    pub ratio: f64,
}

fn summarize(
    input: &Path,
    output: &Path,
    format: StreamFormat,
    input_bytes: u64,
    output_bytes: u64,
) -> StreamSummary {
    StreamSummary {
        input: input.to_string_lossy().to_string(),
        output: output.to_string_lossy().to_string(),
        format: format.label().to_string(),
        input_bytes,
        output_bytes,
        ratio: if input_bytes > 0 {
            output_bytes as f64 / input_bytes as f64 * 100.0
        } else {
            0.0
        },
    }
}

/// Chemin temporaire voisin de la destination : le résultat n'apparaît sous son
/// vrai nom qu'une fois complet et refermé.
fn temporary_for(output: &Path) -> PathBuf {
    let parent = output.parent().unwrap_or(Path::new("."));
    let name = output.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    parent.join(format!(".fourtout-stream-{name}"))
}

fn finish(temporary: &Path, output: &Path, result: Result<u64, String>) -> Result<u64, String> {
    match result {
        Ok(bytes) => {
            fs::rename(temporary, output).map_err(|error| {
                let _ = fs::remove_file(temporary);
                format!("{} : {error}", output.display())
            })?;
            Ok(bytes)
        }
        Err(error) => {
            let _ = fs::remove_file(temporary);
            Err(error)
        }
    }
}

/// Compresse un fichier vers `.gz` ou `.xz`.
pub fn compress(
    input: &Path,
    output: &Path,
    format: StreamFormat,
    level: u32,
    reporter: &Reporter,
) -> Result<StreamSummary, String> {
    let input_bytes = fs::metadata(input).map_err(|e| format!("Fichier introuvable : {e}"))?.len();
    let temporary = temporary_for(output);
    let _ = fs::remove_file(&temporary);

    let written = finish(
        &temporary,
        output,
        (|| -> Result<u64, String> {
            let mut source =
                BufReader::with_capacity(CHUNK, File::open(input).map_err(|e| e.to_string())?);
            let target =
                BufWriter::new(File::create(&temporary).map_err(|e| e.to_string())?);
            let mut buffer = vec![0_u8; CHUNK];
            let mut done = 0_u64;

            // Chaque encodeur enveloppe la même boucle : lire un bloc, l'écrire,
            // vérifier l'annulation. Le format ne change que l'enveloppe.
            macro_rules! pump {
                ($encoder:expr) => {{
                    let mut encoder = $encoder;
                    loop {
                        reporter.check()?;
                        let read = source.read(&mut buffer).map_err(|e| e.to_string())?;
                        if read == 0 {
                            break;
                        }
                        encoder.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
                        done += read as u64;
                        reporter.report(done, input_bytes, "Compression…");
                    }
                    encoder.finish().map_err(|e| e.to_string())?
                }};
            }

            let mut inner = match format {
                StreamFormat::Gz => {
                    pump!(GzEncoder::new(target, Compression::new(level.clamp(0, 9))))
                }
                StreamFormat::Xz => {
                    let options = XzOptions::with_preset(level.clamp(0, 9));
                    pump!(XzWriter::new(target, options).map_err(|e| e.to_string())?)
                }
            };
            inner.flush().map_err(|e| e.to_string())?;
            inner.into_inner().map_err(|e| e.to_string())?.sync_all().map_err(|e| e.to_string())?;
            Ok(fs::metadata(&temporary).map(|m| m.len()).unwrap_or(0))
        })(),
    )?;

    Ok(summarize(input, output, format, input_bytes, written))
}

/// Décompresse un `.gz` ou un `.xz` vers un fichier.
pub fn decompress(
    input: &Path,
    output: &Path,
    format: StreamFormat,
    reporter: &Reporter,
) -> Result<StreamSummary, String> {
    let input_bytes = fs::metadata(input).map_err(|e| format!("Fichier introuvable : {e}"))?.len();
    let temporary = temporary_for(output);
    let _ = fs::remove_file(&temporary);

    let written = finish(
        &temporary,
        output,
        (|| -> Result<u64, String> {
            let source =
                BufReader::with_capacity(CHUNK, File::open(input).map_err(|e| e.to_string())?);
            let mut target =
                BufWriter::new(File::create(&temporary).map_err(|e| e.to_string())?);
            let written = drain(source, &mut target, format, input_bytes, reporter)?;
            target.flush().map_err(|e| e.to_string())?;
            target.into_inner().map_err(|e| e.to_string())?.sync_all().map_err(|e| e.to_string())?;
            Ok(written)
        })(),
    )?;

    Ok(summarize(input, output, format, input_bytes, written))
}

/// Décompresse un flux vers un puits quelconque, et renvoie le nombre d'octets
/// produits. Le test d'intégrité s'en sert avec un puits qui jette tout.
fn drain<R: Read, W: Write>(
    source: R,
    target: &mut W,
    format: StreamFormat,
    total: u64,
    reporter: &Reporter,
) -> Result<u64, String> {
    let mut buffer = vec![0_u8; CHUNK];
    let mut produced = 0_u64;

    macro_rules! pump {
        ($decoder:expr) => {{
            let mut decoder = $decoder;
            loop {
                reporter.check()?;
                let read = decoder.read(&mut buffer).map_err(|e| {
                    format!("Flux {} interrompu ou corrompu : {e}", format.label())
                })?;
                if read == 0 {
                    break;
                }
                target.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
                produced += read as u64;
                reporter.report(produced.min(total), total, "Décompression…");
            }
        }};
    }

    match format {
        StreamFormat::Gz => pump!(GzDecoder::new(source)),
        StreamFormat::Xz => pump!(XzReader::new(source, false)),
    }
    Ok(produced)
}

/// Puits qui compte les octets sans rien écrire : sert au test d'intégrité,
/// qui doit tout décompresser sans produire de fichier.
struct Sink {
    written: u64,
}

impl Write for Sink {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        self.written += buffer.len() as u64;
        Ok(buffer.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Vérifie qu'un flux compressé se décompresse entièrement, sans rien écrire.
///
/// C'est la seule façon honnête de tester un `.gz` ou un `.xz` : ces formats
/// portent une somme de contrôle du contenu *décompressé*, qui n'est vérifiée
/// qu'en le décompressant réellement.
pub fn test_stream(
    input: &Path,
    format: StreamFormat,
    reporter: &Reporter,
) -> Result<u64, String> {
    let total = fs::metadata(input).map_err(|e| format!("Fichier introuvable : {e}"))?.len();
    let source = BufReader::with_capacity(CHUNK, File::open(input).map_err(|e| e.to_string())?);
    let mut sink = Sink { written: 0 };
    drain(source, &mut sink, format, total, reporter)?;
    Ok(sink.written)
}

/// Nom de sortie naturel : `notes.txt` → `notes.txt.gz`, et l'inverse.
pub fn suggested_output(input: &Path, format: StreamFormat, compressing: bool) -> PathBuf {
    if compressing {
        let mut name = input.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        name.push('.');
        name.push_str(format.extension());
        input.with_file_name(name)
    } else {
        let name = input.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let stripped = name
            .strip_suffix(&format!(".{}", format.extension()))
            .map(|s| s.to_string())
            .unwrap_or_else(|| match name.as_str() {
                other if other.ends_with(".tgz") => other.replace(".tgz", ".tar"),
                other if other.ends_with(".txz") => other.replace(".txz", ".tar"),
                other => format!("{other}.decompresse"),
            });
        input.with_file_name(stripped)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::hash::sha256_file;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("fourtout-compress-tests").join(name);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Contenu volontairement plus gros qu'un bloc, et compressible.
    fn sample() -> Vec<u8> {
        let mut bytes = Vec::new();
        for index in 0..40_000 {
            bytes.extend_from_slice(format!("ligne {index} — FourTout compresse en flux.\n").as_bytes());
        }
        bytes
    }

    fn round_trip(format: StreamFormat, level: u32) {
        let dir = scratch(&format!("round-{}-{level}", format.extension()));
        let source = dir.join("source.txt");
        fs::write(&source, sample()).unwrap();
        let before = sha256_file(&source).unwrap();

        let compressed = suggested_output(&source, format, true);
        let summary = compress(&source, &compressed, format, level, &Reporter::silent()).unwrap();
        assert!(compressed.exists());
        assert!(summary.output_bytes > 0);
        assert!(
            summary.output_bytes < summary.input_bytes,
            "{} devrait compresser ce texte répétitif",
            format.label()
        );

        // Le test d'intégrité doit accepter ce que l'on vient d'écrire.
        let produced = test_stream(&compressed, format, &Reporter::silent()).unwrap();
        assert_eq!(produced, summary.input_bytes);

        let restored = dir.join("restore.txt");
        decompress(&compressed, &restored, format, &Reporter::silent()).unwrap();
        assert_eq!(sha256_file(&restored).unwrap(), before, "aller-retour non conforme");
    }

    #[test]
    fn gzip_round_trip_preserves_bytes() {
        round_trip(StreamFormat::Gz, 6);
        round_trip(StreamFormat::Gz, 1);
    }

    #[test]
    fn xz_round_trip_preserves_bytes() {
        round_trip(StreamFormat::Xz, 6);
    }

    #[test]
    fn a_truncated_stream_is_refused() {
        for format in [StreamFormat::Gz, StreamFormat::Xz] {
            let dir = scratch(&format!("truncated-{}", format.extension()));
            let source = dir.join("source.txt");
            fs::write(&source, sample()).unwrap();
            let compressed = suggested_output(&source, format, true);
            compress(&source, &compressed, format, 6, &Reporter::silent()).unwrap();

            let mut bytes = fs::read(&compressed).unwrap();
            bytes.truncate(bytes.len() / 2);
            let broken = dir.join(format!("tronque.{}", format.extension()));
            fs::write(&broken, &bytes).unwrap();

            let error = test_stream(&broken, format, &Reporter::silent()).unwrap_err();
            assert!(error.contains("corrompu") || error.contains("interrompu"), "{error}");
        }
    }

    #[test]
    fn a_corrupted_stream_is_refused() {
        let dir = scratch("corrupted");
        let source = dir.join("source.txt");
        fs::write(&source, sample()).unwrap();
        let compressed = dir.join("source.txt.gz");
        compress(&source, &compressed, StreamFormat::Gz, 6, &Reporter::silent()).unwrap();

        let mut bytes = fs::read(&compressed).unwrap();
        let middle = bytes.len() / 2;
        bytes[middle] ^= 0xFF;
        let broken = dir.join("abime.gz");
        fs::write(&broken, &bytes).unwrap();
        assert!(test_stream(&broken, StreamFormat::Gz, &Reporter::silent()).is_err());
    }

    #[test]
    fn output_names_follow_the_convention() {
        let source = Path::new("/tmp/notes.txt");
        assert_eq!(
            suggested_output(source, StreamFormat::Gz, true),
            PathBuf::from("/tmp/notes.txt.gz")
        );
        assert_eq!(
            suggested_output(Path::new("/tmp/notes.txt.gz"), StreamFormat::Gz, false),
            PathBuf::from("/tmp/notes.txt")
        );
        assert_eq!(
            suggested_output(Path::new("/tmp/archive.tgz"), StreamFormat::Gz, false),
            PathBuf::from("/tmp/archive.tar")
        );
        assert_eq!(
            suggested_output(Path::new("/tmp/data.bin.xz"), StreamFormat::Xz, false),
            PathBuf::from("/tmp/data.bin")
        );
    }

    #[test]
    fn formats_are_detected_from_the_extension() {
        assert_eq!(StreamFormat::detect(Path::new("a.gz")), Some(StreamFormat::Gz));
        assert_eq!(StreamFormat::detect(Path::new("a.tar.gz")), Some(StreamFormat::Gz));
        assert_eq!(StreamFormat::detect(Path::new("a.xz")), Some(StreamFormat::Xz));
        assert_eq!(StreamFormat::detect(Path::new("a.zip")), None);
    }

    #[test]
    fn cancellation_leaves_no_output_behind() {
        let dir = scratch("cancel");
        let source = dir.join("source.txt");
        fs::write(&source, sample()).unwrap();
        let compressed = dir.join("source.txt.gz");
        let outcome =
            compress(&source, &compressed, StreamFormat::Gz, 6, &Reporter::silent_cancelled());
        assert!(outcome.is_err());
        assert!(!compressed.exists());
        assert!(!temporary_for(&compressed).exists());
    }
}
