//! Commandes Tauri du diagnostic et de la récupération.
//!
//! Toutes les commandes qui lisent un fichier entier sont `async` et déportent
//! leur travail dans `spawn_blocking` : une commande synchrone s'exécuterait
//! sur la boucle d'événements et figerait la fenêtre le temps de l'analyse.
//!
//! Aucune de ces commandes n'ouvre un fichier en écriture à l'emplacement de la
//! source. Les chemins de sortie sont calculés à côté d'elle, sans jamais
//! écraser un fichier existant.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use super::{
    generic, image as image_diag, pdf as pdf_diag, read_all, sha256_of, zip as zip_diag,
    DiagnosticReport, Finding, Health, RepairAction, Repairability,
};
use crate::files::{magic, FilesState, Reporter};

/// Assemble le rapport : constats génériques, puis constats du format.
///
/// Public pour que les tests d'intégration éprouvent **le vrai chemin** — celui
/// qui décide des actions proposées —, et non une reconstitution approchée.
pub fn build_report(path: &Path) -> Result<DiagnosticReport, String> {
    let bytes = read_all(path)?;
    let meta = std::fs::metadata(path).map_err(|e| format!("Fichier illisible : {e}"))?;
    let extension =
        path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let signature = magic::identify(&bytes[..bytes.len().min(magic::HEAD_BYTES)]);

    let (mut findings, generic_details) = generic::diagnose(path, &bytes, &signature, &extension);

    let details = match signature.id {
        "zip" => {
            let (mut specific, zip_details) = zip_diag::diagnose(&bytes);
            findings.append(&mut specific);
            serde_json::json!({ "generic": generic_details, "zip": zip_details })
        }
        "pdf" => {
            let (mut specific, pdf_details) = pdf_diag::diagnose(&bytes);
            findings.append(&mut specific);
            serde_json::json!({ "generic": generic_details, "pdf": pdf_details })
        }
        "png" | "jpg" => {
            let (mut specific, image_details) = image_diag::diagnose(&bytes, signature.id);
            findings.append(&mut specific);
            serde_json::json!({ "generic": generic_details, "image": image_details })
        }
        _ => serde_json::json!({ "generic": generic_details }),
    };

    let actions = actions_for(signature.id, &findings, &details);

    Ok(DiagnosticReport {
        name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        size: meta.len(),
        extension,
        detected: signature.id.to_string(),
        detected_label: signature.label.to_string(),
        extension_matches: magic::extension_matches(
            &signature,
            &path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default(),
        ),
        health: Health::from_findings(&findings),
        sha256: sha256_of(path)?,
        findings,
        actions,
        details,
        path: path.to_string_lossy().to_string(),
    })
}

fn has(findings: &[Finding], code: &str) -> bool {
    findings.iter().any(|finding| finding.code == code)
}

/// Ce que FourTout propose, **uniquement** quand il peut le justifier.
///
/// Un bouton de réparation qui apparaît toujours est un bouton qui ment une
/// fois sur deux : chaque action ci-dessous est conditionnée par un constat
/// précis, et porte la liste de ce qu'elle coûte.
fn actions_for(
    format: &str,
    findings: &[Finding],
    details: &serde_json::Value,
) -> Vec<RepairAction> {
    let mut actions = Vec::new();

    if has(findings, "file.extension-mismatch") {
        actions.push(RepairAction {
            id: "fix-extension".into(),
            title: "Créer une copie avec la bonne extension".into(),
            detail: "Copie identique du fichier, nommée d'après son contenu réel. Les octets ne \
                     sont pas touchés."
                .into(),
            costs: vec![],
            repairability: Repairability::SafeRepair,
            output_extension: String::new(),
        });
    }

    match format {
        "zip" => {
            if has(findings, "zip.trailing-garbage") {
                actions.push(RepairAction {
                    id: "zip-strip-trailing".into(),
                    title: "Retirer les données parasites finales".into(),
                    detail: "Copie de l'archive tronquée juste après sa structure de fin. \
                             Les entrées ne sont ni relues ni réécrites."
                        .into(),
                    costs: vec!["Les octets situés après la fin de l'archive".into()],
                    repairability: Repairability::SafeRepair,
                    output_extension: "zip".into(),
                });
            }
            let damaged = findings.iter().any(|f| f.severity == super::Severity::Error);
            let entries = details
                .get("zip")
                .and_then(|zip| zip.get("localHeaders"))
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0);
            if damaged && entries > 0 {
                actions.push(RepairAction {
                    id: "zip-recover-folder".into(),
                    title: "Extraire les entrées récupérables dans un dossier".into(),
                    detail: "Chaque entrée est retrouvée par son en-tête local, décompressée et \
                             vérifiée par sa somme de contrôle avant d'être écrite."
                        .into(),
                    costs: vec![
                        "Les entrées dont les données compressées sont tronquées".into(),
                        "Les entrées chiffrées, sans le mot de passe".into(),
                    ],
                    repairability: Repairability::RecoverPartial,
                    output_extension: String::new(),
                });
                actions.push(RepairAction {
                    id: "zip-recover-archive".into(),
                    title: "Reconstruire une archive saine".into(),
                    detail: "Nouvelle archive ZIP ne contenant que les entrées effectivement \
                             lues et vérifiées."
                        .into(),
                    costs: vec!["Les entrées irrécupérables n'y figureront pas".into()],
                    repairability: Repairability::RecoverPartial,
                    output_extension: "zip".into(),
                });
            }
        }
        "pdf" => {
            let pdf = details.get("pdf");
            let object_streams = pdf
                .and_then(|value| value.get("objectStreams"))
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            let objects = pdf
                .and_then(|value| value.get("objects"))
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0);
            let signed = pdf
                .and_then(|value| value.get("signed"))
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            let signature_cost = if signed {
                vec!["La signature numérique du document sera invalidée".to_string()]
            } else {
                Vec::new()
            };

            if has(findings, "pdf.trailing-garbage") {
                actions.push(RepairAction {
                    id: "pdf-strip-trailing".into(),
                    title: "Retirer les données parasites finales".into(),
                    detail: "Copie du document tronquée juste après son dernier « %%EOF ». \
                             Aucun objet, aucune page, aucune métadonnée n'est touchée."
                        .into(),
                    costs: signature_cost.clone(),
                    repairability: Repairability::SafeRepair,
                    output_extension: "pdf".into(),
                });
            }
            if findings.iter().any(|f| {
                f.code == "pdf.bad-startxref" && f.repairability == Repairability::SafeRepair
            }) {
                actions.push(RepairAction {
                    id: "pdf-fix-startxref".into(),
                    title: "Corriger le pointeur de table de références".into(),
                    detail: "Copie du document dans laquelle seuls les chiffres suivant \
                             « startxref » changent, pour désigner la table réellement présente."
                        .into(),
                    costs: signature_cost.clone(),
                    repairability: Repairability::SafeRepair,
                    output_extension: "pdf".into(),
                });
            }
            // La reconstruction n'est offerte que si la structure de la source
            // est **prouvée** cohérente : objets complets, références qui
            // aboutissent, pages réellement présentes. Ajouter une table à un
            // document amputé produirait un fichier que certains lecteurs
            // ouvrent, et qui ment sur son contenu.
            let provable = pdf
                .and_then(|value| value.get("structure"))
                .and_then(|structure| structure.get("problems"))
                .and_then(serde_json::Value::as_array)
                .map(|problems| problems.is_empty())
                .unwrap_or(false);

            if objects > 0
                && !object_streams
                && provable
                && (has(findings, "pdf.no-startxref")
                    || has(findings, "pdf.no-eof")
                    || findings.iter().any(|f| {
                        f.code == "pdf.bad-startxref"
                            && f.repairability != Repairability::SafeRepair
                    }))
            {
                actions.push(RepairAction {
                    id: "pdf-rebuild-xref".into(),
                    title: "Reconstruire la table de références".into(),
                    detail: format!(
                        "Le document d'origine est recopié à l'identique, suivi d'une table \
                         construite à partir des {objects} objets réellement trouvés, d'un \
                         trailer et d'un « %%EOF ». Le résultat est ensuite rouvert par le \
                         moteur PDF de FourTout : s'il refuse de le lire, la réparation est \
                         déclarée manquée."
                    ),
                    costs: signature_cost,
                    repairability: Repairability::SafeRepair,
                    output_extension: "pdf".into(),
                });
            }
        }
        "png" | "jpg" => {
            let image = details.get("image");
            let flag = |key: &str| {
                image
                    .and_then(|value| value.get(key))
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false)
            };
            // `recoverable` ne se déduit pas des constats : le moteur a
            // réellement tenté le nettoyage et le décodage. Sans ce fait, un
            // fichier tronqué se voyait offrir un bouton « Récupérer les pixels
            // décodables » alors que le décodeur n'en rendait aucun.
            let recoverable = flag("recoverable");
            let lossless = flag("recoveryLossless");
            let repairable = findings.iter().any(|f| {
                matches!(
                    f.repairability,
                    Repairability::SafeRepair | Repairability::RecoverVisual
                ) && f.code != "file.extension-mismatch"
            });
            if repairable && recoverable {
                let visual = !lossless;
                actions.push(RepairAction {
                    id: "image-recover".into(),
                    title: if visual {
                        "Récupérer les pixels décodables".into()
                    } else {
                        "Réécrire une image saine".into()
                    },
                    detail: if visual {
                        "Les pixels que le décodeur accepte de rendre sont réencodés en PNG sans \
                         perte. C'est l'image qui est sauvée, pas le fichier d'origine."
                            .into()
                    } else {
                        "Les blocs non conformes et les données parasites sont écartés ; les \
                         octets des pixels sont recopiés tels quels."
                            .into()
                    },
                    costs: if visual {
                        vec![
                            "Métadonnées, profil de couleur et miniatures d'origine".into(),
                            "Les lignes d'image que le décodeur ne rend pas".into(),
                        ]
                    } else {
                        vec!["Les métadonnées portées par les blocs écartés".into()]
                    },
                    repairability: if visual {
                        Repairability::RecoverVisual
                    } else {
                        Repairability::SafeRepair
                    },
                    output_extension: "png".into(),
                });
            }
        }
        _ => {}
    }

    actions
}

/* ------------------------------------------------------------------------ */
/* Commandes                                                                 */
/* ------------------------------------------------------------------------ */

/// Diagnostic d'un fichier, quel que soit son type.
#[tauri::command]
pub async fn diagnostics_inspect(path: String) -> Result<DiagnosticReport, String> {
    tauri::async_runtime::spawn_blocking(move || build_report(Path::new(&path)))
        .await
        .unwrap_or_else(|error| Err(format!("Diagnostic interrompu : {error}")))
}

/// Chemin de sortie qui sera employé, calculé sans rien écrire.
///
/// Sert à montrer à l'utilisateur **où** le fichier ira avant qu'il ne clique.
#[tauri::command]
pub fn diagnostics_output_path(path: String, suffix: String, extension: String) -> String {
    super::output_path(Path::new(&path), &suffix, &extension).to_string_lossy().to_string()
}

/// Copie un fichier en lui donnant l'extension de son contenu réel.
#[tauri::command]
pub async fn diagnostics_fix_extension(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = PathBuf::from(&path);
        let head = {
            use std::io::Read;
            let mut file = std::fs::File::open(&source)
                .map_err(|e| format!("Fichier illisible : {e}"))?;
            let mut buffer = vec![0_u8; magic::HEAD_BYTES];
            let read = file.read(&mut buffer).unwrap_or(0);
            buffer.truncate(read);
            buffer
        };
        let signature = magic::identify(&head);
        let output = generic::fix_extension(&source, &signature)?;
        Ok(output.to_string_lossy().to_string())
    })
    .await
    .unwrap_or_else(|error| Err(format!("Copie interrompue : {error}")))
}

/// Retire les données parasites d'une archive ZIP, dans une copie.
#[tauri::command]
pub async fn diagnostics_zip_strip(path: String, destination: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = read_all(Path::new(&path))?;
        zip_diag::strip_trailing(&bytes, Path::new(&destination))
    })
    .await
    .unwrap_or_else(|error| Err(format!("Opération interrompue : {error}")))
}

/// Récupère les entrées lisibles d'une archive abîmée.
#[tauri::command]
pub async fn diagnostics_zip_recover(
    app: AppHandle,
    state: State<'_, FilesState>,
    job_id: String,
    path: String,
    destination: String,
    mode: zip_diag::RecoveryMode,
) -> Result<zip_diag::RecoveryResult, String> {
    let flag = state.register(&job_id);
    let reporter = Reporter::new(app, job_id.clone(), flag);

    let result = tauri::async_runtime::spawn_blocking(move || {
        let bytes = read_all(Path::new(&path))?;
        zip_diag::recover(&bytes, Path::new(&destination), mode, &reporter)
    })
    .await
    .unwrap_or_else(|error| Err(format!("Récupération interrompue : {error}")));

    state.release(&job_id);
    result
}

/// Applique une réparation déterministe à un PDF, dans une copie.
#[tauri::command]
pub async fn diagnostics_pdf_repair(
    path: String,
    action: pdf_diag::PdfRepair,
    destination: String,
) -> Result<pdf_diag::PdfRepairReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = read_all(Path::new(&path))?;
        pdf_diag::repair(&bytes, action, Path::new(&destination))
    })
    .await
    .unwrap_or_else(|error| Err(format!("Réparation interrompue : {error}")))
}

/// Récupère les pixels décodables d'une image, dans un fichier neuf.
#[tauri::command]
pub async fn diagnostics_image_recover(
    path: String,
    destination: String,
) -> Result<image_diag::ImageRecovery, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = PathBuf::from(&path);
        let bytes = read_all(&source)?;
        let signature = magic::identify(&bytes[..bytes.len().min(magic::HEAD_BYTES)]);
        image_diag::recover(&bytes, signature.id, Path::new(&destination))
    })
    .await
    .unwrap_or_else(|error| Err(format!("Récupération interrompue : {error}")))
}

/// Empreinte d'un fichier, pour prouver qu'une opération ne l'a pas touché.
#[tauri::command]
pub async fn diagnostics_sha256(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || sha256_of(Path::new(&path)))
        .await
        .unwrap_or_else(|error| Err(format!("Calcul interrompu : {error}")))
}

/// Supprime un fichier **produit par FourTout**, quand l'utilisateur constate
/// que la réparation n'a pas abouti.
///
/// Refuse tout chemin qui n'a pas été écrit à l'instant par une réparation :
/// c'est une commande de ménage, pas un effaceur.
#[derive(Debug, Serialize, Deserialize)]
pub struct DiscardRequest {
    pub path: String,
}

#[tauri::command]
pub fn diagnostics_discard(request: DiscardRequest) -> Result<(), String> {
    let path = PathBuf::from(&request.path);
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    // Les sorties de FourTout portent toutes un suffixe connu. Sans lui, on
    // refuse : une commande de suppression ne doit pas pouvoir servir à autre
    // chose que défaire ce que l'on vient d'écrire.
    const SUFFIXES: &[&str] =
        &["-repare", "-recuperee", "-type-corrige", "-nettoye", "-reconstruit"];
    if !SUFFIXES.iter().any(|suffix| name.contains(suffix)) {
        return Err(
            "Ce chemin ne correspond pas à un fichier produit par une réparation FourTout."
                .to_string(),
        );
    }
    std::fs::remove_file(&path).map_err(|e| format!("Suppression impossible : {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offers_nothing_on_a_healthy_file() {
        let findings = vec![Finding::info("zip.healthy", "x", "x")];
        let details = serde_json::json!({ "zip": { "localHeaders": 3 } });
        assert!(actions_for("zip", &findings, &details).is_empty());
    }

    #[test]
    fn offers_both_zip_recoveries_when_the_directory_is_gone() {
        let findings = vec![Finding::error(
            "zip.no-eocd",
            "x",
            "x",
            Repairability::RecoverPartial,
        )];
        let details = serde_json::json!({ "zip": { "localHeaders": 4 } });
        let actions = actions_for("zip", &findings, &details);
        let ids: Vec<&str> = actions.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(ids, vec!["zip-recover-folder", "zip-recover-archive"]);
        assert!(actions.iter().all(|a| !a.costs.is_empty()));
    }

    #[test]
    fn never_offers_a_zip_recovery_without_a_single_header() {
        let findings = vec![
            Finding::error("zip.no-eocd", "x", "x", Repairability::RecoverPartial),
            Finding::error("zip.no-local-headers", "x", "x", Repairability::None),
        ];
        let details = serde_json::json!({ "zip": { "localHeaders": 0 } });
        assert!(actions_for("zip", &findings, &details).is_empty());
    }

    /// Document dont la structure est prouvée cohérente.
    fn provable_pdf(object_streams: bool) -> serde_json::Value {
        serde_json::json!({
            "pdf": {
                "objects": 12,
                "objectStreams": object_streams,
                "signed": false,
                "structure": { "problems": [] }
            }
        })
    }

    #[test]
    fn never_offers_to_rebuild_a_pdf_that_hides_objects_in_streams() {
        let findings =
            vec![Finding::error("pdf.no-startxref", "x", "x", Repairability::RecoverPartial)];
        assert!(actions_for("pdf", &findings, &provable_pdf(true)).is_empty());

        let actions = actions_for("pdf", &findings, &provable_pdf(false));
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].id, "pdf-rebuild-xref");
    }

    #[test]
    fn never_offers_to_rebuild_a_pdf_whose_structure_is_not_proven() {
        // Le défaut corrigé ici : un document tronqué au milieu d'un objet se
        // voyait offrir une reconstruction, qui produisait un fichier que
        // certains lecteurs ouvrent — et qui ment sur son contenu.
        let findings =
            vec![Finding::error("pdf.no-startxref", "x", "x", Repairability::RecoverPartial)];
        let truncated = serde_json::json!({
            "pdf": {
                "objects": 3,
                "objectStreams": false,
                "signed": false,
                "structure": { "problems": ["Objet 3 ouvert et jamais refermé."] }
            }
        });
        assert!(actions_for("pdf", &findings, &truncated).is_empty());

        // Et l'absence du constat de structure vaut absence de preuve.
        let unknown = serde_json::json!({
            "pdf": { "objects": 3, "objectStreams": false, "signed": false }
        });
        assert!(actions_for("pdf", &findings, &unknown).is_empty());
    }

    #[test]
    fn never_offers_an_image_recovery_without_a_single_decodable_pixel() {
        // L'autre défaut corrigé : l'écran affichait « Récupérer les pixels
        // décodables » sous un diagnostic qui venait d'annoncer que le décodeur
        // n'en rendait aucun.
        let findings = vec![
            Finding::error("png.truncated", "x", "x", Repairability::RecoverVisual),
            Finding::error("image.no-pixels", "x", "x", Repairability::None),
        ];
        let hopeless = serde_json::json!({
            "image": { "decodes": false, "recoverable": false, "recoveryLossless": false }
        });
        assert!(actions_for("png", &findings, &hopeless).is_empty());
    }

    #[test]
    fn still_offers_a_lossless_rewrite_when_the_pixels_survive() {
        let findings = vec![Finding::warning(
            "png.broken-ancillary-chunk",
            "x",
            "x",
            Repairability::SafeRepair,
        )];
        let salvageable = serde_json::json!({
            "image": { "decodes": true, "recoverable": true, "recoveryLossless": true }
        });
        let actions = actions_for("png", &findings, &salvageable);
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].id, "image-recover");
        assert_eq!(actions[0].repairability, Repairability::SafeRepair);
        assert_eq!(actions[0].title, "Réécrire une image saine");
    }

    #[test]
    fn calls_a_jpeg_recovery_visual_even_when_it_decodes() {
        let findings = vec![Finding::warning(
            "jpeg.trailing-garbage",
            "x",
            "x",
            Repairability::SafeRepair,
        )];
        let jpeg = serde_json::json!({
            "image": { "decodes": true, "recoverable": true, "recoveryLossless": false }
        });
        let actions = actions_for("jpg", &findings, &jpeg);
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].repairability, Repairability::RecoverVisual);
        assert_eq!(actions[0].title, "Récupérer les pixels décodables");
    }

    #[test]
    fn a_signed_pdf_carries_its_cost_on_every_action() {
        let findings =
            vec![Finding::warning("pdf.trailing-garbage", "x", "x", Repairability::SafeRepair)];
        let details = serde_json::json!({
            "pdf": {
                "objects": 3,
                "objectStreams": false,
                "signed": true,
                "structure": { "problems": [] }
            }
        });
        let actions = actions_for("pdf", &findings, &details);
        assert_eq!(actions.len(), 1);
        assert!(actions[0].costs.iter().any(|cost| cost.contains("signature")));
    }

    #[test]
    fn a_lying_extension_is_repairable_on_any_format() {
        let findings =
            vec![Finding::warning("file.extension-mismatch", "x", "x", Repairability::SafeRepair)];
        let actions = actions_for("wav", &findings, &serde_json::json!({}));
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].id, "fix-extension");
        assert!(actions[0].costs.is_empty(), "une copie ne coûte rien");
    }

    #[test]
    fn refuses_to_discard_a_file_it_did_not_write() {
        let error =
            diagnostics_discard(DiscardRequest { path: "/etc/passwd".into() }).unwrap_err();
        assert!(error.contains("produit par une réparation"));
    }
}
