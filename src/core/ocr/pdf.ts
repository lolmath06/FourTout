import type { OperationContext, PdfSource } from "@/core/pdf/types";
import { pdfToImages } from "@/core/pdf/operations/toImages";
import { JobCancelledError } from "@/core/jobs/types";
import { getDefaultEngine } from "./index";
import type { OcrEngine, OcrLanguage, OcrResult } from "./types";

/**
 * OCR d'un PDF scanné.
 *
 * Le pipeline réutilise l'existant sans rien dupliquer : les pages sont rendues
 * en images par le moteur PDF (`pdfToImages`, pdf.js), puis passées au moteur
 * OCR de la phase 3 (tesseract.js, hors ligne). Cette fonction est aussi la base
 * d'un futur « PDF océrisé avec couche texte ».
 */

export interface OcrPageResult extends OcrResult {
  page: number;
}

export interface RecognizePdfOptions {
  language: OcrLanguage;
  /** Résolution de rendu des pages, en points par pouce. */
  dpi?: number;
  engine?: OcrEngine;
}

export async function recognizePdf(
  source: PdfSource,
  options: RecognizePdfOptions,
  context?: OperationContext,
): Promise<OcrPageResult[]> {
  const engine = options.engine ?? getDefaultEngine();

  // Rendu des pages (première moitié de la progression).
  const images = await pdfToImages(
    source,
    { format: "png", dpi: options.dpi ?? 200 },
    {
      report: (p) => context?.report?.({ ratio: (p.ratio ?? 0) * 0.4, label: p.label }),
      signal: context?.signal,
    },
  );

  const results: OcrPageResult[] = [];
  for (const [index, image] of images.entries()) {
    if (context?.signal?.aborted) throw new JobCancelledError();
    const base = 0.4 + (index / images.length) * 0.6;
    const span = 0.6 / images.length;
    context?.report?.({ ratio: base, label: `OCR page ${index + 1} sur ${images.length}` });
    const result = await engine.recognize({ name: image.name, bytes: image.bytes }, options.language, {
      report: (p) => context?.report?.({ ratio: base + (p.ratio ?? 0) * span, label: `OCR page ${index + 1} sur ${images.length}` }),
      signal: context?.signal,
    });
    results.push({ page: index + 1, ...result });
  }

  context?.report?.({ ratio: 1, label: "Terminé" });
  return results;
}
