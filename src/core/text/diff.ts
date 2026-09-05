import { splitLines } from "./lines";

/**
 * Comparaison de deux textes.
 *
 * Algorithme : plus longue sous-séquence commune (LCS) sur les lignes, après
 * retrait du préfixe et du suffixe identiques. Les blocs « supprimé puis
 * ajouté » de même taille sont présentés comme des **modifications**, avec un
 * second passage LCS au niveau des mots : c'est ce qui rend un diff lisible.
 *
 * Aucune dépendance : le diff est une fonction pure, testable, et sert
 * indifféremment le texte, le code et les fichiers déposés.
 */

export type DiffOp = "equal" | "add" | "remove" | "change";

export interface WordPart {
  text: string;
  changed: boolean;
}

export interface DiffRow {
  op: DiffOp;
  /** Numéro de ligne à gauche (1-indexé), absent pour un ajout. */
  left?: number;
  /** Numéro de ligne à droite (1-indexé), absent pour une suppression. */
  right?: number;
  leftText?: string;
  rightText?: string;
  /** Découpage mot à mot, présent uniquement sur les lignes modifiées. */
  leftWords?: WordPart[];
  rightWords?: WordPart[];
}

export interface DiffStats {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
}

export interface DiffResult {
  rows: DiffRow[];
  stats: DiffStats;
  identical: boolean;
  /**
   * Les textes dépassaient la taille où la LCS reste raisonnable : la
   * comparaison a été faite ligne à ligne, sans alignement.
   */
  truncated: boolean;
}

/** Au-delà, la matrice LCS coûterait trop cher : on bascule sur un repli. */
const MAX_LCS_CELLS = 4_000_000;

/** Indices communs entre deux suites, par programmation dynamique. */
function lcsMatrix(a: readonly string[], b: readonly string[]): Uint32Array {
  const height = a.length + 1;
  const width = b.length + 1;
  const table = new Uint32Array(height * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + (j + 1)] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)]);
    }
  }
  return table;
}

interface RawOp {
  op: "equal" | "add" | "remove";
  left?: number;
  right?: number;
  text: string;
}

function lcsOps(a: readonly string[], b: readonly string[], offset = 0): RawOp[] {
  const width = b.length + 1;
  const table = lcsMatrix(a, b);
  const ops: RawOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ op: "equal", left: offset + i, right: offset + j, text: a[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
      ops.push({ op: "remove", left: offset + i, text: a[i] });
      i += 1;
    } else {
      ops.push({ op: "add", right: offset + j, text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) {
    ops.push({ op: "remove", left: offset + i, text: a[i] });
    i += 1;
  }
  while (j < b.length) {
    ops.push({ op: "add", right: offset + j, text: b[j] });
    j += 1;
  }
  return ops;
}

/** Découpe une ligne en mots et séparateurs, pour un diff mot à mot. */
export function tokenizeWords(line: string): string[] {
  return line.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
}

/** Diff mot à mot entre deux lignes. */
export function diffWords(left: string, right: string): { left: WordPart[]; right: WordPart[] } {
  const a = tokenizeWords(left);
  const b = tokenizeWords(right);
  if (a.length * b.length > 250_000) {
    return { left: [{ text: left, changed: true }], right: [{ text: right, changed: true }] };
  }
  const ops = lcsOps(a, b);
  const leftParts: WordPart[] = [];
  const rightParts: WordPart[] = [];
  for (const op of ops) {
    if (op.op === "equal") {
      leftParts.push({ text: op.text, changed: false });
      rightParts.push({ text: op.text, changed: false });
    } else if (op.op === "remove") {
      leftParts.push({ text: op.text, changed: true });
    } else {
      rightParts.push({ text: op.text, changed: true });
    }
  }
  return { left: mergeParts(leftParts), right: mergeParts(rightParts) };
}

function mergeParts(parts: WordPart[]): WordPart[] {
  const merged: WordPart[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last && last.changed === part.changed) last.text += part.text;
    else merged.push({ ...part });
  }
  return merged;
}

export function diffLines(leftText: string, rightText: string): DiffResult {
  const left = splitLines(leftText).lines;
  const right = splitLines(rightText).lines;

  const truncated = (left.length + 1) * (right.length + 1) > MAX_LCS_CELLS;
  const ops = truncated ? naiveOps(left, right) : lcsOps(left, right);

  const rows: DiffRow[] = [];
  const stats: DiffStats = { added: 0, removed: 0, modified: 0, unchanged: 0 };

  // Regroupe les suppressions puis ajouts consécutifs pour les apparier.
  for (let index = 0; index < ops.length; ) {
    const op = ops[index];
    if (op.op === "equal") {
      rows.push({
        op: "equal",
        left: (op.left ?? 0) + 1,
        right: (op.right ?? 0) + 1,
        leftText: op.text,
        rightText: op.text,
      });
      stats.unchanged += 1;
      index += 1;
      continue;
    }

    const removals: RawOp[] = [];
    while (index < ops.length && ops[index].op === "remove") removals.push(ops[index++]);
    const additions: RawOp[] = [];
    while (index < ops.length && ops[index].op === "add") additions.push(ops[index++]);

    const paired = Math.min(removals.length, additions.length);
    for (let k = 0; k < paired; k += 1) {
      const words = diffWords(removals[k].text, additions[k].text);
      rows.push({
        op: "change",
        left: (removals[k].left ?? 0) + 1,
        right: (additions[k].right ?? 0) + 1,
        leftText: removals[k].text,
        rightText: additions[k].text,
        leftWords: words.left,
        rightWords: words.right,
      });
      stats.modified += 1;
    }
    for (let k = paired; k < removals.length; k += 1) {
      rows.push({ op: "remove", left: (removals[k].left ?? 0) + 1, leftText: removals[k].text });
      stats.removed += 1;
    }
    for (let k = paired; k < additions.length; k += 1) {
      rows.push({ op: "add", right: (additions[k].right ?? 0) + 1, rightText: additions[k].text });
      stats.added += 1;
    }
  }

  return {
    rows,
    stats,
    identical: stats.added === 0 && stats.removed === 0 && stats.modified === 0,
    truncated,
  };
}

/** Repli pour les très gros textes : comparaison position par position. */
function naiveOps(a: readonly string[], b: readonly string[]): RawOp[] {
  const ops: RawOp[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    if (i < a.length && i < b.length && a[i] === b[i]) {
      ops.push({ op: "equal", left: i, right: i, text: a[i] });
    } else {
      if (i < a.length) ops.push({ op: "remove", left: i, text: a[i] });
      if (i < b.length) ops.push({ op: "add", right: i, text: b[i] });
    }
  }
  return ops;
}

/** Diff au format unifié (utile pour l'export et les tests). */
export function toUnifiedDiff(result: DiffResult, leftName = "avant", rightName = "après"): string {
  const lines: string[] = [`--- ${leftName}`, `+++ ${rightName}`];
  for (const row of result.rows) {
    if (row.op === "equal") lines.push(` ${row.leftText ?? ""}`);
    else if (row.op === "remove") lines.push(`-${row.leftText ?? ""}`);
    else if (row.op === "add") lines.push(`+${row.rightText ?? ""}`);
    else {
      lines.push(`-${row.leftText ?? ""}`);
      lines.push(`+${row.rightText ?? ""}`);
    }
  }
  return lines.join("\n") + "\n";
}
