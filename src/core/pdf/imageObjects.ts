import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  type PDFDocument,
} from "@cantoo/pdf-lib";

/**
 * Inventaire des images embarquées dans un PDF.
 *
 * Deux outils s'en servent : l'extraction d'images et la compression. Les
 * mêmes règles de décodage s'appliquent donc aux deux, et ce qui n'est pas
 * pris en charge est signalé explicitement plutôt que produit à moitié.
 */

export type ImageEncoding =
  /** Flux JPEG, réutilisable tel quel. */
  | "jpeg"
  /** Pixels bruts compressés en zlib, reconstructibles. */
  | "raw"
  /** Encodage non pris en charge (JPEG 2000, CCITT, JBIG2, masque…). */
  | "unsupported";

export interface EmbeddedImage {
  ref: PDFRef;
  stream: PDFRawStream;
  width: number;
  height: number;
  bitsPerComponent: number;
  /** Nombre de composantes couleur : 1 (gris) ou 3 (RVB). */
  components: number;
  encoding: ImageEncoding;
  /** Raison de l'exclusion, lorsque `encoding` vaut `unsupported`. */
  reason?: string;
  /** Taille du flux tel qu'il est stocké dans le PDF, en octets. */
  byteLength: number;
  /** L'image porte-t-elle une transparence (masque associé) ? */
  hasMask: boolean;
}

const FLATE_FILTERS = new Set(["/FlateDecode", "/Fl"]);
const JPEG_FILTERS = new Set(["/DCTDecode", "/DCT"]);

/** Liste les filtres d'un flux, du plus externe au plus interne. */
function filterNames(dict: PDFDict): string[] {
  const filter = dict.get(PDFName.of("Filter"));
  if (filter instanceof PDFName) return [filter.toString()];
  if (filter instanceof PDFArray) {
    return filter.asArray().map((entry) => entry.toString());
  }
  return [];
}

function numberValue(dict: PDFDict, key: string): number | undefined {
  const value = dict.get(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : undefined;
}

/** Nombre de composantes d'un espace colorimétrique, ou `undefined` si exotique. */
function componentsOf(document: PDFDocument, dict: PDFDict): number | undefined {
  const raw = dict.get(PDFName.of("ColorSpace"));
  const resolved = raw instanceof PDFRef ? document.context.lookup(raw) : raw;
  const name = resolved?.toString() ?? "";

  if (name === "/DeviceRGB" || name === "/RGB" || name === "/CalRGB") return 3;
  if (name === "/DeviceGray" || name === "/G" || name === "/CalGray") return 1;
  // Indexed, Separation, ICCBased, DeviceN… demanderaient une table de
  // conversion complète : hors périmètre, l'image est laissée telle quelle.
  return undefined;
}

/**
 * Parcourt tous les objets du document et retient les images.
 * Renvoie aussi celles qui ne sont pas exploitables, avec leur raison, pour
 * que l'interface puisse expliquer ce qui a été ignoré.
 */
export function listEmbeddedImages(document: PDFDocument): EmbeddedImage[] {
  const images: EmbeddedImage[] = [];

  for (const [ref, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;

    const dict = object.dict;
    if (dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;

    const width = numberValue(dict, "Width");
    const height = numberValue(dict, "Height");
    if (!width || !height) continue;

    const bitsPerComponent = numberValue(dict, "BitsPerComponent") ?? 8;
    const filters = filterNames(dict);
    const components = componentsOf(document, dict);
    const hasMask =
      dict.has(PDFName.of("SMask")) ||
      dict.has(PDFName.of("Mask")) ||
      dict.get(PDFName.of("ImageMask"))?.toString() === "true";

    const base: Omit<EmbeddedImage, "encoding" | "reason"> = {
      ref,
      stream: object,
      width,
      height,
      bitsPerComponent,
      components: components ?? 0,
      byteLength: object.contents.length,
      hasMask,
    };

    const last = filters[filters.length - 1];

    if (last && JPEG_FILTERS.has(last) && filters.length === 1) {
      images.push({ ...base, encoding: "jpeg" });
      continue;
    }
    if (last && FLATE_FILTERS.has(last) && filters.length === 1) {
      if (bitsPerComponent !== 8 || components === undefined) {
        images.push({
          ...base,
          encoding: "unsupported",
          reason:
            components === undefined
              ? "espace colorimétrique non géré"
              : `${bitsPerComponent} bits par composante`,
        });
        continue;
      }
      images.push({ ...base, encoding: "raw" });
      continue;
    }

    images.push({
      ...base,
      encoding: "unsupported",
      reason: filters.length === 0 ? "flux non compressé" : `filtre ${filters.join(" + ")}`,
    });
  }

  return images;
}

/**
 * Décompresse un flux zlib. `DecompressionStream` est disponible aussi bien
 * dans la WebView que dans Node : aucune bibliothèque supplémentaire.
 */
export async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice().buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Compresse en zlib, pour réécrire un flux dans le document. */
export async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice().buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Annule le filtre prédictif PNG appliqué avant la compression.
 *
 * Les producteurs de PDF l'utilisent couramment pour mieux compresser les
 * images : sans cette étape, les pixels obtenus seraient du bruit.
 */
export function undoPngPredictor(
  data: Uint8Array,
  colors: number,
  bitsPerComponent: number,
  columns: number,
): Uint8Array {
  const bytesPerPixel = Math.max(1, Math.ceil((colors * bitsPerComponent) / 8));
  const rowLength = Math.ceil((colors * bitsPerComponent * columns) / 8);
  const rows = Math.floor(data.length / (rowLength + 1));
  const output = new Uint8Array(rows * rowLength);

  let previousRow = new Uint8Array(rowLength);

  for (let row = 0; row < rows; row += 1) {
    const start = row * (rowLength + 1);
    const filter = data[start];
    const current = data.subarray(start + 1, start + 1 + rowLength).slice();

    for (let i = 0; i < rowLength; i += 1) {
      const left = i >= bytesPerPixel ? current[i - bytesPerPixel] : 0;
      const up = previousRow[i];
      const upLeft = i >= bytesPerPixel ? previousRow[i - bytesPerPixel] : 0;

      switch (filter) {
        case 1:
          current[i] = (current[i] + left) & 0xff;
          break;
        case 2:
          current[i] = (current[i] + up) & 0xff;
          break;
        case 3:
          current[i] = (current[i] + ((left + up) >> 1)) & 0xff;
          break;
        case 4:
          current[i] = (current[i] + paeth(left, up, upLeft)) & 0xff;
          break;
        default:
          break;
      }
    }

    output.set(current, row * rowLength);
    previousRow = current;
  }

  return output;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export interface DecodeParams {
  predictor: number;
  colors: number;
  bitsPerComponent: number;
  columns: number;
}

/** Lit le dictionnaire `/DecodeParms` d'un flux, avec les valeurs par défaut. */
export function readDecodeParams(document: PDFDocument, image: EmbeddedImage): DecodeParams {
  const raw = image.stream.dict.get(PDFName.of("DecodeParms"));
  const resolved = raw instanceof PDFRef ? document.context.lookup(raw) : raw;
  const dict =
    resolved instanceof PDFDict
      ? resolved
      : resolved instanceof PDFArray
        ? resolved.asArray().find((entry) => entry instanceof PDFDict)
        : undefined;

  const read = (key: string, fallback: number) => {
    if (!(dict instanceof PDFDict)) return fallback;
    const value = dict.get(PDFName.of(key));
    return value instanceof PDFNumber ? value.asNumber() : fallback;
  };

  return {
    predictor: read("Predictor", 1),
    colors: read("Colors", image.components || 1),
    bitsPerComponent: read("BitsPerComponent", image.bitsPerComponent),
    columns: read("Columns", image.width),
  };
}

/**
 * Reconstruit les pixels RVBA d'une image stockée en flux zlib brut.
 * Renvoie `undefined` si les données ne correspondent pas aux dimensions
 * annoncées — mieux vaut ignorer l'image que produire une bouillie.
 */
export async function decodeRawImage(
  document: PDFDocument,
  image: EmbeddedImage,
): Promise<{ width: number; height: number; data: Uint8ClampedArray } | undefined> {
  let pixels = await inflate(image.stream.contents);
  const params = readDecodeParams(document, image);

  if (params.predictor >= 10) {
    pixels = undoPngPredictor(pixels, params.colors, params.bitsPerComponent, params.columns);
  }

  const expected = image.width * image.height * image.components;
  if (pixels.length < expected) return undefined;

  const rgba = new Uint8ClampedArray(image.width * image.height * 4);
  for (let i = 0, p = 0; i < image.width * image.height; i += 1) {
    if (image.components === 1) {
      const grey = pixels[i];
      rgba[p++] = grey;
      rgba[p++] = grey;
      rgba[p++] = grey;
    } else {
      rgba[p++] = pixels[i * 3];
      rgba[p++] = pixels[i * 3 + 1];
      rgba[p++] = pixels[i * 3 + 2];
    }
    rgba[p++] = 255;
  }

  return { width: image.width, height: image.height, data: rgba };
}
