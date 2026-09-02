import type { RasterBackend, RasterCanvas, RasterFormat, RasterPixels } from "./types";

/**
 * Implémentation du backend bitmap reposant sur le canvas du navigateur.
 * C'est celle utilisée dans l'application, aussi bien dans la WebView Tauri
 * (WebKitGTK sous Linux, WebView2 sous Windows) qu'en développement web.
 */

const MIME: Record<RasterFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

class BrowserCanvas implements RasterCanvas {
  readonly context: CanvasRenderingContext2D;

  constructor(readonly handle: HTMLCanvasElement) {
    const context = handle.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Contexte 2D indisponible");
    this.context = context;
  }

  get width(): number {
    return this.handle.width;
  }

  get height(): number {
    return this.handle.height;
  }

  async encode(format: RasterFormat, quality = 0.82): Promise<Uint8Array> {
    const blob = await new Promise<Blob | null>((resolve) =>
      this.handle.toBlob(resolve, MIME[format], format === "png" ? undefined : quality),
    );
    if (!blob) throw new Error("Encodage de l'image impossible");
    return new Uint8Array(await blob.arrayBuffer());
  }

  getPixels(): RasterPixels {
    const image = this.context.getImageData(0, 0, this.width, this.height);
    return { width: image.width, height: image.height, data: image.data };
  }

  putPixels(pixels: RasterPixels): void {
    const image = new ImageData(pixels.data, pixels.width, pixels.height);
    this.context.putImageData(image, 0, 0);
  }
}

function create(width: number, height: number): BrowserCanvas {
  const element = document.createElement("canvas");
  element.width = Math.max(1, Math.round(width));
  element.height = Math.max(1, Math.round(height));
  return new BrowserCanvas(element);
}

export const browserRasterBackend: RasterBackend = {
  id: "browser-canvas",

  createCanvas: create,

  async decode(bytes: Uint8Array, mimeType: string): Promise<RasterCanvas> {
    // `bytes.slice()` détache la vue d'un éventuel buffer partagé : le Blob
    // doit posséder ses octets, sinon un traitement suivant peut les écraser.
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeType });
    const bitmap = await createImageBitmap(blob, { imageOrientation: "none" });
    try {
      const canvas = create(bitmap.width, bitmap.height);
      canvas.context.drawImage(bitmap, 0, 0);
      return canvas;
    } finally {
      bitmap.close();
    }
  },

  resize(source: RasterCanvas, width: number, height: number): RasterCanvas {
    const target = create(width, height);
    target.context.imageSmoothingEnabled = true;
    target.context.imageSmoothingQuality = "high";
    target.context.drawImage(
      source.handle as CanvasImageSource,
      0,
      0,
      target.width,
      target.height,
    );
    return target;
  },
};
