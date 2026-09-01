import { PDFDocument, type PDFImage } from "@cantoo/pdf-lib";
import { report, savePdf, throwIfCancelled } from "../document";
import { PdfError } from "../errors";
import { outputName } from "../filenames";
import { getRasterBackend } from "../raster/types";
import type { OperationContext, OutputFile } from "../types";

/**
 * Conversion d'images en PDF, une image par page.
 *
 * PNG et JPEG sont intégrés tels quels (pdf-lib les gère nativement, sans
 * réencodage donc sans perte de qualité). Les autres formats que le système
 * sait décoder — WebP notamment — passent par le backend bitmap et sont
 * convertis en PNG avant intégration.
 */

/** Dimensions en points PostScript (1 pt = 1/72 pouce). */
export const PAGE_SIZES = {
  a4Portrait: { width: 595.28, height: 841.89 },
  a4Landscape: { width: 841.89, height: 595.28 },
} as const;

export type ImagePageMode = "fit-image" | "a4-portrait" | "a4-landscape";

export interface ImageInput {
  name: string;
  bytes: Uint8Array;
  /** Type MIME, sinon déduit du contenu. */
  mimeType?: string;
}

export interface ImagesToPdfOptions {
  mode: ImagePageMode;
  /** Marge autour de l'image sur une page de taille fixe, en points. */
  margin?: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

/** Détecte le format réel d'une image, sans se fier à son extension. */
export function detectImageFormat(bytes: Uint8Array): "png" | "jpeg" | "other" {
  if (startsWith(bytes, PNG_SIGNATURE)) return "png";
  if (startsWith(bytes, JPEG_SIGNATURE)) return "jpeg";
  return "other";
}

async function embedImage(document: PDFDocument, image: ImageInput): Promise<PDFImage> {
  const format = detectImageFormat(image.bytes);
  if (format === "png") return document.embedPng(image.bytes);
  if (format === "jpeg") return document.embedJpg(image.bytes);

  // Format non géré nativement : on tente de le décoder puis de le réencoder.
  const backend = getRasterBackend();
  if (!backend) {
    throw new PdfError(
      "unsupported-image",
      `« ${image.name} » n'est ni un PNG ni un JPEG.`,
    );
  }
  try {
    const canvas = await backend.decode(image.bytes, image.mimeType ?? "image/webp");
    return await document.embedPng(await canvas.encode("png"));
  } catch (error) {
    throw new PdfError(
      "unsupported-image",
      `« ${image.name} » n'a pas pu être décodé.`,
      { cause: error },
    );
  }
}

export async function imagesToPdf(
  images: readonly ImageInput[],
  options: ImagesToPdfOptions,
  context?: OperationContext,
): Promise<OutputFile> {
  if (images.length === 0) throw new PdfError("no-pages-selected", "Ajoutez au moins une image.");

  const document = await PDFDocument.create();
  const margin = options.margin ?? 28;

  for (const [index, image] of images.entries()) {
    throwIfCancelled(context);
    report(context, index / images.length, `Image ${index + 1} sur ${images.length}`);

    const embedded = await embedImage(document, image);

    if (options.mode === "fit-image") {
      // La page épouse exactement l'image : aucune déformation possible.
      const page = document.addPage([embedded.width, embedded.height]);
      page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
      continue;
    }

    const size =
      options.mode === "a4-landscape" ? PAGE_SIZES.a4Landscape : PAGE_SIZES.a4Portrait;
    const page = document.addPage([size.width, size.height]);
    const box = fitInside(
      { width: embedded.width, height: embedded.height },
      { width: size.width - margin * 2, height: size.height - margin * 2 },
    );
    page.drawImage(embedded, {
      x: (size.width - box.width) / 2,
      y: (size.height - box.height) / 2,
      width: box.width,
      height: box.height,
    });
  }

  report(context, 1, "Écriture du document");
  const baseName = images.length === 1 ? images[0].name : "images";
  return savePdf(document, outputName(baseName, "pdf-converti"));
}

/**
 * Plus grand rectangle de mêmes proportions que `source` tenant dans `bounds`.
 * Garantit qu'une image n'est jamais déformée ni agrandie au-delà du cadre.
 */
export function fitInside(
  source: { width: number; height: number },
  bounds: { width: number; height: number },
): { width: number; height: number } {
  if (source.width <= 0 || source.height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(bounds.width / source.width, bounds.height / source.height);
  return { width: source.width * scale, height: source.height * scale };
}
