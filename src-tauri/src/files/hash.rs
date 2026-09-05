//! Empreintes de fichiers, calculées **en flux**.
//!
//! Un fichier de 20 Go n'est jamais chargé en mémoire : il est lu par blocs de
//! 1 Mio, ce qui rend le coût mémoire constant et l'avancement mesurable en
//! octets réellement parcourus.

use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use md5::Md5;
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Digest, Sha256, Sha512};

use super::Reporter;

const CHUNK: usize = 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Algorithm {
    Md5,
    Sha1,
    Sha256,
    Sha512,
}

impl Algorithm {
    pub fn label(&self) -> &'static str {
        match self {
            Algorithm::Md5 => "MD5",
            Algorithm::Sha1 => "SHA-1",
            Algorithm::Sha256 => "SHA-256",
            Algorithm::Sha512 => "SHA-512",
        }
    }
}

/// Cumul multi-algorithmes : le fichier n'est lu qu'une fois, quel que soit le
/// nombre d'empreintes demandées.
enum Hasher {
    Md5(Md5),
    Sha1(Sha1),
    Sha256(Sha256),
    Sha512(Sha512),
}

impl Hasher {
    fn new(algorithm: Algorithm) -> Self {
        match algorithm {
            Algorithm::Md5 => Hasher::Md5(Md5::new()),
            Algorithm::Sha1 => Hasher::Sha1(Sha1::new()),
            Algorithm::Sha256 => Hasher::Sha256(Sha256::new()),
            Algorithm::Sha512 => Hasher::Sha512(Sha512::new()),
        }
    }

    fn update(&mut self, bytes: &[u8]) {
        match self {
            Hasher::Md5(h) => h.update(bytes),
            Hasher::Sha1(h) => h.update(bytes),
            Hasher::Sha256(h) => h.update(bytes),
            Hasher::Sha512(h) => h.update(bytes),
        }
    }

    fn finish(self) -> String {
        match self {
            Hasher::Md5(h) => hex(&h.finalize()),
            Hasher::Sha1(h) => hex(&h.finalize()),
            Hasher::Sha256(h) => hex(&h.finalize()),
            Hasher::Sha512(h) => hex(&h.finalize()),
        }
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHashes {
    pub path: String,
    pub name: String,
    pub size: u64,
    /// Empreintes demandées, dans l'ordre reçu : `[("SHA-256", "ab12…")]`.
    pub digests: Vec<(String, String)>,
}

/// Calcule une ou plusieurs empreintes d'un fichier.
pub fn hash_file(
    path: &Path,
    algorithms: &[Algorithm],
    reporter: &Reporter,
) -> Result<FileHashes, String> {
    let file = File::open(path).map_err(|e| format!("Lecture impossible : {e}"))?;
    let size = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut reader = BufReader::with_capacity(CHUNK, file);
    let mut hashers: Vec<Hasher> = algorithms.iter().map(|a| Hasher::new(*a)).collect();
    let mut buffer = vec![0_u8; CHUNK];
    let mut done: u64 = 0;
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();

    loop {
        reporter.check()?;
        let read = reader.read(&mut buffer).map_err(|e| format!("Lecture interrompue : {e}"))?;
        if read == 0 {
            break;
        }
        for hasher in hashers.iter_mut() {
            hasher.update(&buffer[..read]);
        }
        done += read as u64;
        reporter.report(done, size, &name);
    }

    let digests = algorithms
        .iter()
        .zip(hashers.into_iter())
        .map(|(algorithm, hasher)| (algorithm.label().to_string(), hasher.finish()))
        .collect();

    Ok(FileHashes { path: path.to_string_lossy().to_string(), name, size, digests })
}

/// SHA-256 seul, sans progression : brique interne (doublons, découpage).
pub fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| format!("Lecture impossible : {e}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; CHUNK];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

/// Empreinte partielle : début, milieu et fin du fichier.
///
/// Elle sert à éliminer rapidement les faux candidats du détecteur de doublons
/// sans lire des gigaoctets : deux fichiers de même taille dont ces trois
/// fenêtres diffèrent ne peuvent pas être identiques.
pub fn partial_sha256(path: &Path, window: usize) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| format!("Lecture impossible : {e}"))?;
    let size = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut hasher = Sha256::new();
    hasher.update(size.to_le_bytes());

    if size <= (window as u64) * 3 {
        // Petit fichier : le lire en entier coûte moins cher que trois seeks.
        let mut all = Vec::new();
        file.read_to_end(&mut all).map_err(|e| e.to_string())?;
        hasher.update(&all);
    } else {
        let mut buffer = vec![0_u8; window];
        let half = (window as u64) / 2;
        for offset in [0, size / 2 - half, size - window as u64] {
            file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
            file.read_exact(&mut buffer).map_err(|e| e.to_string())?;
            hasher.update(&buffer);
        }
    }
    Ok(hex(&hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_file(name: &str, content: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join("fourtout-hash-tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        let mut file = File::create(&path).unwrap();
        file.write_all(content).unwrap();
        path
    }

    #[test]
    fn matches_known_vectors() {
        let path = temp_file("abc.bin", b"abc");
        let result = hash_file(
            &path,
            &[Algorithm::Md5, Algorithm::Sha1, Algorithm::Sha256, Algorithm::Sha512],
            &Reporter::silent(),
        )
        .unwrap();
        assert_eq!(result.size, 3);
        assert_eq!(result.digests[0].1, "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(result.digests[1].1, "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(
            result.digests[2].1,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert!(result.digests[3].1.starts_with("ddaf35a193617aba"));
    }

    #[test]
    fn partial_hash_separates_different_files() {
        let a = temp_file("part-a.bin", &vec![7_u8; 100_000]);
        let mut different = vec![7_u8; 100_000];
        different[50_000] = 9;
        let b = temp_file("part-b.bin", &different);
        assert_ne!(partial_sha256(&a, 4096).unwrap(), partial_sha256(&b, 4096).unwrap());
        assert_eq!(partial_sha256(&a, 4096).unwrap(), partial_sha256(&a, 4096).unwrap());
    }
}
