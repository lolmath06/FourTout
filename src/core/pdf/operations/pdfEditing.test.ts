// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { setRasterBackend } from "../raster/types";
import { nodeRasterBackend, configurePdfJsForNode } from "@/test/nodeRaster";
import { buildSource } from "@/test/pdfFixtures";
import { extractText, joinPages } from "./extractText";
import { documentToPdf, parseDocument, parseInline, toWinAnsi } from "./documentToPdf";
import { addTextToPdf, addImageToPdf } from "./addContent";
import { redactPdf } from "./redact";
import { comparePdfs } from "./compare";
import { recognizePdf } from "@/core/ocr/pdf";
import type { OcrEngine, OcrInput, OcrLanguage } from "@/core/ocr/types";
import { inspectPdf } from "../document";

beforeAll(() => {
  configurePdfJsForNode();
  setRasterBackend(nodeRasterBackend);
});

const textOf = async (bytes: Uint8Array) =>
  joinPages(await extractText({ name: "out.pdf", bytes }));

describe("document vers PDF", () => {
  it("convertit du texte brut en PDF lisible", async () => {
    const file = await documentToPdf("note.txt", "Bonjour le monde.\n\nDeuxieme paragraphe.", { kind: "text" });
    expect(file.name).toBe("note.pdf");
    const text = await textOf(file.bytes);
    expect(text).toContain("Bonjour le monde");
    expect(text).toContain("Deuxieme paragraphe");
  });

  it("interprète le Markdown (titres, listes, gras)", () => {
    const blocks = parseDocument("# Titre\n\nUn **mot** gras.\n\n- item un\n- item deux", "markdown");
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1 });
    expect(blocks.some((b) => b.type === "listitem")).toBe(true);
    const runs = parseInline("un **mot** gras");
    expect(runs.find((r) => r.bold)?.text).toBe("mot");
  });

  it("remplace les caractères hors WinAnsi sans planter", async () => {
    expect(toWinAnsi("guillemets « français » et tiret —")).toBe('guillemets " français " et tiret -');
    const file = await documentToPdf("emoji.md", "# Résumé 😀 €uro", { kind: "markdown" });
    expect(file.bytes.length).toBeGreaterThan(0);
  });
});

describe("ajouter du texte / une image", () => {
  it("inscrit un texte réellement extractible", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 1, labels: ["ORIGINE"] });
    const file = await addTextToPdf(source, [
      { page: 1, x: 0.1, y: 0.2, text: "AJOUT-FOURTOUT", size: 14, color: { r: 0, g: 0, b: 0 } },
    ]);
    expect(await textOf(file.bytes)).toContain("AJOUT-FOURTOUT");
  });

  it("insère une image sans casser le document", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 2 });
    const png = new Uint8Array(readFileSync(join(process.cwd(), "test-assets/generated/image-colors.png")));
    const file = await addImageToPdf(source, [
      { page: 1, bytes: png, x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
    ]);
    expect((await inspectPdf({ name: "x", bytes: file.bytes })).pageCount).toBe(2);
  });
});

describe("caviardage sécurisé", () => {
  it("supprime réellement le texte masqué (non extractible)", async () => {
    const secret = "SECRET-FOURTOUT-92841";
    const source = await buildSource("confidentiel.pdf", { pageCount: 2, labels: [secret, "PAGE PUBLIQUE"] });
    // Vérifie d'abord que le secret est bien présent au départ.
    expect(await textOf(source.bytes)).toContain(secret);

    const file = await redactPdf(source, [
      { page: 1, rects: [{ x: 0, y: 0, width: 1, height: 1 }] },
    ]);

    const text = await textOf(file.bytes);
    expect(text).not.toContain(secret);
    // La recherche brute des octets ne doit pas non plus révéler le secret.
    const raw = Buffer.from(file.bytes).toString("latin1");
    expect(raw).not.toContain(secret);
    // La page publique (non caviardée) reste, elle, du texte.
    expect(text).toContain("PAGE PUBLIQUE");
    expect((await inspectPdf({ name: "x", bytes: file.bytes })).pageCount).toBe(2);
  });
});

describe("comparaison de deux PDF", () => {
  it("repère les pages identiques et différentes", async () => {
    const a = await buildSource("a.pdf", { pageCount: 2, labels: ["ALPHA", "BETA"] });
    const b = await buildSource("b.pdf", { pageCount: 2, labels: ["ALPHA", "OMEGA"] });
    const result = await comparePdfs(a, b, { dpi: 96 });
    expect(result.pageCountA).toBe(2);
    expect(result.pages[0].status).toBe("identical");
    expect(result.pages[1].status).toBe("different");
    expect(result.pages[1].diffPng).toBeDefined();
    expect(result.pages[1].diffRatio).toBeGreaterThan(result.pages[0].diffRatio);
  });

  it("signale une page présente d'un seul côté", async () => {
    const a = await buildSource("a.pdf", { pageCount: 1, labels: ["ALPHA"] });
    const b = await buildSource("b.pdf", { pageCount: 2, labels: ["ALPHA", "EXTRA"] });
    const result = await comparePdfs(a, b, { dpi: 96 });
    expect(result.pages[1].status).toBe("only-in-b");
  });
});

describe("OCR PDF (orchestration)", () => {
  class FakeEngine implements OcrEngine {
    readonly id = "fake";
    pages: string[] = [];
    async recognize(input: OcrInput, _language: OcrLanguage) {
      this.pages.push(input.name);
      return { text: `page ${this.pages.length}`, confidence: 88, words: 2, chars: 6 };
    }
    async dispose() {}
  }

  it("rend chaque page puis l'océrise", async () => {
    const source = await buildSource("scan.pdf", { pageCount: 3 });
    const engine = new FakeEngine();
    const results = await recognizePdf(source, { language: "fra", dpi: 96, engine });
    expect(results).toHaveLength(3);
    expect(results[0].page).toBe(1);
    expect(engine.pages).toHaveLength(3);
  });
});
