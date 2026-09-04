import type { ExtractedPageText } from "@/core/pdf/operations/extractText";

/**
 * Préparation du texte d'un PDF avant lecture à voix haute.
 *
 * Un PDF lu tel quel fait dire au moteur les numéros de page et l'en-tête
 * répété à chaque page. On les retire, mais **prudemment** : seules les lignes
 * courtes, isolées et effectivement répétées d'une page à l'autre sont
 * écartées. Rien de long n'est jamais supprimé — mieux vaut lire une ligne de
 * trop que perdre une phrase.
 */

/** Une ligne qui n'est qu'un numéro de page (« 12 », « - 12 - », « 3 / 40 »). */
function isPageNumber(line: string): boolean {
  return /^[-–—\s]*(?:page\s*)?\d{1,4}(?:\s*[/|sur]{1,3}\s*\d{1,4})?[-–—\s]*$/i.test(line);
}

/** Normalise une ligne pour comparer d'une page à l'autre (numéros ignorés). */
function fingerprint(line: string): string {
  return line
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

/** Longueur au-delà de laquelle une ligne est du contenu, jamais un ornement. */
const ORNAMENT_MAX_CHARS = 80;

/**
 * Repère les en-têtes et pieds de page : lignes courtes présentes en **première
 * ou dernière** position sur la majorité des pages. Il en faut au moins trois
 * pour conclure. On s'en tient strictement aux bords : une ligne juste en
 * dessous d'un en-tête est du contenu, et l'empreinte masque les chiffres —
 * élargir la fenêtre reviendrait à supprimer des phrases qui ne diffèrent que
 * par un numéro.
 */
function repeatedOrnaments(pages: readonly string[][]): Set<string> {
  const found = new Set<string>();
  if (pages.length < 3) return found;

  const counts = new Map<string, number>();
  for (const lines of pages) {
    const candidates = new Set<string>();
    for (const line of [lines[0], lines[lines.length - 1]]) {
      if (line && line.length <= ORNAMENT_MAX_CHARS) candidates.add(fingerprint(line));
    }
    for (const candidate of candidates) {
      counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
    }
  }

  const threshold = Math.max(3, Math.ceil(pages.length * 0.6));
  for (const [key, count] of counts) {
    if (key && count >= threshold) found.add(key);
  }
  return found;
}

export interface CleanPdfTextResult {
  text: string;
  /** Nombre de lignes écartées (numéros de page, en-têtes répétés). */
  removedLines: number;
}

/**
 * Assemble le texte lisible d'un PDF : lignes nettoyées, paragraphes conservés.
 */
export function cleanPdfText(pages: readonly ExtractedPageText[]): CleanPdfTextResult {
  const split = pages.map((page) =>
    page.text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );

  const ornaments = repeatedOrnaments(split);
  let removedLines = 0;

  const cleanedPages = split.map((lines) => {
    const kept = lines.filter((line, index) => {
      // Un ornement est court ET en bordure de page. Un « 2026 » au milieu
      // d'un paragraphe est du contenu : il est lu.
      const short = line.length <= ORNAMENT_MAX_CHARS;
      const atEdge = index === 0 || index === lines.length - 1;
      if (!short || !atEdge) return true;
      if (isPageNumber(line) || ornaments.has(fingerprint(line))) {
        removedLines += 1;
        return false;
      }
      return true;
    });
    return kept.join("\n");
  });

  const text = cleanedPages
    .filter((page) => page.trim().length > 0)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, removedLines };
}
