import { describe, expect, it } from "vitest";
import {
  aspectRatio,
  centeredRect,
  cropRectFor,
  even,
  fitAspect,
  isUpscale,
  resolveSize,
  sizeForHeight,
} from "./dimensions";

/**
 * Ces calculs décident de ce que l'utilisateur obtient réellement. Deux
 * propriétés doivent tenir sans exception : les dimensions produites sont
 * paires (sinon l'encodage échoue en `yuv420p`), et le rectangle de rognage
 * reste entièrement dans l'image.
 */
describe("dimensions vidéo", () => {
  it("arrondit toujours à un nombre pair, au moins 2", () => {
    expect(even(101)).toBe(100);
    expect(even(100)).toBe(100);
    expect(even(0)).toBe(2);
    expect(even(1)).toBe(2);
    expect(even(-5)).toBe(2);
  });

  it("conserve les proportions d'une source paysage", () => {
    expect(sizeForHeight({ width: 1920, height: 1080 }, 720)).toEqual({ width: 1280, height: 720 });
    expect(sizeForHeight({ width: 1920, height: 1080 }, 480)).toEqual({ width: 852, height: 480 });
  });

  it("garde une vidéo verticale verticale : « 720p » porte sur le petit côté", () => {
    const portrait = sizeForHeight({ width: 1080, height: 1920 }, 720);
    expect(portrait.width).toBe(720);
    expect(portrait.height).toBe(1280);
    expect(aspectRatio(portrait)).toBeCloseTo(9 / 16, 2);
  });

  it("déduit la dimension manquante d'une taille personnalisée", () => {
    const source = { width: 1280, height: 720 };
    expect(resolveSize(source, { width: 640, keepRatio: true })).toEqual({ width: 640, height: 360 });
    expect(resolveSize(source, { height: 360, keepRatio: true })).toEqual({ width: 640, height: 360 });
    // Sans conservation des proportions, la demande est respectée telle quelle.
    expect(resolveSize(source, { width: 600, height: 600, keepRatio: false })).toEqual({
      width: 600,
      height: 600,
    });
    // Avec conservation, on tient dans la boîte demandée.
    expect(resolveSize(source, { width: 600, height: 600, keepRatio: true })).toEqual({
      width: 600,
      height: 338,
    });
  });

  it("détecte un agrandissement sur l'une ou l'autre dimension", () => {
    const source = { width: 1280, height: 720 };
    expect(isUpscale(source, { width: 1920, height: 1080 })).toBe(true);
    expect(isUpscale(source, { width: 640, height: 360 })).toBe(false);
    expect(isUpscale(source, { width: 640, height: 800 })).toBe(true);
  });
});

describe("rectangle de rognage", () => {
  const source = { width: 1280, height: 720 };

  it("convertit une sélection en pixels pairs contenus dans l'image", () => {
    const rect = cropRectFor(source, { x: 0.1, y: 0.2, w: 0.5, h: 0.5 });
    expect(rect.width % 2).toBe(0);
    expect(rect.height % 2).toBe(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(source.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(source.height);
    expect(rect.width).toBe(640);
    expect(rect.height).toBe(360);
  });

  it("ne déborde jamais, même pour une sélection aberrante", () => {
    const rect = cropRectFor(source, { x: 0.9, y: 0.9, w: 0.8, h: 0.8 });
    expect(rect.x + rect.width).toBeLessThanOrEqual(source.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(source.height);
    const full = cropRectFor(source, { x: -1, y: -1, w: 5, h: 5 });
    expect(full).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  it("contraint le rapport en pixels, pas en fractions", () => {
    // 1:1 sur une source 16:9 doit donner un carré réel.
    const square = cropRectFor(source, fitAspect({ x: 0, y: 0, w: 1, h: 1 }, source, 1));
    expect(square.width).toBe(square.height);
  });

  it("centre un rectangle 9:16 dans une vidéo paysage", () => {
    const rect = centeredRect(source, 9 / 16);
    const pixels = cropRectFor(source, rect);
    expect(pixels.height).toBe(720);
    expect(Math.round((pixels.width / pixels.height) * 100) / 100).toBeCloseTo(0.56, 1);
    // Centré : autant de marge à gauche qu'à droite, à deux pixels près.
    expect(Math.abs(pixels.x - (source.width - pixels.width - pixels.x))).toBeLessThanOrEqual(2);
  });

  it("laisse le rectangle intact en mode libre", () => {
    const rect = { x: 0.1, y: 0.1, w: 0.3, h: 0.7 };
    expect(fitAspect(rect, source, 0)).toEqual(rect);
  });
});
