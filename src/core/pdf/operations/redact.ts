import { PDFDocument } from "@cantoo/pdf-lib";
import { loadPdf, report, throwIfCancelled } from "../document";
import { outputName } from "../filenames";
import { PdfError } from "../errors";
import { pdfToImages } from "./toImages";
import { decodeImage } from "@/core/image/codec";
import type { OperationContext, OutputFile, PdfSource } from "../types";

/**
 * Caviardage réel d'un PDF.
 *
 * Le piège classique — dessiner un rectangle noir par-dessus un texte qui reste
 * extractible dessous — est évité par construction : chaque page contenant une
 * zone à masquer est **rendue en image**, les rectangles sont peints sur ces
 * pixels (le texte devient donc des pixels puis est recouvert), et la page est
 * reconstruite à partir de cette image. Une page caviardée n'a plus aucune
 * couche de texte : le contenu masqué n'est plus récupérable.
 *
 * Les pages sans zone à masquer restent inchangées (vectorielles, texte
 * sélectionnable). L'opération est irréversible sur le fichier produit.
 */

/** Rectangle normalisé : fractions de 0 à 1 de la page, origine haut-gauche. */
export interface RedactRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageRedaction {
  /** Numéro de page (1-based). */
  page: number;
  rects: RedactRect[];
}

export interface RedactOptions {
  /** Résolution de rastérisation des pages caviardées, en ppp. */
  dpi?: number;
}

export async function redactPdf(
  source: PdfSource,
  redactions: readonly PageRedaction[],
  options: RedactOptions = {},
  context?: OperationContext,
): Promise<OutputFile> {
  const withRects = redactions.filter((r) => r.rects.length > 0);
  if (withRects.length === 0) {
    throw new PdfError("no-pages-selected", "Aucune zone à masquer n'a été définie.");
  }

  const original = await loadPdf(source);
  const pageCount = original.getPageCount();
  const byPage = new Map(withRects.map((r) => [r.page, r.rects]));

  const output = await PDFDocument.create();
  const dpi = options.dpi ?? 200;

  for (let index = 0; index < pageCount; index += 1) {
    throwIfCancelled(context);
    report(context, index / pageCount, `Page ${index + 1} sur ${pageCount}`);
    const rects = byPage.get(index + 1);
    const { width, height } = original.getPage(index).getSize();

    if (rects && rects.length > 0) {
      const [rendered] = await pdfToImages(source, { format: "png", dpi, pages: [index + 1] }, {
        signal: context?.signal,
      });
      const canvas = await decodeImage(rendered.bytes, "png");
      const ctx = canvas.context as CanvasRenderingContext2D;
      ctx.fillStyle = "#000000";
      for (const rect of rects) {
        ctx.fillRect(
          rect.x * canvas.width,
          rect.y * canvas.height,
          rect.width * canvas.width,
          rect.height * canvas.height,
        );
      }
      const embedded = await output.embedPng(await canvas.encode("png"));
      const page = output.addPage([width, height]);
      page.drawImage(embedded, { x: 0, y: 0, width, height });
    } else {
      const [copied] = await output.copyPages(original, [index]);
      output.addPage(copied);
    }
  }

  report(context, 1, "Écriture du document");
  const bytes = await output.save();
  return { name: outputName(source.name, "caviarde"), bytes, mimeType: "application/pdf" };
}
