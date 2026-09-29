import { getRasterBackend, type RasterCanvas } from "@/core/pdf/raster/types";
import { ImageError } from "./errors";
import type { PixelRect, Rgb } from "./types";

/**
 * Opérations bitmap, indépendantes de toute interface.
 *
 * Chaque fonction prend un canvas source et renvoie un nouveau canvas : la
 * source n'est jamais modifiée, ce qui permet d'enchaîner les traitements et de
 * régénérer un aperçu sans repartir du fichier. Les traitements par pixel
 * passent par `getPixels`/`putPixels` : ils sont ainsi testables en Node.
 */

function backendOrThrow() {
  const backend = getRasterBackend();
  if (!backend) throw new ImageError("render-unavailable");
  return backend;
}

function ctx(canvas: RasterCanvas): CanvasRenderingContext2D {
  return canvas.context as CanvasRenderingContext2D;
}

/** Copie conforme d'un canvas. */
export function cloneCanvas(source: RasterCanvas): RasterCanvas {
  const target = backendOrThrow().createCanvas(source.width, source.height);
  ctx(target).drawImage(source.handle as CanvasImageSource, 0, 0);
  return target;
}

/** Redimensionne avec lissage de qualité. */
export function resize(source: RasterCanvas, width: number, height: number): RasterCanvas {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return backendOrThrow().resize(source, w, h);
}

/** Recadre selon une zone en pixels ; la zone est bornée à l'image. */
export function crop(source: RasterCanvas, rect: PixelRect): RasterCanvas {
  const x = Math.max(0, Math.min(source.width - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(source.height - 1, Math.round(rect.y)));
  const width = Math.max(1, Math.min(source.width - x, Math.round(rect.width)));
  const height = Math.max(1, Math.min(source.height - y, Math.round(rect.height)));
  if (width < 1 || height < 1) throw new ImageError("invalid-crop");

  const target = backendOrThrow().createCanvas(width, height);
  ctx(target).drawImage(source.handle as CanvasImageSource, -x, -y);
  return target;
}

/** Pivote par quarts de tour horaires (1 = 90°, 2 = 180°, 3 = 270°). */
export function rotateQuarter(source: RasterCanvas, quarters: number): RasterCanvas {
  const turns = ((quarters % 4) + 4) % 4;
  if (turns === 0) return cloneCanvas(source);
  const swap = turns === 1 || turns === 3;
  const width = swap ? source.height : source.width;
  const height = swap ? source.width : source.height;
  const target = backendOrThrow().createCanvas(width, height);
  const context = ctx(target);
  context.translate(width / 2, height / 2);
  context.rotate((turns * Math.PI) / 2);
  context.drawImage(source.handle as CanvasImageSource, -source.width / 2, -source.height / 2);
  return target;
}

export type FlipAxis = "horizontal" | "vertical";

/** Retourne l'image en miroir. */
export function flip(source: RasterCanvas, axis: FlipAxis): RasterCanvas {
  const target = backendOrThrow().createCanvas(source.width, source.height);
  const context = ctx(target);
  if (axis === "horizontal") context.transform(-1, 0, 0, 1, source.width, 0);
  else context.transform(1, 0, 0, -1, 0, source.height);
  context.drawImage(source.handle as CanvasImageSource, 0, 0);
  return target;
}

/** Applique une transformation par pixel (RVBA), sur une copie. */
function mapPixels(
  source: RasterCanvas,
  fn: (r: number, g: number, b: number, a: number, out: Uint8ClampedArray, i: number) => void,
): RasterCanvas {
  const target = cloneCanvas(source);
  const pixels = target.getPixels();
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    fn(d[i], d[i + 1], d[i + 2], d[i + 3], d, i);
  }
  target.putPixels(pixels);
  return target;
}

/** Luminance perceptuelle (Rec. 601). */
function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export type GrayscaleMode = "grayscale" | "threshold";

/** Niveaux de gris, ou noir et blanc par seuil (0 à 255). */
export function grayscale(
  source: RasterCanvas,
  options: { mode: GrayscaleMode; threshold?: number } = { mode: "grayscale" },
): RasterCanvas {
  const threshold = options.threshold ?? 128;
  return mapPixels(source, (r, g, b, _a, out, i) => {
    const y = luminance(r, g, b);
    const value = options.mode === "threshold" ? (y >= threshold ? 255 : 0) : y;
    out[i] = out[i + 1] = out[i + 2] = value;
  });
}

export interface AdjustOptions {
  /** -100 à 100. */
  brightness?: number;
  /** -100 à 100. */
  contrast?: number;
  /** -100 à 100. */
  saturation?: number;
  /** 0.1 à 3. 1 = neutre. */
  gamma?: number;
}

/** Ajuste luminosité, contraste, saturation et gamma. */
export function adjust(source: RasterCanvas, options: AdjustOptions): RasterCanvas {
  const brightness = (options.brightness ?? 0) * 2.55; // décalage additif
  const c = options.contrast ?? 0;
  const contrast = (259 * (c + 255)) / (255 * (259 - c)); // facteur multiplicatif
  const sat = 1 + (options.saturation ?? 0) / 100;
  const gamma = options.gamma && options.gamma > 0 ? options.gamma : 1;
  const gammaLut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v += 1) gammaLut[v] = 255 * (v / 255) ** (1 / gamma);

  return mapPixels(source, (r, g, b, _a, out, i) => {
    let nr = contrast * (r - 128) + 128 + brightness;
    let ng = contrast * (g - 128) + 128 + brightness;
    let nb = contrast * (b - 128) + 128 + brightness;
    const y = luminance(nr, ng, nb);
    nr = y + (nr - y) * sat;
    ng = y + (ng - y) * sat;
    nb = y + (nb - y) * sat;
    out[i] = gammaLut[clamp8(nr)];
    out[i + 1] = gammaLut[clamp8(ng)];
    out[i + 2] = gammaLut[clamp8(nb)];
  });
}

function clamp8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

/** Aplati l'image sur une couleur : supprime toute transparence. */
export function removeTransparency(source: RasterCanvas, color: Rgb): RasterCanvas {
  const target = backendOrThrow().createCanvas(source.width, source.height);
  const context = ctx(target);
  context.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
  context.fillRect(0, 0, target.width, target.height);
  context.drawImage(source.handle as CanvasImageSource, 0, 0);
  return target;
}

/**
 * Rend transparents les pixels proches d'une couleur cible. La tolérance (0 à
 * 100) est convertie en distance euclidienne dans l'espace RVB.
 */
export function colorToTransparent(source: RasterCanvas, color: Rgb, tolerance: number): RasterCanvas {
  const maxDistance = (tolerance / 100) * 441.673; // sqrt(3 * 255²)
  const threshold = maxDistance * maxDistance;
  return mapPixels(source, (r, g, b, a, out, i) => {
    if (a === 0) return;
    const dr = r - color.r;
    const dg = g - color.g;
    const db = b - color.b;
    if (dr * dr + dg * dg + db * db <= threshold) out[i + 3] = 0;
  });
}

/** Flou par boîte séparable, appliqué à toute l'image ou à une zone. */
export function blur(source: RasterCanvas, radius: number, region?: PixelRect): RasterCanvas {
  const r = Math.max(1, Math.round(radius));
  const rect = clampRect(region, source);
  const target = cloneCanvas(source);
  const pixels = target.getPixels();
  boxBlurRegion(pixels.data, pixels.width, r, rect);
  target.putPixels(pixels);
  return target;
}

/** Pixellisation (mosaïque) par blocs, sur toute l'image ou une zone. */
export function pixelate(source: RasterCanvas, blockSize: number, region?: PixelRect): RasterCanvas {
  const block = Math.max(2, Math.round(blockSize));
  const rect = clampRect(region, source);
  const target = cloneCanvas(source);
  const pixels = target.getPixels();
  const { data, width } = pixels;
  for (let by = rect.y; by < rect.y + rect.height; by += block) {
    for (let bx = rect.x; bx < rect.x + rect.width; bx += block) {
      const bw = Math.min(block, rect.x + rect.width - bx);
      const bh = Math.min(block, rect.y + rect.height - by);
      let sr = 0, sg = 0, sb = 0, sa = 0, count = 0;
      for (let y = by; y < by + bh; y += 1) {
        for (let x = bx; x < bx + bw; x += 1) {
          const i = (y * width + x) * 4;
          sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; sa += data[i + 3];
          count += 1;
        }
      }
      const r = sr / count, g = sg / count, b = sb / count, a = sa / count;
      for (let y = by; y < by + bh; y += 1) {
        for (let x = bx; x < bx + bw; x += 1) {
          const i = (y * width + x) * 4;
          data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
        }
      }
    }
  }
  target.putPixels(pixels);
  return target;
}

function clampRect(region: PixelRect | undefined, source: RasterCanvas): PixelRect {
  if (!region) return { x: 0, y: 0, width: source.width, height: source.height };
  const x = Math.max(0, Math.min(source.width, Math.round(region.x)));
  const y = Math.max(0, Math.min(source.height, Math.round(region.y)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(source.width - x, Math.round(region.width))),
    height: Math.max(1, Math.min(source.height - y, Math.round(region.height))),
  };
}

/** Flou boîte à deux passes (horizontale puis verticale) sur une sous-zone. */
function boxBlurRegion(
  data: Uint8ClampedArray,
  width: number,
  radius: number,
  rect: PixelRect,
): void {
  const passes = 2;
  for (let p = 0; p < passes; p += 1) {
    blurAxis(data, width, radius, rect, true);
    blurAxis(data, width, radius, rect, false);
  }
}

function blurAxis(
  data: Uint8ClampedArray,
  width: number,
  radius: number,
  rect: PixelRect,
  horizontal: boolean,
): void {
  const source = data.slice();
  const window = radius * 2 + 1;
  for (let major = 0; major < (horizontal ? rect.height : rect.width); major += 1) {
    for (let minor = 0; minor < (horizontal ? rect.width : rect.height); minor += 1) {
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const mm = clampIndex(minor + k, horizontal ? rect.width : rect.height);
        const x = horizontal ? rect.x + mm : rect.x + major;
        const y = horizontal ? rect.y + major : rect.y + mm;
        const i = (y * width + x) * 4;
        sr += source[i]; sg += source[i + 1]; sb += source[i + 2]; sa += source[i + 3];
      }
      const x = horizontal ? rect.x + minor : rect.x + major;
      const y = horizontal ? rect.y + major : rect.y + minor;
      const i = (y * width + x) * 4;
      data[i] = sr / window; data[i + 1] = sg / window; data[i + 2] = sb / window; data[i + 3] = sa / window;
    }
  }
}

function clampIndex(value: number, size: number): number {
  return value < 0 ? 0 : value >= size ? size - 1 : value;
}

export interface TextItem {
  text: string;
  /** Position de l'ancre (coin haut-gauche), en fraction de l'image. */
  xFrac: number;
  yFrac: number;
  /** Taille de police en fraction de la hauteur d'image (indépendant de la résolution). */
  sizeFrac: number;
  color: Rgb;
  bold?: boolean;
}

/** Dessine un ou plusieurs textes sur une copie de l'image. */
export function drawText(source: RasterCanvas, items: readonly TextItem[]): RasterCanvas {
  const target = cloneCanvas(source);
  const context = ctx(target);
  context.textBaseline = "top";
  for (const item of items) {
    if (!item.text) continue;
    const fontPx = Math.max(1, item.sizeFrac * target.height);
    context.font = `${item.bold ? "bold " : ""}${fontPx}px sans-serif`;
    context.fillStyle = `rgb(${item.color.r}, ${item.color.g}, ${item.color.b})`;
    const lines = item.text.split("\n");
    lines.forEach((line, index) => {
      context.fillText(line, item.xFrac * target.width, item.yFrac * target.height + index * fontPx * 1.2);
    });
  }
  return target;
}

/** Calcule les dimensions finales, en complétant la dimension manquante. */
export function computeDimensions(
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
  keepRatio: boolean,
): { width: number; height: number } {
  const ratio = srcW / srcH;
  if (keepRatio) {
    if (targetW > 0 && targetH > 0) {
      // On tient dans la boîte sans déformer.
      return targetW / targetH > ratio
        ? { width: Math.round(targetH * ratio), height: targetH }
        : { width: targetW, height: Math.round(targetW / ratio) };
    }
    if (targetW > 0) return { width: targetW, height: Math.round(targetW / ratio) };
    if (targetH > 0) return { width: Math.round(targetH * ratio), height: targetH };
    return { width: srcW, height: srcH };
  }
  return {
    width: targetW > 0 ? targetW : srcW,
    height: targetH > 0 ? targetH : srcH,
  };
}
