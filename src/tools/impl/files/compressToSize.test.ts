// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { compressImage, compressPdfToSize } from "./compressToSizeCore";
import { describeFile } from "@/core/files";
import { setRasterBackend } from "@/core/pdf/raster/types";
import { nodeRasterBackend, configurePdfJsForNode } from "@/test/nodeRaster";

/**
 * Compresser vers une taille maximale, sur de vrais octets : une photo bruitée
 * (qui se comprime mal) et un PDF d'images. Les moteurs vidéo et audio, eux,
 * sont éprouvés côté Rust contre le vrai FFmpeg (`media_encode_integration`).
 */
beforeAll(() => {
  configurePdfJsForNode();
  setRasterBackend(nodeRasterBackend);
});

const context = { report: () => {}, signal: new AbortController().signal };

async function noisyPhoto(width: number, height: number, name: string, type: "png" | "jpeg") {
  const canvas = nodeRasterBackend.createCanvas(width, height);
  const data = new Uint8ClampedArray(width * height * 4);
  let state = 12345;
  for (let i = 0; i < data.length; i += 4) {
    state = (state * 1664525 + 1013904223) >>> 0;
    data[i] = (state >>> 24) & 255;
    data[i + 1] = ((state >>> 16) & 255) * 0.5 + (i % 255) * 0.5;
    data[i + 2] = (state >>> 8) & 255;
    data[i + 3] = 255;
  }
  canvas.putPixels({ width, height, data });
  const bytes = await canvas.encode(type, 0.95);
  return describeFile(new File([bytes as BlobPart], name, { type: `image/${type}` }));
}

describe("image vers une taille maximale", () => {
  it("passe sous la cible en JPEG, sans agrandir ni déformer", async () => {
    const file = await noisyPhoto(640, 480, "photo.jpg", "jpeg");
    expect(file.size).toBeGreaterThan(60_000);
    const target = 30_000;
    const outcome = await compressImage(file, target, "jpeg", context);
    const output = outcome.files[0];
    expect(output.bytes.length).toBeLessThanOrEqual(target);
    expect(output.bytes.length).toBeGreaterThan(target / 4);
    expect(output.name).toBe("photo-taille.jpg");
    const decoded = await nodeRasterBackend.decode(output.bytes, "image/jpeg");
    expect(decoded.width).toBeLessThanOrEqual(640);
    expect(decoded.height).toBeLessThanOrEqual(480);
    // Le ratio est conservé, à un pixel d'arrondi près.
    expect(Math.abs(decoded.width / decoded.height - 640 / 480)).toBeLessThan(0.02);
    expect(outcome.warning).toBeUndefined();
  });

  it("ne réduit la définition qu'en dernier recours, et la qualité d'abord", async () => {
    const file = await noisyPhoto(320, 240, "petite.png", "png");
    // Cible large pour un JPEG de cette taille : seule la qualité baisse.
    const outcome = await compressImage(file, 40_000, "jpeg", context);
    const decoded = await nodeRasterBackend.decode(outcome.files[0].bytes, "image/jpeg");
    expect([decoded.width, decoded.height]).toEqual([320, 240]);
  });

  it("réduit la définition d'un PNG, seul levier d'un format sans perte", async () => {
    const file = await noisyPhoto(400, 300, "capture.png", "png");
    const target = Math.floor(file.size / 3);
    const outcome = await compressImage(file, target, "png", context);
    expect(outcome.files[0].bytes.length).toBeLessThanOrEqual(target);
    const decoded = await nodeRasterBackend.decode(outcome.files[0].bytes, "image/png");
    expect(decoded.width).toBeLessThan(400);
  });

  it("dit franchement quand la cible est hors d'atteinte", async () => {
    const file = await noisyPhoto(300, 300, "bruit.jpg", "jpeg");
    const outcome = await compressImage(file, 200, "jpeg", context);
    expect(outcome.warning).toMatch(/ne passe pas sous/);
    expect(outcome.summary).toMatch(/n'a pas pu être atteinte/);
    // Le fichier rendu est le plus petit essayé, pas un fichier au hasard.
    expect(outcome.files[0].bytes.length).toBeGreaterThan(200);
  });

  it("s'interrompt à l'annulation", async () => {
    const file = await noisyPhoto(200, 200, "x.jpg", "jpeg");
    const controller = new AbortController();
    controller.abort();
    await expect(compressImage(file, 1000, "jpeg", { report: () => {}, signal: controller.signal })).rejects.toThrow();
  });
});

async function imagePdf(): Promise<File> {
  const document = await PDFDocument.create();
  for (let index = 0; index < 2; index += 1) {
    const size = 600;
    const canvas = nodeRasterBackend.createCanvas(size, size);
    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const p = (y * size + x) * 4;
        pixels[p] = (x * 255) / size;
        pixels[p + 1] = (y * 255) / size;
        pixels[p + 2] = ((x + y + index * 60) * 137) % 255;
        pixels[p + 3] = 255;
      }
    }
    canvas.putPixels({ width: size, height: size, data: pixels });
    const embedded = await document.embedPng(await canvas.encode("png"));
    document.addPage([size, size]).drawImage(embedded, { x: 0, y: 0, width: size, height: size });
  }
  return new File([(await document.save()) as BlobPart], "scan.pdf", { type: "application/pdf" });
}

describe("PDF vers une taille maximale", () => {
  it("essaie les niveaux par ordre croissant et s'arrête dès que ça passe", async () => {
    const pdf = describeFile(await imagePdf());
    const outcome = await compressPdfToSize(pdf, Math.floor(pdf.size / 2), context);
    expect(outcome.files[0].bytes.length).toBeLessThanOrEqual(Math.floor(pdf.size / 2));
    expect(outcome.warning).toBeUndefined();
    expect(outcome.files[0].name).toMatch(/\.pdf$/);
  });

  it("explique qu'il ne rasterise pas quand la cible est irréaliste", async () => {
    const pdf = describeFile(await imagePdf());
    const outcome = await compressPdfToSize(pdf, 500, context);
    expect(outcome.warning).toMatch(/ne transforme pas les pages en images/);
    expect(outcome.summary).toMatch(/n'a pas pu être atteinte/);
    // Le PDF rendu reste un PDF valide, le plus petit obtenu.
    const reread = await PDFDocument.load(outcome.files[0].bytes);
    expect(reread.getPageCount()).toBe(2);
  });
});
