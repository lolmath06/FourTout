//! Génération de variantes de mots de passe à partir d'un mot-graine.
//!
//! Le corpus statique fournit les graines ; les règles les déclinent en
//! variantes très courantes (casse, suffixes chiffrés, années, symboles,
//! substitutions « leet »). C'est ce qui permet d'atteindre plusieurs millions
//! de candidats sans stocker chaque ligne.
//!
//! Principe : une **séquence ordonnée** d'opérations, de la variante la plus
//! probable à la moins probable, toutes catégories entrelacées (à la manière
//! des jeux de règles éprouvés type « best64 »). On la tronque au budget du
//! niveau choisi. Le nombre de candidats par graine est donc borné et connu
//! d'avance : pas d'explosion combinatoire, et un total prévisionnel calculable.

use std::collections::HashSet;

/// Niveau de recherche choisi par l'utilisateur.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tier {
    /// Mots de passe les plus fréquents, quasiment sans déclinaison.
    Quick,
    /// Toutes les graines, déclinaison légère.
    Extended,
    /// Toutes les graines, déclinaison complète.
    Full,
}

impl Tier {
    /// Lit un niveau depuis son nom.
    ///
    /// Volontairement `parse` et non `from_str` : ce dernier est le nom de la
    /// méthode du trait `std::str::FromStr`, qui rend un `Result`. Deux
    /// signatures différentes derrière le même nom se confondent trop
    /// facilement à l'appel.
    pub fn parse(value: &str) -> Option<Tier> {
        match value {
            "quick" => Some(Tier::Quick),
            "extended" => Some(Tier::Extended),
            "full" => Some(Tier::Full),
            _ => None,
        }
    }

    /// Nombre de graines à lire, ou `None` pour tout le corpus.
    /// Les graines étant triées par fréquence, la limite garde les plus utiles.
    pub fn seed_limit(self) -> Option<usize> {
        match self {
            Tier::Quick => Some(30_000),
            Tier::Extended | Tier::Full => None,
        }
    }

    /// Nombre maximal de variantes conservées par graine.
    pub fn variant_budget(self) -> usize {
        match self {
            Tier::Quick => 2,
            Tier::Extended => 4,
            Tier::Full => 40,
        }
    }
}

/// Base à laquelle appliquer un suffixe.
#[derive(Clone, Copy)]
enum Base {
    Raw,
    Cap,
    Upper,
}

/// Opération produisant une variante à partir d'un mot-graine.
enum Op {
    /// La base seule (mot brut, capitalisé ou en majuscules).
    Plain(Base),
    /// Une base suivie d'un suffixe.
    Suffix(Base, &'static str),
    /// Le mot entièrement transformé en « leet ».
    Leet,
    /// Le mot « leet » suivi d'un suffixe.
    LeetSuffix(&'static str),
}

/// Séquence de variantes, de la plus probable à la moins probable.
const SEQUENCE: &[Op] = &[
    Op::Plain(Base::Raw),
    Op::Plain(Base::Cap),
    Op::Plain(Base::Upper),
    Op::Suffix(Base::Raw, "1"),
    Op::Suffix(Base::Raw, "123"),
    Op::Suffix(Base::Cap, "1"),
    Op::Suffix(Base::Raw, "12"),
    Op::Suffix(Base::Raw, "2024"),
    Op::Suffix(Base::Raw, "!"),
    Op::Suffix(Base::Raw, "2025"),
    Op::Suffix(Base::Cap, "123"),
    Op::Suffix(Base::Raw, "2"),
    Op::Suffix(Base::Raw, "1234"),
    Op::Suffix(Base::Upper, "1"),
    Op::Suffix(Base::Raw, "2023"),
    Op::Suffix(Base::Raw, "007"),
    Op::Suffix(Base::Cap, "!"),
    Op::Suffix(Base::Raw, "2000"),
    Op::Suffix(Base::Raw, "11"),
    Op::Suffix(Base::Raw, "@"),
    Op::Leet,
    Op::Suffix(Base::Cap, "2024"),
    Op::Suffix(Base::Raw, "69"),
    Op::Suffix(Base::Raw, "2026"),
    Op::Suffix(Base::Raw, "21"),
    Op::Suffix(Base::Cap, "12"),
    Op::LeetSuffix("1"),
    Op::Suffix(Base::Raw, "22"),
    Op::Suffix(Base::Raw, "2022"),
    Op::Suffix(Base::Raw, "99"),
    Op::Suffix(Base::Raw, "?"),
    Op::Suffix(Base::Cap, "2025"),
    Op::LeetSuffix("123"),
    Op::Suffix(Base::Raw, "2010"),
    Op::Suffix(Base::Raw, "123456"),
    Op::Suffix(Base::Raw, "."),
    Op::Suffix(Base::Upper, "123"),
    Op::Suffix(Base::Raw, "1990"),
    Op::LeetSuffix("!"),
    Op::Suffix(Base::Cap, "1234"),
    Op::Suffix(Base::Raw, "#"),
    Op::Suffix(Base::Raw, "13"),
    Op::Suffix(Base::Raw, "$"),
    Op::Suffix(Base::Raw, "111"),
];

/// Applique les substitutions « leet » les plus communes à un mot entier.
fn leet(word: &str) -> String {
    word.chars()
        .map(|c| match c.to_ascii_lowercase() {
            'a' => '@',
            'e' => '3',
            'i' => '1',
            'o' => '0',
            's' => '5',
            other => other,
        })
        .collect()
}

/// Passe la première lettre en majuscule (reste inchangé).
fn capitalize(word: &str) -> String {
    let mut chars = word.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

/// Génère les variantes d'un mot-graine dans l'ordre de probabilité, jusqu'au
/// budget du niveau, en supprimant les doublons internes au mot.
///
/// `out` et `seen` sont réutilisés d'un appel à l'autre pour éviter des
/// allocations dans la boucle chaude ; ils sont vidés au début.
pub fn expand_into(seed: &str, tier: Tier, out: &mut Vec<String>, seen: &mut HashSet<String>) {
    out.clear();
    seen.clear();
    if seed.is_empty() {
        return;
    }
    let budget = tier.variant_budget();

    let cap = capitalize(seed);
    let upper = seed.to_uppercase();
    let leeted = leet(seed);
    let base_of = |base: Base| -> &str {
        match base {
            Base::Raw => seed,
            Base::Cap => &cap,
            Base::Upper => &upper,
        }
    };

    for op in SEQUENCE {
        if out.len() >= budget {
            return;
        }
        let candidate = match op {
            Op::Plain(base) => base_of(*base).to_string(),
            Op::Suffix(base, suffix) => format!("{}{}", base_of(*base), suffix),
            Op::Leet => {
                if leeted == seed {
                    continue;
                }
                leeted.clone()
            }
            Op::LeetSuffix(suffix) => {
                if leeted == seed {
                    continue;
                }
                format!("{leeted}{suffix}")
            }
        };
        if candidate.is_empty() || candidate.len() > 128 {
            continue;
        }
        if seen.insert(candidate.clone()) {
            out.push(candidate);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn expand(seed: &str, tier: Tier) -> Vec<String> {
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        expand_into(seed, tier, &mut out, &mut seen);
        out
    }

    #[test]
    fn quick_is_raw_then_capitalized_only() {
        assert_eq!(expand("dragon", Tier::Quick), vec!["dragon", "Dragon"]);
    }

    #[test]
    fn extended_stays_within_budget() {
        let variants = expand("dragon", Tier::Extended);
        assert_eq!(variants.len(), 4);
        assert_eq!(variants[0], "dragon");
        assert_eq!(variants, vec!["dragon", "Dragon", "DRAGON", "dragon1"]);
    }

    #[test]
    fn full_includes_years_symbols_and_leet() {
        let variants = expand("password", Tier::Full);
        assert!(variants.contains(&"password1".to_string()));
        assert!(variants.contains(&"Password123".to_string()));
        assert!(variants.contains(&"password2024".to_string()));
        assert!(variants.contains(&"password!".to_string()));
        assert!(variants.contains(&"p@55w0rd".to_string()), "le leet doit être atteint dans le budget complet");
    }

    #[test]
    fn respects_budget() {
        for tier in [Tier::Quick, Tier::Extended, Tier::Full] {
            assert!(expand("secret", tier).len() <= tier.variant_budget());
        }
        assert_eq!(expand("secret", Tier::Full).len(), 40);
    }

    #[test]
    fn no_internal_duplicates() {
        let variants = expand("aaa", Tier::Full);
        let unique: HashSet<_> = variants.iter().collect();
        assert_eq!(unique.len(), variants.len());
    }

    #[test]
    fn ordering_prioritizes_common_forms() {
        let variants = expand("hello", Tier::Full);
        let p1 = variants.iter().position(|v| v == "hello1").unwrap();
        let p123456 = variants.iter().position(|v| v == "hello123456").unwrap();
        assert!(p1 < p123456);
    }

    #[test]
    fn handles_empty_and_unicode() {
        assert!(expand("", Tier::Full).is_empty());
        assert_eq!(expand("café", Tier::Quick)[0], "café");
    }
}
