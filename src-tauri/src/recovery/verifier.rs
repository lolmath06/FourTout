//! Vérification d'un mot de passe utilisateur PDF, hors ligne.
//!
//! Implémente le « standard security handler » d'ISO 32000 pour les révisions
//! 2 à 6 : c'est l'algorithme exact qu'utilise un lecteur PDF pour décider si
//! un mot de passe ouvre le document. Aucun raccourci n'est pris — un mot de
//! passe n'est déclaré valide que s'il l'est réellement.
//!
//! Les paramètres de chiffrement (/O, /U, /P, /ID, révision…) sont extraits une
//! seule fois côté frontend (qui dispose déjà de pdf-lib) et transmis ici : le
//! backend n'a donc pas besoin d'un analyseur PDF complet, et la boucle chaude
//! ne fait que du calcul cryptographique.

use aes::cipher::{BlockEncrypt, KeyInit};
use aes::Aes128;
use md5::{Digest, Md5};
use sha2::{Sha256, Sha384, Sha512};

/// Chaîne de remplissage de 32 octets définie par la spécification (R2–R4).
const PADDING: [u8; 32] = [
    0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
    0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A,
];

/// Paramètres du dictionnaire /Encrypt, tels qu'extraits du document.
#[derive(Clone, Debug)]
pub struct EncryptionParams {
    /// Révision du handler (2 à 6).
    pub revision: u8,
    /// Longueur de clé en octets (5 pour R2, 16 pour AES-128/RC4-128, 32 pour R6).
    pub key_length: usize,
    /// Entrée /O (32 octets pour R2–R4, 48 pour R6).
    pub o: Vec<u8>,
    /// Entrée /U (32 octets pour R2–R4, 48 pour R6).
    pub u: Vec<u8>,
    /// Permissions /P (entier signé 32 bits).
    pub p: i32,
    /// Premier élément de /ID (requis pour R2–R4).
    pub id0: Vec<u8>,
    /// /EncryptMetadata (R4+ ; vrai par défaut).
    pub encrypt_metadata: bool,
}

/// Vérificateur préparé : tout ce qui ne dépend pas du mot de passe est
/// pré-calculé, pour que chaque essai soit le plus court possible.
pub struct PasswordVerifier {
    params: EncryptionParams,
}

impl PasswordVerifier {
    pub fn new(params: EncryptionParams) -> Self {
        Self { params }
    }

    /// Le mot de passe ouvre-t-il le document ? (mot de passe utilisateur)
    pub fn verify(&self, password: &str) -> bool {
        match self.params.revision {
            2..=4 => self.verify_legacy(password),
            5 | 6 => self.verify_r6(password),
            _ => false,
        }
    }

    // --- R2 à R4 : dérivation de clé fondée sur MD5, validation RC4 -------

    fn verify_legacy(&self, password: &str) -> bool {
        let key = self.compute_key_legacy(password);

        if self.params.revision == 2 {
            // Algorithme 4 : RC4(clé, PADDING) comparé aux 32 octets de /U.
            let mut buffer = PADDING.to_vec();
            rc4_apply(&key, &mut buffer);
            constant_slice_eq(&buffer, &self.params.u, 32)
        } else {
            // Algorithme 5 : MD5(PADDING || id0), 20 passes RC4, comparé aux
            // 16 premiers octets de /U.
            let mut hasher = Md5::new();
            hasher.update(PADDING);
            hasher.update(&self.params.id0);
            let mut buffer = hasher.finalize().to_vec(); // 16 octets

            rc4_apply(&key, &mut buffer);
            for i in 1..=19u8 {
                let mut derived = key.clone();
                for byte in derived.iter_mut() {
                    *byte ^= i;
                }
                rc4_apply(&derived, &mut buffer);
            }
            constant_slice_eq(&buffer, &self.params.u, 16)
        }
    }

    /// Algorithme 2 : clé de chiffrement à partir du mot de passe (R2–R4).
    fn compute_key_legacy(&self, password: &str) -> Vec<u8> {
        // Mot de passe complété/tronqué à 32 octets avec la chaîne de remplissage.
        let pw_bytes = password.as_bytes();
        let mut padded = [0u8; 32];
        let take = pw_bytes.len().min(32);
        padded[..take].copy_from_slice(&pw_bytes[..take]);
        padded[take..].copy_from_slice(&PADDING[..32 - take]);

        let mut hasher = Md5::new();
        hasher.update(padded);
        hasher.update(&self.params.o); // 32 octets utilisés
        hasher.update(self.params.p.to_le_bytes());
        hasher.update(&self.params.id0);
        // R4 avec métadonnées non chiffrées : ajouter 0xFFFFFFFF.
        if self.params.revision >= 4 && !self.params.encrypt_metadata {
            hasher.update([0xff, 0xff, 0xff, 0xff]);
        }
        let mut hash = hasher.finalize().to_vec();

        // R3+ : 50 itérations MD5 sur les n premiers octets.
        let n = self.params.key_length;
        if self.params.revision >= 3 {
            for _ in 0..50 {
                let mut h = Md5::new();
                h.update(&hash[..n]);
                hash = h.finalize().to_vec();
            }
        }
        hash[..n].to_vec()
    }

    // --- R6 : dérivation durcie (Algorithme 2.B), validation SHA-2 --------

    fn verify_r6(&self, password: &str) -> bool {
        // /U = [hash 32][sel de validation 8][sel de clé 8].
        if self.params.u.len() < 48 {
            return false;
        }
        let mut pw = password.as_bytes().to_vec();
        pw.truncate(127); // R6 : mot de passe UTF-8 limité à 127 octets.

        let validation_salt = &self.params.u[32..40];
        let hash = hash_2b(&pw, validation_salt, &[]);
        constant_slice_eq(&hash, &self.params.u[..32], 32)
    }
}

/// Applique RC4 (clé, données) sur place.
///
/// Implémenté à la main car la longueur de clé PDF varie à l'exécution (5 ou
/// 16 octets), ce qu'un chiffreur générique à taille fixe ne permet pas.
fn rc4_apply(key: &[u8], data: &mut [u8]) {
    let mut s: [u8; 256] = [0; 256];
    for (i, byte) in s.iter_mut().enumerate() {
        *byte = i as u8;
    }
    let mut j: usize = 0;
    for i in 0..256 {
        j = (j + s[i] as usize + key[i % key.len()] as usize) & 0xff;
        s.swap(i, j);
    }
    let (mut i, mut j) = (0usize, 0usize);
    for byte in data.iter_mut() {
        i = (i + 1) & 0xff;
        j = (j + s[i] as usize) & 0xff;
        s.swap(i, j);
        let k = s[(s[i] as usize + s[j] as usize) & 0xff];
        *byte ^= k;
    }
}

/// Comparaison à temps quasi constant des `n` premiers octets.
fn constant_slice_eq(a: &[u8], b: &[u8], n: usize) -> bool {
    if a.len() < n || b.len() < n {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..n {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

/// Algorithme 2.B : fonction de hachage durcie de la révision 6.
///
/// Coûteuse par conception (au moins 64 tours mêlant SHA-2 et AES-128) : c'est
/// ce qui plafonne la vitesse de recherche sur les documents AES-256.
fn hash_2b(password: &[u8], salt: &[u8], udata: &[u8]) -> Vec<u8> {
    let mut k = {
        let mut h = Sha256::new();
        h.update(password);
        h.update(salt);
        h.update(udata);
        h.finalize().to_vec()
    };

    let mut e: Vec<u8> = Vec::new();
    let mut round: usize = 0;
    loop {
        // Condition de la spécification : au moins 64 tours, puis arrêt quand le
        // dernier octet de E est assez petit.
        if !(round < 64 || (*e.last().unwrap() as usize) > round.saturating_sub(32)) {
            break;
        }

        // K1 = (mot de passe || K || udata) répété 64 fois.
        let block: Vec<u8> = [password, &k, udata].concat();
        let mut k1 = Vec::with_capacity(block.len() * 64);
        for _ in 0..64 {
            k1.extend_from_slice(&block);
        }

        // E = AES-128-CBC (clé = K[0..16], IV = K[16..32]), sans remplissage.
        aes128_cbc_encrypt_in_place(&k[0..16], &k[16..32], &mut k1);
        e = k1;

        let sum: u32 = e[..16].iter().map(|&b| b as u32).sum();
        k = match sum % 3 {
            0 => {
                let mut h = Sha256::new();
                h.update(&e);
                h.finalize().to_vec()
            }
            1 => {
                let mut h = Sha384::new();
                h.update(&e);
                h.finalize().to_vec()
            }
            _ => {
                let mut h = Sha512::new();
                h.update(&e);
                h.finalize().to_vec()
            }
        };
        round += 1;
    }

    k.truncate(32);
    k
}

/// AES-128-CBC sans remplissage, chiffrement sur place. `data.len()` est un
/// multiple de 16 par construction (voir Algorithme 2.B).
fn aes128_cbc_encrypt_in_place(key: &[u8], iv: &[u8], data: &mut [u8]) {
    let cipher = Aes128::new(key.into());
    let mut prev = [0u8; 16];
    prev.copy_from_slice(iv);

    for chunk in data.chunks_mut(16) {
        for i in 0..16 {
            chunk[i] ^= prev[i];
        }
        let mut block = aes::cipher::generic_array::GenericArray::clone_from_slice(chunk);
        cipher.encrypt_block(&mut block);
        chunk.copy_from_slice(&block);
        prev.copy_from_slice(chunk);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }

    // Vecteurs extraits de vrais PDF chiffrés par @cantoo/pdf-lib.
    // Mot de passe utilisateur : « topsecret ».

    #[test]
    fn accepts_and_rejects_r6_aes256() {
        let params = EncryptionParams {
            revision: 6,
            key_length: 32,
            o: hex("6fe0476854e031216143979dfc3f152ba1e34c428cb6630a21e5ee3ccb68c83bf0784816aa22735b931f2598137035cf"),
            u: hex("dc6e2f82148c37d10535081e106dc0e2f2acf0d94b4483a2ef484f2b6e0802b406c2681d4d5b1ad575d81f4ada5107c5"),
            p: -3904,
            id0: hex("5183453c8a931cd8175ea2dbaa9642e8"),
            encrypt_metadata: true,
        };
        let v = PasswordVerifier::new(params);
        assert!(v.verify("topsecret"), "le bon mot de passe doit être accepté");
        assert!(!v.verify("wrong"), "un mauvais mot de passe doit être rejeté");
        assert!(!v.verify("topsecre"), "un mot de passe proche doit être rejeté");
        assert!(!v.verify("topsecret "), "un espace en trop doit être rejeté");
    }

    #[test]
    fn accepts_and_rejects_r4_aes128() {
        let params = EncryptionParams {
            revision: 4,
            key_length: 16,
            o: hex("0abf965ec5253fb3dd1361577b6bf5c8957edf62be6129c09ea6653808a9a7b1"),
            u: hex("5d945ae5c176025d0eb16f9b81ee65c400000000000000000000000000000000"),
            p: -3904,
            id0: hex("50fe383d8226bcf3e1881528dbc415b8"),
            encrypt_metadata: true,
        };
        let v = PasswordVerifier::new(params);
        assert!(v.verify("topsecret"));
        assert!(!v.verify("topsecret1"));
        assert!(!v.verify(""));
    }

    #[test]
    fn accepts_and_rejects_r3_rc4() {
        let params = EncryptionParams {
            revision: 3,
            key_length: 16,
            o: hex("0abf965ec5253fb3dd1361577b6bf5c8957edf62be6129c09ea6653808a9a7b1"),
            u: hex("8b43473282ed6d32333aee4da458cbf200000000000000000000000000000000"),
            p: -3904,
            id0: hex("9ad88a939f3905ae3fec9011f38b01ca"),
            encrypt_metadata: true,
        };
        let v = PasswordVerifier::new(params);
        assert!(v.verify("topsecret"));
        assert!(!v.verify("TopSecret"));
    }
}
