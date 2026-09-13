//! Explorateur de bases SQLite — **en lecture seule, et pour de vrai**.
//!
//! Un fichier `.sqlite` est souvent la mémoire d'une application : l'historique
//! d'un navigateur, les notes d'un téléphone, la base d'un logiciel de gestion.
//! On vient l'ouvrir pour comprendre, pas pour modifier. Une modification
//! accidentelle y serait d'autant plus grave qu'elle est silencieuse : SQLite
//! n'a pas de corbeille.
//!
//! La lecture seule est donc garantie par trois verrous indépendants, et non
//! par un filtre sur le texte de la requête :
//!
//! 1. **La connexion** est ouverte avec `SQLITE_OPEN_READ_ONLY`. Le moteur
//!    refuse toute écriture au niveau du fichier.
//! 2. **`PRAGMA query_only`** interdit en plus les écritures en mémoire et dans
//!    les bases temporaires.
//! 3. **Un autorisateur** examine chaque action que le moteur s'apprête à
//!    exécuter — pas chaque mot de la requête — et refuse tout ce qui n'est pas
//!    une lecture. C'est lui qui arrête un `INSERT` caché dans un `WITH`, un
//!    `ATTACH` vers un autre fichier ou un `PRAGMA` d'écriture.
//!
//! Le contrôle syntaxique existe malgré tout, mais seulement pour **expliquer**
//! à l'utilisateur ce qui est refusé et pourquoi. Il n'est jamais la défense.

pub mod command;
pub mod guard;
pub mod read;

use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;

/// Les seize premiers octets d'une base SQLite 3.
const MAGIC: &[u8; 16] = b"SQLite format 3\0";

/// Ouvre une base en lecture seule, verrous compris.
pub fn open_read_only(path: &Path) -> Result<Connection, String> {
    check_is_sqlite(path)?;

    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(describe_open_error)?;

    // Deuxième verrou : même si la connexion était ouverte en écriture par
    // erreur, `query_only` refuserait toute modification.
    connection
        .pragma_update(None, "query_only", true)
        .map_err(|error| format!("Impossible de verrouiller la base en lecture seule : {error}"))?;

    Ok(connection)
}

/// Vérifie que le fichier est bien une base SQLite avant d'appeler le moteur.
///
/// Sans ce contrôle, ouvrir un fichier texte renvoie « file is not a database »,
/// un message juste mais opaque, et ouvrir un fichier absent en lecture seule
/// renvoie « unable to open database file », qui ne dit pas lequel des deux
/// problèmes s'est produit.
fn check_is_sqlite(path: &Path) -> Result<(), String> {
    use std::io::Read;

    let mut file = std::fs::File::open(path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => "Ce fichier n'existe pas.".to_string(),
        std::io::ErrorKind::PermissionDenied => {
            "Lecture refusée : le système n'accorde pas l'accès à ce fichier.".to_string()
        }
        other => format!("Fichier illisible ({other})."),
    })?;

    let mut header = [0u8; 16];
    match file.read_exact(&mut header) {
        Ok(()) if &header == MAGIC => Ok(()),
        Ok(()) => Err(header_mismatch()),
        Err(_) => Err(header_mismatch()),
    }
}

fn header_mismatch() -> String {
    "Ce fichier n'est pas une base SQLite : ses premiers octets ne portent pas la signature \
     « SQLite format 3 ». Une base chiffrée (SQLCipher) ou un fichier d'un autre type donnent \
     ce résultat."
        .to_string()
}

fn describe_open_error(error: rusqlite::Error) -> String {
    let text = error.to_string();
    if text.contains("not a database") {
        header_mismatch()
    } else if text.contains("malformed") || text.contains("corrupt") {
        format!(
            "Base illisible : le fichier porte bien la signature SQLite, mais sa structure est \
             abîmée ({text}). Une copie faite pendant une écriture donne souvent ce résultat."
        )
    } else {
        format!("Ouverture impossible : {text}")
    }
}

/// Erreur de moteur rendue lisible, pour ne jamais afficher un message brut
/// dont l'utilisateur ne peut rien faire.
pub fn describe_query_error(error: rusqlite::Error) -> String {
    let text = error.to_string();
    if text.contains("not authorized") {
        "Requête refusée par le verrou de lecture seule : elle tente une opération qui \
         modifierait la base ou ouvrirait un autre fichier."
            .to_string()
    } else if text.contains("no such table") {
        format!("{text}. La liste des tables est affichée à gauche.")
    } else if text.contains("attempt to write a readonly database") {
        "Écriture refusée : la base est ouverte en lecture seule.".to_string()
    } else {
        text
    }
}

/// Aperçu d'un contenu binaire : taille et premiers octets.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobPreview {
    pub size: usize,
    /// Premiers octets en hexadécimal, séparés par des espaces.
    pub hex: String,
    /// Vrai si l'aperçu a été coupé.
    pub truncated: bool,
}

/// Nombre d'octets montrés d'un BLOB. Au-delà, l'aperçu cesse d'informer.
const BLOB_PREVIEW_BYTES: usize = 16;

pub fn preview_blob(bytes: &[u8]) -> BlobPreview {
    let shown = bytes.len().min(BLOB_PREVIEW_BYTES);
    let hex = bytes[..shown]
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ");
    BlobPreview { size: bytes.len(), hex, truncated: bytes.len() > shown }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_a_file_that_is_not_a_database() {
        let dir = std::env::temp_dir().join("fourtout-sqlite-not-a-db");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("notes.txt");
        std::fs::write(&path, b"ceci n'est pas une base").unwrap();
        let error = open_read_only(&path).unwrap_err();
        assert!(error.contains("SQLite format 3"), "message obtenu : {error}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reports_a_missing_file_plainly() {
        let error = open_read_only(Path::new("/introuvable/fourtout.sqlite")).unwrap_err();
        assert!(error.contains("n'existe pas"), "message obtenu : {error}");
    }

    #[test]
    fn previews_a_blob_without_pretending_it_is_text() {
        let preview = preview_blob(&[0x00, 0xFF, 0x10]);
        assert_eq!(preview.hex, "00 FF 10");
        assert_eq!(preview.size, 3);
        assert!(!preview.truncated);

        let long = preview_blob(&[0xAB; 40]);
        assert!(long.truncated);
        assert_eq!(long.size, 40);
    }
}
