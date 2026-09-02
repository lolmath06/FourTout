import { getRasterBackend, type RasterCanvas } from "@/core/pdf/raster/types";
import type { SelectedFile } from "@/core/files";
import { ImageError } from "./errors";
import { sanitizeSvg, svgIntrinsicSize } from "./svg";
import { parseExif, type ExifOrientation } from "./exif";
import {
  EXTENSION_BY_FORMAT,
  MIME_BY_FORMAT,
  mimeToFormat,
  type ImageFormat,
  type Rgb,
} from "./types";

/**
 * Décodage et encodage des images, au-dessus du backend bitmap partagé
 * (canvas du navigateur dans l'application, canvas natif dans les tests).
 *
 * Deux garde-fous transverses vivent ici : la limite de pixels décodés (pour
 * ne pas saturer la mémoire sur une image démesurée) et l'application de
 * l'orientation EXIF (pour que les photos de smartphone soient droites).
 */

/** Au-delà, on refuse le décodage : 100 Mpx ≈ 400 Mo une fois en RVBA. */
export const MAX_DECODE_PIXELS = 100_000_000;

function backendOrThrow() {
  const backend = getRasterBackend();
  if (!backend) throw new ImageError("render-unavailable");
  return backend;
}

/** Lit les octets d'un fichier sélectionné (glisser-déposer ou dialogue natif). */
export async function readSelectedFile(file: SelectedFile): Promise<Uint8Array> {
  if (file.file) return new Uint8Array(await file.file.arrayBuffer());
  if (file.path) {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    return await readFile(file.path);
  }
  throw new ImageError("not-an-image", "Fichier illisible.");
}

function guessMime(bytes: Uint8Array, extension?: string): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "image/webp";
  if ((bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4d && bytes[1] === 0x4d)) return "image/tiff";
  const ext = (extension ?? "").toLowerCase();
  if (ext === "svg" || looksLikeSvg(bytes)) return "image/svg+xml";
  if (ext === "avif") return "image/avif";
  return "application/octet-stream";
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 256)).trimStart().toLowerCase();
  return head.startsWith("<?xml") || head.startsWith("<svg");
}

/** Décode des octets d'image en canvas, sans appliquer l'orientation EXIF. */
export async function decodeImage(bytes: Uint8Array, extension?: string): Promise<RasterCanvas> {
  const backend = backendOrThrow();
  const mime = guessMime(bytes, extension);

  if (mime === "image/svg+xml") {
    return decodeSvg(bytes);
  }

  let canvas: RasterCanvas;
  try {
    canvas = await backend.decode(bytes, mime);
  } catch (error) {
    throw new ImageError("decode-failed", undefined, { cause: error });
  }
  if (canvas.width * canvas.height > MAX_DECODE_PIXELS) {
    throw new ImageError("too-large", `${canvas.width}×${canvas.height} pixels.`);
  }
  return canvas;
}

/**
 * Décode une image et la redresse selon son orientation EXIF. C'est la porte
 * d'entrée de tous les outils : ils travaillent ensuite sur une image droite.
 */
export async function decodeOriented(
  bytes: Uint8Array,
  extension?: string,
): Promise<{ canvas: RasterCanvas; orientation: ExifOrientation }> {
  const canvas = await decodeImage(bytes, extension);
  const orientation = parseExif(bytes)?.orientation ?? 1;
  return { canvas: applyOrientation(canvas, orientation), orientation };
}

/** Réoriente un canvas selon un code EXIF (1 à 8). Sans effet pour 1. */
export function applyOrientation(source: RasterCanvas, orientation: ExifOrientation): RasterCanvas {
  if (orientation === 1) return source;
  const backend = backendOrThrow();
  const swap = orientation >= 5;
  const width = swap ? source.height : source.width;
  const height = swap ? source.width : source.height;
  const target = backend.createCanvas(width, height);
  const ctx = target.context as CanvasRenderingContext2D;
  const w = source.width;
  const h = source.height;
  const quarter = Math.PI / 2;

  // Transformations issues de la spécification EXIF (miroir + rotation),
  // exprimées en translate/rotate/scale pour rester lisibles et exactes.
  switch (orientation) {
    case 2: ctx.translate(w, 0); ctx.scale(-1, 1); break; // miroir horizontal
    case 3: ctx.translate(w, h); ctx.rotate(Math.PI); break; // 180°
    case 4: ctx.translate(0, h); ctx.scale(1, -1); break; // miroir vertical
    case 5: ctx.rotate(quarter); ctx.scale(1, -1); break; // transposée
    case 6: ctx.rotate(quarter); ctx.translate(0, -h); break; // 90° horaire
    case 7: ctx.rotate(quarter); ctx.translate(w, -h); ctx.scale(-1, 1); break; // transverse
    case 8: ctx.rotate(-quarter); ctx.translate(-w, 0); break; // 90° antihoraire
  }
  ctx.drawImage(source.handle as CanvasImageSource, 0, 0);
  return target;
}

/** Rend le SVG de façon sûre (sanitisé, sans ressource réseau) dans un canvas. */
async function decodeSvg(bytes: Uint8Array): Promise<RasterCanvas> {
  const backend = backendOrThrow();
  const safe = sanitizeSvg(new TextDecoder().decode(bytes));
  const { width, height } = svgIntrinsicSize(safe);
  const safeBytes = new TextEncoder().encode(safe);

  // Dans l'application (navigateur), `createImageBitmap` ne gère pas toujours
  // le SVG : on passe par un élément <img>, qui n'exécute jamais de script et
  // ne charge pas de sous-ressource externe.
  if (typeof document !== "undefined") {
    const canvas = await drawSvgViaImage(backend, safe, width, height);
    return canvas;
  }
  try {
    return await backend.decode(safeBytes, "image/svg+xml");
  } catch (error) {
    throw new ImageError("decode-failed", "SVG non pris en charge.", { cause: error });
  }
}

async function drawSvgViaImage(
  backend: ReturnType<typeof getRasterBackend> & object,
  svg: string,
  width: number,
  height: number,
): Promise<RasterCanvas> {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new ImageError("decode-failed", "SVG illisible."));
      img.src = url;
    });
    const w = image.naturalWidth || width;
    const h = image.naturalHeight || height;
    const canvas = backend.createCanvas(w, h);
    (canvas.context as CanvasRenderingContext2D).drawImage(image, 0, 0, w, h);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Remplit un canvas d'une couleur de fond, sous l'image existante. */
export function flattenOnColor(source: RasterCanvas, color: Rgb): RasterCanvas {
  const backend = backendOrThrow();
  const target = backend.createCanvas(source.width, source.height);
  const ctx = target.context as CanvasRenderingContext2D;
  ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.drawImage(source.handle as CanvasImageSource, 0, 0);
  return target;
}

/**
 * Encode un canvas. Le JPEG ne gère pas la transparence : on aplatit alors sur
 * un fond blanc (ou la couleur demandée) pour éviter un fond noir.
 */
export async function encodeCanvas(
  source: RasterCanvas,
  format: ImageFormat,
  options: { quality?: number; background?: Rgb } = {},
): Promise<Uint8Array> {
  const backend = backendOrThrow();
  void backend;
  let canvas = source;
  if (format === "jpeg") {
    canvas = flattenOnColor(source, options.background ?? { r: 255, g: 255, b: 255 });
  } else if (options.background) {
    canvas = flattenOnColor(source, options.background);
  }
  try {
    return await canvas.encode(format, options.quality ?? 0.85);
  } catch (error) {
    throw new ImageError("encode-failed", undefined, { cause: error });
  }
}

export { MIME_BY_FORMAT, EXTENSION_BY_FORMAT, mimeToFormat };
export type { ImageFormat };
