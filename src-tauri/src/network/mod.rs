//! Sondes réseau **bornées**, destinées au diagnostic local.
//!
//! Trois outils : un ping, un test de ports sur un hôte choisi, une découverte
//! du réseau local. Ils partagent une même discipline, écrite ici une fois pour
//! toutes :
//!
//! - **Rien ne part sans une action explicite.** Aucun écran ne sonde au
//!   chargement ; la découverte annonce sa plage et attend un clic.
//! - **Tout est borné** : 20 paquets pour un ping, 256 ports par lancement,
//!   256 adresses pour une découverte, 16 connexions simultanées.
//! - **Aucune commande système n'est construite à partir d'une saisie.** Tout
//!   passe par des sockets, jamais par un interpréteur de commandes : il n'y a
//!   donc pas de chaîne à échapper, et pas d'injection possible.
//! - **Rien n'est retenu.** Les adresses, les noms et les adresses matérielles
//!   observés ne sont ni enregistrés, ni ajoutés aux récents, ni conservés d'un
//!   lancement à l'autre.
//!
//! Ce qui est délibérément absent : détection de service par bannière,
//! empreinte de système d'exploitation, scan furtif, recherche de
//! vulnérabilités, interrogation d'une base de fabricants sur Internet. Ce sont
//! des outils de reconnaissance offensive.

pub mod cidr;
pub mod command;
pub mod lan;
pub mod ping;
pub mod ports;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Registre des sondes en cours, pour pouvoir les interrompre.
#[derive(Default)]
pub struct NetworkState {
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl NetworkState {
    pub fn register(&self, job_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.jobs.lock().unwrap().insert(job_id.to_string(), flag.clone());
        flag
    }

    pub fn release(&self, job_id: &str) {
        self.jobs.lock().unwrap().remove(job_id);
    }

    pub fn cancel(&self, job_id: &str) {
        if let Some(flag) = self.jobs.lock().unwrap().get(job_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

/// Message renvoyé quand l'utilisateur a interrompu la sonde.
pub const CANCELLED: &str = "cancelled";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProgress {
    pub job_id: String,
    /// Avancement de 0 à 1 ; négatif si le total est inconnu.
    pub ratio: f64,
    pub label: String,
    pub done: u64,
    pub total: u64,
}

/// Publie l'avancement d'une sonde vers l'interface.
pub fn report(app: &AppHandle, job_id: &str, done: usize, total: usize, label: &str) {
    let ratio = if total > 0 { (done as f64 / total as f64).clamp(0.0, 1.0) } else { -1.0 };
    let _ = app.emit(
        "network://progress",
        NetworkProgress {
            job_id: job_id.to_string(),
            ratio,
            label: label.to_string(),
            done: done as u64,
            total: total as u64,
        },
    );
}
