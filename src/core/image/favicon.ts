import type { RasterCanvas } from "@/core/pdf/raster/types";
import { crop, resize } from "./operations";

/**
 * Génération de favicons et de jeux de tailles.
 *
 * Le `.ico` produit est un **vrai conteneur ICO multi-résolutions** (entrées
 * PNG, prises en charge depuis Windows Vista), et non un PNG renommé.
 */

export interface IcoEntry {
  size: number;
  png: Uint8Array;
}

/** Assemble plusieurs PNG carrés en un fichier ICO multi-résolutions. */
export function buildIco(entries: readonly IcoEntry[]): Uint8Array {
  const count = entries.length;
  const header = new Uint8Array(6 + count * 16);
  const view = new DataView(header.buffer);
  view.setUint16(0, 0, true); // réservé
  view.setUint16(2, 1, true); // type : icône
  view.setUint16(4, count, true);

  let offset = header.length;
  const directory: { entry: IcoEntry; offset: number }[] = [];
  entries.forEach((entry, index) => {
    const base = 6 + index * 16;
    header[base] = entry.size >= 256 ? 0 : entry.size; // largeur (0 = 256)
    header[base + 1] = entry.size >= 256 ? 0 : entry.size; // hauteur
    header[base + 2] = 0; // palette
    header[base + 3] = 0; // réservé
    view.setUint16(base + 4, 1, true); // plans
    view.setUint16(base + 6, 32, true); // bits par pixel
    view.setUint32(base + 8, entry.png.length, true); // taille des données
    view.setUint32(base + 12, offset, true); // décalage
    directory.push({ entry, offset });
    offset += entry.png.length;
  });

  const total = new Uint8Array(offset);
  total.set(header, 0);
  for (const { entry, offset: at } of directory) total.set(entry.png, at);
  return total;
}

/** Tailles de favicon usuelles. */
export const FAVICON_SIZES = [16, 32, 48] as const;
/** Tailles d'icônes web/app usuelles. */
export const ICON_SIZES = [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024] as const;

/** Redimensionne une source en un carré `size×size` (recadrage centré). */
export function squareResize(source: RasterCanvas, size: number): RasterCanvas {
  const side = Math.min(source.width, source.height);
  const sx = Math.floor((source.width - side) / 2);
  const sy = Math.floor((source.height - side) / 2);
  return resize(crop(source, { x: sx, y: sy, width: side, height: side }), size, size);
}
