//! Vérification de la signature d'un JWT.
//!
//! Ce module ne fait **que** de la cryptographie : on lui donne un algorithme,
//! les octets signés, une signature et une clé, il répond « ça concorde » ou
//! « ça ne concorde pas ». Toute la politique — refuser `alg: none`, exiger que
//! l'algorithme attendu corresponde à l'en-tête — est décidée en amont, du côté
//! de l'interface, et testée séparément.
//!
//! Deux points méritent d'être explicités :
//!
//! - La comparaison HMAC passe par `Mac::verify_slice`, qui compare en temps
//!   constant. Un `==` sur deux tableaux d'octets s'arrêterait au premier
//!   caractère différent et laisserait fuir, par le temps de réponse, de quoi
//!   reconstruire la signature attendue octet par octet.
//! - Seule la **clé publique** est acceptée pour RSA. Vérifier ne demande
//!   jamais la clé privée, et un outil qui la réclamerait apprendrait à ses
//!   utilisateurs un geste dangereux.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use rsa::pkcs1v15::{Signature, VerifyingKey};
use rsa::pkcs8::DecodePublicKey;
use rsa::signature::Verifier;
use rsa::RsaPublicKey;
use sha2::{Sha256, Sha384, Sha512};

/// Algorithmes réellement vérifiés. La liste est fermée : annoncer un
/// algorithme qu'on ne calcule pas serait pire que ne pas le proposer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Algorithm {
    Hs256,
    Hs384,
    Hs512,
    Rs256,
    Rs384,
    Rs512,
}

impl Algorithm {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "HS256" => Ok(Self::Hs256),
            "HS384" => Ok(Self::Hs384),
            "HS512" => Ok(Self::Hs512),
            "RS256" => Ok(Self::Rs256),
            "RS384" => Ok(Self::Rs384),
            "RS512" => Ok(Self::Rs512),
            other => Err(format!(
                "Algorithme « {other} » non pris en charge. Algorithmes vérifiés : HS256, HS384, HS512, RS256, RS384, RS512."
            )),
        }
    }
}

/// Décode un segment base64url, avec ou sans padding.
fn decode_signature(value: &str) -> Result<Vec<u8>, String> {
    let trimmed = value.trim().trim_end_matches('=');
    URL_SAFE_NO_PAD
        .decode(trimmed)
        .map_err(|_| "La signature du token n'est pas du base64url valide.".to_string())
}

/// HMAC : comparaison en temps constant, toujours.
///
/// Écrit en macro plutôt qu'en fonction générique : les bornes de types de
/// `digest` nécessaires pour abstraire le condensat occupent plus de lignes que
/// les trois corps qu'elles remplaceraient, et se relisent beaucoup moins bien.
macro_rules! hmac_matches {
    ($digest:ty, $key:expr, $message:expr, $signature:expr) => {{
        match <Hmac<$digest> as Mac>::new_from_slice($key) {
            Ok(mut mac) => {
                mac.update($message);
                mac.verify_slice($signature).is_ok()
            }
            Err(_) => false,
        }
    }};
}

/// Vérifie une signature JWT. `Ok(true)` = la signature concorde.
pub fn verify(
    algorithm: Algorithm,
    signing_input: &str,
    signature_b64: &str,
    key: &str,
) -> Result<bool, String> {
    let signature = decode_signature(signature_b64)?;
    let message = signing_input.as_bytes();

    // Trois condensats, trois appels. Rendre ces fonctions génériques
    // demanderait de propager une demi-douzaine de bornes de `digest` pour ne
    // rien gagner : la liste des algorithmes est fermée et tient en six lignes.
    match algorithm {
        Algorithm::Hs256 => Ok(hmac_matches!(Sha256, key.as_bytes(), message, &signature)),
        Algorithm::Hs384 => Ok(hmac_matches!(Sha384, key.as_bytes(), message, &signature)),
        Algorithm::Hs512 => Ok(hmac_matches!(Sha512, key.as_bytes(), message, &signature)),
        Algorithm::Rs256 => {
            let key = parse_public_key(key)?;
            Ok(rsa_matches(VerifyingKey::<Sha256>::new(key), message, &signature))
        }
        Algorithm::Rs384 => {
            let key = parse_public_key(key)?;
            Ok(rsa_matches(VerifyingKey::<Sha384>::new(key), message, &signature))
        }
        Algorithm::Rs512 => {
            let key = parse_public_key(key)?;
            Ok(rsa_matches(VerifyingKey::<Sha512>::new(key), message, &signature))
        }
    }
}

/// RSA PKCS#1 v1.5, à partir d'une clé **publique**.
fn rsa_matches<D>(verifying: VerifyingKey<D>, message: &[u8], signature: &[u8]) -> bool
where
    D: rsa::signature::digest::Digest + rsa::pkcs1v15::RsaSignatureAssociatedOid,
{
    let Ok(parsed) = Signature::try_from(signature) else {
        return false;
    };
    verifying.verify(message, &parsed).is_ok()
}

/// Lit une clé publique RSA au format PEM, `SPKI` ou `PKCS#1`.
///
/// Les deux en-têtes circulent : `BEGIN PUBLIC KEY` (SPKI, le plus courant) et
/// `BEGIN RSA PUBLIC KEY` (PKCS#1). Une clé **privée** est refusée avec un
/// message qui dit pourquoi, plutôt qu'un « format invalide » énigmatique.
fn parse_public_key(pem: &str) -> Result<RsaPublicKey, String> {
    let trimmed = pem.trim();
    if trimmed.contains("PRIVATE KEY") {
        return Err(
            "Cette clé est une clé privée. La vérification d'une signature ne demande que la clé \
             publique : ne collez jamais de clé privée dans un outil."
                .to_string(),
        );
    }
    if trimmed.contains("BEGIN RSA PUBLIC KEY") {
        use rsa::pkcs1::DecodeRsaPublicKey;
        return RsaPublicKey::from_pkcs1_pem(trimmed)
            .map_err(|error| format!("Clé publique PKCS#1 illisible : {error}"));
    }
    RsaPublicKey::from_public_key_pem(trimmed).map_err(|error| {
        format!(
            "Clé publique illisible : {error}. Attendu : un bloc PEM « -----BEGIN PUBLIC KEY----- »."
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vecteur déterministe : jeton HS256 signé avec le secret « fourtout-test ».
    const HS256_TOKEN_INPUT: &str =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFsaWNlIn0";

    fn hs256_signature(secret: &str) -> String {
        use base64::Engine;
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(HS256_TOKEN_INPUT.as_bytes());
        URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    }

    #[test]
    fn accepts_the_right_secret() {
        let signature = hs256_signature("fourtout-test");
        assert!(verify(Algorithm::Hs256, HS256_TOKEN_INPUT, &signature, "fourtout-test").unwrap());
    }

    #[test]
    fn rejects_the_wrong_secret() {
        let signature = hs256_signature("fourtout-test");
        assert!(!verify(Algorithm::Hs256, HS256_TOKEN_INPUT, &signature, "mauvais-secret").unwrap());
    }

    #[test]
    fn rejects_a_tampered_payload() {
        let signature = hs256_signature("fourtout-test");
        let tampered = format!("{HS256_TOKEN_INPUT}x");
        assert!(!verify(Algorithm::Hs256, &tampered, &signature, "fourtout-test").unwrap());
    }

    #[test]
    fn rejects_a_signature_of_the_wrong_length() {
        assert!(!verify(Algorithm::Hs256, HS256_TOKEN_INPUT, "AAAA", "fourtout-test").unwrap());
    }

    #[test]
    fn refuses_a_non_base64_signature() {
        let error = verify(Algorithm::Hs256, HS256_TOKEN_INPUT, "!!!", "secret").unwrap_err();
        assert!(error.contains("base64url"));
    }

    #[test]
    fn refuses_a_private_key() {
        let error = parse_public_key("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----")
            .unwrap_err();
        assert!(error.contains("clé privée"));
    }

    #[test]
    fn names_unsupported_algorithms() {
        let error = Algorithm::parse("none").unwrap_err();
        assert!(error.contains("non pris en charge"));
        assert!(Algorithm::parse("HS384").is_ok());
    }
}
