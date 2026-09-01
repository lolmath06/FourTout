import { loadPdf, report, throwIfCancelled } from "../document";
import { PdfError } from "../errors";
import { decodeRawImage, listEmbeddedImages, type EmbeddedImage } from "../imageObjects";
import { numberedName } from "../filenames";
import { getRasterBackend } from "../raster/types";
import type { OperationContext, OutputFile, PdfSource } from "../types";

/**
 * Extraction des images réellement embarquées dans le document.
 *
 * Les images JPEG sont sorties telles quelles : aucun réencodage, donc aucune
 * perte de qualité. Les images stockées en pixels bruts sont converties en
 * PNG. Les encodages exotiques (JPEG 2000, CCITT, JBIG2) sont signalés et
 * ignorés plutôt que produits corrompus.
 */

export interface ExtractImagesResult {
  files: OutputFile[];
  /** Images trouvées mais non exploitables, avec la raison. */
  skipped: { index: number; reason: string }[];
  /** Nombre total d'images repérées dans le document. */
  found: number;
}

/** En dessous de cette taille, il s'agit presque toujours d'un artefact. */
const MIN_DIMENSION = 16;

export async function extractImages(
  source: PdfSource,
  context?: OperationContext,
): Promise<ExtractImagesResult> {
  const document = await loadPdf(source);
  const images = listEmbeddedImages(document).filter(
    (image) => image.width >= MIN_DIMENSION && image.height >= MIN_DIMENSION,
  );

  if (images.length === 0) throw new PdfError("no-images-found");

  const files: OutputFile[] = [];
  const skipped: { index: number; reason: string }[] = [];
  const backend = getRasterBackend();

  for (const [index, image] of images.entries()) {
    throwIfCancelled(context);
    report(context, index / images.length, `Image ${index + 1} sur ${images.length}`);

    const position = index + 1;

    if (image.encoding === "jpeg") {
      files.push({
        name: numberedName(source.name, position, images.length, "jpg", "image"),
        // Le flux JPEG est déjà un fichier complet : on le recopie à l'octet près.
        bytes: image.stream.contents.slice(),
        mimeType: "image/jpeg",
      });
      continue;
    }

    if (image.encoding === "raw") {
      const converted = await toPng(document, image, backend);
      if (converted) {
        files.push({
          name: numberedName(source.name, position, images.length, "png", "image"),
          bytes: converted,
          mimeType: "image/png",
        });
      } else {
        skipped.push({ index: position, reason: "pixels illisibles" });
      }
      continue;
    }

    skipped.push({ index: position, reason: image.reason ?? "encodage non pris en charge" });
  }

  if (files.length === 0) {
    throw new PdfError(
      "no-images-found",
      `${images.length} image(s) trouvée(s), mais aucune dans un format exploitable.`,
    );
  }

  report(context, 1, "Terminé");
  return { files, skipped, found: images.length };
}

async function toPng(
  document: Awaited<ReturnType<typeof loadPdf>>,
  image: EmbeddedImage,
  backend: ReturnType<typeof getRasterBackend>,
): Promise<Uint8Array | undefined> {
  if (!backend) return undefined;
  try {
    const pixels = await decodeRawImage(document, image);
    if (!pixels) return undefined;
    const canvas = backend.createCanvas(pixels.width, pixels.height);
    canvas.putPixels(pixels);
    return await canvas.encode("png");
  } catch {
    return undefined;
  }
}
