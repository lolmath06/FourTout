import { createCanvas, loadImage, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { join } from "node:path";
import type {
  RasterBackend,
  RasterCanvas,
  RasterFormat,
  RasterPixels,
} from "@/core/pdf/raster/types";
import { configurePdfJs } from "@/core/pdf/pdfjs";

/**
 * Backend bitmap pour les tests, adossé à `@napi-rs/canvas`.
 *
 * Il permet d'exécuter réellement, en Node, le rendu des pages et la
 * recompression des images — donc de tester ces fonctions au lieu de les
 * simuler. Ce module ne fait pas partie de l'application : seule la suite de
 * tests l'importe (`@napi-rs/canvas` est une dépendance de développement).
 */

// `createCanvas` est surchargé (bitmap ou SVG) : on retient la variante bitmap.
type NodeCanvas = Canvas;

class NodeRasterCanvas implements RasterCanvas {
  readonly context: SKRSContext2D;

  constructor(readonly handle: NodeCanvas) {
    this.context = handle.getContext("2d");
  }

  get width(): number {
    return this.handle.width;
  }

  get height(): number {
    return this.handle.height;
  }

  async encode(format: RasterFormat, quality = 0.82): Promise<Uint8Array> {
    const buffer =
      format === "png"
        ? this.handle.toBuffer("image/png")
        : format === "webp"
          ? this.handle.toBuffer("image/webp", Math.round(quality * 100))
          : this.handle.toBuffer("image/jpeg", Math.round(quality * 100));
    return new Uint8Array(buffer);
  }

  getPixels(): RasterPixels {
    const image = this.context.getImageData(0, 0, this.width, this.height);
    return {
      width: image.width,
      height: image.height,
      data: new Uint8ClampedArray(image.data),
    };
  }

  putPixels(pixels: RasterPixels): void {
    const image = this.context.createImageData(pixels.width, pixels.height);
    image.data.set(pixels.data);
    this.context.putImageData(image, 0, 0);
  }
}

function create(width: number, height: number): NodeRasterCanvas {
  return new NodeRasterCanvas(
    createCanvas(
      Math.max(1, Math.round(width)),
      Math.max(1, Math.round(height)),
    ),
  );
}

export const nodeRasterBackend: RasterBackend = {
  id: "node-canvas",

  createCanvas: create,

  async decode(bytes: Uint8Array): Promise<RasterCanvas> {
    const image = await loadImage(Buffer.from(bytes));
    const canvas = create(image.width, image.height);
    canvas.context.drawImage(image, 0, 0);
    return canvas;
  },

  resize(source: RasterCanvas, width: number, height: number): RasterCanvas {
    const target = create(width, height);
    target.context.drawImage(source.handle as NodeCanvas, 0, 0, target.width, target.height);
    return target;
  },
};

/** Pointe pdf.js vers les ressources présentes dans `node_modules`. */
export function configurePdfJsForNode(): void {
  const root = join(process.cwd(), "node_modules", "pdfjs-dist");
  configurePdfJs({
    standardFontDataUrl: join(root, "standard_fonts") + "/",
    cMapUrl: join(root, "cmaps") + "/",
  });
}
