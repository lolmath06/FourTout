import { describe, expect, it } from "vitest";
import { CASE_TRANSFORMS } from "./textCase";
import {
  base64ToBytes,
  bytesToBase64,
  decodeBase64,
  encodeBase64,
  fromDataUri,
  toDataUri,
} from "./base64";

describe("changement de casse", () => {
  it("applique chaque transformation", () => {
    expect(CASE_TRANSFORMS.upper.apply("été chaud")).toBe("ÉTÉ CHAUD");
    expect(CASE_TRANSFORMS.lower.apply("ÉTÉ Chaud")).toBe("été chaud");
    expect(CASE_TRANSFORMS.title.apply("bonjour le monde")).toBe("Bonjour Le Monde");
    expect(CASE_TRANSFORMS.sentence.apply("bonjour. ça va ?")).toBe("Bonjour. Ça va ?");
    expect(CASE_TRANSFORMS.camel.apply("mon super titre")).toBe("monSuperTitre");
    expect(CASE_TRANSFORMS.snake.apply("Mon Super Titre")).toBe("mon_super_titre");
    expect(CASE_TRANSFORMS.kebab.apply("MonSuperTitre")).toBe("mon-super-titre");
  });
});

describe("base64", () => {
  it("fait l'aller-retour, accents compris", () => {
    const source = "Où est le café ? — 100 % local";
    expect(decodeBase64(encodeBase64(source))).toBe(source);
  });

  it("produit une variante compatible URL", () => {
    const encoded = encodeBase64("??>>??>>", true);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(decodeBase64(encoded)).toBe("??>>??>>");
  });

  it("rejette une entrée invalide", () => {
    expect(() => decodeBase64("ceci n'est pas du base64 !!")).toThrow();
  });
});

describe("base64 de fichiers", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 255, 137, 80, 78, 71]);

  it("fait l'aller-retour sur des octets quelconques", () => {
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });

  it("produit et relit un data URI", () => {
    const uri = toDataUri(bytes, "image/png");
    expect(uri.startsWith("data:image/png;base64,")).toBe(true);
    const parsed = fromDataUri(uri);
    expect(parsed?.mimeType).toBe("image/png");
    expect([...(parsed?.bytes ?? [])]).toEqual([...bytes]);
  });

  it("ignore les retours à la ligne d'un Base64 collé", () => {
    const wrapped = bytesToBase64(bytes).replace(/(.{4})/g, "$1\n");
    expect([...base64ToBytes(wrapped)]).toEqual([...bytes]);
  });

  it("refuse une entrée qui n'est pas du Base64", () => {
    expect(() => base64ToBytes("ceci n'est pas du base64 !")).toThrow(/invalide/i);
  });

  it("ne prend pas un texte ordinaire pour un data URI", () => {
    expect(fromDataUri("juste du texte")).toBeNull();
  });
});
