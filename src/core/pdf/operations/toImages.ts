import { openWithPdfJs } from "../pdfjs";
import { report, throwIfCancelled } from "../document";
import { PdfError } from "../errors";
import { numberedName } from "../filenames";
import { getRasterBackend, type RasterPixels } from "../raster/types";
import type { OperationContext, OutputFile, PdfSource } from "../types";

/**
 * Rendu des pages en images.
 *
 * Chaque page est réellement dessinée par pdf.js dans un canvas, puis encodée
 * en PNG ou JPEG. Le calcul se fait entièrement sur la machine, sans service
 * externe ni binaire additionnel.
 */

export type ImageOutputFormat = "png" | "jpeg";

/** Résolutions proposées, en points par pouce. */
export const DPI_PRESETS = {
  screen: 96,
  good: 150,
  print: 300,
} as const;

export interface ToImagesOptions {
  format: ImageOutputFormat;
  /** Résolution cible ; un PDF est décrit en points (72 pt = 1 pouce). */
  dpi: number;
  /** Qualité JPEG, de 0 à 1. Sans effet en PNG. */
  quality?: number;
  /** Pages à convertir ; toutes si absent. */
  pages?: readonly number[];
}

/** Garde-fou : au-delà, un canvas peut dépasser les limites du navigateur. */
const MAX_PIXELS = 40_000_000;

export async function pdfToImages(
  source: PdfSource,
  options: ToImagesOptions,
  context?: OperationContext,
): Promise<OutputFile[]> {
  const backend = getRasterBackend();
  if (!backend) throw new PdfError("render-unavailable");

  const document = await openWithPdfJs(source);
  const outputs: OutputFile[] = [];

  try {
    const targets =
      options.pages && options.pages.length > 0
        ? [...options.pages]
        : Array.from({ length: document.numPages }, (_, index) => index + 1);

    const invalid = targets.filter((page) => page < 1 || page > document.numPages);
    if (invalid.length > 0) {
      throw new PdfError("page-out-of-range", `Page(s) inexistante(s) : ${invalid.join(", ")}.`);
    }

    for (const [index, pageNumber] of targets.entries()) {
      throwIfCancelled(context);
      report(context, index / targets.length, `Page ${pageNumber} sur ${targets.length}`);

      const page = await document.getPage(pageNumber);
      const scale = clampScale(options.dpi / 72, page.getViewport({ scale: 1 }));
      const viewport = page.getViewport({ scale });

      const canvas = backend.createCanvas(viewport.width, viewport.height);
      // Le JPEG ne gère pas la transparence : sans fond blanc, les zones vides
      // ressortiraient en noir.
      if (options.format === "jpeg") {
        const ctx = canvas.context as CanvasRenderingContext2D;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      await page.render({
        canvasContext: canvas.context as never,
        canvas: canvas.handle as never,
        viewport,
      }).promise;
      page.cleanup();

      outputs.push({
        name: numberedName(source.name, pageNumber, document.numPages, options.format === "jpeg" ? "jpg" : "png"),
        bytes: await canvas.encode(options.format, options.quality ?? 0.85),
        mimeType: options.format === "jpeg" ? "image/jpeg" : "image/png",
      });
    }
  } finally {
    await document.loadingTask?.destroy();
  }

  report(context, 1, "Terminé");
  return outputs;
}

/** Réduit l'échelle si la page rendue dépasserait la taille maximale d'un canvas. */
function clampScale(scale: number, baseViewport: { width: number; height: number }): number {
  const pixels = baseViewport.width * scale * baseViewport.height * scale;
  if (pixels <= MAX_PIXELS) return scale;
  return scale * Math.sqrt(MAX_PIXELS / pixels);
}

/**
 * Rend une page en miniature, pour les aperçus et la réorganisation.
 * Renvoie `undefined` si aucun backend de rendu n'est disponible : un aperçu
 * absent ne doit jamais empêcher une opération de fonctionner.
 */
export async function renderThumbnail(
  source: PdfSource,
  pageNumber: number,
  maxWidth = 160,
): Promise<Uint8Array | undefined> {
  const backend = getRasterBackend();
  if (!backend) return undefined;

  const document = await openWithPdfJs(source);
  try {
    if (pageNumber < 1 || pageNumber > document.numPages) return undefined;
    const page = await document.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, maxWidth / base.width) });

    const canvas = backend.createCanvas(viewport.width, viewport.height);
    const ctx = canvas.context as CanvasRenderingContext2D;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvasContext: canvas.context as never,
      canvas: canvas.handle as never,
      viewport,
    }).promise;
    page.cleanup();
    return await canvas.encode("png");
  } finally {
    await document.loadingTask?.destroy();
  }
}

/** Résultat du rendu d'une page pour l'éditeur visuel. */
export interface EditorPageRender {
  /** Page encodée en PNG, pour un affichage `<img>` statique (WebKitGTK-safe). */
  png: Uint8Array;
  /** Largeur du rendu, en pixels. */
  widthPx: number;
  /** Hauteur du rendu, en pixels. */
  heightPx: number;
  /** Pixels RVBA du rendu, pour échantillonner fond et couleur du texte. */
  pixels: RasterPixels;
  /** Facteur pixels par point (px / pt). */
  scale: number;
  /** Dimensions de la page en points PDF. */
  widthPts: number;
  heightPts: number;
}

/**
 * Rend une page pour l'éditeur de texte : un PNG statique (affiché via `<img>`,
 * conformément à l'approche anti-artefacts WebKitGTK — aucune surface canvas
 * persistante) **et** les pixels du rendu, nécessaires pour échantillonner la
 * couleur de fond sous chaque zone de texte. Le canvas temporaire est libéré
 * immédiatement.
 */
export async function renderPageForEditor(
  source: PdfSource,
  pageNumber: number,
  targetWidthPx: number,
): Promise<EditorPageRender> {
  const backend = getRasterBackend();
  if (!backend) throw new PdfError("render-unavailable");

  const document = await openWithPdfJs(source);
  try {
    if (pageNumber < 1 || pageNumber > document.numPages) {
      throw new PdfError("page-out-of-range", `Page ${pageNumber} inexistante.`);
    }
    const page = await document.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const rawScale = targetWidthPx / base.width;
    const scale = clampScale(rawScale, base);
    const viewport = page.getViewport({ scale });

    const canvas = backend.createCanvas(viewport.width, viewport.height);
    const ctx = canvas.context as CanvasRenderingContext2D;
    // Fond blanc : une page PDF est opaque, et cela évite un fond transparent
    // (noir en JPEG) sous les zones échantillonnées.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvasContext: canvas.context as never,
      canvas: canvas.handle as never,
      viewport,
    }).promise;

    const png = await canvas.encode("png");
    const pixels = canvas.getPixels();
    page.cleanup();

    return {
      png,
      widthPx: canvas.width,
      heightPx: canvas.height,
      pixels,
      scale,
      widthPts: base.width,
      heightPts: base.height,
    };
  } finally {
    await document.loadingTask?.destroy();
  }
}
