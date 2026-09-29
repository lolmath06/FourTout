import { parseHexColor, rgbToHex, type Rgb } from "./types";

/**
 * Conversions de couleur et contraste WCAG.
 *
 * Aucune dépendance : les formules tiennent en quelques lignes et sont
 * vérifiables sur des valeurs connues (#000000 sur #FFFFFF vaut exactement
 * 21:1). Importer une bibliothèque de couleurs pour cela coûterait plus cher à
 * auditer qu'à écrire.
 */

export interface Hsl {
  /** Teinte en degrés, 0 à 360. */
  h: number;
  /** Saturation en pourcentage, 0 à 100. */
  s: number;
  /** Luminosité en pourcentage, 0 à 100. */
  l: number;
}

export interface Hsv {
  h: number;
  s: number;
  /** Valeur en pourcentage, 0 à 100. */
  v: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h: round1(h), s: round1(s * 100), l: round1(l * 100) };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sn = Math.min(100, Math.max(0, s)) / 100;
  const ln = Math.min(100, Math.max(0, l)) / 100;
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = ln - c / 2;

  const [r1, g1, b1] =
    hue < 60 ? [c, x, 0]
    : hue < 120 ? [x, c, 0]
    : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c]
    : hue < 300 ? [x, 0, c]
    : [c, 0, x];

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const { h } = rgbToHsl({ r, g, b });
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const s = max === 0 ? 0 : (max - min) / max;
  return { h, s: round1(s * 100), v: round1(max * 100) };
}

/** `hsl(210, 80%, 45%)` — écriture CSS. */
export function formatHsl({ h, s, l }: Hsl): string {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/** `rgb(37, 99, 235)` — écriture CSS. */
export function formatRgb({ r, g, b }: Rgb): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Lit une couleur écrite en `#rgb`, `#rrggbb`, `#rrggbbaa` ou `rgb(...)`.
 * La composante alpha, si elle est présente, est renvoyée à part : les
 * conversions et le contraste travaillent sur la couleur opaque.
 */
export function parseColor(input: string): { rgb: Rgb; alpha: number } | undefined {
  const text = input.trim();

  const short = /^#?([0-9a-f]{3})$/i.exec(text);
  if (short) {
    const [r, g, b] = [...short[1]].map((c) => Number.parseInt(c + c, 16));
    return { rgb: { r, g, b }, alpha: 1 };
  }

  const withAlpha = /^#?([0-9a-f]{6})([0-9a-f]{2})$/i.exec(text);
  if (withAlpha) {
    const rgb = parseHexColor(withAlpha[1]);
    if (!rgb) return undefined;
    return { rgb, alpha: Number.parseInt(withAlpha[2], 16) / 255 };
  }

  const hex = parseHexColor(text);
  if (hex) return { rgb: hex, alpha: 1 };

  const functional = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[/,]\s*([\d.]+)\s*)?\)$/i.exec(text);
  if (functional) {
    const [r, g, b] = [1, 2, 3].map((index) => Number(functional[index]));
    if ([r, g, b].some((value) => value > 255)) return undefined;
    const alpha = functional[4] === undefined ? 1 : Number(functional[4]);
    return { rgb: { r, g, b }, alpha: Number.isFinite(alpha) ? alpha : 1 };
  }

  return undefined;
}

/** Toutes les écritures d'une même couleur, pour l'affichage et la copie. */
export interface ColorReadout {
  rgb: Rgb;
  hex: string;
  hsl: Hsl;
  hsv: Hsv;
  /** Opacité de 0 à 1 (1 si la source n'en portait pas). */
  alpha: number;
}

export function describeColor(rgb: Rgb, alpha = 1): ColorReadout {
  return { rgb, hex: rgbToHex(rgb), hsl: rgbToHsl(rgb), hsv: rgbToHsv(rgb), alpha };
}

/* ----------------------------------------------------------- contraste WCAG */

/**
 * Luminance relative sRGB, telle que définie par WCAG 2.x : chaque canal est
 * linéarisé avant pondération.
 */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Rapport de contraste WCAG entre deux couleurs opaques, de 1 (identiques) à
 * 21 (noir sur blanc). L'ordre des arguments n'a pas d'importance.
 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Seuils WCAG 2.1. « Grand texte » signifie au moins 18 pt (24 px), ou 14 pt
 * (18,66 px) en gras — c'est la définition de la norme, pas un arrondi maison.
 */
export const WCAG_THRESHOLDS = {
  aaNormal: 4.5,
  aaLarge: 3,
  aaaNormal: 7,
  aaaLarge: 4.5,
} as const;

export interface WcagVerdict {
  ratio: number;
  aaNormal: boolean;
  aaLarge: boolean;
  aaaNormal: boolean;
  aaaLarge: boolean;
}

export function wcagVerdict(text: Rgb, background: Rgb): WcagVerdict {
  const ratio = contrastRatio(text, background);
  return {
    ratio,
    aaNormal: ratio >= WCAG_THRESHOLDS.aaNormal,
    aaLarge: ratio >= WCAG_THRESHOLDS.aaLarge,
    aaaNormal: ratio >= WCAG_THRESHOLDS.aaaNormal,
    aaaLarge: ratio >= WCAG_THRESHOLDS.aaaLarge,
  };
}

/** `7.42:1` — deux décimales, tronquées vers le bas pour ne rien promettre de trop. */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}

/* ------------------------------------------------------------------ pipette */

/**
 * Couleur d'un pixel dans une image décodée. Les coordonnées sont en pixels
 * **réels** de l'image : la conversion depuis la position du clic dans un
 * aperçu redimensionné appartient à l'interface, et fait l'objet d'un test à
 * part — c'est l'endroit classique où un zoom CSS fait lire le mauvais pixel.
 */
export function pixelAt(
  pixels: { width: number; height: number; data: Uint8ClampedArray },
  x: number,
  y: number,
): ColorReadout | undefined {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= pixels.width || py >= pixels.height) return undefined;
  const i = (py * pixels.width + px) * 4;
  return describeColor(
    { r: pixels.data[i], g: pixels.data[i + 1], b: pixels.data[i + 2] },
    pixels.data[i + 3] / 255,
  );
}

/**
 * Position d'un clic, ramenée aux pixels réels de l'image.
 *
 * `displayed` est la taille à laquelle l'aperçu est **effectivement affiché**
 * (mesurée sur l'élément, pas déduite d'un facteur de zoom). Sans cette
 * conversion, un aperçu réduit par CSS fait lire une couleur qui n'est pas
 * celle du pixel cliqué.
 */
export function imageCoordinates(
  offsetX: number,
  offsetY: number,
  displayed: { width: number; height: number },
  natural: { width: number; height: number },
): { x: number; y: number } | undefined {
  if (displayed.width <= 0 || displayed.height <= 0) return undefined;
  const x = Math.floor((offsetX / displayed.width) * natural.width);
  const y = Math.floor((offsetY / displayed.height) * natural.height);
  if (x < 0 || y < 0 || x >= natural.width || y >= natural.height) return undefined;
  return { x, y };
}
