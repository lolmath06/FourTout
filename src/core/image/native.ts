import { isTauri } from "@/core/platform";
import { decodeNativeImage } from "@/core/internet/native";

/**
 * Formats d'image que la WebView ne décode pas toujours, et animations qu'un
 * canvas aplatirait en silence.
 *
 * Ces tests ne regardent que les premiers octets (jamais l'extension), comme la
 * table de signatures native dont ils sont le reflet minimal.
 */

export type NativeImageKind = "heic" | "avif";

/** HEIC/HEIF ou AVIF d'après la boîte `ftyp`. */
export function sniffNativeImage(bytes: Uint8Array): NativeImageKind | null {
  if (bytes.length < 16) return null;
  const tag = (offset: number) => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  if (tag(4) !== "ftyp") return null;
  const size = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  const end = Math.min(bytes.length, Math.max(16, Math.min(size, 256)));
  const brands = [tag(8)];
  for (let offset = 16; offset + 4 <= end; offset += 4) brands.push(tag(offset));
  if (brands.some((b) => b === "avif" || b === "avis")) return "avif";
  if (brands.some((b) => ["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"].includes(b))) return "heic";
  return null;
}

export type AnimatedKind = "webp" | "apng";

/** Image animée (WebP ou PNG animé) ? Un canvas n'en garderait que la première image. */
export function detectAnimation(bytes: Uint8Array): AnimatedKind | null {
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (bytes.length >= 21 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
    return text(12, 4) === "VP8X" && (bytes[20] & 0x02) !== 0 ? "webp" : null;
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 16 && png.every((b, i) => bytes[i] === b)) {
    let offset = 8;
    while (offset + 8 <= bytes.length) {
      const length = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
      const type = text(offset + 4, 4);
      if (type === "acTL") return "apng";
      if (type === "IDAT" || type === "IEND") return null;
      offset += 12 + length;
    }
  }
  return null;
}

/** PNG produit par le décodeur natif pour un HEIC/HEIF, ou `null` si ce n'en est pas un. */
export async function decodeNativeIfNeeded(bytes: Uint8Array, kind: NativeImageKind | null): Promise<Uint8Array | null> {
  if (!kind || !isTauri()) return null;
  return decodeNativeImage(bytes);
}
