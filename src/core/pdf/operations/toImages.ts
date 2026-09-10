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

/**
 * Une page rendue, avec **tout ce qu'il faut pour revenir aux coordonnées PDF**.
 *
 * Les pixels seuls ne suffisent pas : positionner une couche de texte océrisée
 * suppose de connaître l'échelle, la taille de la page en points et sa
 * rotation. Ces informations sont produites ici, à l'endroit exact où le rendu
 * a lieu, plutôt que devinées ensuite.
 */
export interface RenderedPage {
  /** Numéro de page, base 1. */
  page: number;
  /** Nombre total de pages du document source. */
  pageCount: number;
  /** Image encodée. */
  bytes: Uint8Array;
  mimeType: string;
  /** Dimensions de l'image produite, en pixels. */
  widthPx: number;
  heightPx: number;
  /** Facteur pixels par point réellement appliqué (bridé si la page est énorme). */
  scale: number;
  /** Dimensions de la page **telle qu'affichée** (rotation appliquée), en points. */
  viewWidthPts: number;
  viewHeightPts: number;
  /** Rotation déclarée de la page, en degrés (0, 90, 180 ou 270). */
  rotation: number;
}

/**
 * Rend les pages demandées en images, en conservant leur géométrie, et remet
 * chacune à `onPage` **dès qu'elle est prête**.
 *
 * C'est le seul endroit de l'application où une page PDF devient des pixels :
 * `pdfToImages` (conversion en fichiers image) et le PDF recherchable (couche
 * texte) s'appuient tous deux dessus, avec la même échelle et le même bridage.
 * Le traitement au fil de l'eau évite de garder en mémoire les images de toutes
 * les pages d'un document long, et permet à l'appelant d'entrelacer son propre
 * travail — l'OCR — avec le rendu, sans rouvrir le document à chaque page.
 */
export async function renderPagesStream(
  source: PdfSource,
  options: ToImagesOptions,
  onPage: (page: RenderedPage, index: number, total: number) => Promise<void> | void,
  context?: OperationContext,
): Promise<void> {
  const backend = getRasterBackend();
  if (!backend) throw new PdfError("render-unavailable");

  const document = await openWithPdfJs(source);

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
      const base = page.getViewport({ scale: 1 });
      const scale = clampScale(options.dpi / 72, base);
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

      await onPage(
        {
          page: pageNumber,
          pageCount: document.numPages,
          bytes: await canvas.encode(options.format, options.quality ?? 0.85),
          mimeType: options.format === "jpeg" ? "image/jpeg" : "image/png",
          widthPx: canvas.width,
          heightPx: canvas.height,
          scale,
          viewWidthPts: base.width,
          viewHeightPts: base.height,
          rotation: ((page.rotate % 360) + 360) % 360,
        },
        index,
        targets.length,
      );
    }
  } finally {
    await document.loadingTask?.destroy();
  }

  report(context, 1, "Terminé");
}

/** Variante « tout en mémoire » de `renderPagesStream`. */
export async function renderPages(
  source: PdfSource,
  options: ToImagesOptions,
  context?: OperationContext,
): Promise<RenderedPage[]> {
  const rendered: RenderedPage[] = [];
  await renderPagesStream(source, options, (page) => void rendered.push(page), context);
  return rendered;
}

export async function pdfToImages(
  source: PdfSource,
  options: ToImagesOptions,
  context?: OperationContext,
): Promise<OutputFile[]> {
  const rendered = await renderPages(source, options, context);
  return rendered.map((item) => ({
    name: numberedName(
      source.name,
      item.page,
      item.pageCount,
      options.format === "jpeg" ? "jpg" : "png",
    ),
    bytes: item.bytes,
    mimeType: item.mimeType,
  }));
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
