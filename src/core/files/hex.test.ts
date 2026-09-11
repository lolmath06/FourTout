import { describe, expect, it } from "vitest";
import {
  asciiToBytes,
  formatOffset,
  groupPatches,
  parseHexBytes,
  parseOffset,
  toAscii,
  toHexLines,
} from "./hex";

describe("mise en forme hexadécimale", () => {
  it("aligne les décalages sur huit chiffres", () => {
    expect(formatOffset(0)).toBe("00000000");
    expect(formatOffset(255)).toBe("000000FF");
    expect(formatOffset(1024)).toBe("00000400");
  });

  it("découpe une fenêtre en lignes de seize octets", () => {
    const bytes = Array.from({ length: 20 }, (_, index) => index);
    const lines = toHexLines(bytes, 256);
    expect(lines).toHaveLength(2);
    expect(lines[0].offset).toBe(256);
    expect(lines[0].hex[0]).toBe("00");
    expect(lines[0].hex[15]).toBe("0F");
    expect(lines[1].offset).toBe(272);
    expect(lines[1].bytes).toHaveLength(4);
  });

  it("ne montre en ASCII que l'imprimable", () => {
    expect(toAscii(asciiToBytes("FourTout"))).toBe("FourTout");
    // 0x92 est imprimable en Windows-1252, pas en ASCII : un vidage brut ne
    // doit pas laisser croire qu'il connaît l'encodage du fichier.
    expect(toAscii([0x00, 0x92, 0x41, 0x7f])).toBe("..A.");
  });
});

describe("saisie de séquences", () => {
  it("accepte les écritures usuelles d'une même séquence", () => {
    const expected = [0xde, 0xad, 0xbe, 0xef];
    expect(parseHexBytes("DE AD BE EF")).toEqual(expected);
    expect(parseHexBytes("deadbeef")).toEqual(expected);
    expect(parseHexBytes("de:ad:be:ef")).toEqual(expected);
    expect(parseHexBytes("0xDE 0xAD 0xBE 0xEF")).toEqual(expected);
  });

  it("refuse une séquence incomplète ou invalide", () => {
    expect(parseHexBytes("DEA")).toBeNull();
    expect(parseHexBytes("zz")).toBeNull();
    expect(parseHexBytes("")).toBeNull();
  });

  it("lit un décalage en décimal comme en hexadécimal", () => {
    expect(parseOffset("1024")).toBe(1024);
    expect(parseOffset("0x400")).toBe(1024);
    expect(parseOffset("400h")).toBe(1024);
    expect(parseOffset("-1")).toBeNull();
    // Sans marqueur, « abc » serait ambigu : on refuse plutôt que de deviner.
    expect(parseOffset("abc")).toBeNull();
    expect(parseOffset("zz")).toBeNull();
  });
});

describe("regroupement des modifications", () => {
  it("fusionne les octets contigus en une seule plage", () => {
    const edits = new Map([
      [10, 0xaa],
      [11, 0xbb],
      [12, 0xcc],
      [100, 0xff],
    ]);
    expect(groupPatches(edits)).toEqual([
      { offset: 10, bytes: [0xaa, 0xbb, 0xcc] },
      { offset: 100, bytes: [0xff] },
    ]);
  });

  it("trie les modifications saisies dans le désordre", () => {
    const edits = new Map([
      [5, 0x02],
      [4, 0x01],
    ]);
    expect(groupPatches(edits)).toEqual([{ offset: 4, bytes: [0x01, 0x02] }]);
  });

  it("ne produit rien quand rien n'a été modifié", () => {
    expect(groupPatches(new Map())).toEqual([]);
  });
});
