import { StandardFonts, rgb } from "@cantoo/pdf-lib";
import { loadPdf, report, savePdf, throwIfCancelled } from "../document";
import { PdfError } from "../errors";
import { toWinAnsi } from "./documentToPdf";
import { detectImageFormat } from "./imagesToPdf";
import { decodeImage } from "@/core/image/codec";
import type { OperationContext, OutputFile, PdfSource } from "../types";

/**
 * Ajouts de contenu par-dessus un PDF existant : zones de texte et images /
 * signatures. Les positions sont exprimées en fractions de la page (origine
 * haut-gauche), indépendantes de la résolution d'affichage : l'interface place
 * les éléments visuellement, le cœur les inscrit aux mêmes proportions.
 */

/** Zone de texte à ajouter. */
export interface TextBox {
  /** Page 1-based. */
  page: number;
  /** Position de l'ancre (haut-gauche du texte), en fraction de la page. */
  x: number;
  y: number;
  text: string;
  /** Taille en points. */
  size: number;
  color: { r: number; g: number; b: number };
  bold?: boolean;
}

export async function addTextToPdf(
  source: PdfSource,
  boxes: readonly TextBox[],
  context?: OperationContext,
): Promise<OutputFile> {
  const usable = boxes.filter((box) => box.text.trim().length > 0);
  if (usable.length === 0) throw new PdfError("no-pages-selected", "Aucun texte à ajouter.");

  const document = await loadPdf(source);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const pageCount = document.getPageCount();

  for (const [index, box] of usable.entries()) {
    throwIfCancelled(context);
    report(context, index / usable.length, `Zone ${index + 1} sur ${usable.length}`);
    if (box.page < 1 || box.page > pageCount) continue;
    const page = document.getPage(box.page - 1);
    const { width, height } = page.getSize();
    const lines = toWinAnsi(box.text).split("\n");
    lines.forEach((line, lineIndex) => {
      page.drawText(line, {
        x: box.x * width,
        // Origine PDF en bas-gauche : on convertit l'ancre haut-gauche.
        y: height - box.y * height - box.size * (lineIndex + 1),
        size: box.size,
        font: box.bold ? bold : font,
        color: rgb(box.color.r / 255, box.color.g / 255, box.color.b / 255),
      });
    });
  }

  report(context, 1, "Écriture du document");
  return savePdf(document, source.name.replace(/\.pdf$/i, "") + "-annote.pdf");
}

/** Image / signature à déposer sur une page. */
export interface ImagePlacement {
  page: number;
  /** Octets de l'image (PNG, JPEG ou WebP). */
  bytes: Uint8Array;
  /** Coin haut-gauche et taille, en fraction de la page. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function addImageToPdf(
  source: PdfSource,
  placements: readonly ImagePlacement[],
  context?: OperationContext,
): Promise<OutputFile> {
  if (placements.length === 0) throw new PdfError("no-pages-selected", "Aucune image à ajouter.");

  const document = await loadPdf(source);
  const pageCount = document.getPageCount();

  for (const [index, placement] of placements.entries()) {
    throwIfCancelled(context);
    report(context, index / placements.length, `Image ${index + 1} sur ${placements.length}`);
    if (placement.page < 1 || placement.page > pageCount) continue;

    const format = detectImageFormat(placement.bytes);
    let embedded;
    if (format === "png") {
      embedded = await document.embedPng(placement.bytes);
    } else if (format === "jpeg") {
      embedded = await document.embedJpg(placement.bytes);
    } else {
      // WebP ou autre : on transcode en PNG (en conservant la transparence).
      const canvas = await decodeImage(placement.bytes);
      embedded = await document.embedPng(await canvas.encode("png"));
    }

    const page = document.getPage(placement.page - 1);
    const { width, height } = page.getSize();
    page.drawImage(embedded, {
      x: placement.x * width,
      y: height - (placement.y + placement.height) * height,
      width: placement.width * width,
      height: placement.height * height,
    });
  }

  report(context, 1, "Écriture du document");
  return savePdf(document, source.name.replace(/\.pdf$/i, "") + "-image.pdf");
}
