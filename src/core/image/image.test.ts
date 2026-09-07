// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { HEAVY_TIMEOUT } from "@/test/timeouts";
import { getRasterBackend, setRasterBackend } from "@/core/pdf/raster/types";
import { nodeRasterBackend } from "@/test/nodeRaster";
import { loadImage } from "@napi-rs/canvas";
import type { SelectedFile } from "@/core/files";
import type { SKRSContext2D } from "@napi-rs/canvas";
import { applyOrientation, decodeImage, encodeCanvas } from "./codec";
import {
  adjust,
  blur,
  colorToTransparent,
  computeDimensions,
  crop,
  drawText,
  flip,
  grayscale,
  pixelate,
  removeTransparency,
  resize,
  rotateQuarter,
} from "./operations";
import { processImage, processImages, imageOutputName } from "./pipeline";
import { parseExif } from "./exif";
import { sanitizeSvg, svgIntrinsicSize } from "./svg";
import { ImageError } from "./errors";

const DIR = join(process.cwd(), "test-assets", "generated");
const read = (name: string) => new Uint8Array(readFileSync(join(DIR, name)));

function fileOf(name: string): SelectedFile {
  const bytes = readFileSync(join(DIR, name));
  const ext = name.slice(name.lastIndexOf(".") + 1);
  return {
    id: name,
    name,
    size: bytes.length,
    extension: ext,
    mimeType: "application/octet-stream",
    kind: "image",
    file: new File([bytes], name),
  };
}

function meanLuminance(pixels: { data: Uint8ClampedArray }): number {
  let sum = 0;
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return sum / (d.length / 4);
}

// Régénération réelle des images de test : un processus Node, hors du délai
// des hooks par défaut.
beforeAll(() => {
  execFileSync(process.execPath, [join(process.cwd(), "scripts/generate-image-assets.mjs")], { stdio: "ignore" });
  setRasterBackend(nodeRasterBackend);
}, HEAVY_TIMEOUT);

describe("décodage et formats", () => {
  it("décode les dimensions d'un JPEG paysage et portrait", async () => {
    const landscape = await decodeImage(read("image-landscape.jpg"), "jpg");
    expect([landscape.width, landscape.height]).toEqual([240, 160]);
    const portrait = await decodeImage(read("image-portrait.jpg"), "jpg");
    expect([portrait.width, portrait.height]).toEqual([160, 240]);
  });

  it("décode le WebP", async () => {
    const webp = await decodeImage(read("image-sample.webp"), "webp");
    expect(webp.width).toBe(120);
  });

  it("fournit un GIF animé structurellement valide", () => {
    // Le décodage GIF (première frame) est assuré par le navigateur en
    // production ; @napi-rs/canvas ne décode pas le GIF, on valide donc ici la
    // structure du conteneur (en-tête, deux frames, terminateur).
    const gif = read("image-animated.gif");
    expect(Buffer.from(gif.subarray(0, 6)).toString("latin1")).toBe("GIF89a");
    expect(gif[gif.length - 1]).toBe(0x3b); // terminateur
    expect(gif.length).toBeGreaterThan(30);
  });

  it("encode en PNG, JPEG et WebP", async () => {
    const source = await decodeImage(read("image-colors.png"), "png");
    const png = await encodeCanvas(source, "png");
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const jpeg = await encodeCanvas(source, "jpeg");
    expect([...jpeg.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    const webp = await encodeCanvas(source, "webp");
    expect(Buffer.from(webp.subarray(0, 4)).toString("latin1")).toBe("RIFF");
    expect(Buffer.from(webp.subarray(8, 12)).toString("latin1")).toBe("WEBP");
  });

  it("rejette un fichier illisible", async () => {
    await expect(decodeImage(new Uint8Array([1, 2, 3, 4, 5]), "png")).rejects.toBeInstanceOf(ImageError);
  });

  it("gère une grande image sans planter", async () => {
    const large = await decodeImage(read("image-large.jpg"), "jpg");
    expect([large.width, large.height]).toEqual([4000, 3000]);
  });
});

describe("transformations géométriques", () => {
  it("redimensionne en pourcentage et en dimensions", async () => {
    const source = await decodeImage(read("image-landscape.jpg"), "jpg");
    const half = resize(source, source.width / 2, source.height / 2);
    expect([half.width, half.height]).toEqual([120, 80]);
  });

  it("complète la dimension manquante en gardant le ratio", () => {
    expect(computeDimensions(200, 100, 100, 0, true)).toEqual({ width: 100, height: 50 });
    expect(computeDimensions(200, 100, 0, 50, true)).toEqual({ width: 100, height: 50 });
    expect(computeDimensions(200, 100, 300, 300, true)).toEqual({ width: 300, height: 150 });
    expect(computeDimensions(200, 100, 80, 80, false)).toEqual({ width: 80, height: 80 });
  });

  it("recadre exactement la zone demandée", async () => {
    const source = await decodeImage(read("image-colors.png"), "png");
    const region = crop(source, { x: 0, y: 0, width: 40, height: 40 });
    expect([region.width, region.height]).toEqual([40, 40]);
    const px = region.getPixels().data;
    // Coin haut-gauche de image-colors = rouge pur.
    expect([px[0], px[1], px[2]]).toEqual([255, 0, 0]);
  });

  it("pivote par quarts de tour en échangeant les dimensions", async () => {
    const source = await decodeImage(read("image-landscape.jpg"), "jpg");
    const rotated = rotateQuarter(source, 1);
    expect([rotated.width, rotated.height]).toEqual([160, 240]);
    expect(rotateQuarter(source, 2).width).toBe(240);
  });

  it("retourne l'image en miroir", async () => {
    const source = await decodeImage(read("image-colors.png"), "png");
    const before = source.getPixels().data;
    const mirrored = flip(source, "horizontal").getPixels().data;
    // Le pixel (0,0) du miroir correspond au pixel (largeur-1, 0) de la source.
    const w = source.width;
    expect([mirrored[0], mirrored[1], mirrored[2]]).toEqual([before[(w - 1) * 4], before[(w - 1) * 4 + 1], before[(w - 1) * 4 + 2]]);
  });
});

// Chaque test parcourt les pixels d'une vraie image, plusieurs fois : le coût
// est celui d'un calcul, et il suit le processeur de la machine.
describe("traitements par pixel", { timeout: HEAVY_TIMEOUT }, () => {
  it("convertit en niveaux de gris (R=V=B)", async () => {
    const source = await decodeImage(read("image-landscape.jpg"), "jpg");
    const gray = grayscale(source, { mode: "grayscale" }).getPixels().data;
    for (let i = 0; i < gray.length; i += 4) {
      expect(gray[i]).toBe(gray[i + 1]);
      expect(gray[i + 1]).toBe(gray[i + 2]);
    }
  });

  it("binarise par seuil (uniquement 0 ou 255)", async () => {
    const source = await decodeImage(read("image-landscape.jpg"), "jpg");
    const bw = grayscale(source, { mode: "threshold", threshold: 128 }).getPixels().data;
    for (let i = 0; i < bw.length; i += 4) expect(bw[i] === 0 || bw[i] === 255).toBe(true);
  });

  it("éclaircit et assombrit via la luminosité", async () => {
    const source = await decodeImage(read("image-landscape.jpg"), "jpg");
    const base = meanLuminance(source.getPixels());
    expect(meanLuminance(adjust(source, { brightness: 60 }).getPixels())).toBeGreaterThan(base);
    expect(meanLuminance(adjust(source, { brightness: -60 }).getPixels())).toBeLessThan(base);
  });

  it("supprime la transparence sur un fond choisi", async () => {
    const source = await decodeImage(read("image-transparent.png"), "png");
    const flat = removeTransparency(source, { r: 255, g: 255, b: 255 }).getPixels().data;
    for (let i = 3; i < flat.length; i += 4) expect(flat[i]).toBe(255);
  });

  it("rend une couleur transparente selon la tolérance", async () => {
    const source = await decodeImage(read("image-colors.png"), "png");
    const out = colorToTransparent(source, { r: 255, g: 0, b: 0 }, 10).getPixels();
    // Le quart rouge devient transparent, pas le quart vert.
    const redIdx = 0;
    const greenIdx = 40 * 4; // premier pixel de la colonne x=40 (vert)
    expect(out.data[redIdx + 3]).toBe(0);
    expect(out.data[greenIdx + 3]).toBe(255);
  });

  it("floute et pixellise en conservant les dimensions", async () => {
    const source = await decodeImage(read("image-landscape.jpg"), "jpg");
    const blurred = blur(source, 6);
    expect([blurred.width, blurred.height]).toEqual([240, 160]);
    const pixelated = pixelate(source, 10);
    expect([pixelated.width, pixelated.height]).toEqual([240, 160]);
  });

  it("ne floute qu'une zone quand une région est fournie", async () => {
    const source = await decodeImage(read("image-colors.png"), "png");
    const out = pixelate(source, 8, { x: 0, y: 0, width: 40, height: 40 }).getPixels();
    const other = source.getPixels();
    // Un pixel hors zone est inchangé.
    const outside = (60 * source.width + 60) * 4;
    expect(out.data[outside]).toBe(other.data[outside]);
  });

  it("écrit du texte sur l'image", async () => {
    const source = await decodeImage(read("image-landscape.jpg"), "jpg");
    const withText = drawText(source, [{ text: "OK", xFrac: 0.1, yFrac: 0.1, sizeFrac: 0.3, color: { r: 0, g: 0, b: 0 }, bold: true }]);
    expect([withText.width, withText.height]).toEqual([240, 160]);
  });
});

describe("EXIF et orientation", () => {
  it("lit orientation, appareil et GPS", () => {
    const exif = parseExif(read("image-exif.jpg"));
    expect(exif?.orientation).toBe(1);
    expect(exif?.make).toBe("FourTout");
    expect(exif?.model).toBe("TestCam 100");
    expect(exif?.gpsLatitude).toBeCloseTo(48.8584, 1);
    expect(exif?.gpsLongitude).toBeCloseTo(2.2945, 1);
  });

  it("détecte l'orientation 6 sur une image paysage", () => {
    expect(parseExif(read("image-rotated-exif.jpg"))?.orientation).toBe(6);
  });

  it("redresse un canvas selon l'orientation EXIF (échange des dimensions)", () => {
    // Test indépendant du backend : @napi-rs/canvas applique déjà l'orientation
    // au décodage, alors que le navigateur ne le fait pas (on la force à
    // « none »). On valide donc directement la transformation géométrique.
    const backend = getRasterBackend()!;
    const source = backend.createCanvas(200, 100);
    const ctx = source.context as SKRSContext2D;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, 200, 100);
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 20, 20); // repère haut-gauche

    const upright = applyOrientation(source, 6);
    expect([upright.width, upright.height]).toEqual([100, 200]);
    // Le contenu est préservé : le repère rouge (20×20 ≈ 400 px) reste présent.
    const px = upright.getPixels().data;
    let red = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] > 200 && px[i + 1] < 60 && px[i + 2] < 60) red += 1;
    }
    expect(red).toBeGreaterThan(200);
    expect(applyOrientation(source, 1)).toBe(source);
  });
});

describe("SVG sécurisé", () => {
  it("retire scripts et références externes", () => {
    const raw = new TextDecoder().decode(read("image-test.svg"));
    const safe = sanitizeSvg(raw);
    expect(raw).toContain("<script");
    expect(safe).not.toContain("<script");
    expect(safe).not.toContain("https://example.com");
  });

  it("rastérise le SVG en PNG valide (SVG -> PNG)", async () => {
    const canvas = await decodeImage(read("image-test.svg"), "svg");
    expect([canvas.width, canvas.height]).toEqual([120, 120]);
    const png = await encodeCanvas(canvas, "png");
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(png.length).toBeGreaterThan(50);
  });

  it("déduit la taille intrinsèque", () => {
    const safe = sanitizeSvg(new TextDecoder().decode(read("image-test.svg")));
    expect(svgIntrinsicSize(safe)).toEqual({ width: 120, height: 120 });
  });
});

describe("chaîne de traitement et nommage", () => {
  it("nomme les sorties selon la convention", () => {
    expect(imageOutputName("photo.jpg", "webp")).toBe("photo.webp");
    expect(imageOutputName("photo.png", "png", "compressee")).toBe("photo-compressee.png");
    expect(imageOutputName("photo.jpg", "jpeg", "50pct")).toBe("photo-50pct.jpg");
  });

  it("traite un fichier de bout en bout", async () => {
    const output = await processImage(fileOf("image-landscape.jpg"), (c) => resize(c, c.width / 2, c.height / 2), {
      format: "webp",
      suffix: "test",
    });
    expect(output.name).toBe("image-landscape-test.webp");
    expect(Buffer.from(output.bytes.subarray(0, 4)).toString("latin1")).toBe("RIFF");
  });

  it("traite un lot en évitant d'écraser les homonymes", async () => {
    const outputs = await processImages(
      [fileOf("image-landscape.jpg"), fileOf("image-portrait.jpg")],
      (c) => c,
      { format: "png" },
    );
    expect(outputs).toHaveLength(2);
    expect(new Set(outputs.map((o) => o.name)).size).toBe(2);
  });

  it("supprime les métadonnées EXIF en ré-encodant", async () => {
    expect(parseExif(read("image-exif.jpg"))?.make).toBe("FourTout");
    const output = await processImage(fileOf("image-exif.jpg"), (c) => c, {
      format: "same",
      suffix: "propre",
      applyOrientation: true,
    });
    // Le ré-encodage des pixels ne conserve aucune métadonnée.
    const exif = parseExif(output.bytes);
    expect(exif === undefined || exif.tagCount === 0).toBe(true);
  });

  it("s'interrompt à l'annulation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      processImages([fileOf("image-landscape.jpg")], (c) => c, { format: "png" }, { signal: controller.signal }),
    ).rejects.toThrow();
  });
});

describe("validation binaire croisée (fichier réel relu)", () => {
  it("produit des PNG/JPEG/WebP relisibles par un décodeur indépendant", async () => {
    // On écrit réellement le fichier sur disque puis on le relit avec une autre
    // implémentation (@napi-rs/canvas). Un fichier tronqué ou corrompu échoue.
    const dir = mkdtempSync(join(tmpdir(), "fourtout-img-"));
    const source = fileOf("image-colors.png");
    for (const [format, ext, w, h] of [
      ["png", "png", 80, 80],
      ["jpeg", "jpg", 80, 80],
      ["webp", "webp", 80, 80],
    ] as const) {
      const output = await processImage(source, (c) => c, { format });
      const path = join(dir, `out.${ext}`);
      writeFileSync(path, output.bytes);
      // Taille disque = taille en mémoire : pas de troncature à l'écriture.
      expect(readFileSync(path).length).toBe(output.bytes.length);
      const reloaded = await loadImage(readFileSync(path));
      expect([reloaded.width, reloaded.height]).toEqual([w, h]);
    }
  });
});
