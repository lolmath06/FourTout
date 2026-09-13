//! Primitives de sécurité qui doivent rester hors de la WebView.
//!
//! Un seul service pour l'instant : refaire le calcul de signature d'un JWT.
//! Il vit côté natif pour deux raisons. D'abord parce que la boîte à outils
//! cryptographique y est déjà présente et éprouvée (`hmac`, `sha2`), ensuite
//! parce que `crypto.subtle` n'est pas garanti dans une WebView servie par un
//! protocole personnalisé : faire dépendre une vérification de signature de la
//! disponibilité d'une API navigateur serait une fragilité inutile.

pub mod command;
pub mod jwt;
