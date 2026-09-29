// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { HEAVY_TIMEOUT } from "@/test/timeouts";
import { TextError } from "./errors";
import {
  convertEncoding,
  decodeText,
  detectBom,
  detectEncoding,
  encodeText,
  inspectUtf8,
  type TextEncodingId,
} from "./encoding";

const DIR = join(process.cwd(), "test-assets", "generated");
const read = (name: string) => new Uint8Array(readFileSync(join(DIR, name)));

/** Texte exact des fixtures (voir `scripts/generate-document-assets.mjs`). */
const SAMPLE = "Été à Genève : coût 12,50 €.\nL'accent aigu, le tréma ë et le ç.\nFin du fichier.\n";
const SAMPLE_LATIN1 = SAMPLE.replace(" €", " euros");

beforeAll(() => {
  execFileSync(process.execPath, [join(process.cwd(), "scripts/generate-document-assets.mjs")], {
    stdio: "ignore",
  });
}, HEAVY_TIMEOUT);

/* ================================================================ BOM */

describe("marque d'ordre des octets", () => {
  it("reconnaît les trois BOM", () => {
    expect(detectBom(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe("utf-8");
    expect(detectBom(new Uint8Array([0xff, 0xfe, 0x41, 0x00]))).toBe("utf-16le");
    expect(detectBom(new Uint8Array([0xfe, 0xff, 0x00, 0x41]))).toBe("utf-16be");
    expect(detectBom(new Uint8Array([0x41, 0x42]))).toBe("none");
  });

  it("n'invente pas de BOM sur un fichier trop court", () => {
    expect(detectBom(new Uint8Array([0xef]))).toBe("none");
    expect(detectBom(new Uint8Array())).toBe("none");
  });
});

/* ========================================================= validité UTF-8 */

describe("validation UTF-8", () => {
  it("accepte l'ASCII, sans y voir une preuve", () => {
    expect(inspectUtf8(new TextEncoder().encode("Hello"))).toEqual({ valid: true, multiByte: 0 });
  });

  it("compte les séquences multi-octets", () => {
    expect(inspectUtf8(new TextEncoder().encode("Été"))).toEqual({ valid: true, multiByte: 2 });
  });

  it("refuse une continuation isolée", () => {
    expect(inspectUtf8(new Uint8Array([0x41, 0x80, 0x42])).valid).toBe(false);
  });

  it("refuse une séquence tronquée", () => {
    expect(inspectUtf8(new Uint8Array([0xc3])).valid).toBe(false);
  });

  it("refuse une surlongueur et un substitut", () => {
    // C0 80 : « nul » codé sur deux octets.
    expect(inspectUtf8(new Uint8Array([0xc0, 0x80])).valid).toBe(false);
    // ED A0 80 : point de code substitut, interdit en UTF-8.
    expect(inspectUtf8(new Uint8Array([0xed, 0xa0, 0x80])).valid).toBe(false);
  });
});

/* ============================================================= détection */

describe("détection sur les fixtures", () => {
  const cases: [string, TextEncodingId, boolean][] = [
    ["encoding-utf8.txt", "utf-8", false],
    ["encoding-utf8-bom.txt", "utf-8-bom", true],
    ["encoding-utf16le.txt", "utf-16le", true],
    ["encoding-utf16be.txt", "utf-16be", true],
    ["encoding-win1252.txt", "windows-1252", false],
  ];

  for (const [name, expected, certain] of cases) {
    it(`reconnaît ${name} comme ${expected}`, () => {
      const detection = detectEncoding(read(name));
      expect(detection.encoding).toBe(expected);
      expect(detection.certain).toBe(certain);
      expect(detection.confidence).toBeGreaterThan(0.5);
      expect(detection.binary).toBe(false);
      expect(detection.reason.length).toBeGreaterThan(10);
    });
  }

  it("redonne le texte d'origine, quel que soit l'encodage du fichier", () => {
    for (const [name] of cases) {
      expect(detectEncoding(read(name)).text, name).toBe(SAMPLE);
    }
  });

  it("lit le Latin-1 et le dit honnêtement indiscernable du Windows-1252", () => {
    const detection = detectEncoding(read("encoding-latin1.txt"));
    // Sans octet dans la plage 0x80–0x9F, les deux encodages donnent le même
    // texte : l'outil retient Windows-1252 mais ne prétend pas trancher.
    expect(detection.text).toBe(SAMPLE_LATIN1);
    expect(detection.certain).toBe(false);
    expect(detection.alternatives.map((item) => item.encoding)).toContain("iso-8859-1");
    expect(detection.reason).toMatch(/même texte/);
  });

  it("distingue Windows-1252 de Latin-1 quand le fichier tranche", () => {
    // Le signe € (0x80) n'existe pas en Latin-1.
    const detection = detectEncoding(read("encoding-win1252.txt"));
    expect(detection.encoding).toBe("windows-1252");
    expect(detection.reason).toMatch(/0x80/);
  });

  it("repère les fins de ligne", () => {
    expect(detectEncoding(read("encoding-utf8.txt")).newline.dominant).toBe("lf");
    const crlf = detectEncoding(read("encoding-win1252-crlf.txt"));
    expect(crlf.newline.dominant).toBe("crlf");
    expect(crlf.newline.mixed).toBe(false);
    expect(crlf.text).toBe(SAMPLE.replace(/\n/g, "\r\n"));
  });

  it("signale un fichier binaire donné par erreur", () => {
    const detection = detectEncoding(read("sample.png"));
    expect(detection.binary).toBe(true);
    expect(detection.confidence).toBeLessThan(0.5);
  });

  it("ne bute pas sur un fichier vide", () => {
    const detection = detectEncoding(new Uint8Array());
    expect(detection.encoding).toBe("utf-8");
    expect(detection.text).toBe("");
    expect(detection.binary).toBe(false);
  });

  it("reconnaît l'UTF-16 sans BOM par son motif d'octets nuls", () => {
    const withBom = read("encoding-utf16le.txt");
    const detection = detectEncoding(withBom.subarray(2));
    expect(detection.encoding).toBe("utf-16le");
    expect(detection.certain).toBe(false);
    expect(detection.text).toBe(SAMPLE);
  });

  it("dit son incertitude sur un fichier purement ASCII", () => {
    const detection = detectEncoding(new TextEncoder().encode("Hello, world.\n"));
    expect(detection.encoding).toBe("utf-8");
    expect(detection.certain).toBe(false);
    expect(detection.alternatives).toHaveLength(2);
    expect(detection.reason).toMatch(/ASCII/);
  });
});

/* ============================================================== encodage */

describe("écriture", () => {
  it("fait l'aller-retour dans tous les encodages", () => {
    const encodings: TextEncodingId[] = ["utf-8", "utf-8-bom", "utf-16le", "utf-16be", "windows-1252"];
    for (const encoding of encodings) {
      const { bytes, unrepresentable } = encodeText(SAMPLE, encoding);
      expect(unrepresentable, encoding).toEqual([]);
      expect(decodeText(bytes, encoding), encoding).toBe(SAMPLE);
    }
    const latin1 = encodeText(SAMPLE_LATIN1, "iso-8859-1");
    expect(latin1.unrepresentable).toEqual([]);
    expect(decodeText(latin1.bytes, "iso-8859-1")).toBe(SAMPLE_LATIN1);
  });

  it("pose bien le BOM demandé", () => {
    expect([...encodeText("A", "utf-8-bom").bytes]).toEqual([0xef, 0xbb, 0xbf, 0x41]);
    expect([...encodeText("A", "utf-8").bytes]).toEqual([0x41]);
    expect([...encodeText("A", "utf-16le").bytes]).toEqual([0xff, 0xfe, 0x41, 0x00]);
    expect([...encodeText("A", "utf-16be").bytes]).toEqual([0xfe, 0xff, 0x00, 0x41]);
  });

  it("liste les caractères que la destination ne sait pas écrire", () => {
    const result = encodeText("Flèche → ok\n中 aussi", "windows-1252");
    expect(result.unrepresentable.map((item) => item.character)).toEqual(["→", "中"]);
    expect(result.unrepresentable[0].codePoint).toBe(0x2192);
    expect(result.unrepresentable[0].line).toBe(1);
    expect(result.unrepresentable[1].line).toBe(2);
  });

  it("regroupe les occurrences d'un même caractère", () => {
    const result = encodeText("→→→", "iso-8859-1");
    expect(result.unrepresentable).toHaveLength(1);
    expect(result.unrepresentable[0].count).toBe(3);
  });

  it("ne remplace que si on le lui demande", () => {
    expect([...encodeText("a→b", "windows-1252").bytes]).toEqual([0x61, 0x62]);
    expect([...encodeText("a→b", "windows-1252", { replacement: "?" }).bytes]).toEqual([
      0x61, 0x3f, 0x62,
    ]);
  });

  it("place le signe euro là où chaque encodage l'attend", () => {
    // 0x80 en Windows-1252, absent du Latin-1.
    expect([...encodeText("€", "windows-1252").bytes]).toEqual([0x80]);
    expect(encodeText("€", "iso-8859-1").unrepresentable).toHaveLength(1);
  });
});

/* ============================================================ conversion */

describe("conversion", () => {
  it("convertit chaque fixture vers UTF-8 sans perte", () => {
    for (const name of [
      "encoding-utf8-bom.txt",
      "encoding-utf16le.txt",
      "encoding-utf16be.txt",
      "encoding-win1252.txt",
    ]) {
      const result = convertEncoding(read(name), { from: "auto", to: "utf-8" });
      expect(new TextDecoder().decode(result.bytes), name).toBe(SAMPLE);
      expect(result.replaced, name).toEqual([]);
    }
    const latin1 = convertEncoding(read("encoding-latin1.txt"), { from: "auto", to: "utf-8" });
    expect(new TextDecoder().decode(latin1.bytes)).toBe(SAMPLE_LATIN1);
  });

  it("respecte un encodage source imposé", () => {
    // Lire volontairement de l'UTF-8 comme du Latin-1 doit produire le fameux
    // « Ã© » — la preuve que le choix de l'utilisateur est bien appliqué.
    const result = convertEncoding(read("encoding-utf8.txt"), {
      from: "iso-8859-1",
      to: "utf-8",
    });
    expect(new TextDecoder().decode(result.bytes)).toContain("Ã");
    expect(result.from).toBe("iso-8859-1");
  });

  it("refuse par défaut de perdre un caractère", () => {
    expect(() =>
      convertEncoding(read("encoding-unrepresentable.txt"), {
        from: "auto",
        to: "windows-1252",
      }),
    ).toThrowError(TextError);

    try {
      convertEncoding(read("encoding-unrepresentable.txt"), { from: "auto", to: "iso-8859-1" });
      expect.unreachable("la conversion aurait dû être refusée");
    } catch (error) {
      expect(error).toBeInstanceOf(TextError);
      expect((error as TextError).code).toBe("encoding-unrepresentable");
      // Le message nomme précisément ce qui bloque.
      expect((error as TextError).message).toContain("U+2192");
    }
  });

  it("remplace uniquement sur demande explicite", () => {
    const result = convertEncoding(read("encoding-unrepresentable.txt"), {
      from: "auto",
      to: "windows-1252",
      replaceUnrepresentable: true,
      replacement: "?",
    });
    const text = decodeText(result.bytes, "windows-1252");
    expect(text).toContain("Flèche ? et");
    expect(result.replaced.map((item) => item.character)).toContain("→");
  });

  it("réécrit les fins de ligne avec le moteur existant", () => {
    const toCrlf = convertEncoding(read("encoding-utf8.txt"), {
      from: "auto",
      to: "utf-8",
      newline: "crlf",
    });
    expect(new TextDecoder().decode(toCrlf.bytes)).toBe(SAMPLE.replace(/\n/g, "\r\n"));

    const toLf = convertEncoding(read("encoding-win1252-crlf.txt"), {
      from: "auto",
      to: "utf-8",
      newline: "lf",
    });
    expect(new TextDecoder().decode(toLf.bytes)).toBe(SAMPLE);
  });

  it("conserve les fins de ligne par défaut", () => {
    const result = convertEncoding(read("encoding-win1252-crlf.txt"), {
      from: "auto",
      to: "utf-8",
    });
    expect(new TextDecoder().decode(result.bytes)).toContain("\r\n");
  });

  it("refuse un fichier binaire donné par erreur", () => {
    try {
      convertEncoding(read("sample.png"), { from: "auto", to: "utf-8" });
      expect.unreachable("un PNG n'est pas un fichier texte");
    } catch (error) {
      expect((error as TextError).code).toBe("encoding-unreadable");
    }
  });

  it("compte les caractères convertis", () => {
    const result = convertEncoding(read("encoding-utf8.txt"), { from: "auto", to: "utf-16le" });
    expect(result.characters).toBe([...SAMPLE].length);
    expect(result.to).toBe("utf-16le");
    expect(result.detection.encoding).toBe("utf-8");
  });
});
