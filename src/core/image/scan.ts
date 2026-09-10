import { getRasterBackend, type RasterCanvas, type RasterPixels } from "@/core/pdf/raster/types";
import { ImageError } from "./errors";
import { adjust, grayscale } from "./operations";

/**
 * Nettoyage d'un document numérisé.
 *
 * Le but est de rendre un scan lisible et léger sans jamais **détruire du texte
 * fin** : chaque traitement est réversible d'un réglage, aucun n'est appliqué
 * d'office, et l'aperçu avant/après est la façon normale de s'en servir.
 *
 * À ne pas confondre avec la correction de perspective (`perspective.ts`) : ici
 * la feuille est déjà à plat et le problème est un léger travers, un fond gris
 * ou un contraste mou — pas une projection.
 */

/* ------------------------------------------------------------ redressement */

export interface SkewEstimate {
  /** Angle détecté, en degrés. Positif = l'image doit tourner dans le sens horaire. */
  angle: number;
  /**
   * Netteté du maximum trouvé, de 0 à 1. Une valeur basse signale un document
   * sans lignes de texte franches : mieux vaut alors régler à la main.
   */
  confidence: number;
}

/** Plage explorée par la détection de travers, en degrés. */
export const MAX_SKEW_DEGREES = 5;

/**
 * Estime le travers d'un scan par **profil de projection**.
 *
 * Le principe : sur une page de texte droite, chaque ligne de texte occupe une
 * rangée de pixels bien à elle. La somme des pixels sombres par rangée est donc
 * très contrastée — pics sur les lignes, creux entre elles. Si la page penche,
 * les lignes se chevauchent et ce profil s'aplatit. On essaie donc plusieurs
 * angles et on retient celui qui maximise la variance du profil.
 *
 * C'est léger, déterministe, et ça n'exige aucune détection de contours. En
 * revanche cela suppose des lignes de texte : d'où la confiance renvoyée, qui
 * permet à l'interface de ne pas proposer un angle absurde sur une photo.
 */
export function estimateSkew(
  pixels: RasterPixels,
  options: { maxDegrees?: number; step?: number } = {},
): SkewEstimate {
  const maxDegrees = options.maxDegrees ?? MAX_SKEW_DEGREES;
  const step = options.step ?? 0.25;
  const { width, height, data } = pixels;
  if (width < 8 || height < 8) return { angle: 0, confidence: 0 };

  // Sous-échantillonnage : la mesure porte sur la disposition des lignes, pas
  // sur le détail des lettres. Un scan A4 à 300 ppp descend ainsi à ~600 px.
  const stride = Math.max(1, Math.floor(Math.max(width, height) / 600));
  const sampleWidth = Math.floor(width / stride);
  const sampleHeight = Math.floor(height / stride);
  if (sampleWidth < 8 || sampleHeight < 8) return { angle: 0, confidence: 0 };

  const dark = new Float32Array(sampleWidth * sampleHeight);
  let sum = 0;
  for (let y = 0; y < sampleHeight; y += 1) {
    for (let x = 0; x < sampleWidth; x += 1) {
      const offset = ((y * stride) * width + x * stride) * 4;
      const luminance =
        0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
      dark[y * sampleWidth + x] = luminance;
      sum += luminance;
    }
  }
  const mean = sum / dark.length;
  // Binarisation grossière autour de la moyenne : ce qui compte est où se
  // trouve l'encre, pas sa nuance.
  for (let index = 0; index < dark.length; index += 1) {
    dark[index] = dark[index] < mean * 0.9 ? 1 : 0;
  }

  let best = { angle: 0, score: -1 };
  let worst = Number.POSITIVE_INFINITY;
  const scores: number[] = [];

  for (let angle = -maxDegrees; angle <= maxDegrees + 1e-9; angle += step) {
    const score = projectionVariance(dark, sampleWidth, sampleHeight, angle);
    scores.push(score);
    if (score > best.score) best = { angle: Number(angle.toFixed(2)), score };
    if (score < worst) worst = score;
  }

  // Confiance : de combien le meilleur angle se détache-t-il de la moyenne ?
  const average = scores.reduce((total, value) => total + value, 0) / scores.length;
  const confidence =
    best.score > 0 && average > 0
      ? Math.max(0, Math.min(1, (best.score / average - 1) * 2.5))
      : 0;

  return { angle: best.angle, confidence: Number(confidence.toFixed(3)) };
}

/** Variance du profil horizontal après rotation virtuelle de `angle` degrés. */
function projectionVariance(
  dark: Float32Array,
  width: number,
  height: number,
  angle: number,
): number {
  const slope = Math.tan((angle * Math.PI) / 180);
  const profile = new Float32Array(height);
  const centerX = width / 2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (dark[y * width + x] === 0) continue;
      // Rotation approchée par cisaillement : pour ±5°, l'écart au vrai
      // pivotement est inférieur au pixel sur une page entière.
      const row = Math.round(y + (x - centerX) * slope);
      if (row >= 0 && row < height) profile[row] += 1;
    }
  }

  let sum = 0;
  for (const value of profile) sum += value;
  const mean = sum / height;
  let variance = 0;
  for (const value of profile) variance += (value - mean) ** 2;
  return variance / height;
}

/**
 * Pivote d'un angle quelconque, en agrandissant la toile pour ne rien couper.
 *
 * Le fond découvert par la rotation est peint en blanc : sur un scan, c'est la
 * couleur du papier, et une bordure transparente deviendrait noire au moindre
 * export JPEG.
 */
export function rotateFine(source: RasterCanvas, degrees: number, background = "#ffffff"): RasterCanvas {
  const backend = getRasterBackend();
  if (!backend) throw new ImageError("render-unavailable");
  if (Math.abs(degrees) < 1e-6) {
    const copy = backend.createCanvas(source.width, source.height);
    (copy.context as CanvasRenderingContext2D).drawImage(source.handle as CanvasImageSource, 0, 0);
    return copy;
  }

  const radians = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const width = Math.ceil(source.width * cos + source.height * sin);
  const height = Math.ceil(source.width * sin + source.height * cos);

  const target = backend.createCanvas(width, height);
  const context = target.context as CanvasRenderingContext2D;
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.translate(width / 2, height / 2);
  context.rotate(radians);
  context.drawImage(source.handle as CanvasImageSource, -source.width / 2, -source.height / 2);
  return target;
}

/* --------------------------------------------------------------- nettoyage */

export type ScanRendering =
  /** Conserve les couleurs. */
  | "color"
  /** Niveaux de gris. */
  | "grayscale"
  /** Noir et blanc à seuil adaptatif. */
  | "bw";

export interface CleanScanOptions {
  /** Redressement en degrés, dans la plage ±5. */
  deskew?: number;
  /** -100 à 100. */
  brightness?: number;
  /** -100 à 100. */
  contrast?: number;
  rendering?: ScanRendering;
  /**
   * Blanchit le fond gris ou jauni. La valeur est l'intensité, de 0 à 100 :
   * elle fixe **jusqu'où** un pixel clair est ramené au blanc pur. Au-delà de
   * ce point, rien n'est touché — c'est ce qui protège les traits fins et les
   * aplats gris légitimes.
   */
  whiten?: number;
}

export const DEFAULT_CLEAN_OPTIONS: CleanScanOptions = {
  deskew: 0,
  brightness: 0,
  contrast: 0,
  rendering: "color",
  whiten: 0,
};

/**
 * Applique la chaîne de nettoyage, dans l'ordre qui a un sens :
 * redresser, puis corriger l'exposition, puis blanchir le fond, puis seulement
 * réduire les couleurs. Inverser blanchiment et binarisation, par exemple,
 * effacerait le texte pâle avant d'avoir eu la chance de le rehausser.
 */
export function cleanScan(source: RasterCanvas, options: CleanScanOptions): RasterCanvas {
  const backend = getRasterBackend();
  if (!backend) throw new ImageError("render-unavailable");

  let canvas = source;
  if (options.deskew) canvas = rotateFine(canvas, options.deskew);

  if (options.brightness || options.contrast) {
    canvas = adjust(canvas, {
      brightness: options.brightness ?? 0,
      contrast: options.contrast ?? 0,
    });
  }

  if (options.whiten && options.whiten > 0) canvas = whitenBackground(canvas, options.whiten);

  const rendering = options.rendering ?? "color";
  if (rendering === "grayscale") canvas = grayscale(canvas, { mode: "grayscale" });
  else if (rendering === "bw") canvas = adaptiveThreshold(canvas);

  // Aucun traitement demandé : renvoyer une copie, jamais la source, pour que
  // l'appelant puisse disposer du résultat sans toucher à son original.
  if (canvas === source) {
    const copy = backend.createCanvas(source.width, source.height);
    (copy.context as CanvasRenderingContext2D).drawImage(source.handle as CanvasImageSource, 0, 0);
    return copy;
  }
  return canvas;
}

/**
 * Ramène au blanc pur les nuances claires — fond grisé d'un scan, papier jauni.
 *
 * `strength` (0 à 100) fixe le point de bascule entre 255 (rien n'est touché) et
 * 160 (tout ce qui est plus clair devient blanc).
 *
 * Le point important est ce que la fonction **ne** fait **pas** : tout ce qui
 * est plus sombre qu'un plancher — fixé aux deux tiers du point de bascule —
 * reste rigoureusement inchangé. Sans ce plancher, un étirement linéaire
 * éclaircirait aussi l'encre, et un texte fin ou pâle s'effacerait un peu plus à
 * chaque cran du réglage. Entre le plancher et le point de bascule, la
 * transition est progressive, pour ne pas créer de halo autour des lettres.
 */
export function whitenBackground(source: RasterCanvas, strength: number): RasterCanvas {
  const backend = getRasterBackend();
  if (!backend) throw new ImageError("render-unavailable");

  const clamped = Math.max(0, Math.min(100, strength));
  if (clamped === 0) {
    const untouched = backend.createCanvas(source.width, source.height);
    (untouched.context as CanvasRenderingContext2D).drawImage(
      source.handle as CanvasImageSource,
      0,
      0,
    );
    return untouched;
  }

  const white = 255 - (clamped / 100) * 95;
  const floor = white * (2 / 3);
  const lut = new Uint8ClampedArray(256);
  for (let value = 0; value < 256; value += 1) {
    if (value >= white) lut[value] = 255;
    else if (value <= floor) lut[value] = value;
    else lut[value] = floor + ((value - floor) / (white - floor)) * (255 - floor);
  }

  const pixels = source.getPixels();
  const data = pixels.data;
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = lut[data[offset]];
    data[offset + 1] = lut[data[offset + 1]];
    data[offset + 2] = lut[data[offset + 2]];
  }

  const target = backend.createCanvas(pixels.width, pixels.height);
  target.putPixels(pixels);
  return target;
}

/**
 * Binarisation à seuil local (moyenne par fenêtre de 24 px, légèrement
 * abaissée). Un seuil unique sur toute la page noircirait un scan éclairé de
 * travers ; le seuil local suit l'éclairage.
 */
export function adaptiveThreshold(source: RasterCanvas, block = 24, bias = 0.9): RasterCanvas {
  const backend = getRasterBackend();
  if (!backend) throw new ImageError("render-unavailable");

  const pixels = source.getPixels();
  const { width, height, data } = pixels;
  const gray = new Float32Array(width * height);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    gray[index] = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
  }

  const blocksX = Math.max(1, Math.ceil(width / block));
  const blocksY = Math.max(1, Math.ceil(height / block));
  const thresholds = new Float32Array(blocksX * blocksY);
  for (let by = 0; by < blocksY; by += 1) {
    for (let bx = 0; bx < blocksX; bx += 1) {
      let sum = 0;
      let count = 0;
      for (let y = by * block; y < Math.min(height, (by + 1) * block); y += 1) {
        for (let x = bx * block; x < Math.min(width, (bx + 1) * block); x += 1) {
          sum += gray[y * width + x];
          count += 1;
        }
      }
      thresholds[by * blocksX + bx] = count > 0 ? (sum / count) * bias : 128;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const threshold = thresholds[Math.floor(y / block) * blocksX + Math.floor(x / block)];
      const value = gray[index] < threshold ? 0 : 255;
      const offset = index * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    }
  }

  const target = backend.createCanvas(width, height);
  target.putPixels(pixels);
  return target;
}
