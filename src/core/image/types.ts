/** Types partagés par les opérations Image. */

/** Formats d'image réellement produits par FourTout. */
export type ImageFormat = "png" | "jpeg" | "webp";

/** Extensions d'entrée acceptées par le décodeur. */
export const READABLE_EXTENSIONS = [
  "png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "svg", "avif",
] as const;

export const MIME_BY_FORMAT: Record<ImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const EXTENSION_BY_FORMAT: Record<ImageFormat, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
};

/** Couleur RVB simple, chaque composante de 0 à 255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Zone rectangulaire en pixels image (origine haut-gauche). */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function mimeToFormat(mime: string): ImageFormat | undefined {
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpeg";
  if (mime.includes("webp")) return "webp";
  return undefined;
}

export function extensionToFormat(extension: string): ImageFormat | undefined {
  const ext = extension.replace(/^\./, "").toLowerCase();
  if (ext === "png") return "png";
  if (ext === "jpg" || ext === "jpeg") return "jpeg";
  if (ext === "webp") return "webp";
  return undefined;
}

/** `#rrggbb` → RVB. Renvoie `undefined` si la chaîne est invalide. */
export function parseHexColor(hex: string): Rgb | undefined {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return undefined;
  const value = Number.parseInt(match[1], 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).slice(1)}`;
}
