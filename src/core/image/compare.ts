import type { RasterCanvas, RasterPixels } from "@/core/pdf/raster/types";
import { crop, resize } from "./operations";

/**
 * Comparaison de deux images : différence pixel à pixel, PSNR et SSIM.
 *
 * Tout ce module est **pur** : il prend deux tableaux RVBA et renvoie des
 * nombres. Aucune dépendance à React, au DOM ou à Tauri — les mêmes fonctions
 * tournent dans l'application et dans les tests, sur les mêmes fixtures.
 *
 * ## La métrique, écrite noir sur blanc
 *
 * Pour un pixel, l'**écart** est le plus grand écart absolu parmi les canaux
 * réellement comparés (distance de Tchebychev). Un pixel est dit « différent »
 * si cet écart dépasse **strictement** la tolérance : une tolérance de 0
 * signale la moindre unité d'écart, une tolérance de 40 laisse passer un écart
 * de 40 exactement.
 *
 * Deux réglages sont distincts et ne doivent jamais être confondus :
 *
 * - la **tolérance** décide de ce qui compte comme différent (elle change les
 *   chiffres) ;
 * - l'**amplification** ne sert qu'à rendre l'image de différence lisible (elle
 *   ne change aucun chiffre).
 *
 * L'alpha est **exclu par défaut** de tous les calculs : deux images qui ne
 * diffèrent que par leur opacité affichent la même chose sur fond opaque, et
 * l'inclure ferait chuter le PSNR pour une différence souvent invisible. La
 * case « tenir compte de la transparence » l'ajoute aux canaux comparés — pour
 * le comptage, pour l'écart moyen, et pour l'EQM.
 */

/** Valeur maximale d'un canal sur 8 bits. */
export const MAX_CHANNEL = 255;

export interface CompareOptions {
  /** Écart par canal en deçà duquel (inclus) deux pixels sont tenus pour égaux. */
  tolerance: number;
  /** Comparer aussi le canal alpha ? */
  includeAlpha: boolean;
  /** Facteur d'amplification de l'image de différence (affichage seul). */
  amplify: number;
}

export const DEFAULT_COMPARE_OPTIONS: CompareOptions = {
  tolerance: 0,
  includeAlpha: false,
  amplify: 1,
};

export interface CompareResult {
  width: number;
  height: number;
  /** Nombre de pixels comparés (`width × height`). */
  pixelsCompared: number;
  /** Pixels dont l'écart dépasse la tolérance. */
  pixelsDifferent: number;
  /** `pixelsDifferent / pixelsCompared`, de 0 à 1. */
  ratioDifferent: number;
  /** Écart moyen par pixel (0 à 255), tolérance non appliquée. */
  meanDifference: number;
  /** Plus grand écart rencontré sur un pixel (0 à 255). */
  maxDifference: number;
  /** Erreur quadratique moyenne sur les canaux comparés. */
  mse: number;
  /**
   * PSNR en décibels, ou `undefined` quand l'EQM est nulle — c'est-à-dire quand
   * les images sont identiques au bit près. Le PSNR est alors infini : il n'a
   * pas de valeur numérique à afficher, et surtout jamais `NaN`.
   */
  psnr?: number;
  /** Indice de similarité structurelle, de 0 à 1. */
  ssim: number;
  /** Les deux images sont-elles identiques au bit près (canaux comparés) ? */
  identical: boolean;
  /** Image de différence, prête à être encodée en PNG. */
  diff: RasterPixels;
}

function assertSameSize(a: RasterPixels, b: RasterPixels): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `Les images n'ont pas les mêmes dimensions (${a.width} × ${a.height} contre ${b.width} × ${b.height}).`,
    );
  }
}

/**
 * Compare deux images de mêmes dimensions.
 *
 * Un seul parcours suffit pour tout le comptage : écarts, EQM et image de
 * différence sont produits ensemble, sans copie intermédiaire des deux sources.
 */
export function compareImages(
  a: RasterPixels,
  b: RasterPixels,
  options: Partial<CompareOptions> = {},
): CompareResult {
  assertSameSize(a, b);
  const { tolerance, includeAlpha, amplify } = { ...DEFAULT_COMPARE_OPTIONS, ...options };
  const channels = includeAlpha ? 4 : 3;
  const count = a.width * a.height;
  const diff = new Uint8ClampedArray(count * 4);

  let different = 0;
  let sumDifference = 0;
  let maxDifference = 0;
  let sumSquares = 0;

  for (let p = 0; p < count; p += 1) {
    const i = p * 4;
    let pixelMax = 0;
    for (let c = 0; c < channels; c += 1) {
      const delta = a.data[i + c] - b.data[i + c];
      sumSquares += delta * delta;
      const magnitude = delta < 0 ? -delta : delta;
      if (magnitude > pixelMax) pixelMax = magnitude;
    }
    if (pixelMax > tolerance) different += 1;
    sumDifference += pixelMax;
    if (pixelMax > maxDifference) maxDifference = pixelMax;

    // Image de différence : niveau de gris proportionnel à l'écart, amplifié.
    // Le noir signifie « aucun écart » — l'amplification ne peut pas en créer.
    const shade = Math.min(MAX_CHANNEL, Math.round(pixelMax * amplify));
    diff[i] = shade;
    diff[i + 1] = shade;
    diff[i + 2] = shade;
    diff[i + 3] = 255;
  }

  const mse = sumSquares / (count * channels);
  return {
    width: a.width,
    height: a.height,
    pixelsCompared: count,
    pixelsDifferent: different,
    ratioDifferent: count === 0 ? 0 : different / count,
    meanDifference: count === 0 ? 0 : sumDifference / count,
    maxDifference,
    mse,
    psnr: mse === 0 ? undefined : 10 * Math.log10((MAX_CHANNEL * MAX_CHANNEL) / mse),
    ssim: computeSsim(a, b, includeAlpha),
    identical: maxDifference === 0,
    diff: { width: a.width, height: a.height, data: diff },
  };
}

/* --------------------------------------------------------------------- SSIM */

/** Taille du bloc SSIM. Voir `computeSsim` pour le choix. */
export const SSIM_BLOCK = 8;

const C1 = (0.01 * MAX_CHANNEL) ** 2;
const C2 = (0.03 * MAX_CHANNEL) ** 2;

/**
 * Luminance d'un pixel, pondérations ITU-R BT.601 — les mêmes que la conversion
 * en niveaux de gris déjà en place, pour que deux outils de FourTout ne donnent
 * pas deux gris différents de la même image.
 */
function luminance(data: Uint8ClampedArray, i: number): number {
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

/**
 * SSIM moyen sur des blocs **disjoints** de 8 × 8 pixels, calculé sur la
 * luminance.
 *
 * La définition de référence emploie une fenêtre glissante gaussienne de
 * 11 × 11 ; elle coûte soixante fois plus cher pour un écart de quelques
 * millièmes, et FourTout doit rester réactif sur une image 4K dans une WebView.
 * Le compromis retenu est celui, courant, des blocs disjoints : déterministe,
 * vérifiable à la main sur une petite image, et exact dans les cas qui comptent
 * (deux images identiques donnent très exactement 1).
 *
 * Les pixels des bandes de droite et du bas qui ne remplissent pas un bloc
 * entier sont ignorés — un bloc tronqué n'a pas la même statistique et
 * biaiserait la moyenne. Sur une image plus petite qu'un bloc, on prend l'image
 * entière comme bloc unique.
 */
export function computeSsim(a: RasterPixels, b: RasterPixels, includeAlpha = false): number {
  assertSameSize(a, b);
  if (a.width === 0 || a.height === 0) return 1;

  const blockWidth = Math.min(SSIM_BLOCK, a.width);
  const blockHeight = Math.min(SSIM_BLOCK, a.height);
  const blocksX = Math.floor(a.width / blockWidth);
  const blocksY = Math.floor(a.height / blockHeight);
  if (blocksX === 0 || blocksY === 0) return 1;

  let total = 0;
  let blocks = 0;

  for (let by = 0; by < blocksY; by += 1) {
    for (let bx = 0; bx < blocksX; bx += 1) {
      let sumA = 0;
      let sumB = 0;
      let sumAA = 0;
      let sumBB = 0;
      let sumAB = 0;
      const n = blockWidth * blockHeight;

      for (let y = 0; y < blockHeight; y += 1) {
        const row = (by * blockHeight + y) * a.width;
        for (let x = 0; x < blockWidth; x += 1) {
          const i = (row + bx * blockWidth + x) * 4;
          // L'opacité module la luminance perçue : une zone rendue à demi
          // transparente est réellement plus claire à l'écran. Ne l'appliquer
          // que si l'utilisateur a demandé que la transparence compte.
          const weight = includeAlpha ? a.data[i + 3] / 255 : 1;
          const weightB = includeAlpha ? b.data[i + 3] / 255 : 1;
          const va = luminance(a.data, i) * weight;
          const vb = luminance(b.data, i) * weightB;
          sumA += va;
          sumB += vb;
          sumAA += va * va;
          sumBB += vb * vb;
          sumAB += va * vb;
        }
      }

      const meanA = sumA / n;
      const meanB = sumB / n;
      const varA = sumAA / n - meanA * meanA;
      const varB = sumBB / n - meanB * meanB;
      const covAB = sumAB / n - meanA * meanB;

      const numerator = (2 * meanA * meanB + C1) * (2 * covAB + C2);
      const denominator = (meanA * meanA + meanB * meanB + C1) * (varA + varB + C2);
      total += denominator === 0 ? 1 : numerator / denominator;
      blocks += 1;
    }
  }

  return blocks === 0 ? 1 : total / blocks;
}

/* ---------------------------------------------------------------- alignement */

/**
 * Ce que FourTout fait de deux images de tailles différentes.
 *
 * Aucune de ces options n'est appliquée d'elle-même : tant que l'utilisateur
 * n'a pas choisi, la comparaison est refusée. Redimensionner en douce l'une des
 * deux images fabriquerait des différences qui n'existent pas dans les
 * fichiers, et donnerait un PSNR qui ne parle de rien.
 */
export type AlignMode = "common" | "fit-a" | "fit-b";

export const ALIGN_MODES: { value: AlignMode; label: string; hint: string }[] = [
  {
    value: "common",
    label: "Zone commune",
    hint: "Compare le rectangle présent dans les deux images (coin haut-gauche). Aucun pixel n'est inventé.",
  },
  {
    value: "fit-a",
    label: "Adapter B à A",
    hint: "Redimensionne l'image B aux dimensions de A. Le rééchantillonnage crée lui-même des écarts.",
  },
  {
    value: "fit-b",
    label: "Adapter A à B",
    hint: "Redimensionne l'image A aux dimensions de B. Le rééchantillonnage crée lui-même des écarts.",
  },
];

/** Les deux images ont-elles déjà les mêmes dimensions ? */
export function sameDimensions(a: RasterCanvas, b: RasterCanvas): boolean {
  return a.width === b.width && a.height === b.height;
}

/**
 * Ramène deux images à des dimensions comparables selon le mode choisi. Les
 * canvas d'origine ne sont jamais modifiés.
 */
export function alignForComparison(
  a: RasterCanvas,
  b: RasterCanvas,
  mode: AlignMode,
): { a: RasterCanvas; b: RasterCanvas } {
  if (sameDimensions(a, b)) return { a, b };
  switch (mode) {
    case "fit-a":
      return { a, b: resize(b, a.width, a.height) };
    case "fit-b":
      return { a: resize(a, b.width, b.height), b };
    case "common": {
      const width = Math.min(a.width, b.width);
      const height = Math.min(a.height, b.height);
      const rect = { x: 0, y: 0, width, height };
      return { a: crop(a, rect), b: crop(b, rect) };
    }
  }
}

/**
 * Nom proposé pour l'image de différence : `a-vs-b-diff.png`.
 * Les extensions sont retirées, le reste du nom est conservé tel quel.
 */
export function diffOutputName(nameA: string, nameB: string): string {
  const base = (name: string) => name.replace(/\.[^.]+$/, "");
  return `${base(nameA)}-vs-${base(nameB)}-diff.png`;
}
