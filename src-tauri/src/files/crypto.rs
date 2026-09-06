//! Chiffrement et déchiffrement de fichiers.
//!
//! Un seul moteur pour les deux cartes du catalogue (« Chiffrer des fichiers »
//! et « Déchiffrer des fichiers ») : deux implémentations, ce serait deux
//! occasions de diverger sur le format, et un fichier illisible par l'outil qui
//! l'a produit.
//!
//! # Choix cryptographiques
//!
//! - **Argon2id** dérive la clé depuis le mot de passe. C'est le lauréat de la
//!   Password Hashing Competition et la recommandation de l'OWASP : il coûte de
//!   la mémoire, ce qui rend les attaques par GPU et ASIC bien plus chères
//!   qu'avec PBKDF2 ou bcrypt.
//! - **XChaCha20-Poly1305** chiffre et authentifie. Son nonce de 192 bits peut
//!   être tiré au hasard sans risque de collision, là où AES-GCM et ses 96 bits
//!   imposent un compteur rigoureux. C'est aussi rapide sans accélération
//!   matérielle, ce qui compte sur les machines sans AES-NI.
//! - **Chiffrement par blocs**, chacun authentifié séparément, avec un drapeau
//!   de dernier bloc. Un fichier de 20 Go ne tient pas en mémoire, et sans le
//!   drapeau de fin un attaquant pourrait tronquer le fichier sans que rien ne
//!   le signale.
//!
//! # Ce que l'outil ne fait pas
//!
//! Il ne supprime jamais l'original, ne devine jamais un mot de passe, et
//! n'écrit le mot de passe nulle part — ni journal, ni fichier temporaire, ni
//! en-tête.

use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use serde::{Deserialize, Serialize};

use super::{unique_path, Reporter};

/// Extension des fichiers produits.
pub const EXTENSION: &str = "ftenc";

const MAGIC: &[u8; 6] = b"FTENC\x00";
const FORMAT_VERSION: u8 = 1;
const KDF_ARGON2ID: u8 = 1;
const SALT_LEN: usize = 16;
const NONCE_PREFIX_LEN: usize = 16;
const KEY_LEN: usize = 32;
const TAG_LEN: usize = 16;

/// 1 Mio : assez grand pour que le coût par bloc soit négligeable, assez petit
/// pour que la mémoire reste bornée quelle que soit la taille du fichier.
const CHUNK_SIZE: u32 = 1024 * 1024;

/// Paramètres Argon2id.
///
/// 64 Mio et trois passes : au-dessus des minima OWASP, et supportables sur une
/// machine modeste. Ils sont **écrits dans l'en-tête**, donc un fichier produit
/// aujourd'hui restera lisible si ces valeurs augmentent demain.
const ARGON_MEMORY_KIB: u32 = 65_536;
const ARGON_ITERATIONS: u32 = 3;
const ARGON_PARALLELISM: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Header {
    version: u8,
    kdf: u8,
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
    salt: [u8; SALT_LEN],
    nonce_prefix: [u8; NONCE_PREFIX_LEN],
    chunk_size: u32,
}

impl Header {
    fn to_bytes(self) -> Vec<u8> {
        let mut out = Vec::with_capacity(64);
        out.extend_from_slice(MAGIC);
        out.push(self.version);
        out.push(self.kdf);
        out.extend_from_slice(&self.memory_kib.to_le_bytes());
        out.extend_from_slice(&self.iterations.to_le_bytes());
        out.extend_from_slice(&self.parallelism.to_le_bytes());
        out.extend_from_slice(&self.salt);
        out.extend_from_slice(&self.nonce_prefix);
        out.extend_from_slice(&self.chunk_size.to_le_bytes());
        out
    }

    fn byte_len() -> usize {
        MAGIC.len() + 2 + 4 * 3 + SALT_LEN + NONCE_PREFIX_LEN + 4
    }

    fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() < Self::byte_len() {
            return Err("Ce fichier est trop court pour être un fichier FourTout chiffré.".into());
        }
        if &bytes[..MAGIC.len()] != MAGIC {
            return Err(
                "Ce fichier n'a pas été produit par FourTout : sa signature ne correspond pas.".into(),
            );
        }
        let mut cursor = MAGIC.len();
        let version = bytes[cursor];
        cursor += 1;
        if version != FORMAT_VERSION {
            return Err(format!(
                "Ce fichier utilise la version de format {version} ; cette version de FourTout \
                 lit la version {FORMAT_VERSION}."
            ));
        }
        let kdf = bytes[cursor];
        cursor += 1;
        if kdf != KDF_ARGON2ID {
            return Err(format!("Fonction de dérivation inconnue (code {kdf})."));
        }
        let read_u32 = |cursor: &mut usize| {
            let value = u32::from_le_bytes([
                bytes[*cursor],
                bytes[*cursor + 1],
                bytes[*cursor + 2],
                bytes[*cursor + 3],
            ]);
            *cursor += 4;
            value
        };
        let memory_kib = read_u32(&mut cursor);
        let iterations = read_u32(&mut cursor);
        let parallelism = read_u32(&mut cursor);

        let mut salt = [0u8; SALT_LEN];
        salt.copy_from_slice(&bytes[cursor..cursor + SALT_LEN]);
        cursor += SALT_LEN;
        let mut nonce_prefix = [0u8; NONCE_PREFIX_LEN];
        nonce_prefix.copy_from_slice(&bytes[cursor..cursor + NONCE_PREFIX_LEN]);
        cursor += NONCE_PREFIX_LEN;
        let chunk_size = read_u32(&mut cursor);

        // Un en-tête falsifié pourrait demander 64 Gio de mémoire ou un bloc de
        // 4 Gio : on borne avant d'allouer quoi que ce soit.
        if !(8_192..=1_048_576).contains(&memory_kib) {
            return Err("En-tête invalide : coût mémoire hors des bornes acceptées.".into());
        }
        if !(1..=16).contains(&iterations) || !(1..=16).contains(&parallelism) {
            return Err("En-tête invalide : paramètres de dérivation hors bornes.".into());
        }
        if !(4096..=16 * 1024 * 1024).contains(&chunk_size) {
            return Err("En-tête invalide : taille de bloc hors bornes.".into());
        }

        Ok(Self {
            version,
            kdf,
            memory_kib,
            iterations,
            parallelism,
            salt,
            nonce_prefix,
            chunk_size,
        })
    }
}

fn random_bytes(buffer: &mut [u8]) -> Result<(), String> {
    getrandom::fill(buffer).map_err(|e| format!("Générateur aléatoire indisponible : {e}"))
}

/// Dérive la clé depuis le mot de passe et le sel.
fn derive_key(password: &str, header: &Header) -> Result<[u8; KEY_LEN], String> {
    let params = Params::new(
        header.memory_kib,
        header.iterations,
        header.parallelism,
        Some(KEY_LEN),
    )
    .map_err(|e| format!("Paramètres de dérivation invalides : {e}"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; KEY_LEN];
    argon
        .hash_password_into(password.as_bytes(), &header.salt, &mut key)
        .map_err(|e| format!("Dérivation de la clé impossible : {e}"))?;
    Ok(key)
}

/// Efface une clé de la mémoire. `write_volatile` empêche le compilateur de
/// supprimer l'écriture au motif que la valeur n'est plus lue ensuite.
fn wipe(key: &mut [u8]) {
    for byte in key.iter_mut() {
        unsafe { std::ptr::write_volatile(byte, 0) };
    }
    std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
}

fn nonce_for(prefix: &[u8; NONCE_PREFIX_LEN], counter: u64) -> XNonce {
    let mut nonce = [0u8; 24];
    nonce[..NONCE_PREFIX_LEN].copy_from_slice(prefix);
    nonce[NONCE_PREFIX_LEN..].copy_from_slice(&counter.to_le_bytes());
    *XNonce::from_slice(&nonce)
}

/// Données associées d'un bloc : en-tête complet, numéro de bloc et drapeau de
/// fin. Lier ces trois éléments interdit de réordonner, de rejouer ou de
/// tronquer les blocs — chacune de ces manipulations casse l'authentification.
fn associated_data(header_bytes: &[u8], counter: u64, last: bool) -> Vec<u8> {
    let mut aad = Vec::with_capacity(header_bytes.len() + 9);
    aad.extend_from_slice(header_bytes);
    aad.extend_from_slice(&counter.to_le_bytes());
    aad.push(u8::from(last));
    aad
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CryptoSummary {
    pub path: String,
    pub input_bytes: u64,
    pub output_bytes: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptRequest {
    pub sources: Vec<String>,
    pub destination: Option<String>,
    pub password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecryptRequest {
    pub sources: Vec<String>,
    pub destination: Option<String>,
    pub password: String,
}

/// Chemin de sortie : à côté de la source, ou dans le dossier demandé.
fn output_path(source: &Path, destination: Option<&str>, extension: Option<&str>) -> PathBuf {
    let file_name = match extension {
        Some(ext) => {
            let mut name = source.file_name().unwrap_or_default().to_os_string();
            name.push(format!(".{ext}"));
            PathBuf::from(name)
        }
        None => {
            // Retire le « .ftenc » final ; si le nom n'en a pas, ajoute un suffixe
            // plutôt que d'écraser la source.
            let name = source.file_name().unwrap_or_default().to_string_lossy().to_string();
            let stripped = name
                .strip_suffix(&format!(".{EXTENSION}"))
                .map(str::to_string)
                .unwrap_or_else(|| format!("{name}.dechiffre"));
            PathBuf::from(stripped)
        }
    };
    let parent = destination
        .map(PathBuf::from)
        .unwrap_or_else(|| source.parent().unwrap_or_else(|| Path::new(".")).to_path_buf());
    unique_path(&parent.join(file_name))
}

pub fn encrypt_file(
    source: &Path,
    destination: Option<&str>,
    password: &str,
    reporter: &Reporter,
) -> Result<CryptoSummary, String> {
    if password.is_empty() {
        return Err("Le mot de passe ne peut pas être vide.".into());
    }
    let metadata = std::fs::metadata(source)
        .map_err(|e| format!("Fichier illisible ({}) : {e}", source.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} n'est pas un fichier.", source.display()));
    }
    let total = metadata.len();

    let mut salt = [0u8; SALT_LEN];
    let mut nonce_prefix = [0u8; NONCE_PREFIX_LEN];
    random_bytes(&mut salt)?;
    random_bytes(&mut nonce_prefix)?;

    let header = Header {
        version: FORMAT_VERSION,
        kdf: KDF_ARGON2ID,
        memory_kib: ARGON_MEMORY_KIB,
        iterations: ARGON_ITERATIONS,
        parallelism: ARGON_PARALLELISM,
        salt,
        nonce_prefix,
        chunk_size: CHUNK_SIZE,
    };
    let header_bytes = header.to_bytes();

    reporter.report(0, total, "Dérivation de la clé…");
    let mut key = derive_key(password, &header)?;
    let cipher = XChaCha20Poly1305::new(Key::from_slice(&key));
    wipe(&mut key);

    let target = output_path(source, destination, Some(EXTENSION));
    let mut reader = BufReader::new(
        File::open(source).map_err(|e| format!("Lecture impossible : {e}"))?,
    );
    let mut writer = BufWriter::new(
        File::create(&target).map_err(|e| format!("Écriture impossible : {e}"))?,
    );

    let result = (|| -> Result<u64, String> {
        writer
            .write_all(&header_bytes)
            .map_err(|e| format!("Écriture impossible : {e}"))?;
        let mut written = header_bytes.len() as u64;

        let mut buffer = vec![0u8; header.chunk_size as usize];
        let mut counter: u64 = 0;
        let mut done: u64 = 0;

        loop {
            reporter.check()?;
            let read = read_full(&mut reader, &mut buffer)?;
            let last = read < buffer.len();
            let ciphertext = cipher
                .encrypt(
                    &nonce_for(&header.nonce_prefix, counter),
                    Payload {
                        msg: &buffer[..read],
                        aad: &associated_data(&header_bytes, counter, last),
                    },
                )
                .map_err(|_| "Chiffrement impossible.".to_string())?;

            writer
                .write_all(&(ciphertext.len() as u32).to_le_bytes())
                .and_then(|_| writer.write_all(&ciphertext))
                .map_err(|e| format!("Écriture impossible : {e}"))?;
            written += 4 + ciphertext.len() as u64;

            done += read as u64;
            counter += 1;
            reporter.report(done, total, "Chiffrement…");
            if last {
                break;
            }
        }
        writer.flush().map_err(|e| format!("Écriture impossible : {e}"))?;
        Ok(written)
    })();

    match result {
        Ok(written) => Ok(CryptoSummary {
            path: target.to_string_lossy().to_string(),
            input_bytes: total,
            output_bytes: written,
        }),
        Err(error) => {
            // Annulation ou panne : on ne laisse pas derrière nous un fichier
            // partiel qui ressemblerait à un résultat.
            drop(writer);
            let _ = std::fs::remove_file(&target);
            Err(error)
        }
    }
}

pub fn decrypt_file(
    source: &Path,
    destination: Option<&str>,
    password: &str,
    reporter: &Reporter,
) -> Result<CryptoSummary, String> {
    if password.is_empty() {
        return Err("Le mot de passe ne peut pas être vide.".into());
    }
    let metadata = std::fs::metadata(source)
        .map_err(|e| format!("Fichier illisible ({}) : {e}", source.display()))?;
    let total = metadata.len();

    let mut reader = BufReader::new(
        File::open(source).map_err(|e| format!("Lecture impossible : {e}"))?,
    );
    let mut header_bytes = vec![0u8; Header::byte_len()];
    reader
        .read_exact(&mut header_bytes)
        .map_err(|_| "Ce fichier est trop court pour être un fichier FourTout chiffré.".to_string())?;
    let header = Header::parse(&header_bytes)?;

    reporter.report(0, total, "Dérivation de la clé…");
    let mut key = derive_key(password, &header)?;
    let cipher = XChaCha20Poly1305::new(Key::from_slice(&key));
    wipe(&mut key);

    let target = output_path(source, destination, None);
    let mut writer = BufWriter::new(
        File::create(&target).map_err(|e| format!("Écriture impossible : {e}"))?,
    );

    let result = (|| -> Result<u64, String> {
        let mut counter: u64 = 0;
        let mut done = header_bytes.len() as u64;
        let mut written: u64 = 0;
        let max_chunk = header.chunk_size as usize + TAG_LEN;

        loop {
            reporter.check()?;
            let mut length_bytes = [0u8; 4];
            match reader.read_exact(&mut length_bytes) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
                    // Le dernier bloc porte le drapeau de fin : arriver ici sans
                    // l'avoir vu signifie que le fichier a été tronqué.
                    return Err(TRUNCATED.to_string());
                }
                Err(error) => return Err(format!("Lecture impossible : {error}")),
            }
            let length = u32::from_le_bytes(length_bytes) as usize;
            if length < TAG_LEN || length > max_chunk {
                return Err(CORRUPTED.to_string());
            }
            let mut chunk = vec![0u8; length];
            reader
                .read_exact(&mut chunk)
                .map_err(|_| TRUNCATED.to_string())?;

            let plain_len = length - TAG_LEN;
            let last = plain_len < header.chunk_size as usize;
            let plain = cipher
                .decrypt(
                    &nonce_for(&header.nonce_prefix, counter),
                    Payload {
                        msg: &chunk,
                        aad: &associated_data(&header_bytes, counter, last),
                    },
                )
                .map_err(|_| {
                    if counter == 0 {
                        WRONG_PASSWORD.to_string()
                    } else {
                        CORRUPTED.to_string()
                    }
                })?;

            writer
                .write_all(&plain)
                .map_err(|e| format!("Écriture impossible : {e}"))?;
            written += plain.len() as u64;
            done += 4 + length as u64;
            counter += 1;
            reporter.report(done, total, "Déchiffrement…");
            if last {
                break;
            }
        }
        writer.flush().map_err(|e| format!("Écriture impossible : {e}"))?;
        Ok(written)
    })();

    match result {
        Ok(written) => Ok(CryptoSummary {
            path: target.to_string_lossy().to_string(),
            input_bytes: total,
            output_bytes: written,
        }),
        Err(error) => {
            // Mot de passe faux, fichier altéré ou annulation : aucun fichier de
            // sortie ne doit survivre. Un fichier partiellement déchiffré serait
            // pris pour un résultat valide.
            drop(writer);
            let _ = std::fs::remove_file(&target);
            Err(error)
        }
    }
}

pub const WRONG_PASSWORD: &str =
    "Mot de passe incorrect, ou fichier altéré. Aucun contenu n'a été produit.";
pub const CORRUPTED: &str =
    "L'authentification a échoué : ce fichier a été modifié depuis son chiffrement. \
     Aucun contenu n'a été produit.";
pub const TRUNCATED: &str =
    "Le fichier est incomplet : il manque des données à la fin. Aucun contenu n'a été produit.";

/// Lit jusqu'à remplir le tampon, ou jusqu'à la fin du fichier.
fn read_full(reader: &mut impl Read, buffer: &mut [u8]) -> Result<usize, String> {
    let mut filled = 0;
    while filled < buffer.len() {
        match reader.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(format!("Lecture impossible : {error}")),
        }
    }
    Ok(filled)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::io::Seek;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fourtout-crypto-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn digest(path: &Path) -> String {
        let mut file = File::open(path).unwrap();
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; 65536];
        loop {
            let read = file.read(&mut buffer).unwrap();
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        format!("{:x}", hasher.finalize())
    }

    fn write_file(path: &Path, size: usize) {
        let mut file = File::create(path).unwrap();
        // Contenu pseudo-aléatoire déterministe : compressible ou non, peu
        // importe, mais reproductible d'un test à l'autre.
        let mut value: u32 = 0x1234_5678;
        let mut buffer = Vec::with_capacity(size);
        for _ in 0..size {
            value = value.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            buffer.push((value >> 24) as u8);
        }
        file.write_all(&buffer).unwrap();
    }

    #[test]
    fn round_trip_preserves_the_file_exactly() {
        let dir = temp_dir("roundtrip");
        let source = dir.join("secret.bin");
        // Deux blocs et demi : le chemin multi-blocs est celui qui casse.
        write_file(&source, (CHUNK_SIZE as usize) * 2 + 4096);
        let before = digest(&source);

        let encrypted = encrypt_file(&source, None, "mot de passe correct", &Reporter::silent()).unwrap();
        let encrypted_path = PathBuf::from(&encrypted.path);
        assert!(encrypted_path.exists());
        assert_ne!(digest(&encrypted_path), before, "le fichier chiffré ne doit pas être le clair");

        let out_dir = dir.join("sortie");
        std::fs::create_dir_all(&out_dir).unwrap();
        let decrypted = decrypt_file(
            &encrypted_path,
            Some(&out_dir.to_string_lossy()),
            "mot de passe correct",
            &Reporter::silent(),
        )
        .unwrap();

        assert_eq!(digest(Path::new(&decrypted.path)), before);
        // L'original n'est jamais supprimé.
        assert!(source.exists());
    }

    #[test]
    fn same_input_and_password_produce_different_ciphertexts() {
        let dir = temp_dir("nondet");
        let source = dir.join("a.bin");
        write_file(&source, 5000);

        let first = encrypt_file(&source, None, "identique", &Reporter::silent()).unwrap();
        let second = encrypt_file(&source, None, "identique", &Reporter::silent()).unwrap();

        // Sel et nonce sont tirés au hasard à chaque fois : deux chiffrements du
        // même fichier ne doivent jamais donner le même octet.
        assert_ne!(digest(Path::new(&first.path)), digest(Path::new(&second.path)));
    }

    #[test]
    fn wrong_password_produces_no_output_at_all() {
        let dir = temp_dir("wrongpass");
        let source = dir.join("b.bin");
        write_file(&source, 20_000);
        let encrypted = encrypt_file(&source, None, "le bon", &Reporter::silent()).unwrap();

        let error = decrypt_file(
            Path::new(&encrypted.path),
            None,
            "le mauvais",
            &Reporter::silent(),
        )
        .unwrap_err();
        assert_eq!(error, WRONG_PASSWORD);

        // Aucun fichier de sortie ne doit traîner : un clair partiel serait pris
        // pour un résultat.
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name != "b.bin" && !name.ends_with(EXTENSION))
            .collect();
        assert!(leftovers.is_empty(), "fichiers en trop : {leftovers:?}");
    }

    #[test]
    fn a_single_flipped_byte_fails_authentication() {
        let dir = temp_dir("tamper");
        let source = dir.join("c.bin");
        write_file(&source, 30_000);
        let encrypted = encrypt_file(&source, None, "secret", &Reporter::silent()).unwrap();
        let path = PathBuf::from(&encrypted.path);

        let mut file = std::fs::OpenOptions::new().read(true).write(true).open(&path).unwrap();
        // Un octet au cœur du chiffré, loin de l'en-tête.
        let offset = Header::byte_len() as u64 + 100;
        file.seek(std::io::SeekFrom::Start(offset)).unwrap();
        let mut byte = [0u8; 1];
        file.read_exact(&mut byte).unwrap();
        file.seek(std::io::SeekFrom::Start(offset)).unwrap();
        file.write_all(&[byte[0] ^ 0x01]).unwrap();
        drop(file);

        let error = decrypt_file(&path, None, "secret", &Reporter::silent()).unwrap_err();
        assert!(
            error == WRONG_PASSWORD || error == CORRUPTED,
            "message inattendu : {error}"
        );
    }

    #[test]
    fn truncation_is_detected() {
        let dir = temp_dir("truncate");
        let source = dir.join("d.bin");
        write_file(&source, (CHUNK_SIZE as usize) + 5000);
        let encrypted = encrypt_file(&source, None, "secret", &Reporter::silent()).unwrap();
        let path = PathBuf::from(&encrypted.path);

        // On coupe le dernier bloc : sans le drapeau de fin authentifié, le
        // déchiffrement s'arrêterait en silence sur un fichier incomplet.
        let size = std::fs::metadata(&path).unwrap().len();
        let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_len(size - 2000).unwrap();
        drop(file);

        let error = decrypt_file(&path, None, "secret", &Reporter::silent()).unwrap_err();
        assert!(
            error == TRUNCATED || error == CORRUPTED,
            "message inattendu : {error}"
        );
    }

    #[test]
    fn refuses_a_file_that_is_not_ours() {
        let dir = temp_dir("foreign");
        // Assez long pour dépasser l'en-tête : c'est bien la signature qui doit
        // refuser le fichier, pas sa taille.
        let source = dir.join("e.txt");
        std::fs::write(&source, vec![b'x'; 4096]).unwrap();
        let error = decrypt_file(&source, None, "peu importe", &Reporter::silent()).unwrap_err();
        assert!(error.contains("signature"), "message inattendu : {error}");

        // Et un fichier plus court que l'en-tête est refusé lui aussi.
        let tiny = dir.join("f.txt");
        std::fs::write(&tiny, b"court").unwrap();
        let error = decrypt_file(&tiny, None, "peu importe", &Reporter::silent()).unwrap_err();
        assert!(error.contains("trop court"), "message inattendu : {error}");
    }

    #[test]
    fn refuses_an_empty_password() {
        let dir = temp_dir("emptypass");
        let source = dir.join("f.bin");
        write_file(&source, 100);
        assert!(encrypt_file(&source, None, "", &Reporter::silent()).is_err());
    }

    #[test]
    fn handles_an_empty_file() {
        let dir = temp_dir("emptyfile");
        let source = dir.join("vide.bin");
        File::create(&source).unwrap();
        let encrypted = encrypt_file(&source, None, "x", &Reporter::silent()).unwrap();
        let decrypted =
            decrypt_file(Path::new(&encrypted.path), None, "x", &Reporter::silent()).unwrap();
        assert_eq!(std::fs::metadata(&decrypted.path).unwrap().len(), 0);
    }

    #[test]
    fn a_cancelled_encryption_leaves_no_output() {
        let dir = temp_dir("cancel-encrypt");
        let source = dir.join("g.bin");
        write_file(&source, (CHUNK_SIZE as usize) + 1000);

        let error = encrypt_file(&source, None, "secret", &Reporter::silent_cancelled()).unwrap_err();
        assert_eq!(error, crate::files::CANCELLED);

        // Un .ftenc partiel serait présenté comme un résultat : il ne doit pas
        // exister, et la source doit être intacte.
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name != "g.bin")
            .collect();
        assert!(leftovers.is_empty(), "fichiers en trop : {leftovers:?}");
        assert!(source.exists());
    }

    #[test]
    fn a_cancelled_decryption_leaves_no_plaintext() {
        let dir = temp_dir("cancel-decrypt");
        let source = dir.join("h.bin");
        write_file(&source, (CHUNK_SIZE as usize) + 1000);
        let encrypted = encrypt_file(&source, None, "secret", &Reporter::silent()).unwrap();
        std::fs::remove_file(&source).unwrap();

        let error = decrypt_file(
            Path::new(&encrypted.path),
            None,
            "secret",
            &Reporter::silent_cancelled(),
        )
        .unwrap_err();
        assert_eq!(error, crate::files::CANCELLED);
        assert!(!source.exists(), "un clair partiel a survécu à l'annulation");
    }

    #[test]
    fn nonces_never_repeat_across_chunks() {
        // Le préfixe est tiré au hasard, le compteur varie : deux blocs d'un
        // même fichier ne peuvent pas partager un nonce, et deux fichiers non
        // plus. Réutiliser un nonce avec la même clé casserait XChaCha20.
        let prefix = [7u8; NONCE_PREFIX_LEN];
        let mut seen = std::collections::HashSet::new();
        for counter in 0..1000u64 {
            assert!(
                seen.insert(nonce_for(&prefix, counter).to_vec()),
                "nonce répété au bloc {counter}"
            );
        }
        let other = [8u8; NONCE_PREFIX_LEN];
        assert_ne!(nonce_for(&prefix, 0).to_vec(), nonce_for(&other, 0).to_vec());
    }

    #[test]
    fn header_bounds_are_enforced() {
        let mut header = Header {
            version: FORMAT_VERSION,
            kdf: KDF_ARGON2ID,
            memory_kib: ARGON_MEMORY_KIB,
            iterations: ARGON_ITERATIONS,
            parallelism: ARGON_PARALLELISM,
            salt: [1u8; SALT_LEN],
            nonce_prefix: [2u8; NONCE_PREFIX_LEN],
            chunk_size: CHUNK_SIZE,
        };
        assert!(Header::parse(&header.to_bytes()).is_ok());

        // Un en-tête falsifié qui demanderait 64 Gio doit être refusé avant toute
        // allocation.
        header.memory_kib = 64 * 1024 * 1024;
        assert!(Header::parse(&header.to_bytes()).is_err());
    }
}
