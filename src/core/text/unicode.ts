/**
 * Normalisation Unicode.
 *
 * Le même mot peut s'écrire de plusieurs façons : « é » en un seul point de
 * code (NFC) ou « e » suivi d'un accent combinant (NFD). Deux fichiers venus
 * de macOS et de Windows peuvent ainsi paraître identiques et ne pas l'être —
 * d'où les comparaisons qui échouent et les noms de fichiers en double.
 */

export type UnicodeForm = "NFC" | "NFD" | "NFKC" | "NFKD";

export const UNICODE_FORM_LABELS: Record<UnicodeForm, string> = {
  NFC: "NFC — composée (recommandée)",
  NFD: "NFD — décomposée",
  NFKC: "NFKC — composée, compatibilité",
  NFKD: "NFKD — décomposée, compatibilité",
};

export interface TextShape {
  /** Unités UTF-16 (la longueur JavaScript). */
  units: number;
  /** Points de code Unicode. */
  codePoints: number;
  /** Caractères perçus par un lecteur (si le moteur sait les segmenter). */
  graphemes?: number;
  /** Taille en octets une fois encodé en UTF-8. */
  bytes: number;
}

export function describeShape(text: string): TextShape {
  const codePoints = [...text].length;
  let graphemes: number | undefined;
  const Segmenter = (Intl as { Segmenter?: new (l?: string, o?: object) => { segment(s: string): Iterable<unknown> } })
    .Segmenter;
  if (typeof Segmenter === "function") {
    graphemes = [...new Segmenter("fr", { granularity: "grapheme" }).segment(text)].length;
  }
  return {
    units: text.length,
    codePoints,
    graphemes,
    bytes: new TextEncoder().encode(text).length,
  };
}

export interface NormalizeResult {
  text: string;
  before: TextShape;
  after: TextShape;
  /** La normalisation a-t-elle changé quelque chose ? */
  changed: boolean;
  /** Le texte était-il déjà dans cette forme ? */
  alreadyNormalized: boolean;
}

export function normalizeUnicode(input: string, form: UnicodeForm): NormalizeResult {
  const text = input.normalize(form);
  return {
    text,
    before: describeShape(input),
    after: describeShape(text),
    changed: text !== input,
    alreadyNormalized: text === input,
  };
}

/** Points de code du texte, pour l'inspection caractère par caractère. */
export function listCodePoints(text: string, limit = 200): { char: string; code: string; name: string }[] {
  const out: { char: string; code: string; name: string }[] = [];
  for (const char of text) {
    if (out.length >= limit) break;
    const point = char.codePointAt(0) ?? 0;
    out.push({
      char,
      code: `U+${point.toString(16).toUpperCase().padStart(4, "0")}`,
      name: categoryOf(point),
    });
  }
  return out;
}

function categoryOf(point: number): string {
  if (point >= 0x0300 && point <= 0x036f) return "accent combinant";
  if (point === 0x00a0) return "espace insécable";
  if (point >= 0x200b && point <= 0x200d) return "largeur nulle";
  if (point === 0xfeff) return "marque d'ordre des octets";
  if (point < 0x20) return "caractère de contrôle";
  return "";
}
