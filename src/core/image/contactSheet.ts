import { getRasterBackend, type RasterCanvas } from "@/core/pdf/raster/types";
import { ImageError } from "./errors";
import type { Rgb } from "./types";

/**
 * Planche-contact : une grille de vignettes sur un fond uni, éventuellement
 * légendée du nom de chaque fichier.
 *
 * Ce n'est pas un éditeur de mise en page. La géométrie est entièrement décrite
 * par `contactSheetLayout`, une fonction d'arithmétique pure : on peut donc
 * prévoir les dimensions de la planche avant de la produire, et un test peut
 * vérifier le calcul sans rien dessiner.
 */

export interface ContactSheetOptions {
  /** Nombre de colonnes (au moins 1). */
  columns: number;
  /** Largeur d'une case de vignette, en pixels. */
  thumbWidth: number;
  /** Espace entre deux cases, en pixels. */
  gap: number;
  /** Marge autour de la grille, en pixels. */
  margin: number;
  /** Couleur de fond de la planche. */
  background: Rgb;
  /** Afficher le nom du fichier sous chaque vignette ? */
  showLabels: boolean;
  /** Couleur du texte des légendes. */
  labelColor: Rgb;
}

export const DEFAULT_CONTACT_SHEET: ContactSheetOptions = {
  columns: 4,
  thumbWidth: 240,
  gap: 12,
  margin: 24,
  background: { r: 255, g: 255, b: 255 },
  showLabels: true,
  labelColor: { r: 60, g: 60, b: 60 },
};

/** Hauteur de la bande de légende, quand elle est affichée. */
export const LABEL_HEIGHT = 22;

export interface ContactSheetLayout {
  width: number;
  height: number;
  columns: number;
  rows: number;
  /** Côté de la case réservée à l'image (hors légende). */
  cellSize: number;
  /** Hauteur totale d'une case, légende comprise. */
  cellHeight: number;
  labelHeight: number;
}

/**
 * Géométrie de la planche.
 *
 * Les cases sont **carrées** : la largeur de vignette choisie donne aussi leur
 * hauteur, et chaque image est inscrite dedans sans déformation ni recadrage.
 * C'est ce qui permet de mélanger des portraits et des panoramas sans que les
 * lignes se décalent — et de prévoir la hauteur de la planche à l'avance.
 */
export function contactSheetLayout(count: number, options: ContactSheetOptions): ContactSheetLayout {
  const columns = Math.max(1, Math.round(options.columns));
  const cellSize = Math.max(1, Math.round(options.thumbWidth));
  const gap = Math.max(0, Math.round(options.gap));
  const margin = Math.max(0, Math.round(options.margin));
  const labelHeight = options.showLabels ? LABEL_HEIGHT : 0;
  const usedColumns = Math.min(columns, Math.max(1, count));
  const rows = Math.max(1, Math.ceil(Math.max(count, 1) / columns));
  const cellHeight = cellSize + labelHeight;

  return {
    width: margin * 2 + usedColumns * cellSize + (usedColumns - 1) * gap,
    height: margin * 2 + rows * cellHeight + (rows - 1) * gap,
    columns: usedColumns,
    rows,
    cellSize,
    cellHeight,
    labelHeight,
  };
}

export interface ContactSheetItem {
  canvas: RasterCanvas;
  /** Nom affiché sous la vignette, si les légendes sont activées. */
  label: string;
}

/**
 * Dimensions d'une image inscrite dans une case carrée, sans déformation.
 * Une image plus petite que la case n'est jamais agrandie : la grossir ne
 * révélerait rien de plus et donnerait une planche trompeuse sur la qualité
 * des originaux.
 */
export function fitInCell(
  width: number,
  height: number,
  cell: number,
): { width: number; height: number } {
  const scale = Math.min(cell / width, cell / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Assemble la planche-contact et renvoie le canvas produit. */
export function buildContactSheet(
  items: readonly ContactSheetItem[],
  options: ContactSheetOptions,
): RasterCanvas {
  const backend = getRasterBackend();
  if (!backend) throw new ImageError("render-unavailable");
  if (items.length === 0) throw new Error("Aucune image à disposer.");

  const layout = contactSheetLayout(items.length, options);
  const sheet = backend.createCanvas(layout.width, layout.height);
  const context = sheet.context as CanvasRenderingContext2D;

  const { background, labelColor } = options;
  context.fillStyle = `rgb(${background.r}, ${background.g}, ${background.b})`;
  context.fillRect(0, 0, layout.width, layout.height);

  const margin = Math.max(0, Math.round(options.margin));
  const gap = Math.max(0, Math.round(options.gap));
  const fontSize = Math.max(9, Math.min(14, Math.round(layout.cellSize / 14)));

  items.forEach((item, index) => {
    const column = index % Math.max(1, Math.round(options.columns));
    const row = Math.floor(index / Math.max(1, Math.round(options.columns)));
    const cellX = margin + column * (layout.cellSize + gap);
    const cellY = margin + row * (layout.cellHeight + gap);

    const fitted = fitInCell(item.canvas.width, item.canvas.height, layout.cellSize);
    const x = cellX + Math.round((layout.cellSize - fitted.width) / 2);
    const y = cellY + Math.round((layout.cellSize - fitted.height) / 2);
    context.drawImage(item.canvas.handle as CanvasImageSource, x, y, fitted.width, fitted.height);

    if (layout.labelHeight > 0) {
      context.fillStyle = `rgb(${labelColor.r}, ${labelColor.g}, ${labelColor.b})`;
      context.font = `${fontSize}px sans-serif`;
      context.textBaseline = "middle";
      context.textAlign = "center";
      const text = ellipsize(context, item.label, layout.cellSize);
      context.fillText(text, cellX + layout.cellSize / 2, cellY + layout.cellSize + layout.labelHeight / 2);
      context.textAlign = "left";
    }
  });

  return sheet;
}

/** Raccourcit un nom trop long au milieu, pour garder l'extension visible. */
function ellipsize(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text;
  let head = text;
  while (head.length > 4 && context.measureText(`${head}…`).width > maxWidth) {
    head = head.slice(0, -1);
  }
  return `${head}…`;
}

/** Ordres de tri proposés pour la planche. */
export type ContactSheetOrder = "dropped" | "name" | "name-desc";

export const CONTACT_SHEET_ORDERS: { value: ContactSheetOrder; label: string }[] = [
  { value: "dropped", label: "Ordre de dépôt" },
  { value: "name", label: "Nom (A → Z)" },
  { value: "name-desc", label: "Nom (Z → A)" },
];

/** Applique un ordre de tri à une liste nommée, sans modifier la source. */
export function sortByOrder<T extends { name: string }>(
  items: readonly T[],
  order: ContactSheetOrder,
): T[] {
  if (order === "dropped") return [...items];
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return order === "name" ? sorted : sorted.reverse();
}
