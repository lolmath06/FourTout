//! Tests d'intégration de la phase 11 : explorateur SQLite et vérification JWT.
//!
//! Ils travaillent sur les fixtures réelles de `test-assets/generated`, pas sur
//! des bases construites à la volée : c'est la seule façon de vérifier que ce
//! que voit l'utilisateur correspond à ce que dit `CONTRAT.json`.

use std::path::{Path, PathBuf};

use fourtout_lib::security::jwt::{verify, Algorithm};
use fourtout_lib::sqlite::read::{self, Cell};

fn assets() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../test-assets/generated")
}

fn database() -> PathBuf {
    assets().join("sample.sqlite")
}

fn missing(path: &Path) -> bool {
    if path.exists() {
        return false;
    }
    eprintln!(
        "fixture absente ({}) : lancer `pnpm test:assets`. Test ignoré.",
        path.display()
    );
    true
}

fn sha256(path: &Path) -> String {
    use sha2::{Digest, Sha256};
    let bytes = std::fs::read(path).expect("lecture du fichier");
    let digest = Sha256::digest(&bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn text_of(cell: &Cell) -> String {
    match cell {
        Cell::Null => "NULL".to_string(),
        Cell::Integer { value } => value.to_string(),
        Cell::Real { value } => value.to_string(),
        Cell::Text { value } => value.clone(),
        Cell::Blob { preview } => format!("BLOB:{}", preview.size),
    }
}

/* ------------------------------------------------------------------------ */
/* SQLite — lecture                                                          */
/* ------------------------------------------------------------------------ */

#[test]
fn reads_the_schema_of_the_sample_database() {
    let path = database();
    if missing(&path) {
        return;
    }
    let overview = read::overview(&path).expect("ouverture de la base");

    assert_eq!(overview.tables, 3, "trois tables attendues");
    assert_eq!(overview.views, 1, "une vue attendue");
    assert_eq!(overview.integrity, "ok", "base saine attendue");

    let names: Vec<&str> = overview.objects.iter().map(|o| o.name.as_str()).collect();
    assert!(names.contains(&"users"));
    assert!(names.contains(&"projects"));
    assert!(names.contains(&"events"));
    assert!(names.contains(&"project_summary"));

    let users = overview.objects.iter().find(|o| o.name == "users").unwrap();
    assert_eq!(users.kind, "table");
    assert_eq!(users.rows, Some(3));
    let columns: Vec<&str> = users.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(columns, vec!["id", "name", "email", "avatar", "joined"]);

    let id = &users.columns[0];
    assert!(id.primary_key, "id doit être clé primaire");
    assert_eq!(id.declared_type, "INTEGER");
    let name = &users.columns[1];
    assert!(name.not_null, "name est NOT NULL");
    let email = &users.columns[2];
    assert!(!email.not_null, "email est facultatif");

    // L'index unique sur le courriel est bien vu, avec sa colonne.
    let unique = users.indexes.iter().find(|index| index.unique).expect("index unique");
    assert_eq!(unique.columns, vec!["email"]);

    // Les clés étrangères de `projects` pointent bien vers `users`.
    let projects = overview.objects.iter().find(|o| o.name == "projects").unwrap();
    let foreign = &projects.foreign_keys[0];
    assert_eq!(foreign.references_table, "users");
    assert_eq!(foreign.column, "owner_id");
    assert_eq!(foreign.on_delete, "CASCADE");

    // Une vue n'a pas de compte de lignes : l'évaluer coûterait une exécution.
    let view = overview.objects.iter().find(|o| o.name == "project_summary").unwrap();
    assert_eq!(view.kind, "view");
    assert_eq!(view.rows, None);
    assert!(view.sql.contains("SELECT"));
}

#[test]
fn runs_selects_joins_and_common_table_expressions() {
    let path = database();
    if missing(&path) {
        return;
    }

    let simple = read::run_query(&path, "SELECT id, name FROM users ORDER BY id", 100).unwrap();
    assert_eq!(simple.columns, vec!["id", "name"]);
    assert_eq!(simple.row_count, 3);
    assert_eq!(text_of(&simple.rows[2][1]), "Élodie", "accents préservés");

    let join = read::run_query(
        &path,
        "SELECT COUNT(*) AS n FROM events e \
         JOIN projects p ON p.id = e.project_id \
         JOIN users u ON u.id = p.owner_id WHERE u.name = 'Alice'",
        10,
    )
    .unwrap();
    assert_eq!(text_of(&join.rows[0][0]), "800");

    let cte = read::run_query(
        &path,
        "WITH gros AS (SELECT project_id, COUNT(*) AS n FROM events GROUP BY project_id) \
         SELECT COUNT(*) FROM gros",
        10,
    )
    .unwrap();
    assert_eq!(text_of(&cte.rows[0][0]), "3");

    let plan = read::run_query(&path, "EXPLAIN QUERY PLAN SELECT * FROM users", 100).unwrap();
    assert!(plan.row_count > 0, "un plan d'exécution était attendu");
}

#[test]
fn distinguishes_null_text_and_blob() {
    let path = database();
    if missing(&path) {
        return;
    }
    let result =
        read::run_query(&path, "SELECT id, email, avatar FROM users ORDER BY id", 10).unwrap();

    // Alice : courriel présent, pas d'avatar.
    assert!(matches!(result.rows[0][1], Cell::Text { .. }));
    assert!(matches!(result.rows[0][2], Cell::Null));

    // Bob : un BLOB, jamais présenté comme du texte.
    match &result.rows[1][2] {
        Cell::Blob { preview } => {
            assert_eq!(preview.size, 16);
            assert!(preview.hex.starts_with("00 11 22"), "aperçu obtenu : {}", preview.hex);
            assert!(!preview.truncated);
        }
        other => panic!("BLOB attendu, obtenu {other:?}"),
    }

    // Élodie : pas de courriel du tout, ce qui n'est pas une chaîne vide.
    assert!(matches!(result.rows[2][1], Cell::Null));
}

#[test]
fn limits_the_number_of_rows_returned() {
    let path = database();
    if missing(&path) {
        return;
    }
    let result = read::run_query(&path, "SELECT * FROM events", 500).unwrap();
    assert_eq!(result.row_count, 500);
    assert!(result.truncated, "1 200 lignes pour une limite de 500");

    // La pagination retrouve bien la suite.
    let page = read::browse_table(&path, "events", 10, 1195).unwrap();
    assert_eq!(page.row_count, 5);
    assert!(!page.truncated);
}

/* ------------------------------------------------------------------------ */
/* SQLite — verrou de lecture seule                                          */
/* ------------------------------------------------------------------------ */

/// Le test le plus important de la phase : **aucune écriture ne passe**.
///
/// Toutes les requêtes interdites sont lancées à la suite, puis le fichier est
/// rehaché. Une seule d'entre elles qui aboutirait changerait l'empreinte.
#[test]
fn no_query_can_modify_the_database() {
    let path = database();
    if missing(&path) {
        return;
    }
    let before = sha256(&path);

    let forbidden = [
        "INSERT INTO users (id, name, joined) VALUES (99, 'Mallory', '2026-01-01')",
        "UPDATE users SET name = 'Mallory' WHERE id = 1",
        "DELETE FROM users",
        "DELETE FROM events WHERE id > 0",
        "DROP TABLE events",
        "DROP VIEW project_summary",
        "DROP INDEX idx_users_email",
        "ALTER TABLE users RENAME TO comptes",
        "ALTER TABLE users ADD COLUMN mot_de_passe TEXT",
        "CREATE TABLE intrus (a INTEGER)",
        "CREATE INDEX idx_intrus ON users(name)",
        "CREATE VIEW intrus AS SELECT 1",
        "CREATE TEMP TABLE intrus (a INTEGER)",
        "REPLACE INTO users (id, name, joined) VALUES (1, 'Mallory', '2026-01-01')",
        "INSERT OR REPLACE INTO users (id, name, joined) VALUES (1, 'x', 'y')",
        "VACUUM",
        "REINDEX",
        "ANALYZE",
        "ATTACH DATABASE '/tmp/fourtout-intrus.sqlite' AS intrus",
        "DETACH DATABASE main",
        "PRAGMA journal_mode = WAL",
        "PRAGMA writable_schema = ON",
        "PRAGMA user_version = 42",
        "PRAGMA foreign_keys = OFF",
        // Écritures déguisées : cachées derrière une lecture, ou dans un CTE.
        "SELECT 1; DROP TABLE users",
        "WITH x AS (SELECT 1) INSERT INTO users (id, name, joined) SELECT 42, 'x', 'y'",
        "SELECT * FROM users; UPDATE users SET name = 'x'",
        // Et le contournement le plus connu : écrire dans le schéma lui-même.
        "UPDATE sqlite_master SET sql = '' WHERE name = 'users'",
    ];

    for sql in forbidden {
        let outcome = read::run_query(&path, sql, 100);
        assert!(outcome.is_err(), "requête acceptée alors qu'elle écrit : {sql}");
        let message = outcome.unwrap_err();
        assert!(!message.is_empty(), "refus sans message pour {sql}");
        assert!(
            !message.contains("panicked"),
            "message brut rendu à l'utilisateur pour {sql} : {message}"
        );
    }

    let after = sha256(&path);
    assert_eq!(before, after, "le fichier a changé : le verrou de lecture seule a cédé");
}

#[test]
fn read_only_pragmas_still_work() {
    let path = database();
    if missing(&path) {
        return;
    }
    let before = sha256(&path);

    // Les pragmas d'information restent utilisables : le verrou ne stérilise
    // pas l'outil, il interdit seulement les écritures.
    for sql in [
        "PRAGMA table_info(users)",
        "PRAGMA index_list(users)",
        "PRAGMA foreign_key_list(projects)",
        "PRAGMA page_count",
        "PRAGMA quick_check",
    ] {
        let result = read::run_query(&path, sql, 100);
        assert!(result.is_ok(), "pragma de lecture refusé : {sql} → {result:?}");
    }

    assert_eq!(before, sha256(&path));
}

#[test]
fn explains_a_file_that_is_not_a_database() {
    let directory = std::env::temp_dir().join("fourtout-phase11");
    std::fs::create_dir_all(&directory).unwrap();

    let text = directory.join("pas-une-base.txt");
    std::fs::write(&text, "Ceci est un fichier texte, pas une base.").unwrap();
    let error = read::overview(&text).unwrap_err();
    assert!(error.contains("SQLite format 3"), "message obtenu : {error}");
    assert!(!error.contains("Error"), "message technique brut : {error}");

    // Une base tronquée : l'en-tête est bon, la suite ne l'est pas.
    if database().exists() {
        let mut bytes = std::fs::read(database()).unwrap();
        bytes.truncate(200);
        let broken = directory.join("abimee.sqlite");
        std::fs::write(&broken, &bytes).unwrap();
        let error = read::overview(&broken).unwrap_err();
        assert!(!error.is_empty());
        assert!(!error.contains("panicked"), "message obtenu : {error}");
    }

    std::fs::remove_dir_all(&directory).ok();
}

/* ------------------------------------------------------------------------ */
/* JWT — jetons réels                                                        */
/* ------------------------------------------------------------------------ */

fn jwt_fixtures() -> Option<serde_json::Value> {
    let path = assets().join("jwt-fixtures.json");
    if missing(&path) {
        return None;
    }
    serde_json::from_slice(&std::fs::read(&path).ok()?).ok()
}

/// Découpe un jeton en (`header.payload`, signature).
fn split(token: &str) -> (String, String) {
    let parts: Vec<&str> = token.split('.').collect();
    (format!("{}.{}", parts[0], parts[1]), parts[2].to_string())
}

#[test]
fn verifies_the_hmac_fixtures() {
    let Some(fixtures) = jwt_fixtures() else { return };
    let secret = fixtures["secret"].as_str().unwrap();
    let wrong = fixtures["wrongSecret"].as_str().unwrap();

    for (key, algorithm) in
        [("hs256Valid", Algorithm::Hs256), ("hs384Valid", Algorithm::Hs384), ("hs512Valid", Algorithm::Hs512)]
    {
        let token = fixtures[key].as_str().unwrap();
        let (input, signature) = split(token);
        assert!(verify(algorithm, &input, &signature, secret).unwrap(), "{key} devait être valide");
        assert!(
            !verify(algorithm, &input, &signature, wrong).unwrap(),
            "{key} accepté avec le mauvais secret"
        );
    }

    // Jeton signé avec une autre clé : la signature ne concorde pas.
    let (input, signature) = split(fixtures["hs256WrongKey"].as_str().unwrap());
    assert!(!verify(Algorithm::Hs256, &input, &signature, secret).unwrap());
    assert!(verify(Algorithm::Hs256, &input, &signature, wrong).unwrap());

    // Jeton expiré : la **signature** reste parfaitement valide. C'est la
    // distinction que l'outil doit montrer, et non transformer en échec.
    let (input, signature) = split(fixtures["hs256Expired"].as_str().unwrap());
    assert!(
        verify(Algorithm::Hs256, &input, &signature, secret).unwrap(),
        "un jeton expiré garde une signature valide"
    );
}

#[test]
fn verifies_the_rsa_fixtures() {
    let Some(fixtures) = jwt_fixtures() else { return };
    let public = std::fs::read_to_string(assets().join("jwt-rsa-public.pem")).unwrap();
    let other = std::fs::read_to_string(assets().join("jwt-rsa-autre-public.pem")).unwrap();

    for (key, algorithm) in [
        ("rs256Valid", Algorithm::Rs256),
        ("rs384Valid", Algorithm::Rs384),
        ("rs512Valid", Algorithm::Rs512),
    ] {
        let (input, signature) = split(fixtures[key].as_str().unwrap());
        assert!(verify(algorithm, &input, &signature, &public).unwrap(), "{key} devait être valide");
        assert!(
            !verify(algorithm, &input, &signature, &other).unwrap(),
            "{key} accepté avec une autre clé publique"
        );
    }

    // Là encore, expiré ne veut pas dire mal signé.
    let (input, signature) = split(fixtures["rs256Expired"].as_str().unwrap());
    assert!(verify(Algorithm::Rs256, &input, &signature, &public).unwrap());

    // Une charge utile modifiée invalide la signature.
    let (input, signature) = split(fixtures["rs256Valid"].as_str().unwrap());
    assert!(!verify(Algorithm::Rs256, &format!("{input}x"), &signature, &public).unwrap());
}

#[test]
fn refuses_algorithms_it_does_not_implement() {
    assert!(Algorithm::parse("none").is_err());
    assert!(Algorithm::parse("ES256").is_err());
    assert!(Algorithm::parse("PS256").is_err());
    assert!(Algorithm::parse("HS256").is_ok());
}

/* ------------------------------------------------------------------------ */
/* Réseau — banc d'essai strictement local                                   */
/* ------------------------------------------------------------------------ */

#[test]
fn pings_the_loopback_or_says_why_it_cannot() {
    use fourtout_lib::network::ping::{ping, PingOptions};

    match ping("127.0.0.1", PingOptions { count: 3, timeout_ms: 500 }, &|| false) {
        Ok(summary) => {
            assert_eq!(summary.resolved, "127.0.0.1");
            assert_eq!(summary.sent, 3);
            assert_eq!(summary.received, 3, "la boucle locale doit répondre");
            assert_eq!(summary.lost, 0);
            assert_eq!(summary.loss_percent, 0.0);
            assert!(summary.avg_ms.unwrap() >= 0.0);
            assert!(summary.min_ms.unwrap() <= summary.max_ms.unwrap());
            assert!(summary.method.contains("ICMP"));
        }
        Err(message) => {
            // Sur une machine d'intégration continue, le socket ICMP peut être
            // refusé. Ce qui compte alors, c'est que le message le dise — et
            // surtout qu'il ne propose pas un test TCP déguisé en ping.
            assert!(
                message.contains("ICMP indisponible"),
                "refus mal expliqué : {message}"
            );
            eprintln!("ICMP indisponible dans cet environnement : {message}");
        }
    }
}

#[test]
fn checks_ports_against_a_local_server_only() {
    use std::net::TcpListener;
    use std::sync::Arc;

    use fourtout_lib::network::ports::{scan, PortStatus};

    // Aucun service extérieur : le banc d'essai est créé ici, sur un port que
    // le système attribue.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let open = listener.local_addr().unwrap().port();
    let closed = {
        let temporary = TcpListener::bind("127.0.0.1:0").unwrap();
        temporary.local_addr().unwrap().port()
    };

    let never: Arc<dyn Fn() -> bool + Send + Sync> = Arc::new(|| false);
    let summary = scan("127.0.0.1", &[open, closed], 500, never, &|_, _| {}).unwrap();

    assert_eq!(summary.tested, 2);
    assert_eq!(summary.open, 1);
    assert_eq!(summary.closed, 1);
    assert_eq!(
        summary.results.iter().find(|r| r.port == open).unwrap().status,
        PortStatus::Open
    );
    assert_eq!(
        summary.results.iter().find(|r| r.port == closed).unwrap().status,
        PortStatus::Closed
    );
}
