import { crc32 } from "./zip";
import { InflateError, inflateRaw } from "./inflate";

/**
 * Lecture d'archives ZIP, en mémoire.
 *
 * Pendant de `createZip`, écrit pour le seul besoin réel de FourTout côté
 * navigateur : ouvrir les parties XML d'un `.docx` déposé dans la fenêtre,
 * quand aucun chemin de fichier n'est disponible pour passer par le socle Rust.
 * On lit le **répertoire central**, la seule source fiable de la liste des
 * entrées — les en-têtes locaux peuvent mentir sur les tailles.
 */

export interface ZipFileEntry {
  name: string;
  /** Taille après décompression, telle que déclarée par l'archive. */
  size: number;
  compressedSize: number;
  /** 0 = stocké, 8 = deflate. Les autres méthodes ne sont pas gérées. */
  method: number;
  /** Décompresse l'entrée et vérifie son empreinte CRC-32. */
  read(): Uint8Array;
}

export class ZipReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipReadError";
  }
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

/** Signature d'une archive ZIP (« PK » ou une archive vide). */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  );
}

/**
 * Localise la fin du répertoire central. Elle est en queue d'archive, précédée
 * d'un commentaire de taille libre : on remonte depuis la fin.
 */
function findEndOfCentralDirectory(view: DataView, length: number): number {
  const earliest = Math.max(0, length - 0xffff - 22);
  for (let offset = length - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new ZipReadError("Ce fichier n'est pas une archive ZIP exploitable.");
}

/**
 * Ouvre une archive et décrit ses entrées. Le contenu n'est décompressé qu'à
 * l'appel de `read()` : ouvrir un `.docx` pour n'en lire qu'une partie ne coûte
 * que la lecture de son index.
 */
export function readZip(bytes: Uint8Array): ZipFileEntry[] {
  if (bytes.length < 22) throw new ZipReadError("Ce fichier est trop court pour être une archive ZIP.");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfCentralDirectory(view, bytes.length);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);

  const decoder = new TextDecoder("utf-8");
  const entries: ZipFileEntry[] = [];

  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL_FILE_HEADER) {
      throw new ZipReadError("Répertoire central de l'archive endommagé.");
    }
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    entries.push({
      name,
      size,
      compressedSize,
      method,
      read: () => readEntry(bytes, view, localOffset, method, compressedSize, size, crc, name),
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readEntry(
  bytes: Uint8Array,
  view: DataView,
  localOffset: number,
  method: number,
  compressedSize: number,
  size: number,
  crc: number,
  name: string,
): Uint8Array {
  if (view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER) {
    throw new ZipReadError(`Entrée « ${name} » introuvable dans l'archive.`);
  }
  // Les longueurs de nom et d'extra de l'en-tête local diffèrent légitimement
  // de celles du répertoire central : ce sont celles-ci qui donnent l'adresse
  // des données.
  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const start = localOffset + 30 + nameLength + extraLength;
  const raw = bytes.subarray(start, start + compressedSize);

  let data: Uint8Array;
  if (method === 0) {
    data = raw.slice();
  } else if (method === 8) {
    try {
      data = inflateRaw(raw, size);
    } catch (error) {
      const detail = error instanceof InflateError ? ` ${error.message}` : "";
      throw new ZipReadError(`Entrée « ${name} » illisible.${detail}`);
    }
  } else {
    throw new ZipReadError(
      `Entrée « ${name} » compressée dans un format non pris en charge (méthode ${method}).`,
    );
  }

  if (crc !== 0 && crc32(data) !== crc) {
    throw new ZipReadError(`Entrée « ${name} » endommagée (empreinte incorrecte).`);
  }
  return data;
}

/** Récupère une entrée par son nom exact, ou `undefined`. */
export function readZipEntry(
  entries: readonly ZipFileEntry[],
  name: string,
): Uint8Array | undefined {
  return entries.find((entry) => entry.name === name)?.read();
}
