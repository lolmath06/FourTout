//! Récupération locale de mot de passe PDF par dictionnaire et règles.

pub mod command;
pub mod engine;
pub mod wordlist;
pub mod rules;
pub mod verifier;
#[cfg(test)]
mod bench;
