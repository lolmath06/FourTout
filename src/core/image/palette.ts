import type { RasterPixels } from "@/core/pdf/raster/types";
import { rgbToHex, type Rgb } from "./types";

/**
 * Extraction de couleurs dominantes par découpage médian (median-cut).
 *
 * On échantillonne les pixels (en ignorant les transparents), puis on découpe
 * récursivement l'espace couleur le long de son axe le plus étendu jusqu'à
 * obtenir le nombre de couleurs demandé. Chaque couleur est la moyenne de son
 * groupe ; le résultat est trié par population décroissante.
 */
export interface PaletteColor {
  rgb: Rgb;
  hex: string;
  /** Part de pixels appartenant à ce groupe (0 à 1). */
  weight: number;
}

interface Bucket {
  pixels: [number, number, number][];
}

export function extractPalette(pixels: RasterPixels, count = 8): PaletteColor[] {
  const samples: [number, number, number][] = [];
  const data = pixels.data;
  // Échantillonnage : au plus ~20 000 pixels, transparents ignorés.
  const step = Math.max(1, Math.floor(data.length / 4 / 20000));
  for (let i = 0; i < data.length; i += 4 * step) {
    if (data[i + 3] < 128) continue;
    samples.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (samples.length === 0) return [];

  let buckets: Bucket[] = [{ pixels: samples }];
  while (buckets.length < count) {
    // Découpe le seau au plus grand étalement.
    let target = -1;
    let bestRange = -1;
    buckets.forEach((bucket, index) => {
      if (bucket.pixels.length < 2) return;
      const range = channelRange(bucket.pixels);
      if (range.spread > bestRange) {
        bestRange = range.spread;
        target = index;
      }
    });
    if (target < 0) break;
    const [a, b] = splitBucket(buckets[target]);
    buckets = [...buckets.slice(0, target), a, b, ...buckets.slice(target + 1)];
  }

  const totalPixels = samples.length;
  return buckets
    .filter((b) => b.pixels.length > 0)
    .map((bucket) => {
      const avg = averageColor(bucket.pixels);
      return { rgb: avg, hex: rgbToHex(avg), weight: bucket.pixels.length / totalPixels };
    })
    .sort((x, y) => y.weight - x.weight)
    .slice(0, count);
}

function channelRange(pixels: [number, number, number][]): { channel: number; spread: number } {
  const min = [255, 255, 255];
  const max = [0, 0, 0];
  for (const p of pixels) {
    for (let c = 0; c < 3; c += 1) {
      if (p[c] < min[c]) min[c] = p[c];
      if (p[c] > max[c]) max[c] = p[c];
    }
  }
  let channel = 0;
  let spread = -1;
  for (let c = 0; c < 3; c += 1) {
    const s = max[c] - min[c];
    if (s > spread) {
      spread = s;
      channel = c;
    }
  }
  return { channel, spread };
}

function splitBucket(bucket: Bucket): [Bucket, Bucket] {
  const { channel } = channelRange(bucket.pixels);
  const sorted = [...bucket.pixels].sort((a, b) => a[channel] - b[channel]);
  const mid = Math.floor(sorted.length / 2);
  return [{ pixels: sorted.slice(0, mid) }, { pixels: sorted.slice(mid) }];
}

function averageColor(pixels: [number, number, number][]): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of pixels) {
    r += p[0];
    g += p[1];
    b += p[2];
  }
  const n = pixels.length;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}
