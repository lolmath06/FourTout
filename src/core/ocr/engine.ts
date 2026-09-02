import type { OperationContext } from "@/core/pdf/types";
import { JobCancelledError } from "@/core/jobs/types";
import { ImageError } from "@/core/image/errors";
import type { OcrEngine, OcrInput, OcrLanguage, OcrResult } from "./types";

/**
 * Moteur OCR reposant sur tesseract.js.
 *
 * Tout est servi localement : le script du worker, le cœur WebAssembly et les
 * modèles de langue proviennent des ressources de l'application
 * (`/tesseract/…`, `/tessdata/…`), jamais d'un CDN. Un worker est créé par
 * combinaison de langues puis réutilisé d'une image à l'autre.
 */

// Emplacements des ressources embarquées (voir scripts/sync-tesseract-assets.mjs).
const CORE_PATH = "/tesseract";
const WORKER_PATH = "/tesseract/worker.min.js";
const LANG_PATH = "/tessdata";

type TesseractWorker = {
  recognize(image: Uint8Array | Blob | string): Promise<{ data: { text: string; confidence: number; words?: unknown[] } }>;
  terminate(): Promise<void>;
};

export class TesseractEngine implements OcrEngine {
  readonly id = "tesseract.js";
  private workers = new Map<OcrLanguage, Promise<TesseractWorker>>();

  private async workerFor(language: OcrLanguage, context?: OperationContext): Promise<TesseractWorker> {
    let existing = this.workers.get(language);
    if (!existing) {
      existing = this.createWorker(language, context);
      this.workers.set(language, existing);
    }
    return existing;
  }

  private async createWorker(language: OcrLanguage, context?: OperationContext): Promise<TesseractWorker> {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker(language, 1, {
      corePath: CORE_PATH,
      workerPath: WORKER_PATH,
      langPath: LANG_PATH,
      gzip: false,
      cacheMethod: "none",
      logger: (message: { status?: string; progress?: number }) => {
        if (message.status === "recognizing text") {
          context?.report?.({ ratio: message.progress, label: "Reconnaissance du texte…" });
        }
      },
    } as never);
    return worker as unknown as TesseractWorker;
  }

  async recognize(input: OcrInput, language: OcrLanguage, context?: OperationContext): Promise<OcrResult> {
    if (context?.signal?.aborted) throw new JobCancelledError();
    let worker: TesseractWorker;
    try {
      worker = await this.workerFor(language, context);
    } catch (error) {
      throw new ImageError("ocr-unavailable", undefined, { cause: error });
    }
    const { data } = await worker.recognize(input.bytes);
    return normalizeResult(data.text, data.confidence);
  }

  async dispose(): Promise<void> {
    const workers = [...this.workers.values()];
    this.workers.clear();
    await Promise.all(
      workers.map(async (promise) => {
        try {
          (await promise).terminate();
        } catch {
          // Un worker déjà arrêté ne doit pas faire échouer le nettoyage.
        }
      }),
    );
  }
}

/** Met en forme un résultat brut de tesseract.js. */
export function normalizeResult(rawText: string, confidence: number): OcrResult {
  const text = rawText.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const words = text.length === 0 ? 0 : text.split(/\s+/).filter(Boolean).length;
  const chars = text.replace(/\s/g, "").length;
  return {
    text,
    confidence: Math.round(Math.max(0, Math.min(100, confidence))),
    words,
    chars,
  };
}
