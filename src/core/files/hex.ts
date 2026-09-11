/**
 * Mise en forme hexadécimale.
 *
 * Ces fonctions sont **pures** et ne touchent jamais au disque : la lecture par
 * fenêtres est faite côté natif, ici on ne fait que présenter des octets déjà
 * reçus. C'est aussi ce qui les rend testables sans fichier ni application
 * installée.
 */

/** Nombre d'octets par ligne d'un vidage hexadécimal classique. */
export const BYTES_PER_LINE = 16;

export interface HexLine {
  /** Décalage absolu du premier octet de la ligne, dans le fichier. */
  offset: number;
  /** Octets de la ligne (au plus `BYTES_PER_LINE`). */
  bytes: number[];
  /** Représentation hexadécimale, deux chiffres par octet. */
  hex: string[];
  /** Colonne ASCII : un point pour tout ce qui n'est pas imprimable. */
  ascii: string;
}

/** Décalage formaté en hexadécimal, sur au moins huit chiffres. */
export function formatOffset(offset: number): string {
  return offset.toString(16).toUpperCase().padStart(8, "0");
}

export function toHexByte(byte: number): string {
  return byte.toString(16).toUpperCase().padStart(2, "0");
}

/**
 * Colonne ASCII.
 *
 * Seuls les caractères imprimables de l'ASCII 7 bits sont montrés : afficher
 * l'octet 0x92 comme une apostrophe supposerait un encodage que le fichier n'a
 * pas déclaré, et ferait passer un vidage brut pour du texte décodé.
 */
export function toAscii(bytes: number[]): string {
  return bytes.map((byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".")).join("");
}

/** Découpe une fenêtre d'octets en lignes prêtes à afficher. */
export function toHexLines(bytes: number[], baseOffset = 0): HexLine[] {
  const lines: HexLine[] = [];
  for (let index = 0; index < bytes.length; index += BYTES_PER_LINE) {
    const slice = bytes.slice(index, index + BYTES_PER_LINE);
    lines.push({
      offset: baseOffset + index,
      bytes: slice,
      hex: slice.map(toHexByte),
      ascii: toAscii(slice),
    });
  }
  return lines;
}

/**
 * Analyse une séquence saisie à la main : « DE AD BE EF », « deadbeef »,
 * « de:ad:be:ef » ou « 0xDEADBEEF » donnent tous les mêmes quatre octets.
 *
 * Renvoie `null` si la saisie n'est pas une séquence hexadécimale complète —
 * un nombre impair de chiffres est une erreur, pas un octet à moitié.
 */
export function parseHexBytes(input: string): number[] | null {
  const cleaned = input.replace(/0x/gi, "").replace(/[\s:,\-_]/g, "");
  if (cleaned.length === 0) return null;
  if (cleaned.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) return null;
  const bytes: number[] = [];
  for (let index = 0; index < cleaned.length; index += 2) {
    bytes.push(Number.parseInt(cleaned.slice(index, index + 2), 16));
  }
  return bytes;
}

/** Séquence d'octets correspondant à un texte ASCII saisi tel quel. */
export function asciiToBytes(input: string): number[] {
  return Array.from(new TextEncoder().encode(input));
}

/**
 * Analyse un décalage saisi : décimal (`1024`) ou hexadécimal (`0x400`, `400h`).
 * Renvoie `null` pour une saisie qui n'est ni l'un ni l'autre.
 */
export function parseOffset(input: string): number | null {
  const trimmed = input.trim().replace(/\s/g, "");
  if (!trimmed) return null;
  const hexadecimal = /^0x([0-9a-f]+)$/i.exec(trimmed) ?? /^([0-9a-f]+)h$/i.exec(trimmed);
  if (hexadecimal) {
    const value = Number.parseInt(hexadecimal[1], 16);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Regroupe des octets modifiés isolés en plages contiguës.
 *
 * L'éditeur enregistre une modification par octet touché ; les écrire une par
 * une ferait autant d'écritures que d'octets. Les fusionner produit le moins de
 * plages possible, donc le moins d'écritures.
 */
export function groupPatches(
  edits: Map<number, number>,
): { offset: number; bytes: number[] }[] {
  const offsets = [...edits.keys()].sort((a, b) => a - b);
  const groups: { offset: number; bytes: number[] }[] = [];
  for (const offset of offsets) {
    const last = groups[groups.length - 1];
    if (last && offset === last.offset + last.bytes.length) {
      last.bytes.push(edits.get(offset)!);
    } else {
      groups.push({ offset, bytes: [edits.get(offset)!] });
    }
  }
  return groups;
}
