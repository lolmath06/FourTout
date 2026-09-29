import type { SubtitleCue, SubtitleFormat, SubtitleIssue } from "./types";

/**
 * Écriture des fichiers SRT et WebVTT.
 *
 * Les sorties sont toujours en UTF-8 sans marque d'ordre des octets et en fins
 * de ligne `\n` : c'est ce que lisent aussi bien VLC que les lecteurs web, et
 * c'est la seule façon d'obtenir un résultat identique sous Fedora et sous
 * Windows. Le texte des répliques, lui, est recopié tel quel — accents,
 * idéogrammes et emoji compris.
 */

const pad = (value: number, size = 2) => String(Math.floor(value)).padStart(size, "0");

function split(ms: number): { h: number; m: number; s: number; ms: number } {
  const total = Math.max(0, Math.round(ms));
  return {
    h: Math.floor(total / 3_600_000),
    m: Math.floor(total / 60_000) % 60,
    s: Math.floor(total / 1000) % 60,
    ms: total % 1000,
  };
}

/** `00:00:02,350` — horodatage SRT (virgule décimale). */
export function formatSrtTimestamp(ms: number): string {
  const { h, m, s, ms: millis } = split(ms);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(millis, 3)}`;
}

/** `00:00:02.350` — horodatage WebVTT (point décimal). */
export function formatVttTimestamp(ms: number): string {
  const { h, m, s, ms: millis } = split(ms);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(millis, 3)}`;
}

/**
 * Écrit un fichier SRT. Les répliques sont renumérotées de 1 à N dans l'ordre
 * fourni : c'est la seule numérotation qu'un lecteur SRT accepte sans broncher.
 */
export function serializeSrt(cues: readonly SubtitleCue[]): string {
  return cues
    .map((cue, index) =>
      [
        String(index + 1),
        `${formatSrtTimestamp(cue.startMs)} --> ${formatSrtTimestamp(cue.endMs)}`,
        cue.text,
        "",
      ].join("\n"),
    )
    .join("\n");
}

/** Écrit un fichier WebVTT, identifiants et réglages de placement conservés. */
export function serializeVtt(cues: readonly SubtitleCue[]): string {
  const blocks = cues.map((cue) => {
    const timing = `${formatVttTimestamp(cue.startMs)} --> ${formatVttTimestamp(cue.endMs)}${
      cue.settings ? ` ${cue.settings}` : ""
    }`;
    // Un identifiant purement numérique venu d'un SRT n'apporte rien en WebVTT
    // et brouille la lecture : on ne le recopie pas.
    const lines = cue.identifier && !/^\d+$/.test(cue.identifier) ? [cue.identifier, timing] : [timing];
    return [...lines, cue.text, ""].join("\n");
  });
  return ["WEBVTT", "", ...blocks].join("\n");
}

export function serialize(cues: readonly SubtitleCue[], format: SubtitleFormat): string {
  return format === "vtt" ? serializeVtt(cues) : serializeSrt(cues);
}

/** Extension et type MIME du format demandé. */
export const SUBTITLE_MIME: Record<SubtitleFormat, string> = {
  srt: "application/x-subrip",
  vtt: "text/vtt",
};

/**
 * Ce qui serait perdu en écrivant ces répliques au format demandé.
 *
 * SRT ne sait porter ni identifiant de réplique ni réglage de placement. Plutôt
 * que de les faire disparaître sans bruit, la conversion le dit — l'utilisateur
 * décide alors s'il conserve le WebVTT d'origine.
 */
export function conversionWarnings(
  cues: readonly SubtitleCue[],
  format: SubtitleFormat,
): SubtitleIssue[] {
  if (format !== "srt") return [];
  const withSettings = cues.filter((cue) => cue.settings).length;
  if (withSettings === 0) return [];
  return [
    {
      kind: "dropped-settings",
      message:
        withSettings === 1
          ? "1 réplique porte un réglage de placement WebVTT (position, alignement) : le format SRT ne sait pas le représenter, il ne sera pas repris."
          : `${withSettings} répliques portent un réglage de placement WebVTT (position, alignement) : le format SRT ne sait pas le représenter, ils ne seront pas repris.`,
    },
  ];
}

/** Nom de sortie : même base, extension du format choisi. */
export function subtitleOutputName(sourceName: string, format: SubtitleFormat, suffix?: string): string {
  const base = sourceName.replace(/\.[^.]+$/, "");
  return `${base}${suffix ? `-${suffix}` : ""}.${format}`;
}
