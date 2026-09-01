import { PDFName, PDFNumber, PDFRawStream } from "@cantoo/pdf-lib";
import { loadPdf, report, savePdf, throwIfCancelled } from "../document";
import { PdfError } from "../errors";
import { outputName } from "../filenames";
import { decodeRawImage, listEmbeddedImages, type EmbeddedImage } from "../imageObjects";
import { getRasterBackend, type RasterBackend } from "../raster/types";
import type { OperationContext, OutputFile, PdfSource } from "../types";

/**
 * Réduction du poids d'un PDF.
 *
 * Deux leviers, appliqués selon le niveau demandé :
 *
 *  1. **Structure** — le document est réécrit avec des flux d'objets, ce qui
 *     élimine les objets orphelins et compacte la table des références. Sans
 *     perte, mais le gain est modeste et dépend beaucoup du producteur d'origine.
 *  2. **Images** — les images embarquées sont réduites et réencodées en JPEG.
 *     C'est ce qui fait réellement maigrir un document scanné ou illustré. Le
 *     texte reste du texte : il demeure sélectionnable et net.
 *
 * Aucune promesse magique : sur un PDF déjà optimisé ou uniquement textuel, le
 * gain peut être nul. Le résultat renvoie les deux tailles pour que l'interface
 * dise la vérité, y compris quand le fichier grossit.
 */

export type CompressionLevel = "light" | "balanced" | "strong";

interface LevelSettings {
  /** Retravaille-t-on les images ? */
  recompressImages: boolean;
  /** Côté le plus long autorisé, en pixels. */
  maxDimension: number;
  /** Qualité JPEG, de 0 à 1. */
  quality: number;
}

const LEVELS: Record<CompressionLevel, LevelSettings> = {
  // Sans perte : uniquement la réécriture de la structure.
  light: { recompressImages: false, maxDimension: Infinity, quality: 1 },
  balanced: { recompressImages: true, maxDimension: 1600, quality: 0.72 },
  strong: { recompressImages: true, maxDimension: 1100, quality: 0.5 },
};

export const COMPRESSION_LEVELS: { value: CompressionLevel; label: string; hint: string }[] = [
  {
    value: "light",
    label: "Légère",
    hint: "Sans perte : réécrit la structure du fichier, ne touche pas aux images.",
  },
  {
    value: "balanced",
    label: "Équilibrée",
    hint: "Réduit les images embarquées en gardant une bonne lisibilité.",
  },
  {
    value: "strong",
    label: "Forte",
    hint: "Réduit fortement les images : privilégiez-la pour un envoi par e-mail.",
  },
];

export interface CompressionResult {
  output: OutputFile;
  originalSize: number;
  compressedSize: number;
  /** Gain en pourcentage ; négatif si le fichier a grossi. */
  savedPercent: number;
  /** Le fichier produit est-il réellement plus petit ? */
  improved: boolean;
  /** Nombre d'images effectivement réencodées. */
  imagesRecompressed: number;
  /** Nombre d'images laissées telles quelles (encodage non géré, transparence…). */
  imagesSkipped: number;
}

export async function compressPdf(
  source: PdfSource,
  level: CompressionLevel,
  context?: OperationContext,
): Promise<CompressionResult> {
  const settings = LEVELS[level];
  const document = await loadPdf(source);
  const originalSize = source.bytes.length;

  let imagesRecompressed = 0;
  let imagesSkipped = 0;

  if (settings.recompressImages) {
    const backend = getRasterBackend();
    if (!backend) throw new PdfError("render-unavailable");

    const images = listEmbeddedImages(document);
    for (const [index, image] of images.entries()) {
      throwIfCancelled(context);
      report(context, (index / Math.max(1, images.length)) * 0.8, `Image ${index + 1} sur ${images.length}`);

      const replaced = await recompressImage(document, image, settings, backend);
      if (replaced) imagesRecompressed += 1;
      else if (image.encoding !== "unsupported" || image.hasMask) imagesSkipped += 1;
    }
  }

  report(context, 0.85, "Réécriture du document");
  const output = await savePdf(document, outputName(source.name, "compresse"));

  // Un fichier plus petit mais illisible ne serait pas une réussite :
  // on relit systématiquement le résultat avant de l'annoncer.
  report(context, 0.95, "Vérification du fichier produit");
  await assertReadable(output.bytes, source.name);

  const compressedSize = output.bytes.length;
  report(context, 1, "Terminé");

  return {
    output,
    originalSize,
    compressedSize,
    savedPercent: originalSize === 0 ? 0 : ((originalSize - compressedSize) / originalSize) * 100,
    improved: compressedSize < originalSize,
    imagesRecompressed,
    imagesSkipped,
  };
}

/**
 * Réencode une image en JPEG et remplace le flux dans le document.
 * Renvoie `false` si l'image n'est pas exploitable ou si le réencodage ne
 * ferait pas gagner de place — dans ce cas l'original est conservé.
 */
async function recompressImage(
  document: Awaited<ReturnType<typeof loadPdf>>,
  image: EmbeddedImage,
  settings: LevelSettings,
  backend: RasterBackend,
): Promise<boolean> {
  // Une image porteuse de transparence perdrait son masque en JPEG.
  if (image.hasMask || image.encoding === "unsupported") return false;

  try {
    let canvas =
      image.encoding === "jpeg"
        ? await backend.decode(image.stream.contents, "image/jpeg")
        : await rawToCanvas(document, image, backend);
    if (!canvas) return false;

    const scale = Math.min(
      1,
      settings.maxDimension / Math.max(canvas.width, canvas.height),
    );
    if (scale < 1) {
      canvas = backend.resize(
        canvas,
        Math.max(1, Math.round(canvas.width * scale)),
        Math.max(1, Math.round(canvas.height * scale)),
      );
    }

    const jpeg = await canvas.encode("jpeg", settings.quality);
    if (jpeg.length >= image.byteLength) return false;

    const dict = image.stream.dict.clone(document.context);
    dict.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
    dict.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"));
    dict.set(PDFName.of("BitsPerComponent"), PDFNumber.of(8));
    dict.set(PDFName.of("Width"), PDFNumber.of(canvas.width));
    dict.set(PDFName.of("Height"), PDFNumber.of(canvas.height));
    dict.set(PDFName.of("Length"), PDFNumber.of(jpeg.length));
    dict.delete(PDFName.of("DecodeParms"));

    document.context.assign(image.ref, PDFRawStream.of(dict, jpeg));
    return true;
  } catch {
    // Une image récalcitrante ne doit pas faire échouer toute la compression.
    return false;
  }
}

async function rawToCanvas(
  document: Awaited<ReturnType<typeof loadPdf>>,
  image: EmbeddedImage,
  backend: RasterBackend,
) {
  const pixels = await decodeRawImage(document, image);
  if (!pixels) return undefined;
  const canvas = backend.createCanvas(pixels.width, pixels.height);
  canvas.putPixels(pixels);
  return canvas;
}

/** Relit le fichier produit pour garantir qu'il est bien exploitable. */
async function assertReadable(bytes: Uint8Array, name: string): Promise<void> {
  try {
    const check = await loadPdf({ name, bytes });
    if (check.getPageCount() === 0) throw new PdfError("corrupted");
  } catch (error) {
    throw new PdfError(
      "corrupted",
      "Le fichier compressé n'a pas pu être relu ; l'original est conservé.",
      { cause: error },
    );
  }
}
