import { describe, expect, it } from "vitest";
import { detectAnimation, sniffNativeImage } from "./native";

function ftyp(major: string, compatible: string[] = []): Uint8Array {
  const size = 16 + compatible.length * 4;
  const bytes = new Uint8Array(size + 16);
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(new TextEncoder().encode("ftyp"), 4);
  bytes.set(new TextEncoder().encode(major), 8);
  compatible.forEach((brand, i) => bytes.set(new TextEncoder().encode(brand), 16 + i * 4));
  return bytes;
}

function png(chunks: [string, number][]): Uint8Array {
  const parts: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const [type, length] of chunks) {
    parts.push((length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255);
    parts.push(...new TextEncoder().encode(type), ...new Array(length + 4).fill(0));
  }
  return new Uint8Array(parts);
}

function webp(chunk: string, flags: number): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  bytes.set(new TextEncoder().encode(chunk), 12);
  bytes[20] = flags;
  return bytes;
}

describe("formats à décoder nativement", () => {
  it("lit les marques ISO-BMFF, pas l'extension", () => {
    expect(sniffNativeImage(ftyp("heic", ["mif1"]))).toBe("heic");
    expect(sniffNativeImage(ftyp("mif1", ["heic"]))).toBe("heic");
    expect(sniffNativeImage(ftyp("avif", ["mif1", "miaf"]))).toBe("avif");
    expect(sniffNativeImage(ftyp("mif1", ["avif"]))).toBe("avif");
    expect(sniffNativeImage(ftyp("isom", ["mp42"]))).toBeNull();
    expect(sniffNativeImage(new Uint8Array(4))).toBeNull();
    expect(sniffNativeImage(new TextEncoder().encode("pas une image du tout, juste du texte"))).toBeNull();
  });
});

describe("animations", () => {
  it("distingue le WebP animé du WebP fixe", () => {
    expect(detectAnimation(webp("VP8X", 0x12))).toBe("webp");
    expect(detectAnimation(webp("VP8X", 0x10))).toBeNull();
    expect(detectAnimation(webp("VP8 ", 0x00))).toBeNull();
  });

  it("distingue l'APNG du PNG par le bloc acTL placé avant les données", () => {
    expect(detectAnimation(png([["IHDR", 13], ["acTL", 8], ["IDAT", 4]]))).toBe("apng");
    expect(detectAnimation(png([["IHDR", 13], ["iCCP", 3000], ["acTL", 8], ["IDAT", 4]]))).toBe("apng");
    expect(detectAnimation(png([["IHDR", 13], ["IDAT", 4], ["acTL", 8]]))).toBeNull();
    expect(detectAnimation(png([["IHDR", 13], ["IDAT", 4], ["IEND", 0]]))).toBeNull();
    expect(detectAnimation(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
