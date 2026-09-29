/**
 * Modèle interne des sous-titres.
 *
 * SRT et WebVTT décrivent la même chose — des répliques horodatées — avec deux
 * grammaires différentes. FourTout les ramène toutes deux à ce modèle, et n'en
 * sort qu'au moment d'écrire un fichier. C'est ce qui permet de décaler, de
 * fusionner et de réparer sans jamais manipuler du texte à coups d'expressions
 * régulières globales : une correction de temps porte sur un nombre, pas sur
 * une chaîne qu'on espère avoir bien reconnue.
 */

export type SubtitleFormat = "srt" | "vtt";

export interface SubtitleCue {
  /** Début en millisecondes depuis le début du média. */
  startMs: number;
  /** Fin en millisecondes. */
  endMs: number;
  /** Texte de la réplique, retours à la ligne compris. */
  text: string;
  /**
   * Identifiant de la réplique. En WebVTT c'est la ligne qui précède
   * l'horodatage ; en SRT, l'index numérique. Conservé tel quel : il peut
   * porter un sens pour l'auteur du fichier.
   */
  identifier?: string;
  /** Réglages de placement WebVTT (`line:90%`, `align:start`…). */
  settings?: string;
}

/** Ce qu'une lecture a pu tirer d'un fichier, défauts compris. */
export interface SubtitleDocument {
  format: SubtitleFormat;
  cues: SubtitleCue[];
  /** Anomalies rencontrées à la lecture, dans l'ordre du fichier. */
  warnings: SubtitleIssue[];
}

export type SubtitleIssueKind =
  | "invalid-timestamp"
  | "end-before-start"
  | "empty-text"
  | "missing-header"
  | "unparsable-block"
  | "overlap"
  | "duplicate"
  | "out-of-order"
  | "dropped-settings";

export interface SubtitleIssue {
  kind: SubtitleIssueKind;
  /** Numéro de réplique concerné (1 = la première), quand il est connu. */
  cue?: number;
  /** Ligne du fichier source, quand elle est connue. */
  line?: number;
  message: string;
}

/** Durée d'une réplique, jamais négative. */
export function cueDuration(cue: SubtitleCue): number {
  return Math.max(0, cue.endMs - cue.startMs);
}

/** Étendue couverte par un ensemble de répliques (début de la 1re → fin de la dernière). */
export function cueSpan(cues: readonly SubtitleCue[]): { startMs: number; endMs: number } | undefined {
  if (cues.length === 0) return undefined;
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;
  for (const cue of cues) {
    if (cue.startMs < startMs) startMs = cue.startMs;
    if (cue.endMs > endMs) endMs = cue.endMs;
  }
  return { startMs, endMs };
}
