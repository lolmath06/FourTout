// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { inspectPdf } from "@/core/pdf/document";
import { mergePdfs, extractPages, splitPdf } from "@/core/pdf/operations/pages";
import { imagesToPdf } from "@/core/pdf/operations/imagesToPdf";
import { compressPdf } from "@/core/pdf/operations/compress";
import { extractImages } from "@/core/pdf/operations/extractImages";
import { extractText } from "@/core/pdf/operations/extractText";
import { readMetadata } from "@/core/pdf/operations/metadata";
import { unlockPdf } from "@/core/pdf/operations/protect";
import { pdfToImages } from "@/core/pdf/operations/toImages";
import { outputName } from "@/core/pdf/filenames";
import { setRasterBackend } from "@/core/pdf/raster/types";
import { nodeRasterBackend, configurePdfJsForNode } from "./nodeRaster";
import { readPageLabels } from "./pdfFixtures";

/**
 * Vérifie les fixtures livrées à l'utilisateur.
 *
 * Les tests manuels de la phase reposent entièrement sur ces fichiers : s'ils
 * sont mal formés, la procédure de vérification ne vaut rien. On les régénère
 * donc réellement, puis on fait tourner les opérations dessus.
 */

const DIR = join(process.cwd(), "test-assets", "generated");
const asset = (name: string) => ({
  name,
  bytes: new Uint8Array(readFileSync(join(DIR, name))),
});

beforeAll(() => {
  configurePdfJsForNode();
  setRasterBackend(nodeRasterBackend);
  execFileSync(process.execPath, [join(process.cwd(), "scripts/generate-pdf-assets.mjs")], {
    stdio: "ignore",
  });
}, 60_000);

describe("fixtures PDF livrées", () => {
  it("génère tous les fichiers annoncés", () => {
    for (const name of [
      "pdf-single-page.pdf",
      "pdf-three-pages.pdf",
      "pdf-five-pages.pdf",
      "pdf-ten-pages.pdf",
      "pdf-with-metadata.pdf",
      "pdf-with-image.pdf",
      "pdf-large-images.pdf",
      "pdf-protected.pdf",
      "pdf-invalid.pdf",
      "page-red.png",
      "page-green.png",
      "page-blue.png",
    ]) {
      expect(existsSync(join(DIR, name)), `fixture manquante : ${name}`).toBe(true);
    }
  });

  it("produit des documents au bon nombre de pages", async () => {
    const expected: [string, number][] = [
      ["pdf-single-page.pdf", 1],
      ["pdf-three-pages.pdf", 3],
      ["pdf-five-pages.pdf", 5],
      ["pdf-ten-pages.pdf", 10],
      ["pdf-with-metadata.pdf", 2],
      ["pdf-with-image.pdf", 1],
      ["pdf-large-images.pdf", 4],
    ];
    for (const [name, pages] of expected) {
      const info = await inspectPdf(asset(name));
      expect(info.pageCount, name).toBe(pages);
      expect(info.encrypted, name).toBe(false);
    }
  });

  it("numérote visiblement chaque page", async () => {
    const labels = await readPageLabels(asset("pdf-three-pages.pdf").bytes);
    expect(labels[0]).toContain("PAGE 1");
    expect(labels[1]).toContain("PAGE 2");
    expect(labels[2]).toContain("PAGE 3");
    expect(labels[0]).toContain("ROUGE");
    expect(labels[1]).toContain("VERT");
  });

  it("porte les métadonnées annoncées", async () => {
    const metadata = await readMetadata(asset("pdf-with-metadata.pdf"));
    expect(metadata.title).toBe("Rapport de test FourTout");
    expect(metadata.author).toBe("Equipe FourTout");
  });

  it("livre un document protégé par le mot de passe documenté", async () => {
    const info = await inspectPdf(asset("pdf-protected.pdf"));
    expect(info.encrypted).toBe(true);

    const unlocked = await unlockPdf(asset("pdf-protected.pdf"), "fourtout");
    const after = await inspectPdf({ name: "u.pdf", bytes: unlocked.bytes });
    expect(after.encrypted).toBe(false);
    expect(after.pageCount).toBe(2);
  });

  it("livre un fichier invalide qui est bien rejeté", async () => {
    await expect(inspectPdf(asset("pdf-invalid.pdf"))).rejects.toMatchObject({
      code: "corrupted",
    });
  });

  it("livre trois images distinctes pour Images vers PDF", async () => {
    const images = ["page-red.png", "page-green.png", "page-blue.png"].map(asset);
    for (const image of images) {
      expect(image.bytes.subarray(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    }
    const output = await imagesToPdf(images, { mode: "a4-portrait" });
    const document = await PDFDocument.load(output.bytes);
    expect(document.getPageCount()).toBe(3);
  });
});

describe("scénarios des tests manuels", () => {
  it("fusion : 1 page + 3 pages donne 4 pages dans le bon ordre", async () => {
    const merged = await mergePdfs([asset("pdf-single-page.pdf"), asset("pdf-three-pages.pdf")]);
    const labels = await readPageLabels(merged.bytes);

    expect(labels).toHaveLength(4);
    expect(labels[0]).toContain("PAGE 1");
    expect(labels[1]).toContain("PAGE 1");
    expect(labels[3]).toContain("PAGE 3");
  });

  it("découpage : 5 pages donnent 5 fichiers d'une page", async () => {
    const outputs = await splitPdf(asset("pdf-five-pages.pdf"), { mode: "each-page" });
    expect(outputs).toHaveLength(5);
    for (const [index, output] of outputs.entries()) {
      const labels = await readPageLabels(output.bytes);
      expect(labels).toHaveLength(1);
      expect(labels[0]).toContain(`PAGE ${index + 1}`);
    }
  });

  it("extraction : pages 1 et 3 donnent un document de deux pages", async () => {
    const output = await extractPages(asset("pdf-five-pages.pdf"), [1, 3]);
    const labels = await readPageLabels(output.bytes);
    expect(labels.map((label) => label.match(/PAGE \d+/)?.[0])).toEqual(["PAGE 1", "PAGE 3"]);
  });

  it("PDF vers images : produit une image par page", async () => {
    const files = await pdfToImages(asset("pdf-three-pages.pdf"), { format: "png", dpi: 96 });
    expect(files.map((file) => file.name)).toEqual([
      "pdf-three-pages-page-01.png",
      "pdf-three-pages-page-02.png",
      "pdf-three-pages-page-03.png",
    ]);
    expect(files[0].bytes.length).toBeGreaterThan(1000);
  });

  it("compression : le PDF volumineux maigrit nettement", async () => {
    const source = asset("pdf-large-images.pdf");
    const result = await compressPdf(source, "strong");

    expect(result.improved).toBe(true);
    expect(result.savedPercent).toBeGreaterThan(70);
    expect(result.imagesRecompressed).toBe(4);

    // Le document produit reste parfaitement lisible.
    const reloaded = await PDFDocument.load(result.output.bytes);
    expect(reloaded.getPageCount()).toBe(4);
  }, 60_000);

  it("extraction d'images : récupère l'image embarquée", async () => {
    const result = await extractImages(asset("pdf-with-image.pdf"));
    expect(result.files.length).toBeGreaterThanOrEqual(1);
    expect(result.files[0].bytes.length).toBeGreaterThan(1000);
  });

  it("extraction de texte : retrouve le texte des pages", async () => {
    const extracted = await extractText(asset("pdf-three-pages.pdf"));
    expect(extracted.pages).toHaveLength(3);
    expect(extracted.emptyPages).toBe(0);
    expect(extracted.pages[1].text).toContain("PAGE 2");
  });
});

describe("noms de fichiers difficiles", () => {
  it("gère les espaces, accents et apostrophes", async () => {
    const source = {
      name: "Rapport annuel 2026 (été) — copie.pdf",
      bytes: asset("pdf-three-pages.pdf").bytes,
    };
    const output = await extractPages(source, [1]);

    expect(output.name).toContain("Rapport annuel 2026");
    expect(output.name.endsWith(".pdf")).toBe(true);
    // Aucun caractère interdit sous Windows ne doit subsister.
    expect(output.name).not.toMatch(/[\\/:*?"<>|]/);
    expect(await inspectPdf({ name: "x.pdf", bytes: output.bytes })).toMatchObject({
      pageCount: 1,
    });
  });

  it("neutralise les caractères interdits sans perdre les accents", () => {
    expect(outputName('fichier: "spécial" <test>.pdf', "compresse")).toBe(
      "fichier- -spécial- -test--compresse.pdf",
    );
  });
});
