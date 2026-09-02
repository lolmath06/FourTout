//! Lecture en flux du corpus de graines.
//!
//! Le corpus est un fichier texte gzip (une graine par ligne, trié par
//! fréquence). Il est lu ligne par ligne sans jamais charger l'ensemble en
//! mémoire : seule la ligne courante existe à un instant donné, ce qui permet
//! un corpus de plusieurs dizaines de Mo décompressés sans coût mémoire.

use std::fs::File;
use std::io::{self, BufRead, BufReader};
use std::path::Path;

use flate2::read::GzDecoder;

/// Ouvre le corpus gzip et renvoie un itérateur de graines.
///
/// `limit` borne le nombre de graines lues (pour le niveau « rapide ») ; `None`
/// lit tout le corpus. Les lignes vides sont ignorées.
pub fn read_seeds(
    path: &Path,
    limit: Option<usize>,
) -> io::Result<impl Iterator<Item = String>> {
    let file = File::open(path)?;
    let reader = BufReader::new(GzDecoder::new(file));
    let iter = reader
        .lines()
        .filter_map(|line| line.ok())
        .map(|line| line.trim_end().to_string())
        .filter(|line| !line.is_empty());

    Ok(match limit {
        Some(n) => Box::new(iter.take(n)) as Box<dyn Iterator<Item = String>>,
        None => Box::new(iter) as Box<dyn Iterator<Item = String>>,
    })
}

/// Métadonnées du corpus, écrites par le générateur à côté du fichier gzip.
#[derive(Clone, Copy)]
pub struct CorpusMeta {
    /// Nombre total de graines.
    pub seed_count: u64,
}

/// Lit le nombre de graines depuis le fichier `*.meta` (une ligne : un entier).
///
/// Permet d'annoncer un total prévisionnel sans parcourir tout le corpus.
pub fn read_meta(meta_path: &Path) -> io::Result<CorpusMeta> {
    let text = std::fs::read_to_string(meta_path)?;
    let seed_count = text
        .trim()
        .lines()
        .next()
        .and_then(|l| l.trim().parse::<u64>().ok())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "métadonnées de corpus invalides"))?;
    Ok(CorpusMeta { seed_count })
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;

    fn write_gz(path: &Path, lines: &[&str]) {
        let file = File::create(path).unwrap();
        let mut encoder = GzEncoder::new(file, Compression::default());
        for line in lines {
            writeln!(encoder, "{line}").unwrap();
        }
        encoder.finish().unwrap();
    }

    #[test]
    fn reads_all_seeds() {
        let dir = std::env::temp_dir().join(format!("ft-wl-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("seeds.txt.gz");
        write_gz(&path, &["password", "dragon", "", "  monkey  ", "letmein"]);

        let seeds: Vec<String> = read_seeds(&path, None).unwrap().collect();
        assert_eq!(seeds, vec!["password", "dragon", "  monkey", "letmein"]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn respects_the_limit() {
        let dir = std::env::temp_dir().join(format!("ft-wl2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("seeds.txt.gz");
        write_gz(&path, &["a", "b", "c", "d", "e"]);

        let seeds: Vec<String> = read_seeds(&path, Some(3)).unwrap().collect();
        assert_eq!(seeds, vec!["a", "b", "c"]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reads_meta() {
        let dir = std::env::temp_dir().join(format!("ft-wl3-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("seeds.meta");
        std::fs::write(&path, "123456\n").unwrap();
        assert_eq!(read_meta(&path).unwrap().seed_count, 123456);
        std::fs::remove_dir_all(&dir).ok();
    }
}
