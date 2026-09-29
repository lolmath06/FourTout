//! Test d'intégration : rejoue une vraie recherche sur le corpus réel.
//!
//! Prouve que corpus + règles + moteur + vérificateur retrouvent réellement un
//! mot de passe qui n'est pas trivial (au-delà des 100 premiers candidats), et
//! que le résultat n'est pas codé en dur.
//!
//! Le test se saute proprement si les fixtures ne sont pas générées
//! (`pnpm wordlist && pnpm test:assets`), pour ne jamais échouer faute de
//! données. La fixture profonde (AES-256, coûteuse) n'est jouée que si
//! `FT_HEAVY=1`, car elle est lente hors mode release.

use std::path::PathBuf;

use fourtout_lib::recovery::engine::{search, Outcome};
use fourtout_lib::recovery::rules::Tier;
use fourtout_lib::recovery::verifier::{EncryptionParams, PasswordVerifier};
use fourtout_lib::recovery::wordlist::read_seeds;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn corpus() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/wordlists/seeds.txt.gz")
}

/// Extrait un champ chaîne d'un bloc JSON plat (sans dépendance JSON).
fn json_str(block: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let start = block.find(&needle)? + needle.len();
    let rest = &block[start..];
    let colon = rest.find(':')?;
    let after = &rest[colon + 1..];
    let q1 = after.find('"')?;
    let q2 = after[q1 + 1..].find('"')?;
    Some(after[q1 + 1..q1 + 1 + q2].to_string())
}

fn json_int(block: &str, key: &str) -> Option<i64> {
    let needle = format!("\"{key}\"");
    let start = block.find(&needle)? + needle.len();
    let rest = &block[start..];
    let colon = rest.find(':')?;
    let after = rest[colon + 1..].trim_start();
    let end = after.find(|c: char| !c.is_ascii_digit() && c != '-').unwrap_or(after.len());
    after[..end].parse().ok()
}

/// Isole le sous-objet `"name": { ... }`.
fn json_block<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    let key = format!("\"{name}\"");
    let start = text.find(&key)?;
    let brace = text[start..].find('{')? + start;
    let mut depth = 0;
    for (i, c) in text[brace..].char_indices() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&text[brace..brace + i + 1]);
                }
            }
            _ => {}
        }
    }
    None
}

fn params_from(block: &str) -> EncryptionParams {
    let hex = |k: &str| {
        let s = json_str(block, k).unwrap();
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    };
    EncryptionParams {
        revision: json_int(block, "revision").unwrap() as u8,
        key_length: json_int(block, "keyLength").unwrap() as usize,
        o: hex("o"),
        u: hex("u"),
        p: json_int(block, "p").unwrap() as i32,
        id0: hex("id0"),
        encrypt_metadata: block.contains("\"encryptMetadata\": true"),
    }
}

fn load_fixture() -> Option<String> {
    let path = root().join("test-assets/generated/recovery-fixture.json");
    std::fs::read_to_string(path).ok()
}

fn run_case(fixture: &str, name: &str, tier: Tier) {
    let block = json_block(fixture, name).expect("bloc de fixture manquant");
    let expected = json_str(block, "password").unwrap();
    let params_block = json_block(block, "params").unwrap();
    let verifier = PasswordVerifier::new(params_from(params_block));

    let seeds = read_seeds(&corpus(), tier.seed_limit()).expect("corpus lisible");
    let mut ticks = 0;
    let outcome = search(seeds, &verifier, tier, u64::MAX, |_| ticks += 1, || false);

    match outcome {
        Outcome::Found { password, tested, .. } => {
            assert_eq!(password, expected, "mot de passe attendu");
            assert!(tested > 100, "trouvé au-delà des premiers candidats ({tested})");
            eprintln!("[{name}] trouvé « {password} » après {tested} candidats, {ticks} lots");
        }
        _ => panic!("[{name}] le mot de passe aurait dû être trouvé"),
    }
}

#[test]
fn finds_the_quick_fixture_on_the_real_corpus() {
    if !corpus().exists() {
        eprintln!("corpus absent : test sauté (lancez `pnpm wordlist`)");
        return;
    }
    let Some(fixture) = load_fixture() else {
        eprintln!("fixtures absentes : test sauté (lancez `pnpm test:assets`)");
        return;
    };
    // AES-128, ~1600 candidats : rapide même en mode debug.
    run_case(&fixture, "quick", Tier::Quick);
}

#[test]
fn finds_the_deep_fixture_when_heavy() {
    if std::env::var("FT_HEAVY").is_err() {
        eprintln!("fixture profonde sautée (activez avec FT_HEAVY=1, de préférence en release)");
        return;
    }
    if !corpus().exists() {
        return;
    }
    let Some(fixture) = load_fixture() else {
        return;
    };
    // AES-256, plusieurs centaines de milliers de candidats : plusieurs lots.
    run_case(&fixture, "deep", Tier::Full);
}
