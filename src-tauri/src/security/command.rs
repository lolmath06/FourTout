//! Commande Tauri de vérification de signature JWT.
//!
//! La clé traverse le pont IPC et n'est ni journalisée, ni conservée, ni
//! renvoyée : elle sert au calcul et disparaît avec la pile d'appel.

use super::jwt::{verify, Algorithm};

/// Vérifie la signature d'un JWT avec l'algorithme **choisi par l'utilisateur**.
///
/// L'en-tête du token n'est pas consulté ici : c'est l'appelant qui a comparé
/// l'algorithme attendu à celui annoncé et refusé les divergences.
#[tauri::command]
pub fn security_jwt_verify(
    algorithm: String,
    signing_input: String,
    signature: String,
    key: String,
) -> Result<bool, String> {
    let algorithm = Algorithm::parse(&algorithm)?;
    verify(algorithm, &signing_input, &signature, &key)
}
