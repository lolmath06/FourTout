import { degrees, rgb, StandardFonts, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import { loadPdf, report, savePdf, throwIfCancelled } from "../document";
import { PdfError } from "../errors";
import { outputName } from "../filenames";
import type { OperationContext, OutputFile, PdfSource, Placement } from "../types";

/**
 * Ajouts par-dessus les pages existantes : filigrane texte et numérotation.
 *
 * Les deux dessinent du texte à une position calculée à partir de la taille
 * réelle de chaque page ; le placement est donc correct quelles que soient les
 * dimensions et l'orientation du document.
 */

/** Marge par défaut depuis le bord de page, en points. */
const MARGIN = 32;

export interface WatermarkOptions {
  text: string;
  /** Corps du texte en points. */
  fontSize: number;
  /** Opacité de 0 (invisible) à 1 (opaque). */
  opacity: number;
  placement: Extract<Placement, "center" | "top" | "bottom" | "diagonal">;
  /** Rotation supplémentaire en degrés ; le mode diagonale l'impose à 45°. */
  rotation?: number;
  color?: { r: number; g: number; b: number };
  /** Pages concernées ; toutes si absent. */
  pages?: readonly number[];
}

export async function addWatermark(
  source: PdfSource,
  options: WatermarkOptions,
  context?: OperationContext,
): Promise<OutputFile> {
  if (options.text.trim().length === 0) {
    throw new PdfError("invalid-range", "Le texte du filigrane est vide.");
  }

  const document = await loadPdf(source);
  const font = await document.embedFont(StandardFonts.HelveticaBold);
  const targets = resolveTargets(document.getPageCount(), options.pages);
  const color = options.color ?? { r: 0.45, g: 0.45, b: 0.45 };

  for (const [index, pageNumber] of targets.entries()) {
    throwIfCancelled(context);
    const page = document.getPage(pageNumber - 1);
    drawWatermark(page, font, options, color);
    report(context, index / targets.length, `Page ${pageNumber}`);
  }

  report(context, 1, "Écriture du document");
  return savePdf(document, outputName(source.name, "filigrane"));
}

function drawWatermark(
  page: PDFPage,
  font: PDFFont,
  options: WatermarkOptions,
  color: { r: number; g: number; b: number },
): void {
  const { width, height } = page.getSize();
  const textWidth = font.widthOfTextAtSize(options.text, options.fontSize);
  const textHeight = font.heightAtSize(options.fontSize);

  const angle =
    options.placement === "diagonal" ? 45 : (options.rotation ?? 0);
  const radians = (angle * Math.PI) / 180;

  // Position du coin bas-gauche du texte, calculée pour que le texte soit
  // centré autour du point voulu une fois la rotation appliquée.
  const centerX = width / 2;
  let centerY = height / 2;
  if (options.placement === "top") centerY = height - MARGIN - textHeight / 2;
  if (options.placement === "bottom") centerY = MARGIN + textHeight / 2;

  const dx = (Math.cos(radians) * textWidth - Math.sin(radians) * -textHeight) / 2;
  const dy = (Math.sin(radians) * textWidth + Math.cos(radians) * -textHeight) / 2;

  page.drawText(options.text, {
    x: centerX - dx,
    y: centerY - dy,
    size: options.fontSize,
    font,
    color: rgb(color.r, color.g, color.b),
    opacity: Math.max(0, Math.min(1, options.opacity)),
    rotate: degrees(angle),
  });
}

export type PageNumberFormat = "plain" | "page-n" | "n-of-total";

export type PageNumberPosition = Extract<
  Placement,
  "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right"
>;

export interface PageNumberOptions {
  /** Numéro affiché sur la première page numérotée. */
  startAt: number;
  position: PageNumberPosition;
  format: PageNumberFormat;
  fontSize?: number;
  margin?: number;
  /** Pages à numéroter ; toutes si absent. */
  pages?: readonly number[];
}

/** Construit le libellé d'un numéro de page selon le format demandé. */
export function formatPageNumber(
  value: number,
  total: number,
  format: PageNumberFormat,
): string {
  if (format === "page-n") return `Page ${value}`;
  if (format === "n-of-total") return `${value} / ${total}`;
  return String(value);
}

export async function addPageNumbers(
  source: PdfSource,
  options: PageNumberOptions,
  context?: OperationContext,
): Promise<OutputFile> {
  const document = await loadPdf(source);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const targets = resolveTargets(document.getPageCount(), options.pages);
  const fontSize = options.fontSize ?? 10;
  const margin = options.margin ?? 28;

  for (const [index, pageNumber] of targets.entries()) {
    throwIfCancelled(context);
    const page = document.getPage(pageNumber - 1);
    const { width, height } = page.getSize();

    const label = formatPageNumber(
      options.startAt + index,
      options.startAt + targets.length - 1,
      options.format,
    );
    const textWidth = font.widthOfTextAtSize(label, fontSize);

    const isTop = options.position.startsWith("top");
    const horizontal = options.position.split("-")[1];
    const x =
      horizontal === "left"
        ? margin
        : horizontal === "right"
          ? width - margin - textWidth
          : (width - textWidth) / 2;
    const y = isTop ? height - margin - fontSize : margin;

    page.drawText(label, { x, y, size: fontSize, font, color: rgb(0.2, 0.2, 0.2) });
    report(context, index / targets.length, `Page ${pageNumber}`);
  }

  report(context, 1, "Écriture du document");
  return savePdf(document, outputName(source.name, "numerote"));
}

/** Valide une sélection de pages, ou renvoie toutes les pages du document. */
function resolveTargets(pageCount: number, pages?: readonly number[]): number[] {
  if (pageCount === 0) throw new PdfError("empty-document");
  if (!pages) return Array.from({ length: pageCount }, (_, index) => index + 1);
  if (pages.length === 0) throw new PdfError("no-pages-selected");

  const invalid = pages.filter((page) => page < 1 || page > pageCount);
  if (invalid.length > 0) {
    throw new PdfError("page-out-of-range", `Page(s) inexistante(s) : ${invalid.join(", ")}.`);
  }
  return [...pages];
}
