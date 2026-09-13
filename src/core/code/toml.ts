/**
 * TOML : validation et reformatage.
 *
 * TOML est le format de configuration de Cargo, de pyproject, de Netlify et de
 * beaucoup d'outils modernes. Il est conçu pour être écrit à la main, ce qui
 * veut dire qu'il est aussi cassé à la main : une table redéfinie, un tableau
 * jamais refermé, une date mal écrite.
 *
 * Deux services, et deux seulement :
 *
 * - **Valider** : dire si le document est conforme, et où il ne l'est pas.
 * - **Reformater** : réécrire le document sous une forme canonique.
 *
 * Le reformatage passe par le modèle de données, pas par le texte. Cela garantit
 * que la *signification* est conservée — tables, tableaux de tables, dates,
 * nombres, chaînes multilignes — mais cela signifie aussi, sans détour possible,
 * que **les commentaires et l'ordre d'écriture d'origine sont perdus** : ils
 * n'existent pas dans le modèle de données. L'interface le dit avant, pas après.
 */

import { parse as parseToml, stringify as stringifyToml, TomlDate } from "smol-toml";

export interface TomlPosition {
  /** Ligne, à partir de 1. */
  line: number;
  /** Colonne, à partir de 1. */
  column: number;
}

export interface TomlProblem {
  message: string;
  position?: TomlPosition;
  /** Extrait du document autour de l'erreur, tel que le parseur le rend. */
  excerpt?: string;
}

export interface TomlValidation {
  valid: boolean;
  problem?: TomlProblem;
  /** Statistiques lisibles d'un document valide. */
  summary?: TomlSummary;
}

export interface TomlSummary {
  /** Clés au premier niveau (hors tables). */
  topLevelKeys: number;
  tables: number;
  arraysOfTables: number;
  /** Profondeur maximale d'imbrication des tables. */
  depth: number;
  dates: number;
}

export class TomlFormatError extends Error {
  readonly problem: TomlProblem;
  constructor(problem: TomlProblem) {
    super(problem.message);
    this.name = "TomlFormatError";
    this.problem = problem;
  }
}

/**
 * Avertissement affiché en permanence par l'outil : mieux vaut le dire une fois
 * de trop que laisser quelqu'un écraser un fichier commenté.
 */
export const TOML_COMMENT_NOTE =
  "Le reformatage reconstruit le document à partir de ses données : les valeurs, " +
  "les tables et les types sont conservés à l'identique, mais les commentaires, " +
  "les lignes vides et l'ordre d'écriture d'origine disparaissent. La validation, " +
  "elle, ne touche à rien.";

/** Traduit une erreur du parseur en problème affichable. */
function toProblem(error: unknown): TomlProblem {
  if (!(error instanceof Error)) {
    return { message: "Document TOML illisible." };
  }
  const candidate = error as Error & { line?: number; column?: number; codeblock?: string };
  // `smol-toml` préfixe systématiquement « Invalid TOML document: » et colle le
  // bloc de code au message. On garde la phrase, pas la mise en page.
  const firstLine = error.message.split("\n")[0].trim();
  const message = firstLine.replace(/^Invalid TOML document:\s*/i, "");
  const position =
    typeof candidate.line === "number" && typeof candidate.column === "number"
      ? { line: candidate.line, column: candidate.column }
      : undefined;
  return {
    message: message.length > 0 ? message : "Document TOML invalide.",
    position,
    excerpt: typeof candidate.codeblock === "string" ? candidate.codeblock.trim() : undefined,
  };
}

/** Décrit un document valide, pour donner une prise à la relecture. */
function summarize(value: unknown): TomlSummary {
  let tables = 0;
  let arraysOfTables = 0;
  let dates = 0;
  let depth = 0;

  const isTable = (candidate: unknown): candidate is Record<string, unknown> =>
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate) &&
    !(candidate instanceof Date) &&
    !(candidate instanceof TomlDate);

  // Une seule traversée compte tout : compter à la racine *et* en descendant
  // ferait apparaître chaque tableau de tables deux fois.
  const visit = (node: unknown, level: number) => {
    if (node instanceof TomlDate || node instanceof Date) {
      dates += 1;
      return;
    }
    if (Array.isArray(node)) {
      if (node.some(isTable)) arraysOfTables += 1;
      for (const item of node) visit(item, level);
      return;
    }
    if (!isTable(node)) return;
    depth = Math.max(depth, level);
    for (const child of Object.values(node)) {
      if (isTable(child)) tables += 1;
      visit(child, level + 1);
    }
  };

  visit(value, 0);

  const topLevelKeys = isTable(value)
    ? Object.values(value).filter(
        (child) => !isTable(child) && !(Array.isArray(child) && child.some(isTable)),
      ).length
    : 0;

  return { topLevelKeys, tables, arraysOfTables, depth, dates };
}

/** Vérifie un document TOML sans le modifier. */
export function validateToml(input: string): TomlValidation {
  try {
    const value = parseToml(input);
    return { valid: true, summary: summarize(value) };
  } catch (error) {
    return { valid: false, problem: toProblem(error) };
  }
}

/**
 * Réécrit un document TOML sous forme canonique.
 *
 * Lève `TomlFormatError` si le document n'est pas valide : on ne reformate
 * jamais un document qu'on n'a pas compris entièrement.
 */
export function formatToml(input: string): string {
  let value: unknown;
  try {
    value = parseToml(input);
  } catch (error) {
    throw new TomlFormatError(toProblem(error));
  }
  try {
    return `${stringifyToml(value).trimEnd()}\n`;
  } catch (error) {
    throw new TomlFormatError({
      message:
        error instanceof Error
          ? `Document lu, mais impossible à réécrire : ${error.message}`
          : "Document lu, mais impossible à réécrire.",
    });
  }
}

/** Convertit un TOML valide en JSON indenté (lecture seule, pratique au débogage). */
export function tomlToJson(input: string, indent = 2): string {
  let value: unknown;
  try {
    value = parseToml(input);
  } catch (error) {
    throw new TomlFormatError(toProblem(error));
  }
  return JSON.stringify(
    value,
    (_key, item) => (item instanceof TomlDate || item instanceof Date ? String(item) : item),
    indent,
  );
}

/** Compte les lignes de commentaire, pour chiffrer ce que le reformatage perdra. */
export function countTomlComments(input: string): number {
  let count = 0;
  let inBasicMultiline = false;
  let inLiteralMultiline = false;
  for (const line of input.split(/\r?\n/)) {
    // Les délimiteurs de chaînes multilignes peuvent contenir un `#` qui n'est
    // pas un commentaire : on les suit de loin, mais on les suit.
    const basicDelimiters = (line.match(/"""/g) ?? []).length;
    const literalDelimiters = (line.match(/'''/g) ?? []).length;
    const wasInside = inBasicMultiline || inLiteralMultiline;
    if (!inLiteralMultiline && basicDelimiters % 2 === 1) inBasicMultiline = !inBasicMultiline;
    if (!inBasicMultiline && literalDelimiters % 2 === 1) inLiteralMultiline = !inLiteralMultiline;
    if (wasInside) continue;
    if (/^\s*#/.test(line)) count += 1;
  }
  return count;
}
