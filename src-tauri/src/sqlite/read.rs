//! Lecture du schéma et exécution des requêtes.

use std::path::Path;
use std::time::Instant;

use rusqlite::types::ValueRef;
use rusqlite::Connection;
use serde::Serialize;

use super::guard::{classify, install_read_only_authorizer, StatementKind};
use super::{describe_query_error, open_read_only, preview_blob, BlobPreview};

/* ------------------------------------------------------------------------ */
/* Schéma                                                                    */
/* ------------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    /// Type **déclaré**. SQLite ne l'impose pas : une colonne `INTEGER` peut
    /// contenir du texte. C'est une intention, pas une garantie.
    pub declared_type: String,
    pub not_null: bool,
    pub primary_key: bool,
    pub default_value: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub name: String,
    pub unique: bool,
    /// `c` (créé explicitement), `u` (contrainte UNIQUE), `pk` (clé primaire).
    pub origin: String,
    pub partial: bool,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyInfo {
    pub column: String,
    pub references_table: String,
    pub references_column: String,
    pub on_update: String,
    pub on_delete: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectInfo {
    pub name: String,
    /// `table` ou `view`.
    pub kind: String,
    /// `NULL` pour une vue : compter ses lignes demanderait de l'exécuter.
    pub rows: Option<i64>,
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
    /// Instruction de création, telle qu'elle est stockée dans la base.
    pub sql: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseOverview {
    pub path: String,
    pub file_size: u64,
    pub page_size: i64,
    pub page_count: i64,
    pub encoding: String,
    pub user_version: i64,
    pub application_id: i64,
    pub sqlite_version: String,
    pub objects: Vec<ObjectInfo>,
    /// Nombre de tables (hors vues), pour l'en-tête.
    pub tables: usize,
    pub views: usize,
    /// Résultat de `PRAGMA quick_check` : « ok » quand la base est saine.
    pub integrity: String,
}

fn scalar_i64(connection: &Connection, pragma: &str) -> i64 {
    connection
        .query_row(&format!("PRAGMA {pragma}"), [], |row| row.get::<_, i64>(0))
        .unwrap_or(0)
}

fn scalar_text(connection: &Connection, pragma: &str) -> String {
    connection
        .query_row(&format!("PRAGMA {pragma}"), [], |row| row.get::<_, String>(0))
        .unwrap_or_default()
}

/// Un nom d'objet SQLite, échappé pour être inséré dans une requête.
///
/// Une table peut légitimement s'appeler `mes "notes"` : le seul échappement
/// correct est le guillemet double redoublé. Sans cela, un nom hostile pourrait
/// détourner la requête de comptage — et si la lecture seule empêcherait les
/// dégâts, une injection reste une injection.
fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn columns_of(connection: &Connection, name: &str) -> Vec<ColumnInfo> {
    let sql = format!("PRAGMA table_info({})", quote_ident(name));
    let Ok(mut statement) = connection.prepare(&sql) else {
        return Vec::new();
    };
    let rows = statement.query_map([], |row| {
        Ok(ColumnInfo {
            name: row.get::<_, String>(1)?,
            declared_type: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            not_null: row.get::<_, i64>(3)? != 0,
            default_value: row.get::<_, Option<String>>(4)?,
            primary_key: row.get::<_, i64>(5)? != 0,
        })
    });
    rows.map(|iter| iter.filter_map(Result::ok).collect()).unwrap_or_default()
}

fn indexes_of(connection: &Connection, name: &str) -> Vec<IndexInfo> {
    let sql = format!("PRAGMA index_list({})", quote_ident(name));
    let Ok(mut statement) = connection.prepare(&sql) else {
        return Vec::new();
    };
    let listed = statement.query_map([], |row| {
        Ok(IndexInfo {
            name: row.get::<_, String>(1)?,
            unique: row.get::<_, i64>(2)? != 0,
            origin: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            partial: row.get::<_, Option<i64>>(4)?.unwrap_or(0) != 0,
            columns: Vec::new(),
        })
    });
    let mut indexes: Vec<IndexInfo> =
        listed.map(|iter| iter.filter_map(Result::ok).collect()).unwrap_or_default();

    for index in &mut indexes {
        let sql = format!("PRAGMA index_info({})", quote_ident(&index.name));
        if let Ok(mut statement) = connection.prepare(&sql) {
            if let Ok(rows) = statement.query_map([], |row| row.get::<_, Option<String>>(2)) {
                index.columns = rows.filter_map(Result::ok).flatten().collect();
            }
        }
    }
    indexes
}

fn foreign_keys_of(connection: &Connection, name: &str) -> Vec<ForeignKeyInfo> {
    let sql = format!("PRAGMA foreign_key_list({})", quote_ident(name));
    let Ok(mut statement) = connection.prepare(&sql) else {
        return Vec::new();
    };
    let rows = statement.query_map([], |row| {
        Ok(ForeignKeyInfo {
            references_table: row.get::<_, String>(2)?,
            column: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            references_column: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
            on_update: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
            on_delete: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
        })
    });
    rows.map(|iter| iter.filter_map(Result::ok).collect()).unwrap_or_default()
}

fn count_rows(connection: &Connection, name: &str) -> Option<i64> {
    connection
        .query_row(&format!("SELECT COUNT(*) FROM {}", quote_ident(name)), [], |row| row.get(0))
        .ok()
}

/// Décrit une base : fichier, tables, vues, colonnes, index, clés étrangères.
pub fn overview(path: &Path) -> Result<DatabaseOverview, String> {
    let connection = open_read_only(path)?;
    let file_size = std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);

    let mut objects: Vec<ObjectInfo> = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT name, type, COALESCE(sql, '') FROM sqlite_master \
                 WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' \
                 ORDER BY type, name",
            )
            .map_err(describe_query_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
            })
            .map_err(describe_query_error)?;

        for row in rows {
            let (name, kind, sql) = row.map_err(describe_query_error)?;
            let is_table = kind == "table";
            objects.push(ObjectInfo {
                rows: if is_table { count_rows(&connection, &name) } else { None },
                columns: columns_of(&connection, &name),
                indexes: if is_table { indexes_of(&connection, &name) } else { Vec::new() },
                foreign_keys: if is_table {
                    foreign_keys_of(&connection, &name)
                } else {
                    Vec::new()
                },
                name,
                kind,
                sql,
            });
        }
    }

    let tables = objects.iter().filter(|object| object.kind == "table").count();
    let views = objects.len() - tables;

    Ok(DatabaseOverview {
        path: path.to_string_lossy().to_string(),
        file_size,
        page_size: scalar_i64(&connection, "page_size"),
        page_count: scalar_i64(&connection, "page_count"),
        encoding: scalar_text(&connection, "encoding"),
        user_version: scalar_i64(&connection, "user_version"),
        application_id: scalar_i64(&connection, "application_id"),
        sqlite_version: rusqlite::version().to_string(),
        integrity: connection
            .query_row("PRAGMA quick_check(1)", [], |row| row.get::<_, String>(0))
            .unwrap_or_else(|error| format!("vérification impossible : {error}")),
        objects,
        tables,
        views,
    })
}

/* ------------------------------------------------------------------------ */
/* Requêtes                                                                  */
/* ------------------------------------------------------------------------ */

/// Une cellule, sans conversion abusive : un BLOB n'est jamais présenté comme
/// du texte, et `NULL` n'est jamais une chaîne vide.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Cell {
    Null,
    Integer { value: i64 },
    Real { value: f64 },
    Text { value: String },
    Blob { preview: BlobPreview },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Cell>>,
    /// Nombre de lignes rendues.
    pub row_count: usize,
    /// Vrai si la limite d'affichage a coupé le résultat.
    pub truncated: bool,
    pub limit: usize,
    pub elapsed_ms: u64,
    /// Requête réellement exécutée, après nettoyage.
    pub sql: String,
}

/// Limite d'affichage par défaut : au-delà, un tableau cesse d'être lisible et
/// la WebView cesse d'être fluide.
pub const DEFAULT_ROW_LIMIT: usize = 500;
/// Plafond absolu, même si l'utilisateur demande davantage.
pub const MAX_ROW_LIMIT: usize = 5000;

fn read_cell(value: ValueRef<'_>) -> Cell {
    match value {
        ValueRef::Null => Cell::Null,
        ValueRef::Integer(value) => Cell::Integer { value },
        ValueRef::Real(value) => Cell::Real { value },
        ValueRef::Text(bytes) => Cell::Text {
            // Une base peut contenir des octets qui ne sont pas de l'UTF-8 dans
            // une colonne texte : on les remplace plutôt que d'échouer.
            value: String::from_utf8_lossy(bytes).into_owned(),
        },
        ValueRef::Blob(bytes) => Cell::Blob { preview: preview_blob(bytes) },
    }
}

/// Exécute une requête de lecture sur une base ouverte en lecture seule.
pub fn run_query(path: &Path, sql: &str, limit: usize) -> Result<QueryResult, String> {
    match classify(sql) {
        StatementKind::Read | StatementKind::ReadPragma(_) => {}
        StatementKind::Refused(reason) => return Err(reason),
    }

    let connection = open_read_only(path)?;
    install_read_only_authorizer(&connection)?;

    let limit = limit.clamp(1, MAX_ROW_LIMIT);
    let started = Instant::now();

    let mut statement = connection.prepare(sql).map_err(describe_query_error)?;
    let columns: Vec<String> =
        statement.column_names().into_iter().map(|name| name.to_string()).collect();
    let width = columns.len();

    let mut rows = Vec::new();
    let mut truncated = false;
    let mut cursor = statement.query([]).map_err(describe_query_error)?;
    while let Some(row) = cursor.next().map_err(describe_query_error)? {
        if rows.len() >= limit {
            truncated = true;
            break;
        }
        let mut cells = Vec::with_capacity(width);
        for index in 0..width {
            cells.push(read_cell(row.get_ref(index).map_err(describe_query_error)?));
        }
        rows.push(cells);
    }

    Ok(QueryResult {
        row_count: rows.len(),
        columns,
        rows,
        truncated,
        limit,
        elapsed_ms: started.elapsed().as_millis() as u64,
        sql: sql.trim().to_string(),
    })
}

/// Requête de consultation d'une table, construite par l'application.
pub fn browse_table(
    path: &Path,
    table: &str,
    limit: usize,
    offset: usize,
) -> Result<QueryResult, String> {
    let sql = format!(
        "SELECT * FROM {} LIMIT {} OFFSET {}",
        quote_ident(table),
        limit.clamp(1, MAX_ROW_LIMIT),
        offset
    );
    run_query(path, &sql, limit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_hostile_identifiers() {
        assert_eq!(quote_ident("users"), "\"users\"");
        assert_eq!(quote_ident("mes \"notes\""), "\"mes \"\"notes\"\"\"");
    }

    #[test]
    fn refuses_a_write_before_touching_the_file() {
        // Le chemin n'existe pas : si le refus venait de l'ouverture et non de
        // la classification, le message parlerait du fichier.
        let error = run_query(Path::new("/introuvable.sqlite"), "DELETE FROM users", 10)
            .unwrap_err();
        assert!(error.contains("DELETE"), "message obtenu : {error}");
    }
}
