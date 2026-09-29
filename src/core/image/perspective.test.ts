// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setRasterBackend, type RasterCanvas } from "@/core/pdf/raster/types";
import { nodeRasterBackend } from "@/test/nodeRaster";
import { HEAVY_TIMEOUT } from "@/test/timeouts";
import { decodeImage } from "./codec";
import { ImageError } from "./errors";
import {
  applyHomography,
  computeHomography,
  correctPerspective,
  isUsableQuad,
  resolveOutputSize,
  suggestOutputSize,
  type Point,
  type Quad,
} from "./perspective";

const DIR = join(process.cwd(), "test-assets", "generated");

beforeAll(() => {
  setRasterBackend(nodeRasterBackend);
  execFileSync(process.execPath, [join(process.cwd(), "scripts/generate-document-assets.mjs")], {
    stdio: "ignore",
  });
}, HEAVY_TIMEOUT);

afterAll(() => setRasterBackend(undefined));

const corners = (quad: Quad) =>
  [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft] as [Point, Point, Point, Point];

const rectangle = (width: number, height: number): Quad => ({
  topLeft: { x: 0, y: 0 },
  topRight: { x: width, y: 0 },
  bottomRight: { x: width, y: height },
  bottomLeft: { x: 0, y: height },
});

/* ============================================================ homographie */

describe("homographie", () => {
  it("est l'identité entre un rectangle et lui-même", () => {
    const square = corners(rectangle(100, 80));
    const homography = computeHomography(square, square)!;
    expect(homography.a).toBeCloseTo(1, 9);
    expect(homography.e).toBeCloseTo(1, 9);
    expect(homography.b).toBeCloseTo(0, 9);
    expect(homography.d).toBeCloseTo(0, 9);
    expect(homography.g).toBeCloseTo(0, 9);
    expect(homography.h).toBeCloseTo(0, 9);

    for (const point of [{ x: 12, y: 34 }, { x: 99, y: 1 }]) {
      const mapped = applyHomography(homography, point);
      expect(mapped.x).toBeCloseTo(point.x, 6);
      expect(mapped.y).toBeCloseTo(point.y, 6);
    }
  });

  it("envoie exactement les quatre coins sur leurs images", () => {
    const from = corners(rectangle(200, 100));
    const to: [Point, Point, Point, Point] = [
      { x: 20, y: 15 },
      { x: 180, y: 40 },
      { x: 170, y: 190 },
      { x: 10, y: 160 },
    ];
    const homography = computeHomography(from, to)!;
    from.forEach((point, index) => {
      const mapped = applyHomography(homography, point);
      expect(mapped.x).toBeCloseTo(to[index].x, 6);
      expect(mapped.y).toBeCloseTo(to[index].y, 6);
    });
  });

  it("est réellement projective, et non affine", () => {
    // Un trapèze ne peut pas être obtenu d'un rectangle par une transformation
    // affine : les coefficients de perspective doivent être non nuls.
    const homography = computeHomography(corners(rectangle(100, 100)), [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 80, y: 100 },
      { x: 20, y: 100 },
    ])!;
    expect(Math.abs(homography.g) + Math.abs(homography.h)).toBeGreaterThan(1e-6);

    // Le milieu d'un côté du rectangle ne va pas au milieu du côté image :
    // c'est la signature d'une projection.
    const middle = applyHomography(homography, { x: 50, y: 50 });
    expect(middle.y).not.toBeCloseTo(50, 3);
  });

  it("refuse quatre points alignés", () => {
    const aligned: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 30, y: 30 },
    ];
    expect(computeHomography(aligned, corners(rectangle(10, 10)))).toBeUndefined();
  });
});

/* ============================================================ dimensions */

describe("dimensions et validité du quadrilatère", () => {
  it("retient le plus long de chaque paire de côtés opposés", () => {
    const quad: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 100, y: 0 },
      bottomRight: { x: 200, y: 300 },
      bottomLeft: { x: 0, y: 300 },
    };
    // Haut : 100 ; bas : 200 → largeur 200.
    expect(suggestOutputSize(quad).width).toBe(200);
    // Gauche : 300 ; droite : hypoténuse de 100 × 300 ≈ 316.
    expect(suggestOutputSize(quad).height).toBe(316);
  });

  it("accepte un quadrilatère convexe et refuse un quadrilatère croisé", () => {
    expect(isUsableQuad(rectangle(100, 100))).toBe(true);
    // Coins haut-droite et bas-droite échangés : nœud papillon.
    expect(
      isUsableQuad({
        topLeft: { x: 0, y: 0 },
        topRight: { x: 100, y: 100 },
        bottomRight: { x: 100, y: 0 },
        bottomLeft: { x: 0, y: 100 },
      }),
    ).toBe(false);
  });

  it("refuse un quadrilatère dégénéré", () => {
    expect(isUsableQuad(rectangle(1, 1))).toBe(false);
  });
});

/* ================================================================ rendu */

/** Toile de test : quatre quadrants de couleurs franches. */
function quadrantCanvas(size = 120): RasterCanvas {
  const canvas = nodeRasterBackend.createCanvas(size, size);
  const context = canvas.context as CanvasRenderingContext2D;
  const half = size / 2;
  const colors = ["#ff0000", "#00ff00", "#0000ff", "#ffff00"];
  [[0, 0], [half, 0], [half, half], [0, half]].forEach(([x, y], index) => {
    context.fillStyle = colors[index];
    context.fillRect(x, y, half, half);
  });
  return canvas;
}

function pixelAt(canvas: RasterCanvas, x: number, y: number): [number, number, number, number] {
  const pixels = canvas.getPixels();
  const offset = (Math.round(y) * pixels.width + Math.round(x)) * 4;
  return [
    pixels.data[offset],
    pixels.data[offset + 1],
    pixels.data[offset + 2],
    pixels.data[offset + 3],
  ];
}

describe("redressement", () => {
  it("reproduit l'image à l'identique sur un quadrilatère rectangle", () => {
    const source = quadrantCanvas();
    const result = correctPerspective(source, { quad: rectangle(120, 120) });
    expect(result.width).toBe(120);
    expect(result.height).toBe(120);
    // Chaque quadrant garde sa couleur et sa place.
    expect(pixelAt(result.canvas, 30, 30)[0]).toBeGreaterThan(200); // rouge
    expect(pixelAt(result.canvas, 90, 30)[1]).toBeGreaterThan(200); // vert
    expect(pixelAt(result.canvas, 90, 90)[2]).toBeGreaterThan(200); // bleu
  });

  it("ne produit aucun effet miroir", () => {
    const source = quadrantCanvas();
    const result = correctPerspective(source, { quad: rectangle(120, 120) });
    const topLeft = pixelAt(result.canvas, 20, 20);
    const topRight = pixelAt(result.canvas, 100, 20);
    // Rouge en haut à gauche, vert en haut à droite : l'ordre est conservé.
    expect(topLeft[0]).toBeGreaterThan(topLeft[1]);
    expect(topRight[1]).toBeGreaterThan(topRight[0]);
  });

  it("redresse un quadrilatère en rectangle frontal", () => {
    const size = 160;
    const source = nodeRasterBackend.createCanvas(size, size);
    const context = source.context as CanvasRenderingContext2D;
    context.fillStyle = "#202020";
    context.fillRect(0, 0, size, size);
    // Feuille blanche vue en biais, avec une pastille rouge dans son coin
    // haut-gauche : elle doit se retrouver dans le coin haut-gauche du résultat.
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.moveTo(30, 20);
    context.lineTo(140, 40);
    context.lineTo(130, 150);
    context.lineTo(20, 130);
    context.closePath();
    context.fill();
    context.fillStyle = "#ff0000";
    context.beginPath();
    context.arc(42, 34, 7, 0, Math.PI * 2);
    context.fill();

    const result = correctPerspective(source, {
      quad: {
        topLeft: { x: 30, y: 20 },
        topRight: { x: 140, y: 40 },
        bottomRight: { x: 130, y: 150 },
        bottomLeft: { x: 20, y: 130 },
      },
    });

    // La pastille est dans le premier quart haut-gauche du rectangle produit.
    const [r, g, b] = pixelAt(result.canvas, result.width * 0.11, result.height * 0.12);
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(120);
    expect(b).toBeLessThan(120);

    // Le centre du rectangle est du papier blanc : plus aucun fond sombre.
    const centre = pixelAt(result.canvas, result.width / 2, result.height / 2);
    expect(centre[0]).toBeGreaterThan(200);
    expect(centre[3]).toBe(255);
  });

  it("respecte les dimensions imposées", () => {
    const result = correctPerspective(quadrantCanvas(), {
      quad: rectangle(120, 120),
      width: 60,
      height: 300,
    });
    expect(result.width).toBe(60);
    expect(result.height).toBe(300);
  });

  it("conserve la couleur, la transparence, ou les convertit selon le mode", () => {
    const source = quadrantCanvas();
    const color = correctPerspective(source, { quad: rectangle(120, 120), rendering: "color" });
    const gray = correctPerspective(source, { quad: rectangle(120, 120), rendering: "grayscale" });
    const document = correctPerspective(source, { quad: rectangle(120, 120), rendering: "document" });

    const [cr, cg] = pixelAt(color.canvas, 30, 30);
    expect(cr).not.toBe(cg);

    const [gr, gg, gb, ga] = pixelAt(gray.canvas, 30, 30);
    expect(gr).toBe(gg);
    expect(gg).toBe(gb);
    expect(ga).toBe(255);

    // Noir et blanc strict : aucune valeur intermédiaire.
    const pixels = document.canvas.getPixels();
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      expect([0, 255]).toContain(pixels.data[offset]);
    }
  });

  it("laisse transparent ce qui tombe hors de la photo", () => {
    const source = quadrantCanvas(100);
    // Quadrilatère qui déborde largement de l'image.
    const result = correctPerspective(source, {
      quad: {
        topLeft: { x: -100, y: -100 },
        topRight: { x: 200, y: -100 },
        bottomRight: { x: 200, y: 200 },
        bottomLeft: { x: -100, y: 200 },
      },
    });
    expect(pixelAt(result.canvas, 5, 5)[3]).toBe(0);
    expect(pixelAt(result.canvas, result.width / 2, result.height / 2)[3]).toBe(255);
  });

  it("refuse un quadrilatère croisé avec une erreur exploitable", () => {
    expect(() =>
      correctPerspective(quadrantCanvas(), {
        quad: {
          topLeft: { x: 0, y: 0 },
          topRight: { x: 100, y: 100 },
          bottomRight: { x: 100, y: 0 },
          bottomLeft: { x: 0, y: 100 },
        },
      }),
    ).toThrowError(ImageError);
  });
});

/* ================================================== fixture photographiée */

describe("photo de document réelle", () => {
  it("redresse la feuille de scan-perspective.jpg", async () => {
    const meta = JSON.parse(readFileSync(join(DIR, "scan-perspective.json"), "utf8")) as {
      corners: Quad;
    };
    const source = await decodeImage(
      new Uint8Array(readFileSync(join(DIR, "scan-perspective.jpg"))),
      "jpg",
    );

    const result = correctPerspective(source, { quad: meta.corners, rendering: "color" });

    // La feuille d'origine mesurait 900 × 1200, soit un rapport de 0,75. Les
    // dimensions déduites des seuls coins l'approchent sans l'atteindre : une
    // photo est une projection, et retrouver les proportions exactes
    // supposerait de connaître la focale. On vérifie donc l'ordre de grandeur,
    // et l'on s'appuie sur le format imposé ci-dessous pour l'exactitude.
    const ratio = result.width / result.height;
    expect(ratio).toBeGreaterThan(0.65);
    expect(ratio).toBeLessThan(0.95);

    // Plus de fond sombre : la quasi-totalité du rectangle est du papier.
    const pixels = result.canvas.getPixels();
    let bright = 0;
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      if (pixels.data[offset] > 180) bright += 1;
    }
    expect(bright / (pixels.data.length / 4)).toBeGreaterThan(0.75);
  }, HEAVY_TIMEOUT);

  it("rend les proportions exactes quand on impose le format", async () => {
    const meta = JSON.parse(readFileSync(join(DIR, "scan-perspective.json"), "utf8")) as {
      corners: Quad;
    };
    const source = await decodeImage(
      new Uint8Array(readFileSync(join(DIR, "scan-perspective.jpg"))),
      "jpg",
    );
    const result = correctPerspective(source, { quad: meta.corners, aspect: "a4-portrait" });
    expect(result.width / result.height).toBeCloseTo(210 / 297, 2);
  }, HEAVY_TIMEOUT);
});

describe("dimensions finales", () => {
  const suggested = { width: 800, height: 1000 };

  it("respecte les dimensions explicites avant tout", () => {
    expect(resolveOutputSize(suggested, { width: 300, height: 400, aspect: "square" })).toEqual({
      width: 300,
      height: 400,
    });
  });

  it("applique le format imposé", () => {
    const a4 = resolveOutputSize(suggested, { aspect: "a4-portrait" });
    expect(a4.width / a4.height).toBeCloseTo(210 / 297, 2);
    const square = resolveOutputSize(suggested, { aspect: "square" });
    expect(square.width).toBe(square.height);
  });

  it("retombe sur les dimensions déduites", () => {
    expect(resolveOutputSize(suggested, {})).toEqual(suggested);
    expect(resolveOutputSize(suggested, { aspect: "auto" })).toEqual(suggested);
  });
});
