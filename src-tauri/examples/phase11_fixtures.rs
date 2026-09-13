//! Base SQLite de référence de la phase 11.
//!
//! Écrite par `rusqlite`, comme le reste des fixtures que Node ne sait pas
//! produire sans dépendance. Elle est **déterministe** : mêmes lignes, mêmes
//! identifiants, même BLOB à chaque exécution, de sorte qu'une valeur attendue
//! dans un test ou dans une recette manuelle puisse être recopiée sans dériver.
//!
//! Elle contient volontairement tout ce qui met un explorateur en difficulté :
//!
//! - un `NULL` dans une colonne facultative ;
//! - des caractères accentués et une casse qui compte (« Élodie ») ;
//! - un BLOB, qu'il ne faut surtout pas afficher comme du texte ;
//! - une clé étrangère, un index, une vue ;
//! - une table assez remplie pour que la pagination serve à quelque chose.
//!
//! Usage : `cargo run --quiet --example phase11_fixtures` depuis `src-tauri/`.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

fn out_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../test-assets/generated")
}

/// BLOB déterministe : seize octets dont la valeur se recalcule de tête.
fn deterministic_blob() -> Vec<u8> {
    (0u8..16).map(|index| index.wrapping_mul(17)).collect()
}

fn main() -> Result<(), String> {
    let out = out_dir();
    std::fs::create_dir_all(&out).map_err(|error| error.to_string())?;
    let path = out.join("sample.sqlite");
    let _ = std::fs::remove_file(&path);

    let connection = Connection::open(&path).map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            r#"
            PRAGMA foreign_keys = ON;

            CREATE TABLE users (
                id       INTEGER PRIMARY KEY,
                name     TEXT    NOT NULL,
                email    TEXT,
                avatar   BLOB,
                joined   TEXT    NOT NULL
            );

            CREATE TABLE projects (
                id       INTEGER PRIMARY KEY,
                owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title    TEXT    NOT NULL,
                budget   REAL,
                archived INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE events (
                id         INTEGER PRIMARY KEY,
                project_id INTEGER NOT NULL REFERENCES projects(id),
                kind       TEXT    NOT NULL,
                happened   TEXT    NOT NULL
            );

            CREATE INDEX idx_projects_owner ON projects(owner_id);
            CREATE UNIQUE INDEX idx_users_email ON users(email);
            CREATE INDEX idx_events_project ON events(project_id, happened);

            CREATE VIEW project_summary AS
                SELECT p.id          AS project_id,
                       p.title       AS title,
                       u.name        AS owner,
                       COUNT(e.id)   AS events
                FROM projects p
                JOIN users u ON u.id = p.owner_id
                LEFT JOIN events e ON e.project_id = p.id
                GROUP BY p.id, p.title, u.name;
            "#,
        )
        .map_err(|error| error.to_string())?;

    // Trois personnes : une adresse manquante, un prénom accentué.
    connection
        .execute(
            "INSERT INTO users (id, name, email, avatar, joined) VALUES \
             (1, 'Alice', 'alice@example.test', NULL, '2024-01-15'), \
             (2, 'Bob', 'bob@example.test', ?1, '2024-03-02'), \
             (3, 'Élodie', NULL, NULL, '2025-11-30')",
            [deterministic_blob()],
        )
        .map_err(|error| error.to_string())?;

    connection
        .execute(
            "INSERT INTO projects (id, owner_id, title, budget, archived) VALUES \
             (1, 1, 'Refonte du site', 12500.5, 0), \
             (2, 1, 'Migration — étape 2', NULL, 1), \
             (3, 3, 'Inventaire', 300.0, 0)",
            [],
        )
        .map_err(|error| error.to_string())?;

    // Assez d'événements pour que la limite d'affichage se voie.
    let transaction = connection.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut insert = transaction
            .prepare("INSERT INTO events (id, project_id, kind, happened) VALUES (?1, ?2, ?3, ?4)")
            .map_err(|error| error.to_string())?;
        for index in 1..=1200i64 {
            let project = (index % 3) + 1;
            let kind = match index % 4 {
                0 => "création",
                1 => "modification",
                2 => "consultation",
                _ => "suppression",
            };
            // Dates réparties sur 1 200 jours à partir du 1er janvier 2024,
            // calculées sans bibliothèque pour rester reproductibles.
            let happened = format!("2024-01-01T{:02}:{:02}:00Z", index % 24, index % 60);
            insert
                .execute(rusqlite::params![index, project, kind, happened])
                .map_err(|error| error.to_string())?;
        }
    }
    transaction.commit().map_err(|error| error.to_string())?;

    // Base compactée : même taille de fichier d'une génération à l'autre.
    connection.execute_batch("VACUUM").map_err(|error| error.to_string())?;
    drop(connection);

    // On rouvre la base qu'on vient d'écrire et on note ce qu'elle contient
    // réellement : le contrat des fixtures lit ce fichier plutôt que des
    // chiffres recopiés à la main.
    let connection = Connection::open(&path).map_err(|error| error.to_string())?;
    let count = |table: &str| -> Result<i64, String> {
        connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
            .map_err(|error| error.to_string())
    };
    let users = count("users")?;
    let projects = count("projects")?;
    let events = count("events")?;
    let blob_size: i64 = connection
        .query_row("SELECT LENGTH(avatar) FROM users WHERE id = 2", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let null_emails: i64 = connection
        .query_row("SELECT COUNT(*) FROM users WHERE email IS NULL", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let summary_rows: i64 = connection
        .query_row("SELECT COUNT(*) FROM project_summary", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let alice_events: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM events e JOIN projects p ON p.id = e.project_id \
             JOIN users u ON u.id = p.owner_id WHERE u.name = 'Alice'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    drop(connection);

    let observed = format!(
        "{{\n  \"tables\": [\"events\", \"projects\", \"users\"],\n  \"vues\": [\"project_summary\"],\n  \
         \"lignes\": {{ \"users\": {users}, \"projects\": {projects}, \"events\": {events} }},\n  \
         \"tailleBlobAvatarBob\": {blob_size},\n  \"utilisateursSansCourriel\": {null_emails},\n  \
         \"lignesVueResume\": {summary_rows},\n  \"evenementsDesProjetsDAlice\": {alice_events}\n}}\n"
    );
    std::fs::write(out.join("sample.sqlite.json"), observed).map_err(|e| e.to_string())?;

    println!("sample.sqlite écrit dans {}", path.display());
    Ok(())
}
