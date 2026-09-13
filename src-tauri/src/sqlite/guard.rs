//! Ce que l'explorateur accepte d'exécuter, et comment il le fait respecter.
//!
//! Deux couches, dans cet ordre d'importance :
//!
//! - `authorizer` : le verrou. Il est consulté par SQLite lui-même, pour chaque
//!   action, après analyse complète de la requête. Rien ne lui échappe, ni un
//!   mot-clé écrit bizarrement, ni une écriture cachée au fond d'un `WITH`.
//! - `classify` : l'explication. Elle regarde le premier mot utile de la requête
//!   pour pouvoir dire « INSERT est refusé ici » *avant* d'exécuter, plutôt que
//!   de laisser remonter un « not authorized » sans contexte.
//!
//! L'ordre compte : si la classification laissait passer quelque chose, le
//! verrou refuserait quand même. L'inverse ne serait pas vrai.

use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::Connection;

/// Nature d'une requête, du point de vue de l'explorateur.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StatementKind {
    /// `SELECT`, `WITH … SELECT`, `VALUES`, `EXPLAIN`.
    Read,
    /// `PRAGMA` figurant dans la liste blanche de lecture.
    ReadPragma(String),
    /// Refusée, avec le motif à afficher.
    Refused(String),
}

/// `PRAGMA` d'information qui **prennent un argument** : un nom de table ou
/// d'index, écrit entre parenthèses. `PRAGMA table_info(users)` en est le cas
/// type. Ils restent des lectures avec ou sans argument.
pub const READ_PRAGMAS_WITH_ARG: &[&str] = &[
    "foreign_key_list",
    "index_info",
    "index_list",
    "index_xinfo",
    "integrity_check",
    "quick_check",
    "table_info",
    "table_list",
    "table_xinfo",
];

/// `PRAGMA` d'information qui **ne prennent aucun argument**.
///
/// La distinction n'est pas cosmétique : beaucoup de pragmas SQLite lisent
/// lorsqu'on les interroge et **écrivent** lorsqu'on leur donne une valeur
/// (`PRAGMA user_version` lit, `PRAGMA user_version = 42` écrit). Pour ceux-là,
/// la présence d'une valeur suffit à refuser, sans avoir à deviner laquelle.
pub const READ_PRAGMAS_NO_ARG: &[&str] = &[
    "application_id",
    "collation_list",
    "compile_options",
    "database_list",
    "encoding",
    "freelist_count",
    "function_list",
    "module_list",
    "page_count",
    "page_size",
    "pragma_list",
    "schema_version",
    "user_version",
];

/// Tous les pragmas d'information autorisés, pour les messages d'erreur.
pub fn read_pragmas() -> Vec<&'static str> {
    let mut all: Vec<&'static str> =
        READ_PRAGMAS_WITH_ARG.iter().chain(READ_PRAGMAS_NO_ARG.iter()).copied().collect();
    all.sort_unstable();
    all
}

/// Un pragma est-il une lecture, compte tenu de la présence d'un argument ?
fn pragma_is_read(name: &str, has_value: bool) -> bool {
    let name = name.to_ascii_lowercase();
    if READ_PRAGMAS_WITH_ARG.contains(&name.as_str()) {
        return true;
    }
    READ_PRAGMAS_NO_ARG.contains(&name.as_str()) && !has_value
}

/// Retire commentaires et blancs pour retrouver le premier mot utile.
fn strip_leading_noise(sql: &str) -> String {
    let mut rest = sql.trim_start();
    loop {
        if let Some(after) = rest.strip_prefix("--") {
            rest = after.split_once('\n').map(|(_, tail)| tail).unwrap_or("").trim_start();
            continue;
        }
        if let Some(after) = rest.strip_prefix("/*") {
            rest = after.split_once("*/").map(|(_, tail)| tail).unwrap_or("").trim_start();
            continue;
        }
        break;
    }
    rest.to_string()
}

/// Vrai si la chaîne contient un `;` suivi d'autre chose qu'un blanc, hors
/// littéral de texte : autrement dit, plusieurs requêtes d'un coup.
fn has_extra_statement(sql: &str) -> bool {
    let mut in_single = false;
    let mut in_double = false;
    let mut chars = sql.chars().peekable();
    while let Some(char) = chars.next() {
        match char {
            '\'' if !in_double => in_single = !in_single,
            '"' if !in_single => in_double = !in_double,
            ';' if !in_single
                && !in_double
                && chars.clone().any(|next| !next.is_whitespace() && next != ';') =>
            {
                return true;
            }
            _ => {}
        }
    }
    false
}

fn first_word(sql: &str) -> String {
    sql.split(|c: char| c.is_whitespace() || c == '(')
        .find(|word| !word.is_empty())
        .unwrap_or("")
        .trim_end_matches(';')
        .to_ascii_uppercase()
}

/// Classe une requête avant exécution, pour pouvoir l'expliquer.
pub fn classify(sql: &str) -> StatementKind {
    let cleaned = strip_leading_noise(sql);
    if cleaned.trim().is_empty() {
        return StatementKind::Refused("Aucune requête à exécuter.".to_string());
    }
    if has_extra_statement(&cleaned) {
        return StatementKind::Refused(
            "Une seule requête à la fois. Enchaîner plusieurs instructions séparées par « ; » \
             est refusé : c'est ainsi qu'une écriture se glisse derrière une lecture."
                .to_string(),
        );
    }

    let word = first_word(&cleaned);
    match word.as_str() {
        "SELECT" | "WITH" | "VALUES" | "EXPLAIN" => StatementKind::Read,
        "PRAGMA" => classify_pragma(&cleaned),
        "" => StatementKind::Refused("Aucune requête à exécuter.".to_string()),
        other => StatementKind::Refused(format!(
            "« {other} » n'est pas une lecture. Cet explorateur ouvre la base en lecture seule : \
             seuls SELECT, WITH … SELECT, VALUES, EXPLAIN et quelques PRAGMA d'information sont \
             exécutables."
        )),
    }
}

fn classify_pragma(sql: &str) -> StatementKind {
    let rest = sql[6..].trim_start();
    let name: String = rest
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect::<String>()
        .to_ascii_lowercase();
    // `PRAGMA x = y` écrit ; `PRAGMA x` et `PRAGMA x(y)` lisent.
    let after_name = rest[name.len()..].trim_start();
    if after_name.starts_with('=') {
        return StatementKind::Refused(format!(
            "« PRAGMA {name} = … » modifie un réglage de la base : refusé en lecture seule."
        ));
    }
    if pragma_is_read(&name, false) {
        StatementKind::ReadPragma(name)
    } else {
        StatementKind::Refused(format!(
            "« PRAGMA {name} » ne figure pas parmi les pragmas d'information autorisés ({}).",
            read_pragmas().join(", ")
        ))
    }
}

/// Installe l'autorisateur de lecture seule sur une connexion.
///
/// C'est le verrou qui compte. Il tourne à l'intérieur du moteur, sur la requête
/// déjà analysée, et il ne connaît que des actions — pas du texte.
pub fn install_read_only_authorizer(connection: &Connection) -> Result<(), String> {
    connection
        .authorizer(Some(|context: AuthContext<'_>| match context.action {
            // Lectures : la raison d'être de l'outil.
            AuthAction::Read { .. }
            | AuthAction::Select
            | AuthAction::Function { .. }
            | AuthAction::Recursive => Authorization::Allow,

            // Un `PRAGMA` n'est autorisé que s'il figure dans la liste blanche
            // **et** ne reçoit aucune valeur : `PRAGMA x = y` écrit.
            AuthAction::Pragma { pragma_name, pragma_value, .. } => {
                if pragma_is_read(pragma_name, pragma_value.is_some()) {
                    Authorization::Allow
                } else {
                    Authorization::Deny
                }
            }

            // Tout le reste — écritures, DDL, ATTACH, transactions, vues
            // temporaires, fonctions virtuelles — est refusé.
            _ => Authorization::Deny,
        }))
        .map_err(|error| format!("Impossible d'installer le verrou de lecture : {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refused(sql: &str) -> String {
        match classify(sql) {
            StatementKind::Refused(reason) => reason,
            other => panic!("attendu : refus, obtenu {other:?} pour {sql}"),
        }
    }

    #[test]
    fn accepts_reads() {
        assert_eq!(classify("SELECT 1"), StatementKind::Read);
        assert_eq!(classify("  select * from users"), StatementKind::Read);
        assert_eq!(
            classify("WITH t AS (SELECT 1) SELECT * FROM t"),
            StatementKind::Read
        );
        assert_eq!(classify("EXPLAIN QUERY PLAN SELECT 1"), StatementKind::Read);
        assert_eq!(classify("-- un commentaire\nSELECT 1"), StatementKind::Read);
        assert_eq!(classify("/* bloc */ SELECT 1"), StatementKind::Read);
    }

    #[test]
    fn refuses_every_write_verb() {
        for sql in [
            "INSERT INTO users VALUES (1)",
            "UPDATE users SET name = 'x'",
            "DELETE FROM users",
            "DROP TABLE users",
            "ALTER TABLE users RENAME TO t",
            "CREATE TABLE t (a)",
            "REPLACE INTO users VALUES (1)",
            "VACUUM",
            "ATTACH DATABASE 'autre.db' AS autre",
            "DETACH autre",
            "REINDEX",
            "ANALYZE",
        ] {
            let reason = refused(sql);
            assert!(!reason.is_empty(), "refus sans motif pour {sql}");
        }
    }

    #[test]
    fn refuses_chained_statements() {
        let reason = refused("SELECT 1; DROP TABLE users");
        assert!(reason.contains("Une seule requête"));
        // Un point-virgule final isolé reste une requête unique.
        assert_eq!(classify("SELECT 1;"), StatementKind::Read);
        // Un `;` à l'intérieur d'un littéral ne compte pas.
        assert_eq!(classify("SELECT 'a; b'"), StatementKind::Read);
    }

    #[test]
    fn sorts_pragmas_into_read_and_write() {
        assert_eq!(
            classify("PRAGMA table_info(users)"),
            StatementKind::ReadPragma("table_info".to_string())
        );
        assert!(refused("PRAGMA journal_mode = WAL").contains("modifie"));
        assert!(refused("PRAGMA writable_schema = ON").contains("modifie"));
        assert!(refused("PRAGMA journal_mode").contains("autorisés"));
    }

    #[test]
    fn refuses_an_empty_query() {
        assert!(refused("   ").contains("Aucune requête"));
        assert!(refused("-- rien que du commentaire").contains("Aucune requête"));
    }
}
