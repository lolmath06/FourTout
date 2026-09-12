// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { setRasterBackend, type RasterCanvas, type RasterPixels } from "@/core/pdf/raster/types";
import { nodeRasterBackend } from "@/test/nodeRaster";
import { decodeImage } from "./codec";
import {
  alignForComparison,
  compareImages,
  computeSsim,
  diffOutputName,
  sameDimensions,
} from "./compare";

/**
 * Les fixtures viennent de `scripts/generate-phase10-assets.mjs` : elles sont
 * écrites pixel par pixel, donc les comptages ci-dessous sont des valeurs
 * exactes et non des ordres de grandeur. Les chiffres attendus sont recalculés
 * ici à partir du contrat des fixtures plutôt que recopiés — le jour où une
 * fixture change, c'est le test qui s'ajuste, pas l'inverse.
 */
const DIR = join(process.cwd(), "test-assets", "generated");
const CONTRACT = JSON.parse(readFileSync(join(DIR, "CONTRAT.json"), "utf8")) as {
  comparaisonImages: {
    largeur: number;
    hauteur: number;
    pixels: number;
    unPixel: { x: number; y: number; ecart: number };
    alpha: { pixels: number; ecart: number };
    unPixelSsim?: number;
    petitBruit: { pixelsDifferents: number; ecartMaximal: number; psnr: number; ssim: number };
    grosseModification: { pixelsDifferents: number; psnr: number; ssim: number };
  };
};

async function pixelsOf(name: string): Promise<RasterPixels> {
  return (await canvasOf(name)).getPixels();
}

async function canvasOf(name: string): Promise<RasterCanvas> {
  const bytes = new Uint8Array(readFileSync(join(DIR, name)));
  return decodeImage(bytes, "png");
}

describe("comparaison d'images", () => {
  beforeAll(() => {
    setRasterBackend(nodeRasterBackend);
  });

  it("conclut à l'identité sur deux fichiers de même contenu", async () => {
    const result = compareImages(
      await pixelsOf("image-reference.png"),
      await pixelsOf("image-identical.png"),
    );

    expect(result.pixelsCompared).toBe(CONTRACT.comparaisonImages.pixels);
    expect(result.pixelsDifferent).toBe(0);
    expect(result.maxDifference).toBe(0);
    expect(result.meanDifference).toBe(0);
    expect(result.mse).toBe(0);
    // PSNR infini : aucune valeur numérique, surtout pas NaN.
    expect(result.psnr).toBeUndefined();
    expect(result.ssim).toBeCloseTo(1, 12);
    expect(result.identical).toBe(true);
  });

  it("compte exactement un pixel quand un seul a changé", async () => {
    const result = compareImages(
      await pixelsOf("image-reference.png"),
      await pixelsOf("image-one-pixel.png"),
    );

    expect(result.pixelsDifferent).toBe(1);
    expect(result.maxDifference).toBe(CONTRACT.comparaisonImages.unPixel.ecart);
    expect(result.identical).toBe(false);
    expect(result.psnr).toBeGreaterThan(0);
    // Un pixel sur 3072 : le pourcentage doit rester juste, pas arrondi à zéro.
    expect(result.ratioDifferent).toBeCloseTo(1 / CONTRACT.comparaisonImages.pixels, 12);
  });

  it("applique la tolérance en dessous et au-dessus de l'écart réel", async () => {
    const a = await pixelsOf("image-reference.png");
    const b = await pixelsOf("image-one-pixel.png");
    const { ecart } = CONTRACT.comparaisonImages.unPixel;

    expect(compareImages(a, b, { tolerance: ecart - 1 }).pixelsDifferent).toBe(1);
    // La tolérance est inclusive : un écart égal à la tolérance passe.
    expect(compareImages(a, b, { tolerance: ecart }).pixelsDifferent).toBe(0);
  });

  it("ignore l'alpha par défaut, le compte quand on le demande", async () => {
    const a = await pixelsOf("image-reference.png");
    const b = await pixelsOf("image-alpha-change.png");
    const { pixels, ecart } = CONTRACT.comparaisonImages.alpha;

    const ignored = compareImages(a, b, { includeAlpha: false });
    expect(ignored.pixelsDifferent).toBe(0);
    expect(ignored.identical).toBe(true);

    const counted = compareImages(a, b, { includeAlpha: true });
    expect(counted.pixelsDifferent).toBe(pixels);
    expect(counted.maxDifference).toBe(ecart);
  });

  it("classe la grosse modification comme plus dégradée que le petit bruit", async () => {
    const reference = await pixelsOf("image-reference.png");
    const noise = compareImages(reference, await pixelsOf("image-small-noise.png"));
    const heavy = compareImages(reference, await pixelsOf("image-heavy-change.png"));

    expect(noise.pixelsDifferent).toBe(CONTRACT.comparaisonImages.petitBruit.pixelsDifferents);
    expect(heavy.pixelsDifferent).toBe(CONTRACT.comparaisonImages.grosseModification.pixelsDifferents);

    // Un PSNR plus bas et un SSIM plus bas décrivent tous deux une image plus
    // abîmée : les deux métriques doivent être d'accord sur l'ordre.
    expect(heavy.psnr!).toBeLessThan(noise.psnr!);
    expect(heavy.ssim).toBeLessThan(noise.ssim);
    expect(noise.ssim).toBeGreaterThan(0.99);
    expect(heavy.ssim).toBeLessThan(0.9);
  });

  it("retrouve le PSNR calculé à la main sur le petit bruit", async () => {
    const a = await pixelsOf("image-reference.png");
    const b = await pixelsOf("image-small-noise.png");
    const result = compareImages(a, b);

    // Vérification indépendante : somme des carrés sur les trois canaux.
    let squares = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      for (let c = 0; c < 3; c += 1) {
        const delta = a.data[i + c] - b.data[i + c];
        squares += delta * delta;
      }
    }
    const mse = squares / (result.pixelsCompared * 3);
    expect(result.mse).toBeCloseTo(mse, 12);
    expect(result.psnr).toBeCloseTo(10 * Math.log10((255 * 255) / mse), 10);
  });

  it("produit une image de différence noire là où rien ne change", async () => {
    const result = compareImages(
      await pixelsOf("image-reference.png"),
      await pixelsOf("image-one-pixel.png"),
      { amplify: 4 },
    );
    const { x, y } = CONTRACT.comparaisonImages.unPixel;
    const changed = (y * result.width + x) * 4;
    expect(result.diff.data[changed]).toBe(Math.min(255, CONTRACT.comparaisonImages.unPixel.ecart * 4));
    // Voisin immédiat : identique, donc noir opaque, quelle que soit l'amplification.
    expect(result.diff.data[changed + 4]).toBe(0);
    expect(result.diff.data[changed + 7]).toBe(255);
  });

  it("refuse de comparer des dimensions incompatibles", async () => {
    const a = await pixelsOf("image-reference.png");
    const b = await pixelsOf("image-different-size.png");
    expect(() => compareImages(a, b)).toThrow(/dimensions/i);
  });

  it("aligne explicitement deux images de tailles différentes", async () => {
    const a = await canvasOf("image-reference.png");
    const b = await canvasOf("image-different-size.png");
    expect(sameDimensions(a, b)).toBe(false);

    const common = alignForComparison(a, b, "common");
    expect(common.a.width).toBe(b.width);
    expect(common.a.height).toBe(b.height);
    expect(sameDimensions(common.a, common.b)).toBe(true);

    const fitted = alignForComparison(a, b, "fit-a");
    expect(fitted.b.width).toBe(a.width);
    expect(fitted.b.height).toBe(a.height);

    const other = alignForComparison(a, b, "fit-b");
    expect(other.a.width).toBe(b.width);
  });

  it("retombe sur le SSIM calculé hors du moteur", async () => {
    // Le contrat des fixtures recalcule le SSIM avec sa propre implémentation du
    // même énoncé. Deux calculs indépendants qui concordent valent mieux qu'un
    // seuil choisi après coup pour que le test passe.
    const reference = await pixelsOf("image-reference.png");
    const noise = compareImages(reference, await pixelsOf("image-small-noise.png"));
    const heavy = compareImages(reference, await pixelsOf("image-heavy-change.png"));

    expect(noise.ssim).toBeCloseTo(CONTRACT.comparaisonImages.petitBruit.ssim, 5);
    expect(heavy.ssim).toBeCloseTo(CONTRACT.comparaisonImages.grosseModification.ssim, 5);
    expect(noise.psnr).toBeCloseTo(CONTRACT.comparaisonImages.petitBruit.psnr, 2);
    expect(heavy.psnr).toBeCloseTo(CONTRACT.comparaisonImages.grosseModification.psnr, 2);
  });

  it("donne un SSIM de 1 exactement pour une image comparée à elle-même", async () => {
    const pixels = await pixelsOf("image-heavy-change.png");
    expect(computeSsim(pixels, pixels)).toBeCloseTo(1, 12);
  });

  it("nomme l'image de différence d'après les deux sources", () => {
    expect(diffOutputName("image-reference.png", "image-heavy-change.png")).toBe(
      "image-reference-vs-image-heavy-change-diff.png",
    );
  });
});
