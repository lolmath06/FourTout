/**
 * Abstraction de rendu bitmap.
 *
 * Trois usages en dépendent : le rendu des pages (PDF vers images et
 * miniatures), la recompression des images embarquées, et la conversion des
 * images brutes extraites d'un PDF. Les implémentations diffèrent selon
 * l'environnement — canvas du navigateur dans l'application, canvas natif dans
 * les tests — mais le cœur métier ne connaît que cette interface.
 */

export type RasterFormat = "png" | "jpeg";

/** Image en mémoire, au format RVBA sur 8 bits par composante. */
export interface RasterPixels {
  width: number;
  height: number;
  /** `width * height * 4` octets, dans l'ordre R, V, B, A. */
  data: Uint8ClampedArray;
}

export interface RasterCanvas {
  readonly width: number;
  readonly height: number;
  /**
   * Le contexte 2D natif. Typé `unknown` car son type diffère selon
   * l'implémentation ; seul pdf.js le consomme, et il accepte les deux.
   */
  readonly context: unknown;
  /** L'objet canvas lui-même, également requis par l'API de rendu de pdf.js. */
  readonly handle: unknown;

  encode(format: RasterFormat, quality?: number): Promise<Uint8Array>;
  getPixels(): RasterPixels;
  putPixels(pixels: RasterPixels): void;
}

export interface RasterBackend {
  readonly id: string;
  createCanvas(width: number, height: number): RasterCanvas;
  /** Décode une image encodée (JPEG, PNG…) et la dessine dans un canvas. */
  decode(bytes: Uint8Array, mimeType: string): Promise<RasterCanvas>;
  /** Redimensionne en conservant le lissage ; ne modifie pas la source. */
  resize(source: RasterCanvas, width: number, height: number): RasterCanvas;
}

/**
 * Le backend actif. L'application installe celui du navigateur au démarrage,
 * les tests celui de Node : le cœur métier n'a jamais à savoir lequel.
 */
let backend: RasterBackend | undefined;

export function setRasterBackend(next: RasterBackend | undefined): void {
  backend = next;
}

export function getRasterBackend(): RasterBackend | undefined {
  return backend;
}

export function hasRasterBackend(): boolean {
  return backend !== undefined;
}
