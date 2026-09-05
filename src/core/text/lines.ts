/**
 * Découpage et recomposition de lignes.
 *
 * Toutes les opérations « lignes » de FourTout passent par ici : la façon de
 * couper un texte (et de le recoller sans lui ajouter ni lui retirer un saut
 * de ligne final) ne doit exister qu'à un seul endroit.
 */

/** Fins de ligne reconnues. */
export type Eol = "lf" | "crlf" | "cr";

export const EOL_CHARS: Record<Eol, string> = { lf: "\n", crlf: "\r\n", cr: "\r" };

export interface SplitText {
  lines: string[];
  /** Le texte se terminait-il par un saut de ligne ? */
  trailingNewline: boolean;
  /** Fin de ligne majoritaire du texte d'origine. */
  eol: Eol;
}

/** Coupe un texte en lignes, quelle que soit sa convention de fin de ligne. */
export function splitLines(input: string): SplitText {
  const eol = detectLineEndings(input).dominant;
  const trailingNewline = /(\r\n|\n|\r)$/.test(input);
  const body = trailingNewline ? input.replace(/(\r\n|\n|\r)$/, "") : input;
  return { lines: body.length === 0 ? [] : body.split(/\r\n|\n|\r/), trailingNewline, eol };
}

/** Recolle des lignes en respectant la forme du texte d'origine. */
export function joinLines(lines: readonly string[], source: SplitText, eol?: Eol): string {
  const separator = EOL_CHARS[eol ?? source.eol];
  const body = lines.join(separator);
  return source.trailingNewline && lines.length > 0 ? body + separator : body;
}

export interface LineEndingReport {
  lf: number;
  crlf: number;
  cr: number;
  /** Convention majoritaire (LF par défaut si le texte n'a aucun saut). */
  dominant: Eol;
  /** Le texte mélange-t-il plusieurs conventions ? */
  mixed: boolean;
  lines: number;
}

/** Compte les fins de ligne de chaque type. */
export function detectLineEndings(input: string): LineEndingReport {
  const crlf = (input.match(/\r\n/g) ?? []).length;
  const lf = (input.match(/(?<!\r)\n/g) ?? []).length;
  const cr = (input.match(/\r(?!\n)/g) ?? []).length;
  const kinds = [
    ["crlf", crlf],
    ["lf", lf],
    ["cr", cr],
  ] as const;
  const present = kinds.filter(([, count]) => count > 0);
  const dominant = present.length === 0
    ? "lf"
    : present.reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
  const total = crlf + lf + cr;
  return {
    lf,
    crlf,
    cr,
    dominant,
    mixed: present.length > 1,
    lines: input.length === 0 ? 0 : total + (/(\r\n|\n|\r)$/.test(input) ? 0 : 1),
  };
}

/** Réécrit toutes les fins de ligne dans la convention demandée. */
export function convertLineEndings(input: string, to: Eol): string {
  return input.replace(/\r\n|\n|\r/g, EOL_CHARS[to]);
}

/* ------------------------------------------------------------ doublons */

export interface DedupeOptions {
  /** « Paris » et « paris » sont-elles deux lignes différentes ? */
  caseSensitive: boolean;
  /** Ignorer les espaces de début et de fin lors de la comparaison. */
  trimComparison: boolean;
  /** Occurrence conservée lorsqu'une ligne apparaît plusieurs fois. */
  keep: "first" | "last";
  /** Laisser les lignes vides telles quelles (ne jamais les dédupliquer). */
  ignoreBlank: boolean;
}

export const DEFAULT_DEDUPE_OPTIONS: DedupeOptions = {
  caseSensitive: false,
  trimComparison: true,
  keep: "first",
  ignoreBlank: true,
};

export interface DedupeResult {
  text: string;
  linesBefore: number;
  linesAfter: number;
  removed: number;
}

function comparisonKey(line: string, options: DedupeOptions): string {
  const trimmed = options.trimComparison ? line.trim() : line;
  return options.caseSensitive ? trimmed : trimmed.toLocaleLowerCase("fr");
}

/** Ne conserve qu'une occurrence de chaque ligne. */
export function deduplicateLines(input: string, options: DedupeOptions): DedupeResult {
  const source = splitLines(input);
  const seen = new Set<string>();
  const kept: string[] = [];

  const ordered = options.keep === "last" ? [...source.lines].reverse() : source.lines;
  for (const line of ordered) {
    if (options.ignoreBlank && line.trim().length === 0) {
      kept.push(line);
      continue;
    }
    const key = comparisonKey(line, options);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
  }
  if (options.keep === "last") kept.reverse();

  return {
    text: joinLines(kept, source),
    linesBefore: source.lines.length,
    linesAfter: kept.length,
    removed: source.lines.length - kept.length,
  };
}

/* ----------------------------------------------------------------- tri */

export type SortMode =
  | "alpha-asc"
  | "alpha-desc"
  | "numeric-asc"
  | "numeric-desc"
  | "length-asc"
  | "length-desc"
  | "shuffle"
  | "reverse";

export const SORT_LABELS: Record<SortMode, string> = {
  "alpha-asc": "A → Z",
  "alpha-desc": "Z → A",
  "numeric-asc": "Numérique croissant",
  "numeric-desc": "Numérique décroissant",
  "length-asc": "Longueur croissante",
  "length-desc": "Longueur décroissante",
  shuffle: "Aléatoire",
  reverse: "Inverser l'ordre",
};

export interface SortOptions {
  mode: SortMode;
  caseSensitive: boolean;
  /** Conserver les lignes vides (sinon elles sont retirées). */
  keepBlank: boolean;
}

/** Premier nombre trouvé dans une ligne, `NaN` s'il n'y en a pas. */
export function leadingNumber(line: string): number {
  const match = line.match(/-?\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : Number.NaN;
}

/** Trie des lignes selon un mode. `random` est injectable pour les tests. */
export function sortLines(
  input: string,
  options: SortOptions,
  random: () => number = Math.random,
): { text: string; linesBefore: number; linesAfter: number } {
  const source = splitLines(input);
  const linesBefore = source.lines.length;
  const lines = options.keepBlank
    ? [...source.lines]
    : source.lines.filter((line) => line.trim().length > 0);

  const collator = new Intl.Collator("fr", {
    sensitivity: options.caseSensitive ? "variant" : "base",
    numeric: false,
  });

  switch (options.mode) {
    case "alpha-asc":
      lines.sort((a, b) => collator.compare(a, b));
      break;
    case "alpha-desc":
      lines.sort((a, b) => collator.compare(b, a));
      break;
    case "numeric-asc":
    case "numeric-desc": {
      // Les lignes sans nombre restent groupées à la fin, dans leur ordre.
      const withNumber = lines.filter((line) => !Number.isNaN(leadingNumber(line)));
      const without = lines.filter((line) => Number.isNaN(leadingNumber(line)));
      withNumber.sort((a, b) =>
        options.mode === "numeric-asc"
          ? leadingNumber(a) - leadingNumber(b)
          : leadingNumber(b) - leadingNumber(a),
      );
      lines.length = 0;
      lines.push(...withNumber, ...without);
      break;
    }
    case "length-asc":
      lines.sort((a, b) => a.length - b.length || collator.compare(a, b));
      break;
    case "length-desc":
      lines.sort((a, b) => b.length - a.length || collator.compare(a, b));
      break;
    case "shuffle":
      for (let i = lines.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [lines[i], lines[j]] = [lines[j], lines[i]];
      }
      break;
    case "reverse":
      lines.reverse();
      break;
  }

  return { text: joinLines(lines, source), linesBefore, linesAfter: lines.length };
}
