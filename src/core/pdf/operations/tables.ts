import { openWithPdfJs } from "../pdfjs";
import { report, throwIfCancelled } from "../document";
import { PdfError } from "../errors";
import { outputName } from "../filenames";
import { toCsvBytes, type CsvDelimiter } from "@/core/text/csv";
import { createXlsx } from "@/core/files/xlsx";
import type { OperationContext, OutputFile, PdfSource } from "../types";

/**
 * Extraction des tableaux d'un PDF.
 *
 * **Ce que FourTout peut promettre, et ce qu'il ne peut pas.** Un PDF ne
 * contient presque jamais de tableau au sens d'une structure : il contient des
 * fragments de texte à des coordonnées. Les bordures, quand il y en a, sont des
 * traits dessinés, sans lien déclaré avec les cellules. Reconstruire un tableau
 * consiste donc à **déduire** lignes et colonnes de la position du texte.
 *
 * Cette méthode a l'avantage de fonctionner aussi bien sur un tableau quadrillé
 * que sur un tableau sans aucune bordure — seul l'alignement compte. Elle a la
 * limite correspondante : les cellules fusionnées, les tableaux imbriqués et les
 * textes sur plusieurs lignes dans une cellule peuvent demander une retouche.
 * L'outil le dit, et laisse relire avant export.
 */

/** Un fragment de texte positionné, tel que le livre pdf.js. */
export interface PositionedItem {
  text: string;
  /** Bord gauche, en points, origine bas-gauche de la page. */
  x: number;
  /** Ligne de base, en points. */
  y: number;
  width: number;
  height: number;
}

export interface DetectedTable {
  page: number;
  /** Rang du tableau dans la page, base 1. */
  index: number;
  rows: string[][];
  columnCount: number;
  rowCount: number;
  /**
   * Régularité du tableau détecté, de 0 à 1 : part des cellules effectivement
   * remplies. Un tableau très creux est probablement du texte mis en colonnes,
   * pas un tableau — l'interface s'en sert pour tempérer sa présentation.
   */
  fillRatio: number;
}

export interface TableExtractionResult {
  tables: DetectedTable[];
  pageCount: number;
  /** Pages analysées sans qu'aucun tableau n'y soit reconnu. */
  pagesWithoutTable: number[];
}

export interface TableExtractionOptions {
  /** Pages à analyser ; toutes si absent. */
  pages?: readonly number[];
  /** Nombre minimal de lignes pour qu'un groupe soit tenu pour un tableau. */
  minRows?: number;
  /** Nombre minimal de colonnes. */
  minColumns?: number;
}

/* ---------------------------------------------------------- reconstruction */

/**
 * Regroupe les fragments en lignes visuelles.
 *
 * Le critère est la ligne de base : deux fragments dont les lignes de base sont
 * distantes de moins de la moitié d'une hauteur de caractère appartiennent à la
 * même ligne, quelle que soit leur position horizontale.
 */
export function groupIntoRows(items: readonly PositionedItem[]): PositionedItem[][] {
  if (items.length === 0) return [];
  const heights = items.map((item) => item.height).filter((height) => height > 0).sort((a, b) => a - b);
  const medianHeight = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 10;
  const tolerance = Math.max(1, medianHeight * 0.5);

  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PositionedItem[][] = [];

  for (const item of sorted) {
    const current = rows[rows.length - 1];
    if (current && Math.abs(current[0].y - item.y) <= tolerance) current.push(item);
    else rows.push([item]);
  }

  for (const row of rows) row.sort((a, b) => a.x - b.x);
  return rows;
}

/**
 * Déduit les frontières de colonnes à partir des **couloirs verticaux vides**.
 *
 * On projette l'emprise horizontale de tous les fragments sur un axe ; les
 * intervalles que ne couvre aucun fragment, et qui sont assez larges, sont les
 * gouttières entre colonnes. C'est ce qui permet de traiter identiquement un
 * tableau quadrillé et un tableau simplement aligné : dans les deux cas, les
 * colonnes laissent un blanc franc.
 */
export function findColumnBoundaries(
  rows: readonly (readonly PositionedItem[])[],
  minimumGap: number,
): number[] {
  const items = rows.flat();
  if (items.length === 0) return [];

  const left = Math.min(...items.map((item) => item.x));
  const right = Math.max(...items.map((item) => item.x + item.width));
  if (right <= left) return [];

  // Grille au demi-point : assez fine pour séparer deux colonnes serrées, assez
  // grossière pour rester instantanée sur une page dense.
  const step = 0.5;
  const cells = Math.ceil((right - left) / step) + 1;
  const occupied = new Uint8Array(cells);

  for (const item of items) {
    const from = Math.max(0, Math.floor((item.x - left) / step));
    const to = Math.min(cells - 1, Math.ceil((item.x + item.width - left) / step));
    for (let index = from; index <= to; index += 1) occupied[index] = 1;
  }

  const boundaries: number[] = [];
  let runStart = -1;
  for (let index = 0; index < cells; index += 1) {
    if (occupied[index] === 0) {
      if (runStart < 0) runStart = index;
      continue;
    }
    if (runStart >= 0) {
      const width = (index - runStart) * step;
      // Les blancs de bord ne séparent rien.
      if (width >= minimumGap && runStart > 0) {
        boundaries.push(left + ((runStart + index) / 2) * step);
      }
      runStart = -1;
    }
  }

  return boundaries;
}

/** Répartit les fragments d'une ligne dans les colonnes délimitées. */
function rowToCells(row: readonly PositionedItem[], boundaries: readonly number[]): string[] {
  const cells: string[] = new Array(boundaries.length + 1).fill("");
  for (const item of row) {
    // Le centre du fragment, plus stable que son bord gauche pour du texte
    // centré ou aligné à droite dans sa cellule.
    const center = item.x + item.width / 2;
    let column = 0;
    while (column < boundaries.length && center > boundaries[column]) column += 1;
    cells[column] = cells[column] ? `${cells[column]} ${item.text}` : item.text;
  }
  return cells.map((cell) => cell.replace(/\s+/g, " ").trim());
}

/**
 * Reconstruit les tableaux d'une page à partir de ses fragments positionnés.
 *
 * Isolé de pdf.js pour être testable directement, à partir de coordonnées
 * écrites à la main.
 */
export function detectTables(
  items: readonly PositionedItem[],
  page: number,
  options: { minRows?: number; minColumns?: number } = {},
): DetectedTable[] {
  const minRows = options.minRows ?? 2;
  const minColumns = options.minColumns ?? 2;

  const rows = groupIntoRows(items);
  if (rows.length < minRows) return [];

  const heights = items.map((item) => item.height).filter((height) => height > 0);
  const medianHeight =
    heights.length > 0 ? [...heights].sort((a, b) => a - b)[Math.floor(heights.length / 2)] : 10;
  // Une gouttière de colonne fait au moins la largeur de deux espaces ; en
  // dessous, c'est l'espacement normal des mots d'une phrase.
  const minimumGap = Math.max(4, medianHeight * 0.9);

  // Premier tri : une ligne de texte courant — un titre, un paragraphe — ne
  // comporte pas plusieurs fragments séparés. Ces lignes sont écartées avant
  // toute recherche de colonnes, car un titre large **recouvre les
  // gouttières** et empêcherait de les voir.
  const blocks: PositionedItem[][][] = [];
  let current: PositionedItem[][] = [];
  for (const row of rows) {
    if (row.length >= minColumns) current.push(row);
    else {
      if (current.length > 0) blocks.push(current);
      current = [];
    }
  }
  if (current.length > 0) blocks.push(current);

  const tables: DetectedTable[] = [];

  for (const block of blocks) {
    if (block.length < minRows) continue;

    // Les colonnes sont cherchées **dans le bloc seul** : deux tableaux d'une
    // même page peuvent avoir des colonnes différentes, et rien de ce qui les
    // entoure ne doit peser sur leur découpage.
    const boundaries = findColumnBoundaries(block, minimumGap);
    if (boundaries.length < minColumns - 1) continue;

    const grid = block.map((row) => rowToCells(row, boundaries));
    const usable = grid.filter(
      (row) => row.filter((cell) => cell !== "").length >= minColumns,
    );
    if (usable.length < minRows) continue;

    const columnCount = boundaries.length + 1;
    const filled = usable.reduce(
      (total, row) => total + row.filter((cell) => cell !== "").length,
      0,
    );
    tables.push({
      page,
      index: tables.length + 1,
      rows: usable,
      columnCount,
      rowCount: usable.length,
      fillRatio: Number((filled / (usable.length * columnCount)).toFixed(3)),
    });
  }

  return tables;
}

/* ------------------------------------------------------------- extraction */

/** Convertit un élément de texte pdf.js en fragment positionné. */
function toPositionedItem(item: unknown): PositionedItem | undefined {
  if (typeof item !== "object" || item === null || !("str" in item)) return undefined;
  const entry = item as {
    str: string;
    width?: number;
    height?: number;
    transform?: number[];
  };
  const text = entry.str;
  if (!text || !text.trim()) return undefined;
  const transform = entry.transform;
  if (!transform || transform.length < 6) return undefined;
  return {
    text: text.trim(),
    x: transform[4],
    y: transform[5],
    width: entry.width ?? 0,
    // `height` vaut parfois 0 pour un fragment sans dimension déclarée : la
    // matrice de transformation porte alors l'échelle verticale.
    height: entry.height && entry.height > 0 ? entry.height : Math.abs(transform[3]) || 10,
  };
}

/**
 * Extrait les tableaux d'un document. Aucune écriture disque : la relecture
 * comme l'export se font à partir du résultat en mémoire.
 */
export async function extractTables(
  source: PdfSource,
  options: TableExtractionOptions = {},
  context?: OperationContext,
): Promise<TableExtractionResult> {
  const document = await openWithPdfJs(source);
  const tables: DetectedTable[] = [];
  const pagesWithoutTable: number[] = [];
  let pageCount = 0;

  try {
    pageCount = document.numPages;
    const targets =
      options.pages && options.pages.length > 0
        ? [...options.pages]
        : Array.from({ length: pageCount }, (_, index) => index + 1);

    const invalid = targets.filter((page) => page < 1 || page > pageCount);
    if (invalid.length > 0) {
      throw new PdfError("page-out-of-range", `Page(s) inexistante(s) : ${invalid.join(", ")}.`);
    }

    for (const [index, pageNumber] of targets.entries()) {
      throwIfCancelled(context);
      report(context, index / targets.length, `Page ${pageNumber} sur ${targets.length}`);

      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items
        .map(toPositionedItem)
        .filter((item): item is PositionedItem => item !== undefined);
      page.cleanup();

      const found = detectTables(items, pageNumber, options);
      if (found.length === 0) pagesWithoutTable.push(pageNumber);
      tables.push(...found);
    }
  } finally {
    await document.loadingTask?.destroy();
  }

  report(context, 1, "Terminé");

  if (tables.length === 0) {
    throw new PdfError(
      "table-not-found",
      "Aucun alignement en colonnes n'a été reconnu. Un tableau enregistré comme image demande d'abord un PDF recherchable.",
    );
  }

  return { tables, pageCount, pagesWithoutTable };
}

/* ----------------------------------------------------------------- export */

/** Étiquette lisible d'un tableau : « Page 2 — tableau 1 ». */
export function tableLabel(table: DetectedTable): string {
  return `Page ${table.page} — tableau ${table.index}`;
}

/** Un tableau en fichier CSV, encodé en UTF-8. */
export function tableToCsvFile(
  sourceName: string,
  table: DetectedTable,
  options: { delimiter?: CsvDelimiter; bom?: boolean } = {},
): OutputFile {
  return {
    name: outputName(sourceName, `tableau-p${table.page}-${table.index}`, "csv"),
    bytes: toCsvBytes(table.rows, {
      delimiter: options.delimiter ?? ";",
      // Par défaut oui : c'est ce qui fait qu'un « é » s'affiche correctement
      // en ouvrant le fichier dans Excel sous Windows.
      bom: options.bom ?? true,
    }),
    mimeType: "text/csv;charset=utf-8",
  };
}

/** Tous les tableaux dans un classeur, une feuille par tableau. */
export function tablesToXlsxFile(
  sourceName: string,
  tables: readonly DetectedTable[],
): OutputFile {
  if (tables.length === 0) throw new PdfError("table-not-found");
  return {
    name: outputName(sourceName, "tableaux", "xlsx"),
    bytes: createXlsx(
      tables.map((table) => ({
        name: `Page ${table.page} (${table.index})`,
        rows: table.rows,
      })),
    ),
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}
