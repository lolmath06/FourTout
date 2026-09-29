// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { setRasterBackend } from "@/core/pdf/raster/types";
import { nodeRasterBackend } from "@/test/nodeRaster";
import { decodeImage } from "./codec";
import { extractPalette } from "./palette";
import { rgbToHex } from "./types";
import {
  contrastRatio,
  describeColor,
  formatRatio,
  hslToRgb,
  imageCoordinates,
  parseColor,
  pixelAt,
  relativeLuminance,
  rgbToHsl,
  rgbToHsv,
  wcagVerdict,
} from "./color";

const DIR = join(process.cwd(), "test-assets", "generated");
const CONTRACT = JSON.parse(readFileSync(join(DIR, "CONTRAT.json"), "utf8")) as {
  couleurs: {
    imageTaille: { largeur: number; hauteur: number };
    quadrants: { x: number; y: number; hex: string }[];
    contrastes: { noirSurBlanc: number; identique: number; rougeSurBlanc: number };
  };
};

describe("conversions de couleur", () => {
  it("fait l'aller-retour hexadécimal sans dérive sur les couleurs de référence", () => {
    for (const hex of ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#7c3aed"]) {
      const parsed = parseColor(hex);
      expect(parsed).toBeDefined();
      expect(rgbToHex(parsed!.rgb)).toBe(hex);
    }
  });

  it("lit les écritures courtes, opaques et fonctionnelles", () => {
    expect(parseColor("#f00")?.rgb).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColor("rgb(37, 99, 235)")?.rgb).toEqual({ r: 37, g: 99, b: 235 });
    expect(parseColor("#00000080")?.alpha).toBeCloseTo(128 / 255, 5);
    expect(parseColor("pas une couleur")).toBeUndefined();
    expect(parseColor("rgb(300, 0, 0)")).toBeUndefined();
  });

  it("convertit RVB et TSL dans les deux sens", () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 });
    expect(rgbToHsl({ r: 0, g: 255, b: 0 })).toEqual({ h: 120, s: 100, l: 50 });
    expect(rgbToHsl({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 100, l: 50 });
    expect(rgbToHsl({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, l: 0 });
    expect(rgbToHsl({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, l: 100 });

    // L'aller-retour doit retomber sur la couleur d'origine, à l'arrondi près.
    for (const rgb of [
      { r: 37, g: 99, b: 235 },
      { r: 234, g: 179, b: 8 },
      { r: 124, g: 58, b: 237 },
      { r: 17, g: 17, b: 17 },
    ]) {
      const back = hslToRgb(rgbToHsl(rgb));
      expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(1);
    }
  });

  it("donne une valeur TSV cohérente avec la teinte TSL", () => {
    const rgb = { r: 37, g: 99, b: 235 };
    expect(rgbToHsv(rgb).h).toBe(rgbToHsl(rgb).h);
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, v: 100 });
  });

  it("décrit une couleur dans toutes ses écritures d'un coup", () => {
    const readout = describeColor({ r: 255, g: 255, b: 255 });
    expect(readout.hex).toBe("#ffffff");
    expect(readout.hsl.l).toBe(100);
    expect(readout.alpha).toBe(1);
  });
});

describe("contraste WCAG", () => {
  it("retrouve les deux valeurs de référence de la norme", () => {
    const { noirSurBlanc, identique } = CONTRACT.couleurs.contrastes;
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(noirSurBlanc, 10);
    expect(contrastRatio({ r: 119, g: 119, b: 119 }, { r: 119, g: 119, b: 119 })).toBeCloseTo(identique, 10);
    expect(contrastRatio({ r: 255, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(
      CONTRACT.couleurs.contrastes.rougeSurBlanc,
      3,
    );
  });

  it("donne le même rapport quel que soit l'ordre des couleurs", () => {
    const a = { r: 37, g: 99, b: 235 };
    const b = { r: 255, g: 255, b: 255 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 12);
  });

  it("borne la luminance relative entre 0 et 1", () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 10);
  });

  it("applique les seuils AA et AAA sans les arrondir en sa faveur", () => {
    const perfect = wcagVerdict({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
    expect(perfect.aaNormal && perfect.aaLarge && perfect.aaaNormal && perfect.aaaLarge).toBe(true);

    const none = wcagVerdict({ r: 119, g: 119, b: 119 }, { r: 119, g: 119, b: 119 });
    expect(none.aaNormal || none.aaLarge || none.aaaNormal || none.aaaLarge).toBe(false);

    // Rouge pur sur blanc : ~4,0 — passe le grand texte en AA, rien de plus.
    const red = wcagVerdict({ r: 255, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
    expect(red.aaLarge).toBe(true);
    expect(red.aaNormal).toBe(false);
    expect(red.aaaLarge).toBe(false);
  });

  it("écrit le rapport sans jamais l'arrondir vers le haut", () => {
    expect(formatRatio(21)).toBe("21.00:1");
    // 4,499 ne doit pas devenir 4,50 : ce serait annoncer un seuil AA atteint.
    expect(formatRatio(4.499)).toBe("4.49:1");
  });
});

describe("pipette", () => {
  beforeAll(() => {
    setRasterBackend(nodeRasterBackend);
  });

  it("lit la couleur exacte de chaque quadrant connu", async () => {
    const canvas = await decodeImage(
      new Uint8Array(readFileSync(join(DIR, "color-known.png"))),
      "png",
    );
    const pixels = canvas.getPixels();

    for (const quadrant of CONTRACT.couleurs.quadrants) {
      const color = pixelAt(pixels, quadrant.x, quadrant.y);
      expect(color?.hex).toBe(quadrant.hex);
      expect(color?.alpha).toBe(1);
    }
    expect(pixelAt(pixels, -1, 0)).toBeUndefined();
    expect(pixelAt(pixels, pixels.width, 0)).toBeUndefined();
  });

  it("retrouve le bon pixel malgré un aperçu redimensionné", async () => {
    const canvas = await decodeImage(
      new Uint8Array(readFileSync(join(DIR, "color-known.png"))),
      "png",
    );
    const pixels = canvas.getPixels();
    const natural = { width: pixels.width, height: pixels.height };

    // L'aperçu est affiché à 400 × 400 pour une image de 40 × 40 : un facteur
    // 10. Sans conversion, un clic à (250, 250) lirait le pixel (250, 250) —
    // hors de l'image — au lieu du quadrant blanc.
    const displayed = { width: natural.width * 10, height: natural.height * 10 };
    const point = imageCoordinates(250, 250, displayed, natural);
    expect(point).toEqual({ x: 25, y: 25 });
    expect(pixelAt(pixels, point!.x, point!.y)?.hex).toBe("#ffffff");

    // Et dans l'autre sens : un aperçu réduit de moitié.
    const small = { width: natural.width / 2, height: natural.height / 2 };
    expect(imageCoordinates(2, 2, small, natural)).toEqual({ x: 4, y: 4 });

    // Un clic hors de l'aperçu ne renvoie rien plutôt qu'un pixel de bord.
    expect(imageCoordinates(-5, 10, displayed, natural)).toBeUndefined();
    expect(imageCoordinates(0, 0, { width: 0, height: 0 }, natural)).toBeUndefined();
  });

  it("retrouve les couleurs connues dans la palette dominante", async () => {
    const canvas = await decodeImage(
      new Uint8Array(readFileSync(join(DIR, "color-known.png"))),
      "png",
    );
    const palette = extractPalette(canvas.getPixels(), 4);
    const found = palette.map((entry) => entry.hex).sort();
    expect(found).toEqual(CONTRACT.couleurs.quadrants.map((q) => q.hex).sort());
    // Quatre quadrants de même taille : chacun pèse un quart de l'image.
    for (const entry of palette) expect(entry.weight).toBeCloseTo(0.25, 2);
  });
});
