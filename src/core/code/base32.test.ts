import { describe, expect, it } from "vitest";
import {
  Base32Error,
  decodeBase32,
  decodeBase32Text,
  encodeBase32,
  encodeBase32Text,
  wrapBase32,
} from "./base32";

/** Vecteurs de la RFC 4648, section 10. Ils ne se discutent pas. */
const RFC_4648_VECTORS: [string, string][] = [
  ["", ""],
  ["f", "MY======"],
  ["fo", "MZXQ===="],
  ["foo", "MZXW6==="],
  ["foob", "MZXW6YQ="],
  ["fooba", "MZXW6YTB"],
  ["foobar", "MZXW6YTBOI======"],
];

describe("Base32 — alphabet standard", () => {
  it("reproduit les vecteurs de la RFC 4648", () => {
    for (const [plain, encoded] of RFC_4648_VECTORS) {
      expect(encodeBase32Text(plain), `encodage de « ${plain} »`).toBe(encoded);
    }
  });

  it("décode les vecteurs de la RFC 4648", () => {
    for (const [plain, encoded] of RFC_4648_VECTORS) {
      expect(decodeBase32Text(encoded), `décodage de « ${encoded} »`).toBe(plain);
    }
  });

  it("sait se passer de padding quand on le demande", () => {
    expect(encodeBase32Text("f", { padding: false })).toBe("MY");
    expect(encodeBase32Text("foobar", { padding: false })).toBe("MZXW6YTBOI");
    // Et relit ce qu'il a écrit.
    expect(decodeBase32Text("MZXW6YTBOI")).toBe("foobar");
  });

  it("ignore les blancs au décodage", () => {
    expect(decodeBase32Text("MZXW6YTB OI======")).toBe("foobar");
    expect(decodeBase32Text("MZXW6YTB\nOI======\n")).toBe("foobar");
  });

  it("accepte les minuscules", () => {
    expect(decodeBase32Text("mzxw6ytboi======")).toBe("foobar");
  });
});

describe("Base32 — alphabet hexadécimal étendu", () => {
  it("encode et décode avec l'alphabet 0–V", () => {
    const options = { alphabet: "rfc4648-hex" as const };
    expect(encodeBase32Text("foobar", options)).toBe("CPNMUOJ1E8======");
    expect(decodeBase32Text("CPNMUOJ1E8======", options)).toBe("foobar");
  });

  it("refuse un caractère qui n'appartient pas à l'alphabet choisi", () => {
    // « W » existe en standard, pas en hexadécimal étendu (qui s'arrête à V).
    expect(() => decodeBase32("MZXW6===", { alphabet: "rfc4648-hex" })).toThrow(Base32Error);
  });
});

describe("Base32 — aller-retour et erreurs", () => {
  it("retrouve exactement les octets d'un texte accentué", () => {
    const original = "FourTout — été";
    const bytes = new TextEncoder().encode(original);
    const encoded = encodeBase32(bytes);
    const decoded = decodeBase32(encoded);
    expect([...decoded]).toEqual([...bytes]);
    expect(new TextDecoder().decode(decoded)).toBe(original);
  });

  it("retrouve exactement des octets qui ne sont pas du texte", () => {
    const bytes = Uint8Array.from([0x00, 0xff, 0x10, 0x80, 0x7f, 0x01]);
    expect([...decodeBase32(encodeBase32(bytes))]).toEqual([...bytes]);
  });

  it("refuse une longueur qu'aucun encodeur ne peut produire", () => {
    // 1, 3 et 6 caractères utiles ne correspondent à aucun nombre entier d'octets.
    expect(() => decodeBase32("M")).toThrow(/Longueur impossible/);
    expect(() => decodeBase32("MZX")).toThrow(/Longueur impossible/);
    expect(() => decodeBase32("MZXW6Y")).toThrow(/Longueur impossible/);
  });

  it("refuse un caractère étranger à l'alphabet", () => {
    expect(() => decodeBase32("MZXW6YT1")).toThrow(/alphabet/);
    expect(() => decodeBase32("MZXW6YT!")).toThrow(/alphabet/);
  });

  it("refuse un padding placé au milieu", () => {
    expect(() => decodeBase32("MY==MZXQ")).toThrow(/à la fin/);
  });

  it("refuse des bits de remplissage non nuls", () => {
    // « MZ » décoderait « f » mais porte des bits parasites : un encodeur
    // conforme n'écrit jamais cela.
    expect(() => decodeBase32("MZ======")).toThrow(/n'a pas été produite/);
  });

  it("rend une chaîne vide pour une entrée vide", () => {
    expect(encodeBase32(new Uint8Array(0))).toBe("");
    expect(decodeBase32("").length).toBe(0);
    expect(decodeBase32("========").length).toBe(0);
  });

  it("coupe les sorties longues en lignes", () => {
    const long = encodeBase32Text("a".repeat(100));
    const wrapped = wrapBase32(long, 16);
    expect(wrapped.split("\n").every((line) => line.length <= 16)).toBe(true);
    expect(wrapped.replace(/\n/g, "")).toBe(long);
  });

  it("dit clairement quand les octets décodés ne sont pas du texte", () => {
    const encoded = encodeBase32(Uint8Array.from([0xff, 0xfe, 0xfd]));
    expect(() => decodeBase32Text(encoded)).toThrow(/binaires/);
  });
});
