/**
 * Agrandissement par super-résolution (Real-ESRGAN « general x4 v3 »).
 *
 * Le réseau prend une tuile fixe de 128×128 pixels et en rend une de 512×512.
 * Une image entière ne tiendrait ni dans cette entrée ni dans la mémoire d'une
 * WebView : on la découpe donc en tuiles **qui se recouvrent**, on garde le
 * centre de chaque résultat et on jette les bords, là où un réseau
 * convolutionnel manque de contexte et fait apparaître des coutures.
 *
 *   ┌────────── tuile d'entrée 128 ──────────┐
 *   │ marge 8 │     zone utile 112      │ marge 8 │
 *   └─────────┴─────────────────────────┴─────────┘
 *
 * Le ×2 n'est pas un second modèle : c'est le ×4, réduit de moitié tuile par
 * tuile par moyenne de blocs 2×2. Réduire un résultat net donne plus de détail
 * qu'un agrandissement direct de même taille, et la mémoire reste bornée à la
 * taille de la sortie.
 *
 * **La transparence n'est pas reconstruite** par le réseau : il ne connaît que
 * le RVB. Le canal alpha est agrandi par interpolation bilinéaire — c'est dit à
 * l'utilisateur, et les pixels transparents voient leur couleur prolongée
 * depuis leurs voisins opaques pour ne pas teinter les bords.
 */
import type { RasterCanvas, RasterPixels } from "@/core/pdf/raster/types";
import { getRasterBackend } from "@/core/pdf/raster/types";
import { JobCancelledError } from "@/core/jobs/types";
import type { OperationContext } from "@/core/pdf/types";
import { ImageError } from "./errors";
import { t } from "@/i18n";

/** Entrée du réseau, fixée par le modèle. */
export const TILE = 128;
/** Facteur natif du réseau. */
export const NATIVE_SCALE = 4;
/** Contexte écarté de chaque côté d'une tuile. */
export const MARGIN = 8;
/** Zone utile d'une tuile. */
export const CORE = TILE - 2 * MARGIN;
/** Plafond de la sortie : 64 Mpx = 256 Mo de RVBA. */
export const MAX_OUTPUT_PIXELS = 64_000_000;

export type UpscaleFactor = 2 | 4;

export interface UpscaleSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, UpscaleTensor>): Promise<Record<string, UpscaleTensor>>;
}

export interface UpscaleTensor {
  readonly data: Float32Array | ArrayLike<number>;
  readonly dims: readonly number[];
}

export type UpscaleTensorFactory = (data: Float32Array, dims: number[]) => UpscaleTensor;

export interface TileJob {
  /** Coin de la zone utile dans l'image source. */
  x: number;
  y: number;
  /** Taille de la zone utile (plus petite en bordure). */
  w: number;
  h: number;
}

export interface UpscalePlan {
  columns: number;
  rows: number;
  tiles: TileJob[];
  outputWidth: number;
  outputHeight: number;
  outputPixels: number;
  /** Mémoire approximative de la sortie, en octets. */
  outputBytes: number;
  /** La sortie dépasse le plafond : l'agrandissement est refusé. */
  tooLarge: boolean;
}

export function outputSize(width: number, height: number, factor: UpscaleFactor): { width: number; height: number } {
  return { width: width * factor, height: height * factor };
}

/** Plan de découpage. Pur : sert à l'estimation affichée avant de lancer. */
export function planTiles(width: number, height: number, factor: UpscaleFactor): UpscalePlan {
  const columns = Math.ceil(width / CORE);
  const rows = Math.ceil(height / CORE);
  const tiles: TileJob[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * CORE;
      const y = row * CORE;
      tiles.push({ x, y, w: Math.min(CORE, width - x), h: Math.min(CORE, height - y) });
    }
  }
  const out = outputSize(width, height, factor);
  const outputPixels = out.width * out.height;
  return {
    columns,
    rows,
    tiles,
    outputWidth: out.width,
    outputHeight: out.height,
    outputPixels,
    outputBytes: outputPixels * 4,
    tooLarge: outputPixels > MAX_OUTPUT_PIXELS,
  };
}

/** Prolonge la couleur des pixels transparents depuis leurs voisins visibles. */
export function bleedTransparentColors(pixels: RasterPixels): Uint8ClampedArray {
  const { width, height, data } = pixels;
  const out = new Uint8ClampedArray(data);
  const known = new Uint8Array(width * height);
  for (let i = 0; i < known.length; i += 1) known[i] = data[i * 4 + 3] > 0 ? 1 : 0;
  // Quatre balayages : chaque pixel inconnu emprunte son voisin déjà connu.
  const sweep = (xs: number, xe: number, xd: number, ys: number, ye: number, yd: number) => {
    for (let y = ys; y !== ye; y += yd) {
      for (let x = xs; x !== xe; x += xd) {
        const i = y * width + x;
        if (known[i]) continue;
        const neighbours = [x - xd >= 0 && x - xd < width ? i - xd : -1, y - yd >= 0 && y - yd < height ? i - yd * width : -1];
        for (const n of neighbours) {
          if (n >= 0 && known[n]) {
            out[i * 4] = out[n * 4];
            out[i * 4 + 1] = out[n * 4 + 1];
            out[i * 4 + 2] = out[n * 4 + 2];
            known[i] = 1;
            break;
          }
        }
      }
    }
  };
  sweep(0, width, 1, 0, height, 1);
  sweep(width - 1, -1, -1, height - 1, -1, -1);
  sweep(0, width, 1, height - 1, -1, -1);
  sweep(width - 1, -1, -1, 0, height, 1);
  return out;
}

/** Entrée du réseau pour une tuile : plans R, V, B en flottants 0-1, bords prolongés. */
export function buildTileInput(rgb: Uint8ClampedArray, width: number, height: number, job: TileJob): Float32Array {
  const plane = TILE * TILE;
  const input = new Float32Array(3 * plane);
  for (let ty = 0; ty < TILE; ty += 1) {
    const sy = Math.min(height - 1, Math.max(0, job.y - MARGIN + ty));
    for (let tx = 0; tx < TILE; tx += 1) {
      const sx = Math.min(width - 1, Math.max(0, job.x - MARGIN + tx));
      const s = (sy * width + sx) * 4;
      const d = ty * TILE + tx;
      input[d] = rgb[s] / 255;
      input[plane + d] = rgb[s + 1] / 255;
      input[2 * plane + d] = rgb[s + 2] / 255;
    }
  }
  return input;
}

/** Copie la zone utile d'une sortie 512×512 dans l'image finale, au facteur voulu. */
export function placeTile(
  output: Float32Array | ArrayLike<number>,
  job: TileJob,
  target: Uint8ClampedArray,
  targetWidth: number,
  factor: UpscaleFactor,
): void {
  const plane = TILE * NATIVE_SCALE * (TILE * NATIVE_SCALE);
  const stride = TILE * NATIVE_SCALE;
  const block = NATIVE_SCALE / factor; // 1 pour ×4, 2 pour ×2
  const clamp = (v: number) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));
  for (let y = 0; y < job.h * factor; y += 1) {
    for (let x = 0; x < job.w * factor; x += 1) {
      // Position dans la sortie du réseau, en sautant la marge (MARGIN × 4).
      const ox = MARGIN * NATIVE_SCALE + x * block;
      const oy = MARGIN * NATIVE_SCALE + y * block;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let by = 0; by < block; by += 1) {
        for (let bx = 0; bx < block; bx += 1) {
          const i = (oy + by) * stride + (ox + bx);
          r += output[i];
          g += output[plane + i];
          b += output[2 * plane + i];
        }
      }
      const n = block * block;
      const d = ((job.y * factor + y) * targetWidth + (job.x * factor + x)) * 4;
      target[d] = clamp(r / n);
      target[d + 1] = clamp(g / n);
      target[d + 2] = clamp(b / n);
    }
  }
}

/** Alpha agrandi en bilinéaire (centres de pixels alignés). */
export function scaleAlpha(source: RasterPixels, factor: number, target: Uint8ClampedArray): void {
  const { width, height, data } = source;
  const outW = width * factor;
  const outH = height * factor;
  for (let y = 0; y < outH; y += 1) {
    const fy = Math.min(height - 1, Math.max(0, (y + 0.5) / factor - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < outW; x += 1) {
      const fx = Math.min(width - 1, Math.max(0, (x + 0.5) / factor - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(width - 1, x0 + 1);
      const wx = fx - x0;
      const a =
        data[(y0 * width + x0) * 4 + 3] * (1 - wx) * (1 - wy) +
        data[(y0 * width + x1) * 4 + 3] * wx * (1 - wy) +
        data[(y1 * width + x0) * 4 + 3] * (1 - wx) * wy +
        data[(y1 * width + x1) * 4 + 3] * wx * wy;
      target[(y * outW + x) * 4 + 3] = Math.round(a);
    }
  }
}

function throwIfCancelled(context?: OperationContext): void {
  if (context?.signal?.aborted) throw new JobCancelledError();
}

export interface UpscaleResult {
  canvas: RasterCanvas;
  tiles: number;
  elapsedMs: number;
  hadAlpha: boolean;
}

/** Agrandit un canvas. La session et la fabrique de tenseurs viennent du moteur chargé. */
export async function upscaleCanvas(
  source: RasterCanvas,
  factor: UpscaleFactor,
  session: UpscaleSession,
  tensor: UpscaleTensorFactory,
  context?: OperationContext,
): Promise<UpscaleResult> {
  const backend = getRasterBackend();
  if (!backend) throw new ImageError("render-unavailable");
  const plan = planTiles(source.width, source.height, factor);
  if (plan.tooLarge) {
    throw new ImageError(
      "too-large",
      t("Le résultat ferait {width} × {height} pixels, au-delà de la limite de {limit} millions de pixels. Réduisez l'image ou choisissez ×2.", {
        width: plan.outputWidth,
        height: plan.outputHeight,
        limit: MAX_OUTPUT_PIXELS / 1_000_000,
      }),
    );
  }

  const pixels = source.getPixels();
  let hadAlpha = false;
  for (let i = 3; i < pixels.data.length; i += 4) {
    if (pixels.data[i] < 255) {
      hadAlpha = true;
      break;
    }
  }
  const rgb = hadAlpha ? bleedTransparentColors(pixels) : pixels.data;
  const out = new Uint8ClampedArray(plan.outputWidth * plan.outputHeight * 4);
  out.fill(255);

  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const started = Date.now();
  let done = 0;
  for (const job of plan.tiles) {
    throwIfCancelled(context);
    const input = buildTileInput(rgb, source.width, source.height, job);
    const result = await session.run({ [inputName]: tensor(input, [1, 3, TILE, TILE]) });
    const produced = result[outputName];
    if (!produced || produced.dims.length !== 4 || produced.dims[2] !== TILE * NATIVE_SCALE) {
      throw new ImageError("decode-failed", t("Le modèle d'agrandissement a rendu une sortie inattendue."));
    }
    placeTile(produced.data, job, out, plan.outputWidth, factor);
    done += 1;
    context?.report?.({
      ratio: done / plan.tiles.length,
      label: t("Tuile {done} sur {total}", { done, total: plan.tiles.length }),
    });
    // Rend la main à l'interface entre deux tuiles : l'annulation reste réactive.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (hadAlpha) scaleAlpha(pixels, factor, out);

  const canvas = backend.createCanvas(plan.outputWidth, plan.outputHeight);
  canvas.putPixels({ width: plan.outputWidth, height: plan.outputHeight, data: out });
  return { canvas, tiles: plan.tiles.length, elapsedMs: Date.now() - started, hadAlpha };
}
