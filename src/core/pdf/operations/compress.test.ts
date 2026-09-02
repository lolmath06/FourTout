// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { compressPdf } from "./compress";
import { extractImages } from "./extractImages";
import { listEmbeddedImages, undoPngPredictor, inflate, deflate } from "../imageObjects";
import { PdfError } from "../errors";
import { setRasterBackend } from "../raster/types";
import { nodeRasterBackend, configurePdfJsForNode } from "@/test/nodeRaster";
import { buildPng } from "@/test/pdfFixtures";
import { createZip, crc32 } from "@/core/archive/zip";

beforeAll(() => {
  configurePdfJsForNode();
  setRasterBackend(nodeRasterBackend);
});

/**
 * Construit un PDF contenant de vraies images photographiques.
 * Un dégradé bruité se comprime mal en PNG et bien en JPEG : c'est exactement
 * le profil d'un document scanné, donc le cas que la compression doit traiter.
 */
async function buildImagePdf(count = 2, size = 500): Promise<Uint8Array> {
  const document = await PDFDocument.create();

  for (let index = 0; index < count; index += 1) {
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

    const image = await document.embedPng(await canvas.encode("png"));
    const page = document.addPage([size, size]);
    page.drawImage(image, { x: 0, y: 0, width: size, height: size });
  }

  return document.save();
}

describe("inventaire des images embarquées", () => {
  it("repère les images et leur encodage", async () => {
    const bytes = await buildImagePdf(2, 120);
    const document = await PDFDocument.load(bytes);
    const images = listEmbeddedImages(document);

    expect(images).toHaveLength(2);
    expect(images[0].width).toBe(120);
    expect(images[0].height).toBe(120);
    expect(images[0].encoding).toBe("raw");
    expect(images[0].components).toBe(3);
  });

  it("reconnaît un flux JPEG intégré tel quel", async () => {
    const canvas = nodeRasterBackend.createCanvas(60, 40);
    canvas.putPixels({
      width: 60,
      height: 40,
      data: new Uint8ClampedArray(60 * 40 * 4).fill(180),
    });
    const jpeg = await canvas.encode("jpeg", 0.8);

    const document = await PDFDocument.create();
    const embedded = await document.embedJpg(jpeg);
    document.addPage([60, 40]).drawImage(embedded, { x: 0, y: 0, width: 60, height: 40 });

    const reloaded = await PDFDocument.load(await document.save());
    const images = listEmbeddedImages(reloaded);
    expect(images[0].encoding).toBe("jpeg");
  });
});

describe("filtre prédictif PNG", () => {
  it("annule un prédicteur « Up »", () => {
    // Deux lignes de 3 octets, filtre 2 (Up) : chaque ligne s'ajoute à la précédente.
    const data = new Uint8Array([0, 10, 20, 30, 2, 1, 2, 3]);
    expect([...undoPngPredictor(data, 3, 8, 1)]).toEqual([10, 20, 30, 11, 22, 33]);
  });

  it("laisse intactes les lignes sans filtre", () => {
    const data = new Uint8Array([0, 5, 6, 7]);
    expect([...undoPngPredictor(data, 3, 8, 1)]).toEqual([5, 6, 7]);
  });
});

describe("compression zlib", () => {
  it("fait l'aller-retour", async () => {
    const source = new TextEncoder().encode("FourTout ".repeat(50));
    const compressed = await deflate(source);
    expect(compressed.length).toBeLessThan(source.length);
    expect(await inflate(compressed)).toEqual(source);
  });
});

describe("compression PDF", () => {
  it("réduit réellement un document riche en images", async () => {
    const bytes = await buildImagePdf(2, 500);
    const result = await compressPdf({ name: "photos.pdf", bytes }, "strong");

    expect(result.improved).toBe(true);
    expect(result.compressedSize).toBeLessThan(result.originalSize);
    expect(result.savedPercent).toBeGreaterThan(50);
    expect(result.imagesRecompressed).toBe(2);
    expect(result.output.name).toBe("photos-compresse.pdf");
  });

  it("produit un fichier toujours lisible", async () => {
    const bytes = await buildImagePdf(1, 300);
    const result = await compressPdf({ name: "photo.pdf", bytes }, "balanced");

    const reloaded = await PDFDocument.load(result.output.bytes);
    expect(reloaded.getPageCount()).toBe(1);
    const images = listEmbeddedImages(reloaded);
    expect(images[0].encoding).toBe("jpeg");
  });

  it("réduit davantage en mode fort qu'en mode équilibré", async () => {
    const bytes = await buildImagePdf(1, 600);
    const balanced = await compressPdf({ name: "p.pdf", bytes }, "balanced");
    const strong = await compressPdf({ name: "p.pdf", bytes }, "strong");

    expect(strong.compressedSize).toBeLessThan(balanced.compressedSize);
  });

  it("réencode les images à haute qualité en mode léger, sans les réduire", async () => {
    const bytes = await buildImagePdf(1, 400);
    const result = await compressPdf({ name: "p.pdf", bytes }, "light");

    // Le mode léger tente réellement une réduction (correction du « +0,0 % »).
    expect(result.imagesRecompressed).toBe(1);
    const reloaded = await PDFDocument.load(result.output.bytes);
    const image = listEmbeddedImages(reloaded)[0];
    expect(image.encoding).toBe("jpeg");
    // La résolution n'est pas réduite en mode léger.
    expect(image.width).toBe(400);
  });

  it("dit la vérité quand il n'y a rien à gagner", async () => {
    // Un document purement textuel n'offre aucune image à recompresser.
    const document = await PDFDocument.create();
    document.addPage([200, 200]);
    const bytes = await document.save();

    const result = await compressPdf({ name: "vide.pdf", bytes }, "strong");
    expect(result.imagesRecompressed).toBe(0);
    expect(typeof result.improved).toBe("boolean");
    expect(result.savedPercent).toBeLessThan(60);
  });

  it("laisse le fichier source intact", async () => {
    const bytes = await buildImagePdf(1, 200);
    const copy = bytes.slice();
    await compressPdf({ name: "p.pdf", bytes }, "strong");
    expect(bytes).toEqual(copy);
  });
});

describe("extraction des images", () => {
  it("sort une image par objet embarqué", async () => {
    const bytes = await buildImagePdf(2, 150);
    const result = await extractImages({ name: "photos.pdf", bytes });

    expect(result.found).toBe(2);
    expect(result.files).toHaveLength(2);
    expect(result.files[0].name).toBe("photos-image-01.png");
    expect(result.files[0].bytes.subarray(0, 4)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
  });

  it("recopie un JPEG embarqué sans le réencoder", async () => {
    const canvas = nodeRasterBackend.createCanvas(80, 60);
    canvas.putPixels({
      width: 80,
      height: 60,
      data: new Uint8ClampedArray(80 * 60 * 4).fill(120),
    });
    const jpeg = await canvas.encode("jpeg", 0.9);

    const document = await PDFDocument.create();
    const embedded = await document.embedJpg(jpeg);
    document.addPage([80, 60]).drawImage(embedded, { x: 0, y: 0, width: 80, height: 60 });
    const bytes = await document.save();

    const result = await extractImages({ name: "doc.pdf", bytes });
    expect(result.files[0].name).toBe("doc-image-01.jpg");
    expect(result.files[0].bytes).toEqual(jpeg);
  });

  it("signale un document sans image", async () => {
    const document = await PDFDocument.create();
    document.addPage([100, 100]);
    const bytes = await document.save();

    await expect(extractImages({ name: "vide.pdf", bytes })).rejects.toMatchObject({
      code: "no-images-found",
    });
  });

  it("refuse un fichier qui n'est pas un PDF", async () => {
    await expect(
      extractImages({ name: "faux.pdf", bytes: new TextEncoder().encode("bonjour") }),
    ).rejects.toBeInstanceOf(PdfError);
  });
});

describe("archive ZIP", () => {
  it("produit une archive dont l'en-tête est conforme", async () => {
    const zip = createZip([
      { name: "un.txt", bytes: new TextEncoder().encode("bonjour") },
      { name: "deux.png", bytes: await buildPng(4, 4, [1, 2, 3]) },
    ]);

    expect(zip.subarray(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    // Signature de fin de répertoire central.
    const tail = zip.subarray(zip.length - 22, zip.length - 18);
    expect(tail).toEqual(new Uint8Array([0x50, 0x4b, 0x05, 0x06]));
  });

  it("calcule un CRC-32 conforme", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("gère les noms accentués", () => {
    const zip = createZip([
      { name: "été/rapport final.txt", bytes: new TextEncoder().encode("x") },
    ]);
    expect(new TextDecoder().decode(zip)).toContain("été/rapport final.txt");
  });
});

describe("niveaux de compression distincts", () => {
  it("Original > Légère > Équilibrée > Forte sur un document compressible", async () => {
    const bytes = await buildImagePdf(2, 500);
    const original = bytes.length;

    const light = await compressPdf({ name: "p.pdf", bytes }, "light");
    const balanced = await compressPdf({ name: "p.pdf", bytes }, "balanced");
    const strong = await compressPdf({ name: "p.pdf", bytes }, "strong");

    expect(light.imagesRecompressed).toBe(2);
    expect(balanced.imagesRecompressed).toBe(2);
    expect(strong.imagesRecompressed).toBe(2);

    // La légère gagne réellement de la place (corrige l'ancien « +0,0 % »).
    expect(light.improved).toBe(true);
    expect(light.compressedSize).toBeLessThan(original);

    // Ordre attendu.
    expect(light.compressedSize).toBeGreaterThan(balanced.compressedSize);
    expect(balanced.compressedSize).toBeGreaterThan(strong.compressedSize);

    for (const result of [light, balanced, strong]) {
      const doc = await PDFDocument.load(result.output.bytes);
      expect(doc.getPageCount()).toBe(2);
    }
  }, 30_000);
});
