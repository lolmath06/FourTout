import { beforeAll, describe, expect, it } from "vitest";
import { getRasterBackend, setRasterBackend, type RasterPixels } from "@/core/pdf/raster/types";
import {
  CORE,
  MARGIN,
  MAX_OUTPUT_PIXELS,
  TILE,
  bleedTransparentColors,
  buildTileInput,
  planTiles,
  scaleAlpha,
  upscaleCanvas,
  type UpscaleSession,
  type UpscaleTensor,
} from "./upscale";
import { nodeRasterBackend } from "@/test/nodeRaster";

/**
 * Faux réseau : agrandit chaque pixel en un bloc 4×4 identique. Si le découpage,
 * les marges et le recollage sont justes, l'image finale est **exactement**
 * l'image d'origine répétée par blocs — sans couture, sans décalage.
 */
const nearest4: UpscaleSession = {
  inputNames: ["image"],
  outputNames: ["upscaled_image"],
  async run(feeds): Promise<Record<string, UpscaleTensor>> {
    const input = feeds.image.data as Float32Array;
    const plane = TILE * TILE;
    const stride = TILE * 4;
    const out = new Float32Array(3 * stride * stride);
    for (let c = 0; c < 3; c += 1) {
      for (let y = 0; y < stride; y += 1) {
        for (let x = 0; x < stride; x += 1) {
          out[c * stride * stride + y * stride + x] = input[c * plane + Math.floor(y / 4) * TILE + Math.floor(x / 4)];
        }
      }
    }
    return { upscaled_image: { data: out, dims: [1, 3, stride, stride] } };
  },
};
const factory = (data: Float32Array, dims: number[]) => ({ data, dims });

function gradient(width: number, height: number, alpha = false): RasterPixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = (x * 7 + y * 3) % 256;
      data[i + 1] = (x * 5) % 256;
      data[i + 2] = (y * 11) % 256;
      data[i + 3] = alpha ? ((x + y) % 2 === 0 ? 255 : 100) : 255;
    }
  }
  return { width, height, data };
}

beforeAll(() => setRasterBackend(nodeRasterBackend));

describe("découpage en tuiles", () => {
  it("couvre l'image entière une seule fois", () => {
    for (const [w, h] of [[1, 1], [112, 112], [113, 50], [300, 257], [1000, 10]]) {
      const plan = planTiles(w, h, 4);
      const covered = new Uint8Array(w * h);
      for (const tile of plan.tiles) {
        for (let y = tile.y; y < tile.y + tile.h; y += 1) {
          for (let x = tile.x; x < tile.x + tile.w; x += 1) covered[y * w + x] += 1;
        }
      }
      expect(covered.every((n) => n === 1), `${w}×${h}`).toBe(true);
      expect(plan.tiles.every((tile) => tile.w <= CORE && tile.h <= CORE)).toBe(true);
    }
  });

  it("annonce les dimensions et la mémoire de la sortie", () => {
    const plan = planTiles(1000, 500, 4);
    expect([plan.outputWidth, plan.outputHeight]).toEqual([4000, 2000]);
    expect(plan.outputBytes).toBe(4000 * 2000 * 4);
    expect(planTiles(1000, 500, 2).outputWidth).toBe(2000);
    expect(planTiles(CORE * 9, CORE * 9, 4).columns).toBe(9);
  });

  it("refuse une sortie démesurée avant de commencer", () => {
    expect(planTiles(4000, 4000, 4).tooLarge).toBe(true);
    expect(planTiles(4000, 4000, 2).tooLarge).toBe(false);
    expect(planTiles(2000, 2000, 4).outputPixels).toBeLessThanOrEqual(MAX_OUTPUT_PIXELS);
    expect(planTiles(2000, 2000, 4).tooLarge).toBe(false);
  });
});

describe("tuile d'entrée", () => {
  it("prolonge les bords et place le coin utile après la marge", () => {
    const px = gradient(20, 20);
    const input = buildTileInput(px.data, 20, 20, { x: 0, y: 0, w: 20, h: 20 });
    const plane = TILE * TILE;
    // Pixel (0,0) de l'image = pixel (MARGIN, MARGIN) de la tuile ; au-delà, bord répété.
    expect(input[MARGIN * TILE + MARGIN]).toBeCloseTo(px.data[0] / 255);
    expect(input[0]).toBeCloseTo(px.data[0] / 255);
    expect(input[plane + MARGIN * TILE + MARGIN]).toBeCloseTo(px.data[1] / 255);
    expect(input[(TILE - 1) * TILE + (TILE - 1)]).toBeCloseTo(px.data[(19 * 20 + 19) * 4] / 255);
  });
});

describe("agrandissement complet", () => {
  it("recolle les tuiles sans couture : ×4 est exactement l'image répétée par blocs", async () => {
    const backend = getRasterBackend()!;
    const source = backend.createCanvas(130, 121); // plusieurs tuiles, bordures irrégulières
    const px = gradient(130, 121);
    source.putPixels(px);
    const result = await upscaleCanvas(source, 4, nearest4, factory);
    expect([result.canvas.width, result.canvas.height]).toEqual([520, 484]);
    expect(result.tiles).toBe(planTiles(130, 121, 4).tiles.length);
    const out = result.canvas.getPixels();
    for (let y = 0; y < 484; y += 1) {
      for (let x = 0; x < 520; x += 1) {
        const s = (Math.floor(y / 4) * 130 + Math.floor(x / 4)) * 4;
        const d = (y * 520 + x) * 4;
        if (out.data[d] !== px.data[s] || out.data[d + 1] !== px.data[s + 1] || out.data[d + 2] !== px.data[s + 2]) {
          throw new Error(`pixel (${x},${y}) : ${out.data[d]} ≠ ${px.data[s]}`);
        }
      }
    }
  });

  it("×2 moyenne les blocs : une image unie reste unie, un damier se lisse", async () => {
    const backend = getRasterBackend()!;
    const source = backend.createCanvas(40, 40);
    source.putPixels(gradient(40, 40));
    const doubled = await upscaleCanvas(source, 2, nearest4, factory);
    expect([doubled.canvas.width, doubled.canvas.height]).toEqual([80, 80]);
    // Le faux réseau répète les pixels : la moyenne 2×2 redonne l'original.
    const out = doubled.canvas.getPixels();
    const px = gradient(40, 40);
    expect(out.data[(10 * 80 + 10) * 4]).toBe(px.data[(5 * 40 + 5) * 4]);
  });

  it("agrandit l'alpha par interpolation et signale que le réseau ne le voit pas", async () => {
    const backend = getRasterBackend()!;
    const source = backend.createCanvas(8, 8);
    source.putPixels(gradient(8, 8, true));
    const result = await upscaleCanvas(source, 4, nearest4, factory);
    expect(result.hadAlpha).toBe(true);
    const out = result.canvas.getPixels();
    const alphas = new Set<number>();
    for (let i = 3; i < out.data.length; i += 4) alphas.add(out.data[i]);
    expect(alphas.size).toBeGreaterThan(2); // interpolé, pas seulement 255/100
  });

  it("s'arrête à l'annulation, entre deux tuiles", async () => {
    const backend = getRasterBackend()!;
    const source = backend.createCanvas(300, 300);
    source.putPixels(gradient(300, 300));
    const controller = new AbortController();
    let runs = 0;
    const counting: UpscaleSession = {
      ...nearest4,
      async run(feeds) {
        runs += 1;
        if (runs === 2) controller.abort();
        return nearest4.run(feeds);
      },
    };
    await expect(
      upscaleCanvas(source, 4, counting, factory, { signal: controller.signal, report: () => {} }),
    ).rejects.toThrow();
    expect(runs).toBe(2);
  });

  it("refuse une sortie inattendue du modèle", async () => {
    const backend = getRasterBackend()!;
    const source = backend.createCanvas(10, 10);
    source.putPixels(gradient(10, 10));
    const broken: UpscaleSession = {
      ...nearest4,
      run: async () => ({ upscaled_image: { data: new Float32Array(12), dims: [1, 3, 2, 2] } }),
    };
    await expect(upscaleCanvas(source, 4, broken, factory)).rejects.toThrow();
  });
});

describe("transparence", () => {
  it("prolonge la couleur des pixels invisibles depuis leurs voisins", () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i += 1) data.set([0, 0, 0, 0], i * 4);
    data.set([200, 100, 50, 255], (1 * 4 + 1) * 4);
    const out = bleedTransparentColors({ width: 4, height: 4, data });
    expect([out[(3 * 4 + 3) * 4], out[(3 * 4 + 3) * 4 + 1], out[(3 * 4 + 3) * 4 + 2]]).toEqual([200, 100, 50]);
    expect(out[3]).toBe(0); // l'alpha n'est pas modifié ici
  });

  it("l'interpolation bilinéaire conserve un alpha uniforme", () => {
    const px = { width: 3, height: 3, data: new Uint8ClampedArray(36).fill(255) };
    const target = new Uint8ClampedArray(6 * 6 * 4);
    scaleAlpha(px, 2, target);
    for (let i = 3; i < target.length; i += 4) expect(target[i]).toBe(255);
  });
});
