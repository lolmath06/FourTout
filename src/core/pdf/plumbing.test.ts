// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { openWithPdfJs } from "./pdfjs";
import { setRasterBackend } from "./raster/types";
import { nodeRasterBackend, configurePdfJsForNode } from "@/test/nodeRaster";

beforeAll(() => {
  configurePdfJsForNode();
  setRasterBackend(nodeRasterBackend);
});

describe("plomberie pdf.js + canvas", () => {
  it("ouvre un document et lit son texte", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([200, 200]).drawText("BONJOUR", { x: 20, y: 100, size: 18, font });
    const bytes = await doc.save();

    const pdf = await openWithPdfJs({ name: "t.pdf", bytes });
    expect(pdf.numPages).toBe(1);
    const content = await (await pdf.getPage(1)).getTextContent();
    expect(content.items.map((i) => ("str" in i ? i.str : "")).join("")).toBe("BONJOUR");
  });

  it("rend une page dans le backend bitmap de test", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 50]);
    const bytes = await doc.save();

    const pdf = await openWithPdfJs({ name: "t.pdf", bytes });
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = nodeRasterBackend.createCanvas(viewport.width, viewport.height);
    await page.render({
      canvasContext: canvas.context as never,
      canvas: canvas.handle as never,
      viewport,
    }).promise;

    const png = await canvas.encode("png");
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
    expect(png.subarray(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });
});
