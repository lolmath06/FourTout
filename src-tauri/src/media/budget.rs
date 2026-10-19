//! Budget de taille : de « moins de 25 Mo » à un débit vidéo et audio.
//!
//! Un encodeur ne sait pas viser un nombre d'octets. Il sait viser un débit, et
//! la taille du fichier est alors `débit × durée`, plus le conteneur, plus
//! l'écart entre le débit demandé et celui que l'encodeur produit réellement.
//! Ce module fait ce calcul, **sans promettre l'octet près** : il réserve une
//! marge, borne les débits, prévient quand la cible est irréaliste, et propose
//! un second essai plus bas si le résultat dépasse quand même.
//!
//! Aucune dépendance à FFmpeg ni à Tauri : des fonctions pures, testées seules.

use serde::{Deserialize, Serialize};

/// Part de la cible réservée à l'imprécision du débit et aux métadonnées.
pub const SAFETY_MARGIN: f64 = 0.06;
/// Surcoût fixe du conteneur (en-têtes, index), en octets.
const CONTAINER_FIXED: f64 = 24.0 * 1024.0;
/// Surcoût proportionnel du conteneur (multiplexage), part du total.
const CONTAINER_RATIO: f64 = 0.01;
/// En deçà, une vidéo n'est plus qu'une suite de blocs : on refuse plutôt que d'essayer.
pub const MIN_VIDEO_KBPS: f64 = 80.0;
/// Au-delà, aucun usage raisonnable : on borne.
pub const MAX_VIDEO_KBPS: f64 = 60_000.0;
pub const MIN_AUDIO_KBPS: f64 = 24.0;
pub const MAX_AUDIO_KBPS: f64 = 192.0;
/// Nombre maximal d'essais d'encodage pour passer sous la cible.
pub const MAX_ATTEMPTS: u32 = 3;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub duration_secs: f64,
    pub has_audio: bool,
    /// Débit vidéo de la source, quand on le connaît : on ne le dépasse jamais.
    pub video_kbps: Option<f64>,
    pub audio_kbps: Option<f64>,
    /// Dimensions de la source : l'image n'est jamais agrandie.
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum Warning {
    /// La cible dépasse ce que la source pèse déjà : rien à réduire.
    AlreadySmaller,
    /// L'image est réduite pour que le débit suffise.
    Downscaled,
    /// Même au débit minimal, la cible n'est pas tenable.
    Impossible,
    /// Le débit est très bas : le résultat sera dégradé.
    VeryLowQuality,
    /// Durée inconnue ou nulle : aucun calcul possible.
    UnknownDuration,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub feasible: bool,
    pub video_kbps: u32,
    pub audio_kbps: u32,
    /// Hauteur cible si l'image doit être réduite (jamais supérieure à la source).
    pub scale_height: Option<u32>,
    /// Taille attendue du fichier, à la marge près.
    pub expected_bytes: u64,
    pub warnings: Vec<Warning>,
}

/// Octets réellement utilisables pour les flux, une fois la marge et le
/// conteneur retirés.
pub fn stream_budget(target_bytes: u64) -> f64 {
    let target = target_bytes as f64;
    (target * (1.0 - SAFETY_MARGIN) - CONTAINER_FIXED - target * CONTAINER_RATIO).max(0.0)
}

/// Débit audio à réserver : celui de la source (sans le dépasser), plafonné par
/// paliers quand le budget total est étroit, pour que le son ne mange pas l'image.
pub fn audio_budget(total_kbps: f64, source_kbps: Option<f64>) -> f64 {
    let wanted = source_kbps.unwrap_or(128.0).clamp(MIN_AUDIO_KBPS, MAX_AUDIO_KBPS);
    let ceiling = match total_kbps {
        t if t < 120.0 => 24.0,
        t if t < 300.0 => 48.0,
        t if t < 700.0 => 64.0,
        t if t < 1500.0 => 96.0,
        _ => 128.0,
    };
    wanted.min(ceiling)
}

/// Débit minimal raisonnable pour garder `pixels` par image à `fps` : environ
/// 0,03 bit par pixel pour du H.264/VP9 de qualité acceptable.
fn needed_kbps(width: f64, height: f64, fps: f64) -> f64 {
    width * height * fps * 0.03 / 1000.0
}

/// Plan d'encodage pour tenir sous `target_bytes`.
pub fn plan(source: &Source, target_bytes: u64) -> Plan {
    let mut warnings = Vec::new();
    if !(source.duration_secs.is_finite() && source.duration_secs > 0.0) {
        return Plan {
            feasible: false,
            video_kbps: 0,
            audio_kbps: 0,
            scale_height: None,
            expected_bytes: 0,
            warnings: vec![Warning::UnknownDuration],
        };
    }

    let budget = stream_budget(target_bytes);
    let total_kbps = budget * 8.0 / source.duration_secs / 1000.0;

    let audio = if source.has_audio { audio_budget(total_kbps, source.audio_kbps) } else { 0.0 };
    let mut video = (total_kbps - audio).min(MAX_VIDEO_KBPS);

    // La source pèse déjà moins que la cible : on ne gonfle jamais un fichier.
    if let Some(source_video) = source.video_kbps {
        let already = (source_video + source.audio_kbps.unwrap_or(0.0) * f64::from(source.has_audio as u8))
            * source.duration_secs
            * 1000.0
            / 8.0;
        if already <= budget && video > source_video {
            warnings.push(Warning::AlreadySmaller);
        }
        video = video.min(source_video.max(MIN_VIDEO_KBPS));
    }

    // Réduction d'image : si le débit ne suffit pas à la définition d'origine,
    // on descend (jamais on ne monte) jusqu'à une hauteur que le débit sait tenir.
    let mut scale_height = None;
    if let (Some(width), Some(height)) = (source.width, source.height) {
        let fps = source.fps.unwrap_or(30.0).clamp(1.0, 60.0);
        let (w, h) = (f64::from(width), f64::from(height));
        if video < needed_kbps(w, h, fps) && h > 144.0 {
            let ratio = (video / needed_kbps(w, h, fps)).sqrt().clamp(0.1, 1.0);
            let ideal = (h * ratio).round();
            // Pas standards, pour des dimensions que les décodeurs aiment.
            let step = [2160.0, 1440.0, 1080.0, 720.0, 480.0, 360.0, 240.0, 144.0]
                .into_iter()
                .find(|&s| s <= ideal)
                .unwrap_or(144.0);
            if step < h {
                scale_height = Some(step as u32);
                warnings.push(Warning::Downscaled);
            }
        }
    }

    let feasible = video >= MIN_VIDEO_KBPS;
    if !feasible {
        warnings.push(Warning::Impossible);
        video = MIN_VIDEO_KBPS;
    } else if video < 200.0 {
        warnings.push(Warning::VeryLowQuality);
    }

    let streams = (video + audio) * 1000.0 / 8.0 * source.duration_secs;
    let expected = streams * (1.0 + CONTAINER_RATIO) + CONTAINER_FIXED;
    Plan {
        feasible,
        video_kbps: video.round() as u32,
        audio_kbps: audio.round() as u32,
        scale_height,
        expected_bytes: expected.round() as u64,
        warnings,
    }
}

/// Plan corrigé après un essai qui a dépassé la cible, ou `None` si l'on a
/// épuisé les essais ou touché le plancher de débit.
pub fn retry(previous: &Plan, produced_bytes: u64, target_bytes: u64, attempt: u32) -> Option<Plan> {
    if attempt >= MAX_ATTEMPTS || produced_bytes <= target_bytes || produced_bytes == 0 {
        return None;
    }
    // Les flux (hors conteneur) doivent rapetisser dans le rapport cible/produit,
    // avec un peu de marge pour ne pas rater de peu une seconde fois.
    let factor = (target_bytes as f64 / produced_bytes as f64 * 0.96).clamp(0.3, 0.98);
    let video = (f64::from(previous.video_kbps) * factor).max(MIN_VIDEO_KBPS);
    if video >= f64::from(previous.video_kbps) - 1.0 {
        return None;
    }
    if (video - MIN_VIDEO_KBPS).abs() < f64::EPSILON && previous.video_kbps == MIN_VIDEO_KBPS as u32 {
        return None;
    }
    let mut next = previous.clone();
    next.video_kbps = video.round() as u32;
    next.expected_bytes = (previous.expected_bytes as f64 * factor) as u64;
    Some(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clip(duration: f64) -> Source {
        Source {
            duration_secs: duration,
            has_audio: true,
            video_kbps: Some(8000.0),
            audio_kbps: Some(128.0),
            width: Some(1920),
            height: Some(1080),
            fps: Some(30.0),
        }
    }

    const MB: u64 = 1_000_000;

    #[test]
    fn a_comfortable_target_keeps_the_full_resolution() {
        // 60 s sous 25 Mo : ~3,3 Mb/s au total, largement de quoi garder du 1080p.
        let plan = plan(&clip(60.0), 25 * MB);
        assert!(plan.feasible);
        assert!(plan.video_kbps > 2000 && plan.video_kbps < 3500, "{plan:?}");
        assert_eq!(plan.audio_kbps, 128);
        assert_eq!(plan.scale_height, None);
        assert!(plan.expected_bytes < 25 * MB, "la marge garde le résultat sous la cible : {}", plan.expected_bytes);
        assert!(plan.expected_bytes > 20 * MB, "mais on n'est pas excessivement prudent");
    }

    #[test]
    fn the_safety_margin_and_container_overhead_are_reserved() {
        let usable = stream_budget(10 * MB);
        assert!(usable < 10.0 * MB as f64 * (1.0 - SAFETY_MARGIN));
        assert!(usable > 8.5 * MB as f64);
        assert_eq!(stream_budget(1000), 0.0, "une cible plus petite que le conteneur ne laisse rien");
    }

    #[test]
    fn audio_never_exceeds_the_source_and_never_eats_a_tight_budget() {
        assert_eq!(audio_budget(5000.0, Some(96.0)), 96.0, "jamais plus que la source");
        assert_eq!(audio_budget(5000.0, Some(320.0)), 128.0, "borné à un maximum raisonnable");
        assert!(audio_budget(5000.0, None) <= 128.0);
        // Budget serré : le son plie avant l'image.
        assert!(audio_budget(100.0, Some(128.0)) <= 32.0);
        assert!(audio_budget(250.0, Some(128.0)) <= 64.0);
        assert!(audio_budget(40.0, Some(128.0)) >= MIN_AUDIO_KBPS);
    }

    #[test]
    fn a_tight_target_downscales_instead_of_producing_mush() {
        // 20 minutes de 1080p sous 25 Mo : ~160 kb/s au total, bien trop peu pour du 1080p.
        let plan = plan(&clip(1200.0), 25 * MB);
        assert!(plan.feasible);
        assert!(plan.video_kbps < 200, "{plan:?}");
        let height = plan.scale_height.expect("réduction proposée");
        assert!(height < 1080 && height >= 240, "{height}");
        assert!(plan.warnings.contains(&Warning::Downscaled));
        assert!(plan.warnings.contains(&Warning::VeryLowQuality));
    }

    #[test]
    fn never_upscales_and_never_inflates_a_small_source() {
        // Source 480p déjà légère, cible large : aucun agrandissement, débit plafonné.
        let small = Source { video_kbps: Some(500.0), width: Some(854), height: Some(480), ..clip(60.0) };
        let plan = plan(&small, 100 * MB);
        assert_eq!(plan.scale_height, None);
        assert!(plan.video_kbps <= 500, "ne dépasse pas la source : {plan:?}");
        assert!(plan.warnings.contains(&Warning::AlreadySmaller));
        // Même quand une réduction est décidée, elle ne dépasse jamais la source.
        let tiny = Source { width: Some(320), height: Some(180), ..clip(3600.0) };
        let reduced = super::plan(&tiny, 20 * MB);
        assert!(reduced.scale_height.is_none_or(|h| h < 180));
    }

    #[test]
    fn an_impossible_target_is_reported_not_attempted() {
        // 3 heures dans 1 Mo : aucun débit n'y tient.
        let plan = plan(&clip(10_800.0), MB);
        assert!(!plan.feasible);
        assert!(plan.warnings.contains(&Warning::Impossible));
        assert_eq!(plan.video_kbps as f64, MIN_VIDEO_KBPS, "plancher, pas zéro");
        // Une cible plus petite que le conteneur l'est aussi.
        assert!(!super::plan(&clip(60.0), 10_000).feasible);
    }

    #[test]
    fn unknown_duration_cannot_be_planned() {
        for duration in [0.0, -3.0, f64::NAN, f64::INFINITY] {
            let plan = plan(&clip(duration), 25 * MB);
            assert!(!plan.feasible, "{duration}");
            assert_eq!(plan.warnings, vec![Warning::UnknownDuration]);
        }
    }

    #[test]
    fn audio_only_sources_get_the_whole_budget() {
        let audio = Source { has_audio: false, ..clip(120.0) };
        let plan = plan(&audio, 5 * MB);
        assert_eq!(plan.audio_kbps, 0);
        assert!(plan.video_kbps > 200);
    }

    #[test]
    fn a_retry_lowers_the_bitrate_in_proportion_and_gives_up_at_the_floor() {
        let first = plan(&clip(60.0), 25 * MB);
        // L'encodeur a produit 28 Mo pour 25 demandés.
        let second = retry(&first, 28 * MB, 25 * MB, 1).expect("nouvel essai");
        assert!(second.video_kbps < first.video_kbps);
        let ratio = f64::from(second.video_kbps) / f64::from(first.video_kbps);
        assert!((0.8..0.93).contains(&ratio), "{ratio}");
        // Sous la cible : rien à refaire.
        assert!(retry(&first, 24 * MB, 25 * MB, 1).is_none());
        // Essais épuisés.
        assert!(retry(&first, 28 * MB, 25 * MB, MAX_ATTEMPTS).is_none());
        // Déjà au plancher : inutile d'insister.
        let mut floor = first.clone();
        floor.video_kbps = MIN_VIDEO_KBPS as u32;
        assert!(retry(&floor, 40 * MB, 25 * MB, 1).is_none());
    }
}
