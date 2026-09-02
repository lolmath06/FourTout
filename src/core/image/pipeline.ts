import type { RasterCanvas } from "@/core/pdf/raster/types";
import type { OperationContext, OutputFile } from "@/core/pdf/types";
import type { SelectedFile } from "@/core/files";
import { outputName } from "@/core/pdf/filenames";
import { JobCancelledError } from "@/core/jobs/types";
import { ImageError } from "./errors";
import { decodeOriented, encodeCanvas, readSelectedFile } from "./codec";
import { EXTENSION_BY_FORMAT, MIME_BY_FORMAT, extensionToFormat, type ImageFormat, type Rgb } from "./types";

/**
 * Chaînage de haut niveau : lit un fichier, le décode (redressé EXIF), applique
 * une transformation, encode et nomme la sortie. Les outils n'ont plus qu'à
 * fournir la transformation et le format voulu ; le lot, la progression et
 * l'annulation sont gérés ici.
 */

export type ImageTransform = (canvas: RasterCanvas) => RasterCanvas | Promise<RasterCanvas>;

export interface ProcessOptions {
  /** Format de sortie, ou « conserver » celui de l'entrée. */
  format: ImageFormat | "same";
  /** Qualité 0 à 1 (JPEG/WebP). */
  quality?: number;
  /** Fond appliqué si l'on aplatit la transparence. */
  background?: Rgb;
  /** Suffixe ajouté au nom (« compressee », « 50pct »…). */
  suffix?: string;
  /** Applique l'orientation EXIF avant traitement (vrai par défaut). */
  applyOrientation?: boolean;
}

/** Détermine le format effectif de sortie pour un fichier donné. */
export function resolveFormat(file: SelectedFile, requested: ImageFormat | "same"): ImageFormat {
  if (requested !== "same") return requested;
  return extensionToFormat(file.extension) ?? "png";
}

/** Nom de sortie : `photo.jpg` + webp → `photo.webp` ; + suffixe → `photo-50pct.jpg`. */
export function imageOutputName(sourceName: string, format: ImageFormat, suffix?: string): string {
  return outputName(sourceName, suffix ?? "", EXTENSION_BY_FORMAT[format]);
}

function throwIfCancelled(context?: OperationContext): void {
  if (context?.signal?.aborted) throw new JobCancelledError();
}

/** Traite une image et renvoie le fichier produit. */
export async function processImage(
  file: SelectedFile,
  transform: ImageTransform,
  options: ProcessOptions,
  context?: OperationContext,
): Promise<OutputFile> {
  const bytes = await readSelectedFile(file);
  throwIfCancelled(context);
  const { canvas } =
    options.applyOrientation === false
      ? { canvas: await decodeNoOrient(bytes, file.extension) }
      : await decodeOriented(bytes, file.extension);

  const result = await transform(canvas);
  throwIfCancelled(context);

  const format = resolveFormat(file, options.format);
  const outBytes = await encodeCanvas(result, format, {
    quality: options.quality,
    background: options.background,
  });
  return {
    name: imageOutputName(file.name, format, options.suffix),
    bytes: outBytes,
    mimeType: MIME_BY_FORMAT[format],
  };
}

async function decodeNoOrient(bytes: Uint8Array, extension?: string) {
  const { decodeImage } = await import("./codec");
  return decodeImage(bytes, extension);
}

/**
 * Traite un lot d'images en série, en publiant la progression et en s'arrêtant
 * proprement à l'annulation. Le nommage évite d'écraser deux sorties homonymes.
 */
export async function processImages(
  files: readonly SelectedFile[],
  transform: ImageTransform,
  options: ProcessOptions,
  context?: OperationContext,
): Promise<OutputFile[]> {
  if (files.length === 0) throw new ImageError("empty-selection");
  const outputs: OutputFile[] = [];
  const used = new Set<string>();

  for (const [index, file] of files.entries()) {
    throwIfCancelled(context);
    context?.report?.({
      ratio: index / files.length,
      label: `Image ${index + 1} sur ${files.length}`,
    });
    const output = await processImage(file, transform, options, context);
    output.name = dedupe(output.name, used);
    outputs.push(output);
  }

  context?.report?.({ ratio: 1, label: "Terminé" });
  return outputs;
}

function dedupe(name: string, used: Set<string>): string {
  let candidate = name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let counter = 2; used.has(candidate.toLowerCase()); counter += 1) {
    candidate = `${stem} (${counter})${ext}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}
