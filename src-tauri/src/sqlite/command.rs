//! Commandes Tauri de l'explorateur SQLite.
//!
//! Chaque commande ouvre sa propre connexion en lecture seule et la referme :
//! aucun état n'est conservé entre deux appels, donc aucune connexion ne peut
//! rester ouverte en écriture par inadvertance.

use std::path::PathBuf;

use super::read::{self, DatabaseOverview, QueryResult, DEFAULT_ROW_LIMIT};

/// Schéma complet d'une base : tables, vues, colonnes, index, clés étrangères.
#[tauri::command]
pub fn sqlite_overview(path: String) -> Result<DatabaseOverview, String> {
    read::overview(&PathBuf::from(path))
}

/// Exécute une requête **de lecture** choisie par l'utilisateur.
#[tauri::command]
pub fn sqlite_query(path: String, sql: String, limit: Option<usize>) -> Result<QueryResult, String> {
    read::run_query(&PathBuf::from(path), &sql, limit.unwrap_or(DEFAULT_ROW_LIMIT))
}

/// Consulte les lignes d'une table, par pages.
#[tauri::command]
pub fn sqlite_browse(
    path: String,
    table: String,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<QueryResult, String> {
    read::browse_table(
        &PathBuf::from(path),
        &table,
        limit.unwrap_or(DEFAULT_ROW_LIMIT),
        offset.unwrap_or(0),
    )
}
