// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { setRasterBackend } from "@/core/pdf/raster/types";
import { nodeRasterBackend } from "@/test/nodeRaster";
import { decodeImage } from "./codec";
import { buildIco } from "./favicon";
import { extractPalette } from "./palette";
import { generateQrPng, generateQrSvg, decodeQr, looksLikeUrl } from "./qr";

const DIR = join(process.cwd(), "test-assets", "generated");
const read = (name: string) => new Uint8Array(readFileSync(join(DIR, name)));

beforeAll(() => {
  execFileSync(process.execPath, [join(process.cwd(), "scripts/generate-image-assets.mjs")], { stdio: "ignore" });
  setRasterBackend(nodeRasterBackend);
});

describe("favicon ICO", () => {
  it("assemble un vrai conteneur ICO multi-résolutions", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([5, 6, 7, 8, 9]);
    const ico = buildIco([{ size: 16, png: a }, { size: 32, png: b }]);
    // En-tête ICO : réservé=0, type=1, count=2.
    expect([ico[0], ico[1], ico[2], ico[3], ico[4], ico[5]]).toEqual([0, 0, 1, 0, 2, 0]);
    // Deux entrées de répertoire de 16 octets, puis les données.
    expect(ico[6]).toBe(16); // largeur 1re entrée
    expect(ico[6 + 16]).toBe(32); // largeur 2e entrée
    // Les données PNG suivent le répertoire (6 + 2*16 = 38).
    expect([...ico.slice(38, 42)]).toEqual([1, 2, 3, 4]);
    expect([...ico.slice(42, 47)]).toEqual([5, 6, 7, 8, 9]);
  });
});

describe("palette de couleurs", () => {
  it("extrait les couleurs dominantes d'une image à blocs", async () => {
    const canvas = await decodeImage(read("image-colors.png"), "png");
    const colors = extractPalette(canvas.getPixels(), 4);
    expect(colors.length).toBeGreaterThanOrEqual(3);
    const near = (c: { r: number; g: number; b: number }, r: number, g: number, b: number) =>
      Math.abs(c.r - r) < 60 && Math.abs(c.g - g) < 60 && Math.abs(c.b - b) < 60;
    expect(colors.some((c) => near(c.rgb, 255, 0, 0))).toBe(true);
    expect(colors.some((c) => near(c.rgb, 0, 255, 0))).toBe(true);
    expect(colors.some((c) => near(c.rgb, 0, 0, 255))).toBe(true);
    // Les poids couvrent l'ensemble.
    expect(colors.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 1);
  });
});

describe("QR codes", () => {
  it("génère un PNG et un SVG", async () => {
    const png = await generateQrPng("FOURTOUT-QR-2026", { width: 256 });
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const svg = new TextDecoder().decode(await generateQrSvg("FOURTOUT-QR-2026"));
    expect(svg).toContain("<svg");
  });

  it("relit le contenu d'un QR généré (aller-retour)", async () => {
    const text = "https://example.com/fourtout-test";
    const png = await generateQrPng(text, { width: 320, margin: 4 });
    const image = await loadImage(Buffer.from(png));
    const canvas = nodeRasterBackend.createCanvas(image.width, image.height);
    (canvas.context as SKRSContext2D).drawImage(image, 0, 0);
    const decoded = decodeQr(canvas.getPixels());
    expect(decoded).toBe(text);
    expect(looksLikeUrl(decoded!)).toBe(true);
  });
});
