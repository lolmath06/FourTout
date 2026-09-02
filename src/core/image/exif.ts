/**
 * Lecture des métadonnées EXIF.
 *
 * Implémentation autonome (aucune dépendance) suffisante pour les besoins de
 * FourTout : orientation, appareil, date de prise de vue, réglages et
 * coordonnées GPS. On lit le bloc TIFF/EXIF présent dans les JPEG (segment
 * APP1), les PNG (chunk `eXIf`) et les WebP (chunk `EXIF`).
 *
 * L'orientation est la donnée la plus importante : elle permet d'afficher et
 * d'exporter une photo de smartphone dans le bon sens.
 */

/** Orientation EXIF (1 = normale, 6 = 90° horaire, etc.). */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface ExifData {
  orientation?: ExifOrientation;
  make?: string;
  model?: string;
  software?: string;
  dateTime?: string;
  dateTimeOriginal?: string;
  exposureTime?: string;
  fNumber?: number;
  iso?: number;
  focalLength?: number;
  lens?: string;
  /** Latitude en degrés décimaux (positif = Nord). */
  gpsLatitude?: number;
  /** Longitude en degrés décimaux (positif = Est). */
  gpsLongitude?: number;
  gpsAltitude?: number;
  /** Nombre d'entrées EXIF réellement lues, indicateur de richesse. */
  tagCount: number;
}

const EXIF_MARKER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

/** Extrait le bloc TIFF EXIF des octets d'une image, tous conteneurs confondus. */
function locateTiff(bytes: Uint8Array): Uint8Array | undefined {
  // JPEG : suite de segments, on cherche APP1 (0xFFE1) commençant par "Exif".
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) break; // début du flux / fin
      const size = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (size < 2) break;
      const body = offset + 4;
      if (marker === 0xe1 && startsWith(bytes, body, EXIF_MARKER)) {
        return bytes.subarray(body + 6);
      }
      offset = body + size - 2;
    }
    return undefined;
  }
  // PNG : chunk "eXIf".
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    return findChunk(bytes, "eXIf");
  }
  // WebP (RIFF) : chunk "EXIF".
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    return findRiffChunk(bytes, "EXIF");
  }
  return undefined;
}

function startsWith(bytes: Uint8Array, at: number, pattern: number[]): boolean {
  for (let i = 0; i < pattern.length; i += 1) {
    if (bytes[at + i] !== pattern[i]) return false;
  }
  return true;
}

function findChunk(bytes: Uint8Array, type: string): Uint8Array | undefined {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readU32(bytes, offset, false);
    const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    if (name === type) {
      let data = bytes.subarray(dataStart, dataStart + length);
      // Certains encodeurs préfixent le marqueur "Exif\0\0".
      if (startsWith(data, 0, EXIF_MARKER)) data = data.subarray(6);
      return data;
    }
    offset = dataStart + length + 4; // +4 CRC
  }
  return undefined;
}

function findRiffChunk(bytes: Uint8Array, type: string): Uint8Array | undefined {
  let offset = 12; // "RIFF" + size + "WEBP"
  while (offset + 8 <= bytes.length) {
    const name = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const length = readU32(bytes, offset + 4, true);
    const dataStart = offset + 8;
    if (name === type) {
      let data = bytes.subarray(dataStart, dataStart + length);
      if (startsWith(data, 0, EXIF_MARKER)) data = data.subarray(6);
      return data;
    }
    offset = dataStart + length + (length % 2); // padding pair
  }
  return undefined;
}

function readU32(bytes: Uint8Array, at: number, little: boolean): number {
  return little
    ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
    : ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function readU16(bytes: Uint8Array, at: number, little: boolean): number {
  return little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1];
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

interface RawEntry {
  tag: number;
  type: number;
  count: number;
  valueOffset: number;
}

/** Lit une IFD (Image File Directory) TIFF et renvoie ses entrées brutes. */
function readIfd(tiff: Uint8Array, ifdOffset: number, little: boolean): RawEntry[] {
  if (ifdOffset + 2 > tiff.length) return [];
  const count = readU16(tiff, ifdOffset, little);
  const entries: RawEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = ifdOffset + 2 + i * 12;
    if (at + 12 > tiff.length) break;
    entries.push({
      tag: readU16(tiff, at, little),
      type: readU16(tiff, at + 2, little),
      count: readU32(tiff, at + 4, little),
      valueOffset: at + 8,
    });
  }
  return entries;
}

function entryValueStart(tiff: Uint8Array, entry: RawEntry, little: boolean): number {
  const byteLength = (TYPE_SIZE[entry.type] ?? 1) * entry.count;
  return byteLength <= 4 ? entry.valueOffset : readU32(tiff, entry.valueOffset, little);
}

function readAscii(tiff: Uint8Array, entry: RawEntry, little: boolean): string {
  const start = entryValueStart(tiff, entry, little);
  const end = Math.min(start + entry.count, tiff.length);
  let out = "";
  for (let i = start; i < end; i += 1) {
    const c = tiff[i];
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out.trim();
}

function readInt(tiff: Uint8Array, entry: RawEntry, little: boolean): number {
  const start = entryValueStart(tiff, entry, little);
  return entry.type === 3 ? readU16(tiff, start, little) : readU32(tiff, start, little);
}

function readRational(tiff: Uint8Array, entry: RawEntry, little: boolean, index = 0): number {
  const start = entryValueStart(tiff, entry, little) + index * 8;
  const num = readU32(tiff, start, little);
  const den = readU32(tiff, start + 4, little);
  return den === 0 ? 0 : num / den;
}

/** Analyse les octets d'une image et renvoie ses métadonnées EXIF. */
export function parseExif(bytes: Uint8Array): ExifData | undefined {
  const tiff = locateTiff(bytes);
  if (!tiff || tiff.length < 8) return undefined;

  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return undefined;

  const ifd0Offset = readU32(tiff, 4, little);
  const ifd0 = readIfd(tiff, ifd0Offset, little);
  if (ifd0.length === 0) return undefined;

  const data: ExifData = { tagCount: 0 };
  let exifPointer: number | undefined;
  let gpsPointer: number | undefined;

  for (const entry of ifd0) {
    data.tagCount += 1;
    switch (entry.tag) {
      case 0x0112: data.orientation = clampOrientation(readInt(tiff, entry, little)); break;
      case 0x010f: data.make = readAscii(tiff, entry, little); break;
      case 0x0110: data.model = readAscii(tiff, entry, little); break;
      case 0x0131: data.software = readAscii(tiff, entry, little); break;
      case 0x0132: data.dateTime = readAscii(tiff, entry, little); break;
      case 0x8769: exifPointer = readInt(tiff, entry, little); break;
      case 0x8825: gpsPointer = readInt(tiff, entry, little); break;
    }
  }

  if (exifPointer !== undefined) {
    for (const entry of readIfd(tiff, exifPointer, little)) {
      data.tagCount += 1;
      switch (entry.tag) {
        case 0x9003: data.dateTimeOriginal = readAscii(tiff, entry, little); break;
        case 0x829a: data.exposureTime = formatExposure(readRational(tiff, entry, little)); break;
        case 0x829d: data.fNumber = round(readRational(tiff, entry, little), 2); break;
        case 0x8827: data.iso = readInt(tiff, entry, little); break;
        case 0x920a: data.focalLength = round(readRational(tiff, entry, little), 1); break;
        case 0xa434: data.lens = readAscii(tiff, entry, little); break;
      }
    }
  }

  if (gpsPointer !== undefined) {
    readGps(tiff, gpsPointer, little, data);
  }

  return data;
}

function readGps(tiff: Uint8Array, offset: number, little: boolean, data: ExifData): void {
  const entries = readIfd(tiff, offset, little);
  let latRef = "N";
  let lonRef = "E";
  let lat: number | undefined;
  let lon: number | undefined;
  let altRef = 0;
  for (const entry of entries) {
    data.tagCount += 1;
    switch (entry.tag) {
      case 0x0001: latRef = readAscii(tiff, entry, little) || "N"; break;
      case 0x0002: lat = dms(tiff, entry, little); break;
      case 0x0003: lonRef = readAscii(tiff, entry, little) || "E"; break;
      case 0x0004: lon = dms(tiff, entry, little); break;
      case 0x0005: altRef = readInt(tiff, entry, little); break;
      case 0x0006: data.gpsAltitude = round(readRational(tiff, entry, little) * (altRef ? -1 : 1), 1); break;
    }
  }
  if (lat !== undefined) data.gpsLatitude = round(latRef === "S" ? -lat : lat, 6);
  if (lon !== undefined) data.gpsLongitude = round(lonRef === "W" ? -lon : lon, 6);
}

function dms(tiff: Uint8Array, entry: RawEntry, little: boolean): number {
  const deg = readRational(tiff, entry, little, 0);
  const min = readRational(tiff, entry, little, 1);
  const sec = readRational(tiff, entry, little, 2);
  return deg + min / 60 + sec / 3600;
}

function clampOrientation(value: number): ExifOrientation | undefined {
  return value >= 1 && value <= 8 ? (value as ExifOrientation) : undefined;
}

function formatExposure(seconds: number): string {
  if (seconds <= 0) return "";
  return seconds >= 1 ? `${round(seconds, 1)} s` : `1/${Math.round(1 / seconds)} s`;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
