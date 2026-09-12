import { cueDuration, cueSpan, type SubtitleCue, type SubtitleIssue } from "./types";

/**
 * Décalage, fusion et normalisation des sous-titres.
 *
 * Toutes ces fonctions renvoient de **nouvelles** répliques ; aucune ne modifie
 * celles qu'on lui donne. La règle qui gouverne le reste : ce qui est
 * mécaniquement sûr est corrigé (l'ordre, la numérotation, les fins de ligne),
 * ce qui demande un arbitrage est signalé (chevauchements, fin avant début,
 * doublons). Réparer un chevauchement, c'est décider à la place de l'auteur
 * quelle réplique doit être raccourcie — ce n'est pas à l'outil de le faire.
 */

/* ---------------------------------------------------------------- décalage */

export interface ShiftResult {
  cues: SubtitleCue[];
  /** Répliques dont le début aurait été négatif et a été ramené à 0. */
  clamped: number;
  /** Répliques entièrement avant 0, donc devenues inutilisables. */
  dropped: number;
}

/**
 * Décale toutes les répliques de `offsetMs` (positif ou négatif).
 *
 * Une réplique dont le début passerait sous zéro est ramenée à 0 **en
 * conservant sa durée** : elle reste visible aussi longtemps qu'avant, ce qui
 * vaut mieux qu'une réplique tronquée à quelques millisecondes. Une réplique
 * dont même la fin tomberait avant 0 n'a plus d'existence possible : elle est
 * écartée, et le rapport le dit.
 */
export function shiftCues(cues: readonly SubtitleCue[], offsetMs: number): ShiftResult {
  const result: SubtitleCue[] = [];
  let clamped = 0;
  let dropped = 0;

  for (const cue of cues) {
    const start = cue.startMs + offsetMs;
    const end = cue.endMs + offsetMs;
    if (end <= 0) {
      dropped += 1;
      continue;
    }
    if (start < 0) {
      clamped += 1;
      result.push({ ...cue, startMs: 0, endMs: Math.max(1, cueDuration(cue)) });
      continue;
    }
    result.push({ ...cue, startMs: start, endMs: end });
  }

  return { cues: result, clamped, dropped };
}

/* ------------------------------------------------------------------ fusion */

export type MergeOrder = "chronological" | "sequential";

export const MERGE_ORDERS: { value: MergeOrder; label: string; hint: string }[] = [
  {
    value: "chronological",
    label: "Trier chronologiquement",
    hint: "Une seule ligne de temps : les répliques des deux fichiers sont entremêlées selon leur horodatage.",
  },
  {
    value: "sequential",
    label: "A puis B, sans trier",
    hint: "Conserve l'ordre d'origine de chaque fichier, A d'abord. Utile quand les horodatages se recouvrent volontairement.",
  },
];

/**
 * Réunit deux séries de répliques en une seule.
 *
 * Fusionner, c'est faire l'**union** des répliques, pas coller leurs textes :
 * deux répliques qui se chevauchent restent deux répliques. Rien n'est supprimé
 * ni combiné — un lecteur affichera les deux, ce qui est exactement ce qu'on
 * attend d'un sous-titrage bilingue ou d'un commentaire ajouté.
 */
export function mergeCues(
  first: readonly SubtitleCue[],
  second: readonly SubtitleCue[],
  order: MergeOrder = "chronological",
): SubtitleCue[] {
  const all = [...first, ...second].map((cue) => ({ ...cue }));
  if (order === "sequential") return all;
  return all.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

/* ----------------------------------------------------------- normalisation */

export interface NormalizeOptions {
  /** Trier les répliques par horodatage croissant. */
  sort: boolean;
  /** Retirer les répliques dont le texte est vide. */
  removeEmpty: boolean;
  /** Retirer les doublons exacts (mêmes horodatages **et** même texte). */
  removeDuplicates: boolean;
  /** Retirer les répliques dont la fin précède le début (donc inaffichables). */
  removeInvalid: boolean;
}

export const DEFAULT_NORMALIZE: NormalizeOptions = {
  sort: true,
  removeEmpty: true,
  removeDuplicates: true,
  removeInvalid: false,
};

/** Constat chiffré sur une série de répliques, avant ou après traitement. */
export interface SubtitleReport {
  cues: number;
  /** Horodatage de début de la première réplique, en ms. */
  firstStartMs?: number;
  /** Horodatage de fin de la dernière réplique, en ms. */
  lastEndMs?: number;
  /** Durée cumulée des répliques, en ms. */
  totalDurationMs: number;
  empty: number;
  /** Répliques dont la fin précède le début. */
  endBeforeStart: number;
  /** Paires de répliques consécutives qui se chevauchent. */
  overlaps: number;
  /** Répliques en double exact. */
  duplicates: number;
  /** Répliques qui ne suivent pas l'ordre chronologique. */
  outOfOrder: number;
}

/** Analyse une série de répliques sans rien y changer : le moteur en validateur. */
export function reportCues(cues: readonly SubtitleCue[]): SubtitleReport {
  const span = cueSpan(cues);
  let empty = 0;
  let endBeforeStart = 0;
  let outOfOrder = 0;
  let totalDurationMs = 0;

  cues.forEach((cue, index) => {
    if (cue.text.trim() === "") empty += 1;
    if (cue.endMs < cue.startMs) endBeforeStart += 1;
    if (index > 0 && cue.startMs < cues[index - 1].startMs) outOfOrder += 1;
    totalDurationMs += cueDuration(cue);
  });

  // Les chevauchements se comptent sur la ligne de temps, donc sur une copie
  // triée : un fichier mal ordonné ne doit pas en inventer.
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  let overlaps = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].startMs < sorted[index - 1].endMs) overlaps += 1;
  }

  const seen = new Set<string>();
  let duplicates = 0;
  for (const cue of cues) {
    const key = `${cue.startMs}|${cue.endMs}|${cue.text}`;
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }

  return {
    cues: cues.length,
    firstStartMs: span?.startMs,
    lastEndMs: span?.endMs,
    totalDurationMs,
    empty,
    endBeforeStart,
    overlaps,
    duplicates,
    outOfOrder,
  };
}

export interface NormalizeResult {
  cues: SubtitleCue[];
  before: SubtitleReport;
  after: SubtitleReport;
  /** Ce qui a été constaté mais **pas** corrigé. */
  remaining: SubtitleIssue[];
  removed: number;
}

/**
 * Remet une série de répliques d'aplomb.
 *
 * Ce qui est corrigé : l'ordre, la numérotation (à l'écriture), les répliques
 * vides et les doublons exacts, si l'utilisateur les a demandés. Ce qui ne
 * l'est jamais tout seul : les chevauchements, dont on se contente de dire
 * combien il y en a.
 */
export function normalizeCues(
  cues: readonly SubtitleCue[],
  options: Partial<NormalizeOptions> = {},
): NormalizeResult {
  const settings = { ...DEFAULT_NORMALIZE, ...options };
  const before = reportCues(cues);

  let working = cues.map((cue) => ({ ...cue, text: cue.text.trim() }));
  if (settings.removeEmpty) working = working.filter((cue) => cue.text !== "");
  if (settings.removeInvalid) working = working.filter((cue) => cue.endMs >= cue.startMs);
  if (settings.removeDuplicates) {
    const seen = new Set<string>();
    working = working.filter((cue) => {
      const key = `${cue.startMs}|${cue.endMs}|${cue.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (settings.sort) working.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const after = reportCues(working);
  const remaining: SubtitleIssue[] = [];
  if (after.overlaps > 0) {
    remaining.push({
      kind: "overlap",
      message:
        `${after.overlaps} chevauchement${after.overlaps > 1 ? "s" : ""} : une réplique commence avant la fin de la précédente. ` +
        "Rien n'a été raccourci — décider laquelle doit céder demande de connaître le contenu.",
    });
  }
  if (after.endBeforeStart > 0) {
    remaining.push({
      kind: "end-before-start",
      message:
        `${after.endBeforeStart} réplique${after.endBeforeStart > 1 ? "s ont" : " a"} une fin antérieure à son début : ` +
        "le lecteur ne l'affichera pas. Corrigez l'horodatage, ou demandez leur suppression.",
    });
  }

  return { cues: working, before, after, remaining, removed: cues.length - working.length };
}
