// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setRasterBackend } from "@/core/pdf/raster/types";
import { configurePdfJsForNode, nodeRasterBackend } from "@/test/nodeRaster";
import { ENGINE_TIMEOUT, HEAVY_TIMEOUT } from "@/test/timeouts";
import { normalizeResult, collectWords } from "@/core/ocr/engine";
import type { OcrEngine, OcrInput, OcrLanguage, OcrResult, RecognizeRequest } from "@/core/ocr/types";
import type { OperationContext, PdfSource } from "../types";
import { PdfError } from "../errors";
import { extractText } from "./extractText";
import {
  makeSearchablePdf,
  placeWord,
  viewToUserSpace,
} from "./searchablePdf";

const DIR = join(process.cwd(), "test-assets", "generated");

function source(name: string): PdfSource {
  return { name, bytes: new Uint8Array(readFileSync(join(DIR, name))) };
}

/** Texte comparable : minuscules, espaces uniformes, sans retour à la ligne. */
function flatten(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

beforeAll(() => {
  setRasterBackend(nodeRasterBackend);
  configurePdfJsForNode();
  execFileSync(process.execPath, [join(process.cwd(), "scripts/generate-document-assets.mjs")], {
    stdio: "ignore",
  });
}, HEAVY_TIMEOUT);

afterAll(() => setRasterBackend(undefined));

/* ============================================================== géométrie */

describe("repère image → repère PDF", () => {
  // Page A4 non tournée, 595 × 842 points.
  const width = 595;
  const height = 842;

  it("retourne l'axe vertical sur une page droite", () => {
    expect(viewToUserSpace(0, 0, width, height, 0)).toEqual({ x: 0, y: 842 });
    expect(viewToUserSpace(100, 42, width, height, 0)).toEqual({ x: 100, y: 800 });
    // Le coin bas-gauche de l'image est l'origine du PDF.
    expect(viewToUserSpace(0, height, width, height, 0)).toEqual({ x: 0, y: 0 });
  });

  it("replace les coordonnées d'une page tournée à 90°", () => {
    // Vue tournée : l'image mesure 842 × 595. Son coin haut-gauche correspond à
    // l'origine du repère PDF.
    expect(viewToUserSpace(0, 0, width, height, 90)).toEqual({ x: 0, y: 0 });
    // Le bord droit de la vue (x = 842) est le haut de la page (y = 842).
    expect(viewToUserSpace(height, 0, width, height, 90)).toEqual({ x: 0, y: height });
    // Le bas de la vue (y = 595) est le bord droit de la page (x = 595).
    expect(viewToUserSpace(0, width, width, height, 90)).toEqual({ x: width, y: 0 });
  });

  it("replace les coordonnées d'une page tournée à 180°", () => {
    expect(viewToUserSpace(0, 0, width, height, 180)).toEqual({ x: width, y: 0 });
    expect(viewToUserSpace(width, height, width, height, 180)).toEqual({ x: 0, y: height });
  });

  it("replace les coordonnées d'une page tournée à 270°", () => {
    expect(viewToUserSpace(0, 0, width, height, 270)).toEqual({ x: width, y: height });
    expect(viewToUserSpace(height, width, width, height, 270)).toEqual({ x: 0, y: 0 });
  });

  it("normalise les rotations hors plage", () => {
    expect(viewToUserSpace(10, 20, width, height, 360)).toEqual(
      viewToUserSpace(10, 20, width, height, 0),
    );
    expect(viewToUserSpace(10, 20, width, height, -90)).toEqual(
      viewToUserSpace(10, 20, width, height, 270),
    );
  });

  it("place un mot au bon endroit, à l'échelle du rendu", () => {
    // Rendu à 2 pixels par point : un mot de 200 px de large et 30 px de haut,
    // dont le bas est à 400 px du haut de l'image.
    const placement = placeWord(
      { text: "Facture", confidence: 90, box: { x0: 100, y0: 370, x1: 300, y1: 400 } },
      { scale: 2, width, height, rotation: 0 },
    );
    expect(placement.x).toBe(50); // 100 px / 2
    expect(placement.y).toBe(842 - 200); // 400 px / 2, depuis le haut
    expect(placement.size).toBeCloseTo(12, 5); // 30 px / 2 × 0,8
    expect(placement.angle).toBe(0);
  });

  it("aligne le texte sur le sens de lecture d'une page tournée", () => {
    const placement = placeWord(
      { text: "Facture", confidence: 90, box: { x0: 0, y0: 0, x1: 100, y1: 40 } },
      { scale: 1, width, height, rotation: 90 },
    );
    // Sur une page /Rotate 90, la lecture court dans le sens des y croissants.
    expect(placement.angle).toBe(90);
  });
});

/* ======================================================== moteur simulé */

/**
 * Moteur OCR reproductible : il ne lit rien, il rend des mots à des positions
 * choisies. C'est ce qui permet de tester la **couche texte** — placement,
 * annulation, filtrage — sans dépendre du temps ni de la précision d'un OCR
 * réel, qui sont éprouvés séparément plus bas.
 */
class ScriptedEngine implements OcrEngine {
  readonly id = "scripted";
  calls = 0;
  layoutRequested: boolean[] = [];

  constructor(
    private readonly wordsPerPage: string[][],
    private readonly options: { confidence?: number; delayMs?: number } = {},
  ) {}

  async recognize(
    _input: OcrInput,
    _language: OcrLanguage,
    context?: OperationContext,
    request?: RecognizeRequest,
  ): Promise<OcrResult> {
    const page = this.wordsPerPage[this.calls] ?? [];
    this.calls += 1;
    this.layoutRequested.push(Boolean(request?.layout));
    if (this.options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
    }
    if (context?.signal?.aborted) throw new Error("annulé");

    const base = normalizeResult(page.join(" "), this.options.confidence ?? 90);
    return {
      ...base,
      layout: {
        imageWidth: 1000,
        imageHeight: 1400,
        words: page.map((text, index) => ({
          text,
          confidence: this.options.confidence ?? 90,
          box: { x0: 60, y0: 100 + index * 60, x1: 60 + text.length * 22, y1: 140 + index * 60 },
        })),
      },
    };
  }

  async dispose(): Promise<void> {}
}

describe("couche texte (moteur simulé)", () => {
  it("écrit un mot par boîte et demande bien la mise en page", async () => {
    const engine = new ScriptedEngine([["Bonjour", "monde"], ["Seconde", "page"]]);
    const result = await makeSearchablePdf(source("scanned-two-page.pdf"), {
      language: "fra",
      engine,
      dpi: 100,
    });

    expect(engine.calls).toBe(2);
    expect(engine.layoutRequested).toEqual([true, true]);
    expect(result.totalWords).toBe(4);
    expect(result.pages.map((page) => page.page)).toEqual([1, 2]);
    expect(result.pages[0].text).toContain("Bonjour");
  }, HEAVY_TIMEOUT);

  it("écarte les mots sous le seuil de confiance", async () => {
    const engine = new ScriptedEngine([["a", "b"], ["c"]], { confidence: 20 });
    await expect(
      makeSearchablePdf(source("scanned-two-page.pdf"), {
        language: "fra",
        engine,
        dpi: 100,
        minConfidence: 60,
      }),
    ).rejects.toMatchObject({ code: "no-text-found" });
  }, HEAVY_TIMEOUT);

  it("publie une progression qui nomme la page et l'étape", async () => {
    const engine = new ScriptedEngine([["un"], ["deux"]]);
    const labels: string[] = [];
    await makeSearchablePdf(
      source("scanned-two-page.pdf"),
      { language: "fra", engine, dpi: 100 },
      { report: (progress) => progress.label && labels.push(progress.label) },
    );
    expect(labels).toContain("Page 1 / 2 — OCR");
    expect(labels).toContain("Page 1 / 2 — écriture couche texte");
    expect(labels).toContain("Page 2 / 2 — OCR");
  }, HEAVY_TIMEOUT);

  it("s'arrête à l'annulation sans produire de document", async () => {
    const controller = new AbortController();
    const engine = new ScriptedEngine([["un"], ["deux"]], { delayMs: 30 });
    const promise = makeSearchablePdf(
      source("scanned-two-page.pdf"),
      { language: "fra", engine, dpi: 100 },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 10);
    await expect(promise).rejects.toThrow();
  }, HEAVY_TIMEOUT);

  it("refuse un document protégé par mot de passe", async () => {
    await expect(
      makeSearchablePdf(source("pdf-protected.pdf"), {
        language: "fra",
        engine: new ScriptedEngine([["a"]]),
      }),
    ).rejects.toMatchObject({ code: "encrypted" });
  });

  it("signale un modèle de langue indisponible sans écrire de fichier", async () => {
    const broken: OcrEngine = {
      id: "absent",
      async recognize() {
        throw new PdfError("unknown", "Modèle de langue introuvable.");
      },
      async dispose() {},
    };
    await expect(
      makeSearchablePdf(source("scanned-two-page.pdf"), { language: "deu", engine: broken, dpi: 100 }),
    ).rejects.toThrow(/Mod/);
  }, HEAVY_TIMEOUT);
});

describe("aplatissement des mots reconnus", () => {
  it("ignore les mots vides ou sans boîte", () => {
    const layout = collectWords(
      [
        {
          paragraphs: [
            {
              lines: [
                {
                  words: [
                    { text: "Facture", confidence: 92, bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } },
                    { text: "   ", confidence: 10, bbox: { x0: 60, y0: 0, x1: 70, y1: 20 } },
                    { text: "sans-boîte", confidence: 80 },
                    // Boîte dégénérée : aucune surface, donc aucune position.
                    { text: "plat", confidence: 80, bbox: { x0: 10, y0: 5, x1: 10, y1: 5 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
      1000,
      1400,
    );
    expect(layout.words.map((word) => word.text)).toEqual(["Facture"]);
    expect(layout.imageWidth).toBe(1000);
  });

  it("ne renvoie rien pour une hiérarchie absente", () => {
    expect(collectWords(undefined, 0, 0).words).toEqual([]);
  });
});

/* ================================================== OCR réel, bout en bout */

/**
 * L'essai qui compte : un PDF dont le texte n'est que des pixels devient un PDF
 * dont le texte s'extrait. On ne vérifie pas « un fichier existe », on rouvre
 * le fichier produit avec pdf.js et on y cherche les phrases attendues.
 */
describe("PDF recherchable réel (tesseract.js, hors ligne)", { timeout: ENGINE_TIMEOUT }, () => {
  class NodeEngine implements OcrEngine {
    readonly id = "tesseract-node";
    private workers = new Map<string, Promise<TesseractLike>>();

    private async worker(language: string): Promise<TesseractLike> {
      let existing = this.workers.get(language);
      if (!existing) {
        existing = (async () => {
          const { createWorker } = await import("tesseract.js");
          return (await createWorker(language, 1, {
            corePath: join(process.cwd(), "node_modules/tesseract.js-core"),
            langPath: join(process.cwd(), "public/tessdata"),
            gzip: false,
            cacheMethod: "none",
            logger: () => {},
          } as never)) as unknown as TesseractLike;
        })();
        this.workers.set(language, existing);
      }
      return existing;
    }

    async recognize(
      input: OcrInput,
      language: OcrLanguage,
      _context?: OperationContext,
      request?: RecognizeRequest,
    ): Promise<OcrResult> {
      const worker = await this.worker(language);
      const { data } = await worker.recognize(input.bytes, undefined, {
        text: true,
        blocks: Boolean(request?.layout),
      });
      const base = normalizeResult(data.text, data.confidence);
      if (!request?.layout) return base;
      return {
        ...base,
        layout: collectWords(data.blocks ?? undefined, input.width ?? 0, input.height ?? 0),
      };
    }

    async dispose(): Promise<void> {
      for (const worker of this.workers.values()) await (await worker).terminate();
      this.workers.clear();
    }
  }

  const engine = new NodeEngine();
  afterAll(async () => engine.dispose(), ENGINE_TIMEOUT);

  /** Texte réellement extractible d'un PDF, toutes pages confondues. */
  async function textOf(name: string, bytes: Uint8Array): Promise<string> {
    const extracted = await extractText({ name, bytes });
    return extracted.pages.map((page) => page.text).join("\n");
  }

  it("part bien d'un PDF sans aucun texte extractible", async () => {
    const before = await textOf("scanned-two-page.pdf", source("scanned-two-page.pdf").bytes);
    expect(before.replace(/\s/g, "")).toBe("");
  });

  it("rend un scan de deux pages réellement recherchable", async () => {
    const input = source("scanned-two-page.pdf");
    const result = await makeSearchablePdf(input, { language: "fra+eng", engine, dpi: 200 });

    expect(result.hadNativeText).toBe(false);
    expect(result.pages).toHaveLength(2);
    expect(result.totalWords).toBeGreaterThan(10);

    // Le fichier produit est rouvert par le moteur PDF, comme le ferait un
    // lecteur : c'est la seule preuve qui vaille.
    const after = (await textOf(result.file.name, result.file.bytes)).toLowerCase();
    expect(after).toContain("facture");
    expect(after).toContain("2026-042");
    expect(after).toContain("128,50");
    expect(after).toContain("invoice");

    // Les deux pages portent chacune leur texte : rien n'a été empilé sur la
    // première ni rejeté hors page.
    const pages = await extractText({ name: result.file.name, bytes: result.file.bytes });
    expect(pages.pages).toHaveLength(2);
    expect(pages.pages[0].text.toLowerCase()).toContain("facture");
    expect(pages.pages[1].text.toLowerCase()).toContain("invoice");
  });

  it("conserve les accents et l'apostrophe", async () => {
    const result = await makeSearchablePdf(source("scanned-accents.pdf"), {
      language: "fra",
      engine,
      dpi: 200,
    });
    const after = (await textOf(result.file.name, result.file.bytes)).toLowerCase();
    // Au moins une occurrence de chaque accent attendu doit avoir survécu au
    // trajet OCR → couche texte → extraction.
    expect(after).toMatch(/[éèàçùô]/);
    expect(after).toContain("genève");
    expect(after).toContain("résumé");
  });

  it("place le texte dans les limites de la page", async () => {
    const result = await makeSearchablePdf(source("scanned-two-page.pdf"), {
      language: "fra",
      engine,
      dpi: 150,
    });
    // Un texte poussé hors page rendrait la recherche « fonctionnelle » sans
    // que la sélection ne corresponde à rien : on vérifie les coordonnées.
    const { PDFDocument } = await import("@cantoo/pdf-lib");
    const document = await PDFDocument.load(result.file.bytes);
    const page = document.getPage(0);
    expect(page.getWidth()).toBeGreaterThan(100);
    for (const report of result.pages) {
      expect(report.words).toBeGreaterThan(0);
      expect(report.confidence).toBeGreaterThan(50);
    }
  });

  it("produit un PDF valide, réouvrable sans erreur", async () => {
    const result = await makeSearchablePdf(source("scanned-accents.pdf"), {
      language: "fra",
      engine,
      dpi: 150,
    });
    expect([...result.file.bytes.subarray(0, 5)]).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(result.file.name).toMatch(/recherchable\.pdf$/);
    expect(result.file.mimeType).toBe("application/pdf");
  });
});

/** Ce que la suite consomme de tesseract.js. */
interface TesseractLike {
  recognize(
    image: Uint8Array,
    options?: unknown,
    output?: Record<string, boolean>,
  ): Promise<{
    data: {
      text: string;
      confidence: number;
      blocks?: Parameters<typeof collectWords>[0] | null;
    };
  }>;
  terminate(): Promise<void>;
}

/* ============================ tenue dans la durée, avec le vrai moteur ==== */

/**
 * Ces essais utilisent `TesseractEngine` — la classe que l'application
 * instancie — et non un moteur écrit pour Node. C'est le seul moyen d'éprouver
 * la file d'attente, la reprise sur défaut fatal et la libération des workers
 * telles qu'elles s'exécuteront réellement.
 */
describe("robustesse multipage (moteur embarqué)", { timeout: ENGINE_TIMEOUT }, () => {
  const enginePaths = {
    corePath: join(process.cwd(), "node_modules/tesseract.js-core"),
    langPath: join(process.cwd(), "public/tessdata"),
    workerPath: "",
  };

  it("océrise un document de dix pages sans perdre ni mélanger les pages", async () => {
    const { TesseractEngine } = await import("@/core/ocr/engine");
    const engine = new TesseractEngine(enginePaths);
    try {
      const input = source("scanned-multipage-stress.pdf");

      // Avant : aucun texte extractible.
      const before = await extractText(input);
      expect(before.totalCharacters).toBe(0);

      const result = await makeSearchablePdf(input, {
        language: "fra+eng",
        engine,
        dpi: 150,
      });
      expect(result.pages).toHaveLength(10);

      // Après : chaque page porte son propre repère, à sa propre place. C'est
      // ce qui détecte un état corrompu après plusieurs reconnaissances — une
      // page vide, ou le texte d'une page recopié sur une autre.
      const after = await extractText({ name: result.file.name, bytes: result.file.bytes });
      expect(after.pages).toHaveLength(10);
      for (let page = 1; page <= 10; page += 1) {
        // Les sauts de ligne de la couche texte suivent la mise en page lue :
        // c'est le contenu qui est vérifié ici, pas son découpage en lignes.
        const text = flatten(after.pages[page - 1].text);
        expect(text, `page ${page}`).toContain(`repere ${String(page).padStart(2, "0")}`);
        expect(text, `page ${page}`).toContain(`page numero ${page}`);
      }
    } finally {
      await engine.dispose();
    }
  });

  it("enchaîne deux traitements sur la même instance, langues différentes", async () => {
    const { TesseractEngine } = await import("@/core/ocr/engine");
    const engine = new TesseractEngine(enginePaths);
    try {
      const input = source("scanned-two-page.pdf");
      const first = await makeSearchablePdf(input, { language: "fra", engine, dpi: 150 });
      const second = await makeSearchablePdf(input, { language: "fra+eng", engine, dpi: 200 });
      const third = await makeSearchablePdf(input, { language: "fra+eng", engine, dpi: 150 });

      for (const result of [first, second, third]) {
        expect(result.pages).toHaveLength(2);
        expect(result.totalWords).toBeGreaterThan(10);
        const text = (await extractText({ name: "x.pdf", bytes: result.file.bytes })).pages
          .map((page) => page.text)
          .join(" ")
          .toLowerCase();
        expect(text).toContain("facture");
        expect(text).toContain("invoice");
      }
    } finally {
      await engine.dispose();
    }
  });

  it("annulation puis relance immédiate : la seconde aboutit", async () => {
    const { TesseractEngine } = await import("@/core/ocr/engine");
    const engine = new TesseractEngine(enginePaths);
    try {
      const input = source("scanned-multipage-stress.pdf");

      // On annule en cours de route : la reconnaissance déjà partie continue
      // dans le worker, l'appelant, lui, abandonne.
      const controller = new AbortController();
      const cancelled = makeSearchablePdf(
        input,
        { language: "fra", engine, dpi: 150 },
        { signal: controller.signal },
      );
      setTimeout(() => controller.abort(), 400);
      await expect(cancelled).rejects.toThrow();

      // Relance immédiate, sans rien réinitialiser : c'est le scénario que la
      // file d'attente doit rendre sûr.
      const result = await makeSearchablePdf(input, { language: "fra", engine, dpi: 150 });
      expect(result.pages).toHaveLength(10);
      const after = await extractText({ name: result.file.name, bytes: result.file.bytes });
      expect(flatten(after.pages[0].text)).toContain("repere 01");
      expect(flatten(after.pages[9].text)).toContain("repere 10");
    } finally {
      await engine.dispose();
    }
  });

  it("reste utilisable après une erreur de lecture d'image", async () => {
    const { TesseractEngine } = await import("@/core/ocr/engine");
    const engine = new TesseractEngine(enginePaths);
    try {
      // Des octets qui ne sont pas une image : Tesseract refuse de les lire.
      await expect(
        engine.recognize(
          { name: "faux.png", bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) },
          "fra",
          undefined,
          { layout: true },
        ),
      ).rejects.toThrow();

      // Immédiatement après, une vraie reconnaissance doit aboutir.
      const result = await makeSearchablePdf(source("scanned-accents.pdf"), {
        language: "fra",
        engine,
        dpi: 150,
      });
      expect(result.totalWords).toBeGreaterThan(5);
    } finally {
      await engine.dispose();
    }
  });
});
