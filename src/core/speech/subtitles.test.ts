import { describe, expect, it } from "vitest";
import {
  exportableSegments,
  formatSrtTime,
  formatVttTime,
  toPlainText,
  toSrt,
  toVtt,
  type TranscriptSegment,
} from "./subtitles";

/**
 * Un fichier de sous-titres mal formé est refusé en bloc par les lecteurs :
 * indices, séparateur décimal et durées positives ne souffrent aucune
 * approximation.
 */

const SEGMENTS: TranscriptSegment[] = [
  { start: 0, end: 2350, text: "Bonjour, ceci est un test." },
  { start: 2350, end: 5280, text: "Le numéro est 2026." },
];

describe("horodatages", () => {
  it("formate le SRT avec une virgule décimale", () => {
    expect(formatSrtTime(0)).toBe("00:00:00,000");
    expect(formatSrtTime(2350)).toBe("00:00:02,350");
    expect(formatSrtTime(3_723_004)).toBe("01:02:03,004");
  });

  it("formate le VTT avec un point décimal", () => {
    expect(formatVttTime(2350)).toBe("00:00:02.350");
  });

  it("ramène un temps négatif ou invalide à zéro", () => {
    expect(formatSrtTime(-10)).toBe("00:00:00,000");
    expect(formatSrtTime(Number.NaN)).toBe("00:00:00,000");
  });
});

describe("préparation des passages", () => {
  it("écarte les passages vides", () => {
    const segments = exportableSegments([...SEGMENTS, { start: 6000, end: 7000, text: "   " }]);
    expect(segments).toHaveLength(2);
  });

  it("ne produit jamais de durée nulle ou négative", () => {
    const segments = exportableSegments([{ start: 5000, end: 1000, text: "Inversé" }]);
    expect(segments[0].end).toBeGreaterThan(segments[0].start);
  });

  it("conserve l'ordre d'origine", () => {
    expect(exportableSegments(SEGMENTS).map((s) => s.text)).toEqual([
      "Bonjour, ceci est un test.",
      "Le numéro est 2026.",
    ]);
  });
});

describe("génération SRT", () => {
  const srt = toSrt(SEGMENTS);

  it("respecte le format attendu par les lecteurs", () => {
    expect(srt).toBe(
      [
        "1",
        "00:00:00,000 --> 00:00:02,350",
        "Bonjour, ceci est un test.",
        "",
        "2",
        "00:00:02,350 --> 00:00:05,280",
        "Le numéro est 2026.",
        "",
      ].join("\n"),
    );
  });

  it("numérote à partir de 1, sans trou après filtrage", () => {
    const withHole = toSrt([SEGMENTS[0], { start: 3000, end: 4000, text: "" }, SEGMENTS[1]]);
    expect(withHole.split("\n").filter((line) => line === "2")).toHaveLength(1);
    expect(withHole).not.toContain("3\n");
  });

  it("conserve les accents tels quels (UTF-8)", () => {
    const accented = toSrt([{ start: 0, end: 1000, text: "Élève à Nîmes, ça coûte 5 €." }]);
    expect(accented).toContain("Élève à Nîmes, ça coûte 5 €.");
    expect(new TextEncoder().encode(accented).length).toBeGreaterThan(accented.length);
  });

  it("exporte le texte corrigé par l'utilisateur, aux temps d'origine", () => {
    // L'utilisateur remplace « four-tout » par le vrai nom.
    const edited = SEGMENTS.map((segment, index) =>
      index === 0 ? { ...segment, text: "Bonjour, ceci est un test de FourTout." } : segment,
    );
    const output = toSrt(edited);
    expect(output).toContain("Bonjour, ceci est un test de FourTout.");
    expect(output).toContain("00:00:00,000 --> 00:00:02,350");
  });
});

describe("génération VTT", () => {
  it("commence par l'en-tête WEBVTT", () => {
    const vtt = toVtt(SEGMENTS);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:00:02.350 --> 00:00:05.280");
    // Le VTT n'est pas numéroté.
    expect(vtt.split("\n").some((line) => line === "1")).toBe(false);
  });
});

describe("texte brut", () => {
  it("aligne un passage par ligne", () => {
    expect(toPlainText(SEGMENTS)).toBe("Bonjour, ceci est un test.\nLe numéro est 2026.");
  });
});
