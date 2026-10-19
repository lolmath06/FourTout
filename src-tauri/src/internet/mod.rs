//! Socle Internet : le peu de primitives que les outils en ligne partagent.
//!
//! Chaque outil de ce module contacte un serveur **distant**. Ce n'est jamais
//! implicite : une requête ne part que sur une action explicite de
//! l'utilisateur, vers une adresse qu'il a fournie ou un service que l'outil
//! nomme à l'écran. Aucun démon, aucune requête de fond, aucun suivi.

pub mod command;
pub mod download;
pub mod http;
pub mod shorten;
pub mod speedtest;

#[cfg(test)]
pub mod testserver;
