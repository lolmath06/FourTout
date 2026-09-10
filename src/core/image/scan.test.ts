// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setRasterBackend, type RasterCanvas } from "@/core/pdf/raster/types";
import { nodeRasterBackend } from "@/test/nodeRaster";
import { HEAVY_TIMEOUT } from "@/test/timeouts";
import { decodeImage } from "./codec";
import {
  adaptiveThreshold,
  cleanScan,
  estimateSkew,
  MAX_SKEW_DEGREES,
  rotateFine,
  whitenBackground,
} from "./scan";

const DIR = join(process.cwd(), "test-assets", "generated");

beforeAll(() => {
  setRasterBackend(nodeRasterBackend);
  execFileSync(process.execPath, [join(process.cwd(), "scripts/generate-document-assets.mjs")], {
    stdio: "ignore",
  });
}, HEAVY_TIMEOUT);

afterAll(() => setRasterBackend(undefined));

const load = (name: string) =>
  decodeImage(new Uint8Array(readFileSync(join(DIR, name))), name.split(".").pop());

/** Page de texte synthétique : des barres horizontales régulières. */
function linedPage(width = 600, height = 800, angleDegrees = 0): RasterCanvas {
  const canvas = nodeRasterBackend.createCanvas(width, height);
  const context = canvas.context as CanvasRenderingContext2D;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.translate(width / 2, height / 2);
  context.rotate((angleDegrees * Math.PI) / 180);
  context.fillStyle = "#101010";
  for (let line = 0; line < 16; line += 1) {
    context.fillRect(-width / 2 + 60, -height / 2 + 60 + line * 44, width - 140, 14);
  }
  return canvas;
}

/* =========================================================== redressement */

describe("estimation du travers", () => {
  it("ne voit aucun travers sur une page droite", () => {
    const estimate = estimateSkew(linedPage().getPixels());
    expect(Math.abs(estimate.angle)).toBeLessThanOrEqual(0.5);
  });

  it("retrouve un travers connu", () => {
    for (const angle of [-3, -1.5, 2, 3.5]) {
      const estimate = estimateSkew(linedPage(600, 800, angle).getPixels());
      // Le redressement doit annuler l'inclinaison : l'angle détecté est celui
      // qu'il faut appliquer en sens inverse.
      expect(Math.abs(estimate.angle + angle), `angle ${angle}`).toBeLessThanOrEqual(0.75);
      expect(estimate.confidence, `angle ${angle}`).toBeGreaterThan(0.1);
    }
  });

  it("reste dans la plage annoncée", () => {
    const estimate = estimateSkew(linedPage(600, 800, 20).getPixels());
    expect(Math.abs(estimate.angle)).toBeLessThanOrEqual(MAX_SKEW_DEGREES);
  });

  it("avoue son incertitude sur une image sans lignes", () => {
    const canvas = nodeRasterBackend.createCanvas(200, 200);
    const context = canvas.context as CanvasRenderingContext2D;
    context.fillStyle = "#808080";
    context.fillRect(0, 0, 200, 200);
    expect(estimateSkew(canvas.getPixels()).confidence).toBeLessThan(0.3);
  });

  it("ne bute pas sur une image minuscule", () => {
    const canvas = nodeRasterBackend.createCanvas(4, 4);
    expect(estimateSkew(canvas.getPixels())).toEqual({ angle: 0, confidence: 0 });
  });

  it("mesure le travers de la fixture scan-skewed.jpg", async () => {
    const canvas = await load("scan-skewed.jpg");
    const estimate = estimateSkew(canvas.getPixels());
    // La fixture est inclinée de 3,2° (voir le générateur).
    expect(estimate.angle).toBeLessThan(-2);
    expect(estimate.angle).toBeGreaterThan(-4.2);
    expect(estimate.confidence).toBeGreaterThan(0.1);
  }, HEAVY_TIMEOUT);
});

describe("rotation fine", () => {
  it("ne touche pas à une image pour un angle nul", () => {
    const source = linedPage(120, 160);
    const result = rotateFine(source, 0);
    expect(result.width).toBe(120);
    expect(result.height).toBe(160);
    expect(result).not.toBe(source);
  });

  it("agrandit la toile pour ne rien couper", () => {
    const result = rotateFine(linedPage(100, 100), 45);
    expect(result.width).toBeGreaterThan(140);
    expect(result.height).toBeGreaterThan(140);
  });

  it("comble le fond découvert en blanc, jamais en transparent", () => {
    const data = rotateFine(linedPage(100, 100), 30).getPixels();
    // Coin haut-gauche : découvert par la rotation.
    expect(data.data[0]).toBe(255);
    expect(data.data[3]).toBe(255);
  });

  it("redresse effectivement une page penchée", () => {
    const skewed = linedPage(600, 800, 3);
    const before = estimateSkew(skewed.getPixels());
    const straightened = rotateFine(skewed, before.angle);
    const after = estimateSkew(straightened.getPixels());
    expect(Math.abs(after.angle)).toBeLessThan(Math.abs(before.angle));
    expect(Math.abs(after.angle)).toBeLessThanOrEqual(1);
  });
});

/* ============================================================== nettoyage */

describe("blanchiment du fond", () => {
  it("ramène un fond grisé au blanc sans toucher au texte", () => {
    const canvas = nodeRasterBackend.createCanvas(10, 10);
    const context = canvas.context as CanvasRenderingContext2D;
    context.fillStyle = "#d8d6cf"; // fond jauni
    context.fillRect(0, 0, 10, 10);
    context.fillStyle = "#303030"; // texte
    context.fillRect(0, 0, 3, 3);

    const result = whitenBackground(canvas, 80).getPixels();
    expect(result.data[(5 * 10 + 5) * 4]).toBe(255);
    // L'encre est rigoureusement inchangée : elle est sous le plancher.
    expect(result.data[0]).toBe(0x30);
  });

  it("laisse intact tout ce qui est plus sombre que le plancher", () => {
    const canvas = nodeRasterBackend.createCanvas(4, 4);
    const context = canvas.context as CanvasRenderingContext2D;
    // Gris moyen-sombre : typique d'un trait fin ou d'un texte pâle.
    context.fillStyle = "#4a4a4a";
    context.fillRect(0, 0, 4, 4);
    for (const strength of [20, 50, 80, 100]) {
      expect(whitenBackground(canvas, strength).getPixels().data[0], `intensité ${strength}`).toBe(
        0x4a,
      );
    }
  });

  it("ne change rien à intensité nulle", () => {
    const canvas = nodeRasterBackend.createCanvas(4, 4);
    const context = canvas.context as CanvasRenderingContext2D;
    context.fillStyle = "#c0c0c0";
    context.fillRect(0, 0, 4, 4);
    expect(whitenBackground(canvas, 0).getPixels().data[0]).toBe(0xc0);
  });
});

describe("binarisation adaptative", () => {
  it("ne produit que du noir et du blanc", () => {
    const result = adaptiveThreshold(linedPage(120, 120)).getPixels();
    for (let offset = 0; offset < result.data.length; offset += 4) {
      expect([0, 255]).toContain(result.data[offset]);
    }
  });

  it("suit un éclairage inégal, là où un seuil global échouerait", () => {
    // Dégradé de fond de 60 à 240, avec un trait sombre constant au milieu.
    const canvas = nodeRasterBackend.createCanvas(200, 40);
    const context = canvas.context as CanvasRenderingContext2D;
    const gradient = context.createLinearGradient(0, 0, 200, 0);
    gradient.addColorStop(0, "#3c3c3c");
    gradient.addColorStop(1, "#f0f0f0");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 200, 40);
    context.fillStyle = "#000000";
    context.fillRect(0, 18, 200, 5);

    const result = adaptiveThreshold(canvas, 20).getPixels();
    // Le trait ressort en noir sur toute sa longueur, y compris dans la zone
    // sombre où un seuil unique aurait tout noirci.
    for (const x of [10, 100, 190]) {
      expect(result.data[(20 * 200 + x) * 4], `x=${x}`).toBe(0);
      // Et le fond au-dessus reste blanc.
      expect(result.data[(5 * 200 + x) * 4], `fond x=${x}`).toBe(255);
    }
  });
});

describe("chaîne de nettoyage", () => {
  it("renvoie une copie quand aucun réglage n'est demandé", () => {
    const source = linedPage(60, 60);
    const result = cleanScan(source, {});
    expect(result).not.toBe(source);
    expect(result.width).toBe(60);
    expect(result.getPixels().data[0]).toBe(255);
  });

  it("applique redressement, exposition et rendu dans l'ordre", () => {
    const result = cleanScan(linedPage(300, 300, 2), {
      deskew: -2,
      contrast: 20,
      rendering: "bw",
    });
    // Le redressement agrandit la toile ; le rendu N&B la binarise.
    expect(result.width).toBeGreaterThan(300);
    const pixels = result.getPixels();
    for (let offset = 0; offset < pixels.data.length; offset += 4 * 997) {
      expect([0, 255]).toContain(pixels.data[offset]);
    }
  });

  it("produit des niveaux de gris à la demande", () => {
    const result = cleanScan(linedPage(60, 60), { rendering: "grayscale" }).getPixels();
    expect(result.data[0]).toBe(result.data[1]);
    expect(result.data[1]).toBe(result.data[2]);
  });

  it("relève un scan peu contrasté", async () => {
    const source = await load("scan-low-contrast.jpg");

    /** Écart entre l'encre la plus sombre et le papier le plus clair. */
    const spread = (canvas: RasterCanvas) => {
      const pixels = canvas.getPixels();
      let min = 255;
      let max = 0;
      for (let offset = 0; offset < pixels.data.length; offset += 4 * 37) {
        min = Math.min(min, pixels.data[offset]);
        max = Math.max(max, pixels.data[offset]);
      }
      return max - min;
    };

    const before = spread(source);
    // Le contraste est l'outil de ce défaut-là : il écarte encre et papier.
    expect(spread(cleanScan(source, { contrast: 45, rendering: "grayscale" }))).toBeGreaterThan(
      before,
    );
  }, HEAVY_TIMEOUT);

  it("blanchit le papier jauni d'un scan réel", async () => {
    const source = await load("scan-low-contrast.jpg");
    const cleaned = cleanScan(source, { whiten: 75, rendering: "grayscale" }).getPixels();
    // Le papier, gris-beige à l'origine, ressort blanc.
    let white = 0;
    let total = 0;
    for (let offset = 0; offset < cleaned.data.length; offset += 4 * 13) {
      total += 1;
      if (cleaned.data[offset] === 255) white += 1;
    }
    expect(white / total).toBeGreaterThan(0.7);
  }, HEAVY_TIMEOUT);
});
