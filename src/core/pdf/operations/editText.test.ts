import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import {
  applyTextEdits,
  canEditCleanly,
  extractPageText,
  fitFontSize,
  sampleTextStyle,
  standardFontFor,
  type PdfTextEdit,
} from "./editText";
import { renderPageForEditor } from "./toImages";
import { setRasterBackend } from "../raster/types";
import { nodeRasterBackend, configurePdfJsForNode } from "@/test/nodeRaster";
import type { PdfSource } from "../types";
import type { RasterPixels } from "../raster/types";

/** Luminance moyenne d'une zone en pixels, 0 (noir) à 255 (blanc). */
function meanLuminance(pixels: RasterPixels, box: { x: number; y: number; w: number; h: number }): number {
  let sum = 0;
  let count = 0;
  for (let y = box.y; y < box.y + box.h; y += 1) {
    for (let x = box.x; x < box.x + box.w; x += 1) {
      if (x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) continue;
      const p = (y * pixels.width + x) * 4;
      sum += 0.299 * pixels.data[p] + 0.587 * pixels.data[p + 1] + 0.114 * pixels.data[p + 2];
      count += 1;
    }
  }
  return count === 0 ? 0 : sum / count;
}

beforeAll(() => {
  configurePdfJsForNode();
  setRasterBackend(nodeRasterBackend);
});

/** PDF de test : une ligne de texte connue par page. */
async function buildDoc(lines: string[]): Promise<PdfSource> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const line of lines) {
    const page = doc.addPage([420, 300]);
    page.drawText(line, { x: 40, y: 200, size: 20, font, color: rgb(0.1, 0.1, 0.1) });
  }
  return { name: "doc.pdf", bytes: await doc.save() };
}

function baseEdit(over: Partial<PdfTextEdit>): PdfTextEdit {
  return {
    page: 1,
    index: 0,
    originalText: "Rapport annuel 2026",
    replacementText: "Rapport annuel 2027",
    x: 40,
    y: 200,
    width: 180,
    height: 20,
    fontSize: 20,
    bold: false,
    italic: false,
    fontFamily: "Helvetica",
    vertical: false,
    rotated: false,
    color: { r: 0.1, g: 0.1, b: 0.1 },
    background: { r: 1, g: 1, b: 1 },
    uniformBackground: true,
    ...over,
  };
}

describe("éditeur de texte PDF — extraction", () => {
  it("extrait les fragments avec position et corps de police", async () => {
    const source = await buildDoc(["Rapport annuel 2026"]);
    const page = await extractPageText(source, 1);
    expect(page.widthPts).toBeCloseTo(420, 0);
    expect(page.heightPts).toBeCloseTo(300, 0);
    const item = page.items.find((i) => i.text.includes("Rapport"));
    expect(item).toBeDefined();
    expect(item!.x).toBeCloseTo(40, 0);
    expect(item!.y).toBeCloseTo(200, 0);
    expect(Math.round(item!.fontSize)).toBe(20);
    expect(item!.rotated).toBe(false);
    expect(item!.vertical).toBe(false);
  });

  it("ne renvoie aucun fragment pour une page sans texte (scan)", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]); // page vide
    const page = await extractPageText({ name: "vide.pdf", bytes: await doc.save() }, 1);
    expect(page.items).toHaveLength(0);
  });
});

describe("éditeur de texte PDF — export", () => {
  it("écrit réellement le nouveau texte dans la copie", async () => {
    const source = await buildDoc(["Rapport annuel 2026"]);
    const result = await applyTextEdits(source, [baseEdit({})]);
    expect(result.applied).toBe(1);
    expect(result.refused).toBe(0);

    // Le nouveau texte est réellement présent (dessiné) dans la copie.
    const reread = await extractPageText({ name: "out.pdf", bytes: result.file.bytes }, 1);
    const joined = reread.items.map((i) => i.text).join(" ");
    expect(joined).toContain("2027");
  });

  it("recouvre visuellement l'ancien texte (remplacement visuel)", async () => {
    // Texte large d'origine, remplacé par un texte court : la partie droite de
    // la zone, jadis encrée, doit revenir au fond après recouvrement.
    const source = await buildDoc(["XXXXXXXXXXXXXXXX"]);
    const before = await renderPageForEditor(source, 1, 840);
    const edit = baseEdit({
      originalText: "XXXXXXXXXXXXXXXX",
      replacementText: "Y",
      width: 200,
    });
    const result = await applyTextEdits(source, [edit]);
    const after = await renderPageForEditor({ name: "out.pdf", bytes: result.file.bytes }, 1, 840);

    // Bande horizontale sur la droite de la zone (là où « Y » ne dessine rien).
    const s = before.scale;
    const band = {
      x: Math.round((40 + 200 * 0.6) * s),
      y: Math.round((300 - 216) * s),
      w: Math.round(200 * 0.35 * s),
      h: Math.round(20 * s),
    };
    const lumBefore = meanLuminance(before.pixels, band);
    const lumAfter = meanLuminance(after.pixels, band);
    // Après recouvrement, la bande doit être nettement plus claire (encre partie).
    expect(lumAfter).toBeGreaterThan(lumBefore + 30);
    expect(lumAfter).toBeGreaterThan(220); // proche du blanc de fond
  });

  it("préserve le nombre de pages et n'altère pas les pages non modifiées", async () => {
    const source = await buildDoc(["Page une texte A", "Page deux texte B", "Page trois texte C"]);
    const edit = baseEdit({
      page: 2,
      originalText: "Page deux texte B",
      replacementText: "Page deux MODIFIEE",
    });
    const result = await applyTextEdits(source, [edit]);

    const out = await PDFDocument.load(result.file.bytes);
    expect(out.getPageCount()).toBe(3);

    const p1 = await extractPageText({ name: "o.pdf", bytes: result.file.bytes }, 1);
    const p3 = await extractPageText({ name: "o.pdf", bytes: result.file.bytes }, 3);
    expect(p1.items.map((i) => i.text).join(" ")).toContain("texte A");
    expect(p3.items.map((i) => i.text).join(" ")).toContain("texte C");
    const p2 = await extractPageText({ name: "o.pdf", bytes: result.file.bytes }, 2);
    expect(p2.items.map((i) => i.text).join(" ")).toContain("MODIFIEE");
  });

  it("refuse une édition sur fond non uniforme sans rien dessiner", async () => {
    const source = await buildDoc(["Rapport annuel 2026"]);
    const result = await applyTextEdits(source, [baseEdit({ uniformBackground: false })]);
    expect(result.applied).toBe(0);
    expect(result.refused).toBe(1);
    const reread = await extractPageText({ name: "out.pdf", bytes: result.file.bytes }, 1);
    // Le texte d'origine reste intact (aucune destruction silencieuse).
    expect(reread.items.map((i) => i.text).join(" ")).toContain("2026");
  });

  it("refuse le texte pivoté ou vertical", () => {
    expect(canEditCleanly(baseEdit({ rotated: true }))).toBe(false);
    expect(canEditCleanly(baseEdit({ vertical: true }))).toBe(false);
    expect(canEditCleanly(baseEdit({}))).toBe(true);
  });

  it("laisse les pages intactes quand aucune modification n'est réelle", async () => {
    const source = await buildDoc(["Texte inchange ici"]);
    const noop = baseEdit({ originalText: "Texte inchange ici", replacementText: "Texte inchange ici" });
    const result = await applyTextEdits(source, [noop]);
    expect(result.applied).toBe(0);
  });
});

describe("éditeur de texte PDF — ajustement de police", () => {
  it("réduit légèrement pour tenir dans la largeur", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    // « annee fiscale 2027 » plus long que la largeur d'origine de « 2026 ».
    const short = fitFontSize(font, "2026", 20, font.widthOfTextAtSize("2026", 20) + 10);
    expect(short.size).toBe(20);
    expect(short.overflow).toBe(false);

    const long = fitFontSize(font, "annee fiscale 2027", 20, font.widthOfTextAtSize("2026", 20));
    expect(long.size).toBeLessThan(20);
    expect(long.size).toBeGreaterThanOrEqual(20 * 0.6);
  });

  it("signale un débordement quand même 60 % ne suffit pas", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const res = fitFontSize(font, "un texte de remplacement beaucoup trop long", 20, 20);
    expect(res.overflow).toBe(true);
    expect(res.size).toBeCloseTo(12, 5); // 60 % de 20
  });
});

describe("éditeur de texte PDF — échantillonnage du fond", () => {
  function solid(width: number, height: number, rgb0: [number, number, number]): RasterPixels {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      data[i * 4] = rgb0[0];
      data[i * 4 + 1] = rgb0[1];
      data[i * 4 + 2] = rgb0[2];
      data[i * 4 + 3] = 255;
    }
    return { width, height, data };
  }

  it("reconnaît un fond uni et lit sa couleur", () => {
    const pixels = solid(100, 40, [40, 90, 200]); // bleu uni
    // Encre sombre au centre.
    for (let x = 30; x < 70; x += 1) {
      for (let y = 15; y < 25; y += 1) {
        const p = (y * 100 + x) * 4;
        pixels.data[p] = 10;
        pixels.data[p + 1] = 10;
        pixels.data[p + 2] = 10;
      }
    }
    const style = sampleTextStyle(pixels, { x: 25, y: 12, w: 50, h: 16 });
    expect(style.uniform).toBe(true);
    expect(Math.round(style.background.b * 255)).toBeGreaterThan(150);
    expect(style.text.r).toBeLessThan(0.2);
  });

  it("déclare non uniforme un fond bruité (photo/dégradé)", () => {
    const width = 100;
    const height = 40;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      data[i * 4] = (i * 37) % 255;
      data[i * 4 + 1] = (i * 53) % 255;
      data[i * 4 + 2] = (i * 91) % 255;
      data[i * 4 + 3] = 255;
    }
    const style = sampleTextStyle({ width, height, data }, { x: 25, y: 12, w: 50, h: 16 });
    expect(style.uniform).toBe(false);
  });
});

describe("éditeur de texte PDF — choix de police", () => {
  it("associe une police standard proche", () => {
    expect(standardFontFor({ fontFamily: "Times New Roman", bold: false, italic: false })).toBe(
      StandardFonts.TimesRoman,
    );
    expect(standardFontFor({ fontFamily: "Courier New", bold: true, italic: false })).toBe(
      StandardFonts.CourierBold,
    );
    expect(standardFontFor({ fontFamily: "Arial", bold: true, italic: true })).toBe(
      StandardFonts.HelveticaBoldOblique,
    );
  });
});
