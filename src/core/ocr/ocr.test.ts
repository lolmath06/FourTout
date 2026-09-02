// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SelectedFile } from "@/core/files";
import type { OperationContext } from "@/core/pdf/types";
import { normalizeResult } from "./engine";
import { recognizeImages, type OcrEngine, type OcrInput, type OcrLanguage } from "./index";

const DIR = join(process.cwd(), "test-assets", "generated");

function fileOf(name: string): SelectedFile {
  const bytes = readFileSync(join(DIR, name));
  return {
    id: name,
    name,
    size: bytes.length,
    extension: name.slice(name.lastIndexOf(".") + 1),
    mimeType: "image/png",
    kind: "image",
    file: new File([bytes], name),
  };
}

beforeAll(() => {
  execFileSync(process.execPath, [join(process.cwd(), "scripts/generate-image-assets.mjs")], { stdio: "ignore" });
});

describe("mise en forme des résultats", () => {
  it("compte mots et caractères et normalise les espaces", () => {
    const result = normalizeResult("  Bonjour   le\r\n monde  \n\n\n!  ", 87.4);
    expect(result.text).toBe("Bonjour   le\n monde\n\n!");
    expect(result.words).toBe(4);
    expect(result.confidence).toBe(87);
    expect(result.chars).toBe(result.text.replace(/\s/g, "").length);
  });

  it("gère un texte vide", () => {
    const result = normalizeResult("   ", 0);
    expect(result.words).toBe(0);
    expect(result.chars).toBe(0);
  });
});

describe("orchestration multi-image (moteur simulé)", () => {
  class FakeEngine implements OcrEngine {
    readonly id = "fake";
    calls: string[] = [];
    async recognize(input: OcrInput, language: OcrLanguage, context?: OperationContext) {
      this.calls.push(`${input.name}:${language}`);
      context?.report?.({ ratio: 0.5, label: "…" });
      return normalizeResult(`texte de ${input.name}`, 90);
    }
    async dispose() {}
  }

  it("traite chaque image et publie la progression", async () => {
    const engine = new FakeEngine();
    const steps: number[] = [];
    const items = await recognizeImages(
      [fileOf("image-text-fr.png"), fileOf("image-text-en.png")],
      { language: "fra", engine },
      { report: (p) => steps.push(p.ratio ?? -1) },
    );
    expect(items).toHaveLength(2);
    expect(engine.calls).toEqual(["image-text-fr.png:fra", "image-text-en.png:fra"]);
    expect(items[0].name).toBe("image-text-fr.png");
    expect(steps.at(-1)).toBe(1);
  });

  it("s'interrompt à l'annulation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      recognizeImages([fileOf("image-text-fr.png")], { language: "fra", engine: new FakeEngine() }, { signal: controller.signal }),
    ).rejects.toThrow();
  });
});

/**
 * OCR réel, hors ligne, via tesseract.js et les modèles embarqués. On construit
 * ici un moteur configuré pour Node (chemins locaux), équivalent à celui de
 * l'application mais sans les chemins servis par la WebView.
 */
describe("reconnaissance réelle (tesseract.js, hors ligne)", () => {
  class NodeEngine implements OcrEngine {
    readonly id = "tesseract-node";
    private workers = new Map<string, Promise<{ recognize(b: Uint8Array): Promise<{ data: { text: string; confidence: number } }>; terminate(): Promise<void> }>>();
    private async worker(language: string) {
      let w = this.workers.get(language);
      if (!w) {
        w = (async () => {
          const { createWorker } = await import("tesseract.js");
          return (await createWorker(language, 1, {
            corePath: join(process.cwd(), "node_modules/tesseract.js-core"),
            langPath: join(process.cwd(), "public/tessdata"),
            gzip: false,
            cacheMethod: "none",
            logger: () => {},
          } as never)) as never;
        })();
        this.workers.set(language, w);
      }
      return w;
    }
    async recognize(input: OcrInput, language: OcrLanguage) {
      const worker = await this.worker(language);
      const { data } = await worker.recognize(input.bytes);
      return normalizeResult(data.text, data.confidence);
    }
    async dispose() {
      for (const w of this.workers.values()) await (await w).terminate();
      this.workers.clear();
    }
  }

  const engine = new NodeEngine();
  afterAll(async () => engine.dispose());

  it("lit un texte français", async () => {
    const [item] = await recognizeImages([fileOf("image-text-fr.png")], { language: "fra", engine });
    const text = item.text.toLowerCase();
    expect(text).toContain("fourtout");
    expect(text).toContain("facture");
    expect(text).toContain("2026-042");
    expect(item.confidence).toBeGreaterThan(60);
    expect(item.words).toBeGreaterThan(5);
  }, 120_000);

  it("lit un texte anglais", async () => {
    const [item] = await recognizeImages([fileOf("image-text-en.png")], { language: "eng", engine });
    const text = item.text.toLowerCase();
    expect(text).toContain("fourtout");
    expect(text).toContain("invoice");
    expect(item.confidence).toBeGreaterThan(60);
  }, 120_000);

  it("traite un lot de deux images", async () => {
    const items = await recognizeImages(
      [fileOf("image-text-fr.png"), fileOf("image-text-en.png")],
      { language: "fra+eng", engine },
    );
    expect(items).toHaveLength(2);
    expect(items[0].text.toLowerCase()).toContain("fourtout");
    expect(items[1].text.toLowerCase()).toContain("fourtout");
  }, 180_000);
});
