import type { SubtitleCue, SubtitleDocument, SubtitleFormat, SubtitleIssue } from "./types";

/**
 * Lecture des fichiers SRT et WebVTT.
 *
 * Les deux lecteurs travaillent par **blocs** séparés par une ligne vide, et
 * chaque bloc est analysé ligne à ligne. Un horodatage n'est accepté que s'il
 * est reconnu en entier ; rien n'est deviné. Ce qui ne peut pas être lu est
 * signalé (`warnings`) plutôt que corrigé en douce : un fichier abîmé doit se
 * voir, pas disparaître dans une réparation silencieuse.
 */

/** Limite de bon sens : au-delà, l'horodatage est tenu pour aberrant. */
export const MAX_TIMESTAMP_MS = 100 * 3_600_000; // 100 heures

/** Retire la marque d'ordre des octets et normalise les fins de ligne. */
export function normalizeText(input: string): string {
  return input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

/** Le fichier portait-il une marque d'ordre des octets ? */
export function hasBom(input: string): boolean {
  return input.startsWith("\uFEFF");
}

/**
 * `HH:MM:SS,mmm`, `HH:MM:SS.mmm` ou `MM:SS.mmm` → millisecondes.
 * Renvoie `undefined` si la forme n'est pas reconnue ou si la valeur est
 * aberrante (heures, minutes ou secondes hors bornes).
 */
export function parseTimestamp(value: string): number | undefined {
  const match = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(value.trim());
  if (!match) return undefined;
  const hours = match[1] === undefined ? 0 : Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4].padEnd(3, "0"));
  // 90 minutes ou 75 secondes ne sont pas des horodatages : c'est une erreur de
  // production, et l'accepter décalerait tout le reste du fichier.
  if (minutes > 59 || seconds > 59) return undefined;
  const total = hours * 3_600_000 + minutes * 60_000 + seconds * 1000 + millis;
  return total > MAX_TIMESTAMP_MS ? undefined : total;
}

interface TimingLine {
  startMs: number;
  endMs: number;
  settings?: string;
}

/** Analyse une ligne `début --> fin [réglages]`. */
function parseTiming(line: string): TimingLine | undefined {
  const match = /^(\S+)\s*-->\s*(\S+)(?:\s+(.*))?$/.exec(line.trim());
  if (!match) return undefined;
  const startMs = parseTimestamp(match[1]);
  const endMs = parseTimestamp(match[2]);
  if (startMs === undefined || endMs === undefined) return undefined;
  const settings = match[3]?.trim();
  return { startMs, endMs, settings: settings ? settings : undefined };
}

/** Découpe un texte en blocs, en retenant le numéro de la première ligne. */
function blocks(text: string): { lines: string[]; line: number }[] {
  const found: { lines: string[]; line: number }[] = [];
  let current: string[] = [];
  let startLine = 1;

  text.split("\n").forEach((raw, index) => {
    if (raw.trim() === "") {
      if (current.length > 0) {
        found.push({ lines: current, line: startLine });
        current = [];
      }
      startLine = index + 2;
      return;
    }
    if (current.length === 0) startLine = index + 1;
    current.push(raw);
  });
  if (current.length > 0) found.push({ lines: current, line: startLine });
  return found;
}

/** Cœur commun aux deux formats : un bloc → une réplique, ou une anomalie. */
function readBlocks(
  text: string,
  format: SubtitleFormat,
  warnings: SubtitleIssue[],
): SubtitleCue[] {
  const cues: SubtitleCue[] = [];

  for (const block of blocks(text)) {
    let lines = block.lines;
    let identifier: string | undefined;

    // Une première ligne sans `-->` est un identifiant (l'index en SRT, un nom
    // de réplique en WebVTT).
    if (lines.length > 1 && !lines[0].includes("-->")) {
      identifier = lines[0].trim();
      lines = lines.slice(1);
    }

    const timing = parseTiming(lines[0] ?? "");
    if (!timing) {
      warnings.push({
        kind: lines[0]?.includes("-->") ? "invalid-timestamp" : "unparsable-block",
        line: block.line,
        message: lines[0]?.includes("-->")
          ? `Horodatage illisible : « ${lines[0].trim()} »`
          : `Bloc ignoré, aucun horodatage : « ${(lines[0] ?? "").trim()} »`,
      });
      continue;
    }

    const cue: SubtitleCue = {
      startMs: timing.startMs,
      endMs: timing.endMs,
      text: lines.slice(1).join("\n").trim(),
      identifier,
      settings: format === "vtt" ? timing.settings : undefined,
    };

    const position = cues.length + 1;
    if (cue.endMs < cue.startMs) {
      warnings.push({
        kind: "end-before-start",
        cue: position,
        line: block.line,
        message: "La fin précède le début.",
      });
    }
    if (cue.text === "") {
      warnings.push({ kind: "empty-text", cue: position, line: block.line, message: "Réplique sans texte." });
    }
    cues.push(cue);
  }

  return cues;
}

/** Lit un fichier SRT. */
export function parseSrt(input: string): SubtitleDocument {
  const warnings: SubtitleIssue[] = [];
  const cues = readBlocks(normalizeText(input), "srt", warnings);
  return { format: "srt", cues, warnings };
}

/** Lit un fichier WebVTT. */
export function parseVtt(input: string): SubtitleDocument {
  const warnings: SubtitleIssue[] = [];
  let text = normalizeText(input);

  const header = /^WEBVTT[^\n]*\n?/.exec(text);
  if (header) {
    text = text.slice(header[0].length);
  } else {
    warnings.push({
      kind: "missing-header",
      line: 1,
      message: "En-tête WEBVTT absent : le fichier a été lu quand même.",
    });
  }

  // Les blocs NOTE, STYLE et REGION ne sont pas des répliques ; on les écarte
  // avant l'analyse plutôt que de les signaler comme illisibles.
  const kept = text
    .split("\n\n")
    .filter((block) => !/^\s*(NOTE|STYLE|REGION)\b/.test(block))
    .join("\n\n");

  const cues = readBlocks(kept, "vtt", warnings);
  return { format: "vtt", cues, warnings };
}

/** Devine le format d'après le contenu, puis d'après l'extension. */
export function detectFormat(input: string, extension?: string): SubtitleFormat {
  if (/^\uFEFF?WEBVTT/.test(input)) return "vtt";
  const ext = (extension ?? "").replace(/^\./, "").toLowerCase();
  if (ext === "vtt") return "vtt";
  if (ext === "srt") return "srt";
  // Les horodatages WebVTT emploient le point décimal, SRT la virgule.
  return /\d{2}:\d{2}[.]\d{3}\s*-->/.test(input) ? "vtt" : "srt";
}

/** Lit un fichier de sous-titres, format deviné si nécessaire. */
export function parseSubtitles(input: string, extension?: string): SubtitleDocument {
  return detectFormat(input, extension) === "vtt" ? parseVtt(input) : parseSrt(input);
}
