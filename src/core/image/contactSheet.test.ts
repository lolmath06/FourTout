// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { setRasterBackend, type RasterCanvas } from "@/core/pdf/raster/types";
import { nodeRasterBackend } from "@/test/nodeRaster";
import { decodeImage } from "./codec";
import {
  buildContactSheet,
  contactSheetLayout,
  DEFAULT_CONTACT_SHEET,
  fitInCell,
  sortByOrder,
  type ContactSheetOptions,
} from "./contactSheet";

const DIR = join(process.cwd(), "test-assets", "generated");
const CONTRACT = JSON.parse(readFileSync(join(DIR, "CONTRAT.json"), "utf8")) as {
  plancheContact: {
    images: number;
    reglages: { colonnes: number; largeurVignette: number; espacement: number; marge: number };
    lignes: number;
    largeur: number;
    hauteurAvecLegendes: number;
    hauteurSansLegendes: number;
  };
};

const FIXTURES = [
  "contact-red.png",
  "contact-green.png",
  "contact-blue.png",
  "contact-yellow.png",
  "contact-wide.png",
];

/** Couleurs pleines des vignettes : on les retrouve dans la planche produite. */
const COLORS: Record<string, [number, number, number]> = {
  "contact-red.png": [220, 38, 38],
  "contact-green.png": [22, 163, 74],
  "contact-blue.png": [37, 99, 235],
  "contact-yellow.png": [234, 179, 8],
  "contact-wide.png": [124, 58, 237],
};

async function load(name: string): Promise<RasterCanvas> {
  return decodeImage(new Uint8Array(readFileSync(join(DIR, name))), "png");
}

function optionsFromContract(overrides: Partial<ContactSheetOptions> = {}): ContactSheetOptions {
  const { reglages } = CONTRACT.plancheContact;
  return {
    ...DEFAULT_CONTACT_SHEET,
    columns: reglages.colonnes,
    thumbWidth: reglages.largeurVignette,
    gap: reglages.espacement,
    margin: reglages.marge,
    background: { r: 20, g: 20, b: 20 },
    showLabels: false,
    ...overrides,
  };
}

describe("planche-contact", () => {
  beforeAll(() => {
    setRasterBackend(nodeRasterBackend);
  });

  it("calcule des dimensions vérifiables à la main", () => {
    const expected = CONTRACT.plancheContact;
    const withLabels = contactSheetLayout(expected.images, optionsFromContract({ showLabels: true }));
    const without = contactSheetLayout(expected.images, optionsFromContract());

    expect(withLabels.rows).toBe(expected.lignes);
    expect(withLabels.width).toBe(expected.largeur);
    expect(withLabels.height).toBe(expected.hauteurAvecLegendes);
    expect(without.height).toBe(expected.hauteurSansLegendes);
    // Sans légende, la planche est plus courte d'exactement une bande par ligne.
    expect(withLabels.height - without.height).toBe(expected.lignes * withLabels.labelHeight);
  });

  it("rétrécit la planche quand il y a moins d'images que de colonnes", () => {
    const layout = contactSheetLayout(1, optionsFromContract({ columns: 4 }));
    expect(layout.columns).toBe(1);
    expect(layout.rows).toBe(1);
    expect(layout.width).toBe(DEFAULT_CONTACT_SHEET.margin * 2 + layout.cellSize);
  });

  it("inscrit chaque image dans sa case sans la déformer ni l'agrandir", () => {
    // Panorama 80 × 30 dans une case de 120 : il tient déjà, on n'y touche pas.
    expect(fitInCell(80, 30, 120)).toEqual({ width: 80, height: 30 });
    // Image plus grande que la case : réduction à rapport constant.
    expect(fitInCell(400, 200, 100)).toEqual({ width: 100, height: 50 });
    expect(fitInCell(200, 400, 100)).toEqual({ width: 50, height: 100 });
  });

  it("dispose les cinq images une fois chacune, dans l'ordre, sur le fond demandé", async () => {
    const canvases = await Promise.all(FIXTURES.map(load));
    const options = optionsFromContract();
    const sheet = buildContactSheet(
      canvases.map((canvas, index) => ({ canvas, label: FIXTURES[index] })),
      options,
    );

    const expected = CONTRACT.plancheContact;
    expect(sheet.width).toBe(expected.largeur);
    expect(sheet.height).toBe(expected.hauteurSansLegendes);

    const pixels = sheet.getPixels();
    const at = (x: number, y: number): [number, number, number] => {
      const i = (y * pixels.width + x) * 4;
      return [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]];
    };

    // Le fond est bien celui demandé, dans la marge.
    expect(at(2, 2)).toEqual([20, 20, 20]);

    // Centre de chaque case : la couleur de la vignette attendue à cette place.
    const layout = contactSheetLayout(FIXTURES.length, options);
    FIXTURES.forEach((name, index) => {
      const column = index % options.columns;
      const row = Math.floor(index / options.columns);
      const centerX = options.margin + column * (layout.cellSize + options.gap) + layout.cellSize / 2;
      const centerY = options.margin + row * (layout.cellHeight + options.gap) + layout.cellSize / 2;
      expect(at(Math.round(centerX), Math.round(centerY))).toEqual(COLORS[name]);
    });
  });

  it("produit un PNG relisible", async () => {
    const canvases = await Promise.all(FIXTURES.slice(0, 2).map(load));
    const sheet = buildContactSheet(
      canvases.map((canvas, index) => ({ canvas, label: FIXTURES[index] })),
      optionsFromContract({ showLabels: true }),
    );
    const png = await sheet.encode("png");
    const decoded = await decodeImage(png, "png");
    expect(decoded.width).toBe(sheet.width);
    expect(decoded.height).toBe(sheet.height);
  });

  it("trie la liste sans toucher à la source", () => {
    const items = [{ name: "b.png" }, { name: "a.png" }, { name: "c.png" }];
    expect(sortByOrder(items, "dropped").map((i) => i.name)).toEqual(["b.png", "a.png", "c.png"]);
    expect(sortByOrder(items, "name").map((i) => i.name)).toEqual(["a.png", "b.png", "c.png"]);
    expect(sortByOrder(items, "name-desc").map((i) => i.name)).toEqual(["c.png", "b.png", "a.png"]);
    expect(items[0].name).toBe("b.png");
  });

  it("refuse une planche sans image", () => {
    expect(() => buildContactSheet([], DEFAULT_CONTACT_SHEET)).toThrow(/aucune image/i);
  });
});
