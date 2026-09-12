//! Lecture et écriture hexadécimales par **fenêtre**.
//!
//! Volontairement borné : ce n'est pas un éditeur binaire professionnel. Il n'y
//! a ni modèle de structure, ni script, ni désassemblage — seulement de quoi
//! regarder les octets d'un fichier, en chercher une séquence, et en corriger
//! quelques-uns.
//!
//! La conséquence architecturale importante : **rien n'est jamais entièrement
//! chargé**. Un fichier de 20 Go se parcourt par fenêtres de quelques dizaines
//! de kilo-octets, la recherche le traverse en flux, et l'enregistrement le
//! recopie par blocs en appliquant les modifications au passage.
//!
//! Par défaut, l'écriture produit un **nouveau fichier** : écraser l'original
//! est une action distincte, que l'appelant doit demander explicitement.

use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::Reporter;

/// Taille maximale d'une fenêtre de lecture. Au-delà, l'affichage n'apporte
/// plus rien et le transfert vers l'interface coûte cher.
pub const MAX_WINDOW: usize = 64 * 1024;
const COPY_CHUNK: usize = 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HexWindow {
    pub path: String,
    pub offset: u64,
    pub file_size: u64,
    /// Octets lus, dans l'ordre. Jamais plus que `MAX_WINDOW`.
    pub bytes: Vec<u8>,
}

/// Lit une fenêtre d'octets à partir d'un décalage.
pub fn read_window(path: &Path, offset: u64, length: usize) -> Result<HexWindow, String> {
    let mut file = File::open(path).map_err(|e| format!("Lecture impossible : {e}"))?;
    let file_size = file.metadata().map_err(|e| e.to_string())?.len();
    if offset > file_size {
        return Err(format!(
            "Décalage hors du fichier : {offset} demandé, le fichier fait {file_size} octet(s)."
        ));
    }
    let length = length.min(MAX_WINDOW);
    let available = (file_size - offset).min(length as u64) as usize;
    let mut bytes = vec![0_u8; available];
    if available > 0 {
        file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
        file.read_exact(&mut bytes).map_err(|e| format!("Lecture interrompue : {e}"))?;
    }
    Ok(HexWindow { path: path.to_string_lossy().to_string(), offset, file_size, bytes })
}

/// Cherche une séquence d'octets à partir d'un décalage, en flux.
///
/// Les blocs se chevauchent de `pattern.len() - 1` octets : une séquence à
/// cheval sur deux blocs est trouvée comme les autres.
pub fn find(
    path: &Path,
    pattern: &[u8],
    from: u64,
    reporter: &Reporter,
) -> Result<Option<u64>, String> {
    if pattern.is_empty() {
        return Err("La séquence recherchée est vide.".into());
    }
    if pattern.len() > COPY_CHUNK {
        return Err("La séquence recherchée est trop longue.".into());
    }
    let file = File::open(path).map_err(|e| format!("Lecture impossible : {e}"))?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    if from >= size {
        return Ok(None);
    }
    let mut reader = BufReader::with_capacity(COPY_CHUNK, file);
    reader.seek(SeekFrom::Start(from)).map_err(|e| e.to_string())?;

    let overlap = pattern.len() - 1;
    let mut window: Vec<u8> = Vec::with_capacity(COPY_CHUNK + overlap);
    let mut base = from;
    let mut chunk = vec![0_u8; COPY_CHUNK];

    loop {
        reporter.check()?;
        let read = reader.read(&mut chunk).map_err(|e| format!("Lecture interrompue : {e}"))?;
        if read == 0 {
            return Ok(None);
        }
        window.extend_from_slice(&chunk[..read]);
        if let Some(position) = window.windows(pattern.len()).position(|slice| slice == pattern) {
            return Ok(Some(base + position as u64));
        }
        // On ne garde que la queue susceptible de porter un début de séquence.
        let keep = overlap.min(window.len());
        base += (window.len() - keep) as u64;
        window.drain(..window.len() - keep);
        reporter.report(base - from, size - from, "Recherche de la séquence…");
    }
}

/// Toutes les occurrences d'une séquence, en **une seule** traversée.
///
/// Chercher occurrence par occurrence obligerait à relire le fichier autant de
/// fois qu'il y a de résultats. Une passe suffit, et elle donne d'emblée de
/// quoi afficher « occurrence 3 sur 17 » — ce qu'un simple « suivante » ne
/// permet jamais de savoir.
pub fn find_all(
    path: &Path,
    pattern: &[u8],
    limit: usize,
    reporter: &Reporter,
) -> Result<Vec<u64>, String> {
    if pattern.is_empty() {
        return Err("La séquence recherchée est vide.".into());
    }
    if pattern.len() > COPY_CHUNK {
        return Err("La séquence recherchée est trop longue.".into());
    }
    let file = File::open(path).map_err(|e| format!("Lecture impossible : {e}"))?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    let mut reader = BufReader::with_capacity(COPY_CHUNK, file);

    let overlap = pattern.len() - 1;
    let mut window: Vec<u8> = Vec::with_capacity(COPY_CHUNK + overlap);
    let mut base = 0_u64;
    let mut chunk = vec![0_u8; COPY_CHUNK];
    let mut found = Vec::new();
    let limit = limit.clamp(1, 100_000);

    loop {
        reporter.check()?;
        let read = reader.read(&mut chunk).map_err(|e| format!("Lecture interrompue : {e}"))?;
        if read == 0 {
            break;
        }
        window.extend_from_slice(&chunk[..read]);

        // Les occurrences peuvent se chevaucher : on avance d'un octet après
        // chaque trouvaille plutôt que de sauter la séquence entière.
        let mut cursor = 0_usize;
        while cursor + pattern.len() <= window.len() {
            match window[cursor..].windows(pattern.len()).position(|slice| slice == pattern) {
                Some(offset) => {
                    found.push(base + (cursor + offset) as u64);
                    if found.len() >= limit {
                        return Ok(found);
                    }
                    cursor += offset + 1;
                }
                None => break,
            }
        }

        let keep = overlap.min(window.len());
        base += (window.len() - keep) as u64;
        window.drain(..window.len() - keep);
        reporter.report(base, size, "Recherche de la séquence…");
    }
    Ok(found)
}

/// Une modification : remplacer des octets à partir d'un décalage.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HexPatch {
    pub offset: u64,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HexWriteSummary {
    pub path: String,
    pub size: u64,
    pub patched_bytes: u64,
    pub patches: usize,
    /// L'original a-t-il été remplacé ?
    pub in_place: bool,
}

/// Applique des modifications et écrit le résultat.
///
/// `destination` différent de `source` = « Enregistrer sous », le
/// comportement par défaut : l'original n'est pas touché. `destination` égal à
/// `source` écrase l'original, et l'appelant doit l'avoir voulu.
///
/// La longueur du fichier ne change jamais : cet éditeur corrige des octets, il
/// n'insère ni ne supprime — une insertion décalerait toutes les structures du
/// fichier et produirait presque toujours un fichier cassé.
pub fn write_patched(
    source: &Path,
    destination: &Path,
    patches: &[HexPatch],
    reporter: &Reporter,
) -> Result<HexWriteSummary, String> {
    let size = fs::metadata(source).map_err(|e| format!("Fichier introuvable : {e}"))?.len();
    for patch in patches {
        if patch.bytes.is_empty() {
            return Err("Une modification sans octet n'a pas de sens.".into());
        }
        let end = patch.offset.saturating_add(patch.bytes.len() as u64);
        if end > size {
            return Err(format!(
                "Modification hors du fichier : {} octet(s) à partir de {}, le fichier fait {size} octet(s).",
                patch.bytes.len(),
                patch.offset
            ));
        }
    }
    let patched_bytes: u64 = patches.iter().map(|p| p.bytes.len() as u64).sum();
    let in_place = fs::canonicalize(source).ok() == fs::canonicalize(destination).ok()
        && destination.exists();

    if in_place {
        // Écrasement demandé explicitement : on écrit seulement les octets
        // concernés, sans recopier le fichier entier.
        let mut file = OpenOptions::new()
            .write(true)
            .open(source)
            .map_err(|e| format!("Écriture impossible : {e}"))?;
        for patch in patches {
            file.seek(SeekFrom::Start(patch.offset)).map_err(|e| e.to_string())?;
            file.write_all(&patch.bytes).map_err(|e| e.to_string())?;
        }
        file.sync_all().map_err(|e| e.to_string())?;
        return Ok(HexWriteSummary {
            path: destination.to_string_lossy().to_string(),
            size,
            patched_bytes,
            patches: patches.len(),
            in_place: true,
        });
    }

    // Enregistrer sous : copie par blocs, modifications appliquées au passage.
    let parent = destination.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(parent).map_err(|e| format!("{} : {e}", parent.display()))?;
    let temporary = parent.join(format!(
        ".fourtout-hex-{}",
        destination.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
    ));
    let _ = fs::remove_file(&temporary);

    let result = (|| -> Result<(), String> {
        let mut input =
            BufReader::new(File::open(source).map_err(|e| format!("Lecture impossible : {e}"))?);
        let mut output = BufWriter::new(
            File::create(&temporary).map_err(|e| format!("{} : {e}", temporary.display()))?,
        );
        let mut buffer = vec![0_u8; COPY_CHUNK];
        let mut position = 0_u64;
        loop {
            reporter.check()?;
            let read = input.read(&mut buffer).map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            for patch in patches {
                let start = patch.offset;
                let end = start + patch.bytes.len() as u64;
                let block_end = position + read as u64;
                if end <= position || start >= block_end {
                    continue;
                }
                let from = start.max(position);
                let to = end.min(block_end);
                for absolute in from..to {
                    buffer[(absolute - position) as usize] =
                        patch.bytes[(absolute - start) as usize];
                }
            }
            output.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
            position += read as u64;
            reporter.report(position, size, "Enregistrement…");
        }
        output.flush().map_err(|e| e.to_string())?;
        output.into_inner().map_err(|e| e.to_string())?.sync_all().map_err(|e| e.to_string())?;
        Ok(())
    })();

    match result {
        Ok(()) => {
            fs::rename(&temporary, destination).map_err(|error| {
                let _ = fs::remove_file(&temporary);
                format!("{} : {error}", destination.display())
            })?;
            Ok(HexWriteSummary {
                path: destination.to_string_lossy().to_string(),
                size,
                patched_bytes,
                patches: patches.len(),
                in_place: false,
            })
        }
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn pattern_file(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("fourtout-hex-tests");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        let mut bytes: Vec<u8> = (0..=255_u8).collect();
        bytes.extend_from_slice(b"FourTout");
        bytes.extend_from_slice(&[0xDE, 0xAD, 0xBE, 0xEF]);
        bytes.extend(std::iter::repeat_n(0x5A, 1000));
        fs::write(&path, &bytes).unwrap();
        path
    }

    #[test]
    fn reads_a_window_at_an_offset() {
        let path = pattern_file("read.bin");
        let window = read_window(&path, 256, 8).unwrap();
        assert_eq!(window.bytes, b"FourTout");
        assert_eq!(window.file_size, 256 + 8 + 4 + 1000);

        // Une fenêtre qui dépasse la fin est tronquée, pas refusée.
        let tail = read_window(&path, window.file_size - 4, 64).unwrap();
        assert_eq!(tail.bytes.len(), 4);
    }

    #[test]
    fn refuses_an_offset_past_the_end() {
        let path = pattern_file("range.bin");
        assert!(read_window(&path, 999_999, 16).is_err());
    }

    #[test]
    fn finds_a_pattern_across_the_file() {
        let path = pattern_file("find.bin");
        assert_eq!(find(&path, b"FourTout", 0, &Reporter::silent()).unwrap(), Some(256));
        assert_eq!(
            find(&path, &[0xDE, 0xAD, 0xBE, 0xEF], 0, &Reporter::silent()).unwrap(),
            Some(264)
        );
        assert_eq!(find(&path, b"absent", 0, &Reporter::silent()).unwrap(), None);
        // Recherche à partir d'un décalage : on ne retrouve pas ce qui précède.
        assert_eq!(find(&path, b"FourTout", 300, &Reporter::silent()).unwrap(), None);
    }

    #[test]
    fn finds_every_occurrence_in_one_pass() {
        let dir = std::env::temp_dir().join("fourtout-hex-tests");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("occurrences.bin");

        // Trois occurrences, dont une à cheval sur la frontière de deux blocs
        // de lecture : c'est le cas qu'une recherche par fenêtre rate.
        let mut bytes = vec![0x11_u8; COPY_CHUNK - 2];
        bytes.extend_from_slice(&[0xDE, 0xAD, 0xBE, 0xEF]);
        bytes.extend(std::iter::repeat_n(0x22_u8, 100));
        let first = 10_usize;
        bytes[first..first + 4].copy_from_slice(&[0xDE, 0xAD, 0xBE, 0xEF]);
        let last = bytes.len();
        bytes.extend_from_slice(&[0xDE, 0xAD, 0xBE, 0xEF]);
        fs::write(&path, &bytes).unwrap();

        let found =
            find_all(&path, &[0xDE, 0xAD, 0xBE, 0xEF], 100, &Reporter::silent()).unwrap();
        assert_eq!(found, vec![first as u64, (COPY_CHUNK - 2) as u64, last as u64]);

        // La recherche unitaire et la recherche complète doivent s'accorder.
        assert_eq!(
            find(&path, &[0xDE, 0xAD, 0xBE, 0xEF], 0, &Reporter::silent()).unwrap(),
            Some(found[0])
        );
        assert!(find_all(&path, b"absent", 100, &Reporter::silent()).unwrap().is_empty());
    }

    #[test]
    fn counts_overlapping_occurrences() {
        let dir = std::env::temp_dir().join("fourtout-hex-tests");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("overlap.bin");
        fs::write(&path, b"aaaa").unwrap();
        // « aa » apparaît trois fois dans « aaaa » : aux positions 0, 1 et 2.
        assert_eq!(find_all(&path, b"aa", 100, &Reporter::silent()).unwrap(), vec![0, 1, 2]);
    }

    #[test]
    fn save_as_leaves_the_original_untouched() {
        let source = pattern_file("original.bin");
        let before = fs::read(&source).unwrap();
        let destination = source.with_file_name("modifie.bin");
        let _ = fs::remove_file(&destination);

        let summary = write_patched(
            &source,
            &destination,
            &[HexPatch { offset: 256, bytes: b"QUATRE!!".to_vec() }],
            &Reporter::silent(),
        )
        .unwrap();
        assert!(!summary.in_place);
        assert_eq!(summary.patched_bytes, 8);

        assert_eq!(fs::read(&source).unwrap(), before, "l'original ne doit pas bouger");
        let after = fs::read(&destination).unwrap();
        assert_eq!(&after[256..264], b"QUATRE!!");
        assert_eq!(after.len(), before.len(), "la taille ne change jamais");
        assert_eq!(&after[..256], &before[..256]);
        assert_eq!(&after[264..], &before[264..]);
    }

    #[test]
    fn in_place_write_replaces_only_the_patched_bytes() {
        let source = pattern_file("inplace.bin");
        let before = fs::read(&source).unwrap();
        let summary = write_patched(
            &source,
            &source,
            &[HexPatch { offset: 0, bytes: vec![0xFF, 0xFF] }],
            &Reporter::silent(),
        )
        .unwrap();
        assert!(summary.in_place);
        let after = fs::read(&source).unwrap();
        assert_eq!(&after[..2], &[0xFF, 0xFF]);
        assert_eq!(&after[2..], &before[2..]);
    }

    #[test]
    fn a_patch_past_the_end_is_refused() {
        let source = pattern_file("bounds.bin");
        let size = fs::metadata(&source).unwrap().len();
        let destination = source.with_file_name("bounds-out.bin");
        let error = write_patched(
            &source,
            &destination,
            &[HexPatch { offset: size - 1, bytes: vec![1, 2, 3] }],
            &Reporter::silent(),
        )
        .unwrap_err();
        assert!(error.contains("hors du fichier"));
        assert!(!destination.exists(), "aucun fichier ne doit être produit");
    }

    #[test]
    fn patches_spanning_two_blocks_are_applied() {
        // Fichier plus grand qu'un bloc de copie, modification à cheval.
        let dir = std::env::temp_dir().join("fourtout-hex-tests");
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("large.bin");
        fs::write(&source, vec![0x11_u8; COPY_CHUNK + 4096]).unwrap();
        let destination = dir.join("large-out.bin");
        let offset = (COPY_CHUNK - 2) as u64;
        write_patched(
            &source,
            &destination,
            &[HexPatch { offset, bytes: vec![0xAA, 0xBB, 0xCC, 0xDD] }],
            &Reporter::silent(),
        )
        .unwrap();
        let after = fs::read(&destination).unwrap();
        assert_eq!(&after[COPY_CHUNK - 2..COPY_CHUNK + 2], &[0xAA, 0xBB, 0xCC, 0xDD]);
        assert_eq!(after.len(), COPY_CHUNK + 4096);
    }
}
