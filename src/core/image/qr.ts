import QRCode from "qrcode";
import jsQR from "jsqr";
import { isOpenableUrl } from "@/core/output/externalUrl";
import type { RasterPixels } from "@/core/pdf/raster/types";

/**
 * Génération et lecture de QR codes, 100 % local.
 *
 * Génération via `qrcode` (PNG ou SVG), lecture via `jsQR` sur les pixels d'une
 * image déjà décodée. Aucun contenu actif : un QR lu n'est jamais ouvert
 * automatiquement.
 */

export type QrErrorCorrection = "L" | "M" | "Q" | "H";

export interface QrOptions {
  width?: number;
  margin?: number;
  errorCorrection?: QrErrorCorrection;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = typeof atob === "function" ? atob(base64) : Buffer.from(base64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Génère un QR code en PNG. */
export async function generateQrPng(text: string, options: QrOptions = {}): Promise<Uint8Array> {
  const dataUrl = await QRCode.toDataURL(text, {
    width: options.width ?? 512,
    margin: options.margin ?? 4,
    errorCorrectionLevel: options.errorCorrection ?? "M",
  });
  return dataUrlToBytes(dataUrl);
}

/** Génère un QR code en SVG (vectoriel). */
export async function generateQrSvg(text: string, options: QrOptions = {}): Promise<Uint8Array> {
  const svg = await QRCode.toString(text, {
    type: "svg",
    margin: options.margin ?? 4,
    errorCorrectionLevel: options.errorCorrection ?? "M",
    width: options.width ?? 512,
  });
  return new TextEncoder().encode(svg);
}

/** Lit un QR code depuis les pixels d'une image. Renvoie le contenu, ou `undefined`. */
export function decodeQr(pixels: RasterPixels): string | undefined {
  const result = jsQR(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
  return result?.data;
}

/**
 * Le contenu lu est-il un lien que FourTout accepte d'ouvrir ? Même règle que
 * l'ouverture elle-même : pas de bouton pour un contenu non ouvrable.
 */
export function looksLikeUrl(text: string): boolean {
  return isOpenableUrl(text);
}
