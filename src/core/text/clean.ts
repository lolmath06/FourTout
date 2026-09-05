import { convertLineEndings, detectLineEndings, joinLines, splitLines, type Eol } from "./lines";

/**
 * Nettoyage d'un texte.
 *
 * Règle de conception : **aucune transformation implicite**. Chaque
 * modification correspond à une case cochée par l'utilisateur, et le résultat
 * est comparable au texte d'origine (aperçu avant/après). Un outil de nettoyage
 * qui « range » silencieusement est un outil qui abîme des données.
 */

export interface CleanOptions {
  /** Suites d'espaces/tabulations → un seul espace. */
  collapseSpaces: boolean;
  /** Espaces en début et fin de chaque ligne. */
  trimLines: boolean;
  /** Plusieurs lignes vides consécutives → une seule. */
  collapseBlankLines: boolean;
  /** Supprimer toutes les lignes vides. */
  removeBlankLines: boolean;
  /** Espaces au tout début et à la toute fin du document. */
  trimDocument: boolean;
  /** Apostrophes et guillemets typographiques → apostrophe et guillemets droits. */
  normalizeQuotes: boolean;
  /** Tirets cadratins/demi-cadratins → trait d'union. */
  normalizeDashes: boolean;
  /** Espaces insécables et caractères de largeur nulle. */
  removeInvisible: boolean;
  /** Forme de normalisation Unicode appliquée avant tout le reste. */
  normalizeUnicode: "none" | "NFC" | "NFD" | "NFKC" | "NFKD";
  /** Fin de ligne finale : « keep » ne touche à rien. */
  lineEndings: "keep" | Eol;
}

export const DEFAULT_CLEAN_OPTIONS: CleanOptions = {
  collapseSpaces: true,
  trimLines: true,
  collapseBlankLines: true,
  removeBlankLines: false,
  trimDocument: true,
  normalizeQuotes: false,
  normalizeDashes: false,
  removeInvisible: true,
  normalizeUnicode: "none",
  lineEndings: "keep",
};

export interface TextSize {
  characters: number;
  lines: number;
  words: number;
}

export interface CleanResult {
  text: string;
  before: TextSize;
  after: TextSize;
}

/** Caractères invisibles retirés par l'option « caractères invisibles ». */
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
/** Espaces « exotiques » (insécables, fines, idéographiques) → espace ordinaire. */
const EXOTIC_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;

export function measureText(text: string): TextSize {
  const trimmed = text.trim();
  return {
    characters: text.length,
    lines: detectLineEndings(text).lines,
    words: trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length,
  };
}

export function cleanText(input: string, options: CleanOptions): CleanResult {
  const before = measureText(input);
  let text = input;

  if (options.normalizeUnicode !== "none") {
    text = text.normalize(options.normalizeUnicode);
  }
  if (options.removeInvisible) {
    text = text.replace(ZERO_WIDTH, "").replace(EXOTIC_SPACES, " ");
  }
  if (options.normalizeQuotes) {
    // Les guillemets français encadrent leur contenu d'espaces (souvent
    // insécables) : les convertir sans les retirer produirait « " chaud " ».
    text = text
      .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
      .replace(/\u00AB[\u0020\u00A0\u202F]?/g, '"')
      .replace(/[\u0020\u00A0\u202F]?\u00BB/g, '"')
      .replace(/[\u201C\u201D\u201F\u2033]/g, '"');
  }
  if (options.normalizeDashes) {
    text = text.replace(/[\u2010-\u2015\u2212]/g, "-");
  }

  // À partir d'ici on travaille ligne par ligne : les sauts de ligne d'origine
  // sont préservés jusqu'à l'éventuelle conversion finale.
  const source = splitLines(text);
  let lines = source.lines;

  if (options.collapseSpaces) {
    lines = lines.map((line) => line.replace(/[ \t]{2,}/g, " "));
  }
  if (options.trimLines) {
    lines = lines.map((line) => line.replace(/^[ \t]+|[ \t]+$/g, ""));
  }
  if (options.removeBlankLines) {
    lines = lines.filter((line) => line.trim().length > 0);
  } else if (options.collapseBlankLines) {
    lines = lines.filter(
      (line, index) => line.trim().length > 0 || (lines[index - 1]?.trim().length ?? 1) > 0,
    );
  }

  text = joinLines(lines, source);

  if (options.trimDocument) text = text.trim();
  if (options.lineEndings !== "keep") text = convertLineEndings(text, options.lineEndings);

  return { text, before, after: measureText(text) };
}
