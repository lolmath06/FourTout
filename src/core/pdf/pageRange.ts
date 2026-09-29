import { PdfError } from "./errors";

/**
 * Analyse des sélections de pages, en numérotation humaine (la page 1 est la
 * première). Syntaxe acceptée : `1,3,5`, `1-4`, `1-3,7,10-12`.
 *
 * Tolérances volontaires : espaces libres, points-virgules, tirets longs
 * (fréquents après un copier-coller), plage inversée (`5-3` vaut `3-5`).
 * Ce module est pur : il ne connaît ni pdf-lib ni le DOM.
 */

export interface ParsedRange {
  /** Numéros de page (base 1), triés, sans doublon. */
  pages: number[];
  /** Numéros dans l'ordre saisi, doublons retirés. Utile pour l'extraction. */
  ordered: number[];
}

const SEPARATORS = /[,;\s]+/;
const DASH = "[-–—]";

/**
 * @param input      Sélection saisie par l'utilisateur.
 * @param pageCount  Nombre de pages du document, pour valider les bornes.
 */
export function parsePageRange(input: string, pageCount: number): ParsedRange {
  if (pageCount <= 0) throw new PdfError("empty-document");

  const trimmed = input.trim();
  if (trimmed.length === 0) throw new PdfError("no-pages-selected");

  const ordered: number[] = [];
  const seen = new Set<number>();
  const outOfRange = new Set<number>();

  // « 1 - 3 » doit se lire comme « 1-3 » : on recolle les tirets avant de
  // découper, sinon l'espace ferait de chaque partie un jeton séparé.
  const compact = trimmed.replace(new RegExp(`\\s*(${DASH})\\s*`, "g"), "$1");

  for (const token of compact.split(SEPARATORS).filter(Boolean)) {
    for (const page of parseToken(token, pageCount)) {
      if (page < 1 || page > pageCount) {
        outOfRange.add(page);
        continue;
      }
      if (!seen.has(page)) {
        seen.add(page);
        ordered.push(page);
      }
    }
  }

  if (outOfRange.size > 0) {
    const list = [...outOfRange].sort((a, b) => a - b).join(", ");
    const plural = outOfRange.size > 1 ? "s" : "";
    throw new PdfError(
      "page-out-of-range",
      `Ce document a ${pageCount} page${pageCount > 1 ? "s" : ""} ; page${plural} demandée${plural} : ${list}.`,
    );
  }
  if (ordered.length === 0) throw new PdfError("no-pages-selected");

  return { pages: [...ordered].sort((a, b) => a - b), ordered };
}

function parseToken(token: string, pageCount: number): number[] {
  // « 5- » et « -5 » : jusqu'à la fin / depuis le début.
  const openEnd = token.match(new RegExp(`^(\\d+)${DASH}$`));
  if (openEnd) return sequence(Number(openEnd[1]), pageCount);

  const openStart = token.match(new RegExp(`^${DASH}(\\d+)$`));
  if (openStart) return sequence(1, Number(openStart[1]));

  const range = token.match(new RegExp(`^(\\d+)${DASH}(\\d+)$`));
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    // Plage inversée : on accepte, l'intention est claire.
    return from <= to ? sequence(from, to) : sequence(to, from);
  }

  if (/^\d+$/.test(token)) return [Number(token)];

  throw new PdfError("invalid-range", `« ${token} » n'est pas une page ni une plage valide.`);
}

function sequence(from: number, to: number): number[] {
  const pages: number[] = [];
  for (let page = from; page <= to; page += 1) pages.push(page);
  return pages;
}

/** Sélection inverse : toutes les pages sauf celles indiquées. */
export function invertSelection(pages: readonly number[], pageCount: number): number[] {
  const excluded = new Set(pages);
  const kept: number[] = [];
  for (let page = 1; page <= pageCount; page += 1) {
    if (!excluded.has(page)) kept.push(page);
  }
  return kept;
}

/**
 * Écrit une liste de pages sous forme compacte : `[1,2,3,7]` donne `1-3, 7`.
 * Utilisé pour les libellés d'interface et les noms de fichiers.
 */
export function formatPageRange(pages: readonly number[]): string {
  if (pages.length === 0) return "";
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let previous = sorted[0];

  for (let i = 1; i <= sorted.length; i += 1) {
    const current = sorted[i];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    parts.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = current;
    previous = current;
  }
  return parts.join(", ");
}

/** Découpe une sélection en groupes contigus : `1-3, 5` donne `[[1,2,3],[5]]`. */
export function splitIntoChunks(pages: readonly number[]): number[][] {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const chunks: number[][] = [];
  let current: number[] = [];

  for (const page of sorted) {
    if (current.length === 0 || page === current[current.length - 1] + 1) current.push(page);
    else {
      chunks.push(current);
      current = [page];
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Analyse une syntaxe de découpage : `1-3, 4-5, 6` produit un fichier par
 * groupe, contrairement à `parsePageRange` qui fusionne tout en une sélection.
 */
export function parseSplitGroups(input: string, pageCount: number): number[][] {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new PdfError("no-pages-selected");

  const groups: number[][] = [];
  for (const token of trimmed.split(/[,;]+/).map((t) => t.trim()).filter(Boolean)) {
    const { pages } = parsePageRange(token, pageCount);
    groups.push(pages);
  }
  if (groups.length === 0) throw new PdfError("no-pages-selected");
  return groups;
}
