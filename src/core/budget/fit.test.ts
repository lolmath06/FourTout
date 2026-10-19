import { describe, expect, it } from "vitest";
import { fitToSize, scaledSize } from "./fit";

/** Faux encodeur : la taille croît avec la qualité et comme le carré de l'échelle. */
const JPEG = (base: number) => async (quality: number, scale: number) => ({
  data: { quality, scale },
  bytes: Math.round(base * scale * scale * (0.15 + quality * 0.85)),
});
const PNG = (base: number) => async (_quality: number, scale: number) => ({
  data: { scale },
  bytes: Math.round(base * scale * scale),
});

describe("recherche d'une taille visée", () => {
  it("garde la pleine qualité quand elle tient déjà", async () => {
    const result = await fitToSize(JPEG(100_000), 500_000, { lossy: true });
    expect(result.reached).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.best.scale).toBe(1);
    expect(result.best.quality).toBeCloseTo(0.92);
  });

  it("baisse la qualité avant de toucher à la définition", async () => {
    const result = await fitToSize(JPEG(1_000_000), 600_000, { lossy: true });
    expect(result.reached).toBe(true);
    expect(result.best.scale).toBe(1);
    expect(result.best.bytes).toBeLessThanOrEqual(600_000);
    // Et c'est la meilleure qualité qui passe, pas la pire.
    expect(result.best.quality).toBeGreaterThan(0.5);
  });

  it("réduit la définition quand la qualité ne suffit pas, sans jamais agrandir", async () => {
    const result = await fitToSize(JPEG(4_000_000), 200_000, { lossy: true });
    expect(result.reached).toBe(true);
    expect(result.best.scale).toBeLessThan(1);
    expect(result.best.scale).toBeGreaterThan(0.1);
    expect(result.best.bytes).toBeLessThanOrEqual(200_000);
  });

  it("n'utilise que la définition pour un format sans perte", async () => {
    const result = await fitToSize(PNG(2_000_000), 500_000, { lossy: false });
    expect(result.reached).toBe(true);
    expect(result.best.scale).toBeCloseTo(0.5, 1);
    expect(result.best.bytes).toBeLessThanOrEqual(500_000);
  });

  it("dit franchement quand la cible est hors d'atteinte", async () => {
    const result = await fitToSize(JPEG(50_000_000), 100, { lossy: true, minScale: 0.1 });
    expect(result.reached).toBe(false);
    expect(result.best.scale).toBeGreaterThanOrEqual(0.1);
    // On rend le plus petit essai, pas un fichier au hasard.
    expect(result.best.bytes).toBeGreaterThan(100);
  });

  it("borne le nombre d'essais et respecte l'annulation", async () => {
    let calls = 0;
    const counting = async (q: number, s: number) => {
      calls += 1;
      return JPEG(9_000_000)(q, s);
    };
    await fitToSize(counting, 1000, { lossy: true, maxAttempts: 6 });
    expect(calls).toBeLessThanOrEqual(6);
    const controller = new AbortController();
    controller.abort();
    await expect(fitToSize(JPEG(10), 5, { lossy: true, signal: controller.signal })).rejects.toThrow();
  });

  it("calcule des dimensions réduites sans jamais agrandir ni tomber à zéro", () => {
    expect(scaledSize(4000, 3000, 0.5)).toEqual({ width: 2000, height: 1500 });
    expect(scaledSize(4000, 3000, 1.7)).toEqual({ width: 4000, height: 3000 });
    expect(scaledSize(10, 3, 0.01)).toEqual({ width: 1, height: 1 });
    expect(scaledSize(100, 50, 0)).toEqual({ width: 1, height: 1 });
  });
});
