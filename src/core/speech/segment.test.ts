import { describe, expect, it } from "vitest";
import { countText, normalizeForSpeech, previewText, segmentText, splitSentences } from "./segment";

/**
 * La segmentation conditionne toute la synthèse : elle décide de la
 * progression, du grain de l'annulation et surtout du naturel de la lecture.
 * Couper au milieu d'un mot ou après « M. » s'entend immédiatement.
 */

describe("découpage en phrases", () => {
  it("sépare sur les ponctuations fortes", () => {
    expect(splitSentences("Bonjour. Ça va ? Très bien !")).toEqual([
      "Bonjour.",
      "Ça va ?",
      "Très bien !",
    ]);
  });

  it("ne coupe pas après une abréviation courante", () => {
    expect(splitSentences("M. Dupont est arrivé.")).toEqual(["M. Dupont est arrivé."]);
    expect(splitSentences("Voir p. 12 pour le détail.")).toEqual([
      "Voir p. 12 pour le détail.",
    ]);
    expect(splitSentences("Mr. Smith arrived late.")).toEqual(["Mr. Smith arrived late."]);
  });

  it("ne coupe pas un nombre décimal", () => {
    expect(splitSentences("La valeur de pi vaut 3.14 environ.")).toEqual([
      "La valeur de pi vaut 3.14 environ.",
    ]);
  });

  it("traite les points de suspension comme une seule fin", () => {
    expect(splitSentences("Attendez... J'arrive.")).toEqual(["Attendez...", "J'arrive."]);
  });

  it("ferme la dernière phrase même sans ponctuation", () => {
    expect(splitSentences("Une phrase sans point")).toEqual(["Une phrase sans point"]);
  });

  it("coupe aussi sur le point-virgule", () => {
    expect(splitSentences("D'abord ceci ; ensuite cela.")).toEqual([
      "D'abord ceci ;",
      "ensuite cela.",
    ]);
  });
});

describe("normalisation avant lecture", () => {
  it("recolle un mot coupé en fin de ligne", () => {
    expect(normalizeForSpeech("un exem-\nple clair")).toBe("un exemple clair");
  });

  it("réduit les blancs sans écraser les paragraphes", () => {
    expect(normalizeForSpeech("Un   texte\n\n\n\nDeuxième")).toBe("Un texte\n\nDeuxième");
  });
});

describe("segmentation d'un texte complet", () => {
  it("renvoie une liste vide pour un texte vide", () => {
    expect(segmentText("   \n  ")).toEqual([]);
  });

  it("garde un paragraphe court en un seul segment", () => {
    expect(segmentText("Bonjour, ceci est un test de FourTout. Le numéro est 2026.")).toEqual([
      "Bonjour, ceci est un test de FourTout. Le numéro est 2026.",
    ]);
  });

  it("ne mélange jamais deux paragraphes dans un segment", () => {
    const segments = segmentText("Premier paragraphe.\n\nSecond paragraphe.");
    expect(segments).toEqual(["Premier paragraphe.", "Second paragraphe."]);
  });

  it("regroupe les phrases jusqu'à la taille visée", () => {
    const text = "Une. Deux. Trois. Quatre.";
    expect(segmentText(text, { maxChars: 20 })).toEqual(["Une. Deux. Trois.", "Quatre."]);
  });

  it("découpe une phrase trop longue sans jamais couper un mot", () => {
    const sentence = `${"mot ".repeat(120).trim()}.`;
    const segments = segmentText(sentence, { maxChars: 100 });
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      expect(segment.length).toBeLessThanOrEqual(100);
      // Aucun segment ne commence ni ne finit au milieu de « mot ».
      expect(segment).toMatch(/^mot/);
      expect(segment).toMatch(/(mot|mot\.)$/);
    }
    expect(segments.join(" ").replace(/\s+/g, " ")).toBe(sentence);
  });

  it("préfère couper sur une virgule quand c'est possible", () => {
    const text = `${"a".repeat(60)}, ${"b".repeat(60)}.`;
    const segments = segmentText(text, { maxChars: 90 });
    expect(segments[0]).toBe(`${"a".repeat(60)},`);
  });

  it("découpe un texte long en plusieurs segments exploitables", () => {
    const paragraph = "Ceci est une phrase de test suffisamment longue pour compter. ";
    const segments = segmentText(paragraph.repeat(30));
    expect(segments.length).toBeGreaterThan(3);
    expect(segments.every((segment) => segment.length <= 480)).toBe(true);
  });
});

describe("aperçu et compteurs", () => {
  it("n'aperçoit que la première phrase", () => {
    expect(previewText("Première phrase. Deuxième phrase. Troisième.")).toBe("Première phrase.");
  });

  it("borne l'aperçu d'un texte sans ponctuation", () => {
    expect(previewText("mot ".repeat(200), 200).length).toBeLessThanOrEqual(200);
  });

  it("compte caractères et mots", () => {
    expect(countText("Bonjour le monde")).toEqual({ characters: 16, words: 3 });
    expect(countText("   ")).toEqual({ characters: 3, words: 0 });
  });
});
