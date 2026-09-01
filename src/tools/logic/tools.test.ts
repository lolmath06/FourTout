import { describe, expect, it } from "vitest";
import { computeTextStatistics } from "./textStatistics";
import { CASE_TRANSFORMS } from "./textCase";
import { decodeBase64, encodeBase64 } from "./base64";

describe("statistiques de texte", () => {
  it("compte mots, phrases et paragraphes", () => {
    const stats = computeTextStatistics("Bonjour le monde. Ça va ?\n\nDeuxième paragraphe.");
    expect(stats.words).toBe(8);
    expect(stats.sentences).toBe(3);
    expect(stats.paragraphs).toBe(2);
  });

  it("gère un texte vide", () => {
    const stats = computeTextStatistics("");
    expect(stats).toMatchObject({ words: 0, characters: 0, sentences: 0, readingTime: "—" });
  });

  it("estime un temps de lecture", () => {
    const stats = computeTextStatistics("mot ".repeat(400));
    expect(stats.readingTime).toBe("2 min");
  });
});

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
