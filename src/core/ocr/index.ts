import type { OperationContext } from "@/core/pdf/types";
import type { SelectedFile } from "@/core/files";
import { readSelectedFile } from "@/core/image/codec";
import { JobCancelledError } from "@/core/jobs/types";
import { TesseractEngine } from "./engine";
import type { OcrEngine, OcrLanguage, OcrResult } from "./types";

export * from "./types";
export { TesseractEngine, normalizeResult } from "./engine";

/** Résultat OCR associé à son image source (pour l'affichage multi-image). */
export interface OcrItem extends OcrResult {
  name: string;
}

let defaultEngine: OcrEngine | undefined;

/** Moteur par défaut (tesseract.js), instancié à la demande. */
export function getDefaultEngine(): OcrEngine {
  if (!defaultEngine) defaultEngine = new TesseractEngine();
  return defaultEngine;
}

export interface RecognizeOptions {
  language: OcrLanguage;
  /** Moteur à utiliser ; celui par défaut sinon. */
  engine?: OcrEngine;
}

/**
 * Reconnaît le texte d'une ou plusieurs images, en série. La progression tient
 * compte du nombre d'images ; l'annulation est vérifiée entre chaque image.
 * Le moteur fourni n'est pas libéré (il peut être réutilisé) ; le moteur par
 * défaut reste vivant pour accélérer les appels suivants.
 */
export async function recognizeImages(
  files: readonly SelectedFile[],
  options: RecognizeOptions,
  context?: OperationContext,
): Promise<OcrItem[]> {
  const engine = options.engine ?? getDefaultEngine();
  const items: OcrItem[] = [];

  for (const [index, file] of files.entries()) {
    if (context?.signal?.aborted) throw new JobCancelledError();
    const base = index / files.length;
    const span = 1 / files.length;
    context?.report?.({
      ratio: base,
      label: files.length > 1 ? `Image ${index + 1} sur ${files.length}` : "Reconnaissance du texte…",
    });
    const bytes = await readSelectedFile(file);
    const result = await engine.recognize({ name: file.name, bytes }, options.language, {
      report: (progress) =>
        context?.report?.({
          ratio: base + (progress.ratio ?? 0) * span,
          label: files.length > 1 ? `Image ${index + 1} sur ${files.length}` : progress.label,
        }),
      signal: context?.signal,
    });
    items.push({ name: file.name, ...result });
  }

  context?.report?.({ ratio: 1, label: "Terminé" });
  return items;
}
