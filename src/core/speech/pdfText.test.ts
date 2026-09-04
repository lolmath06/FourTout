import { describe, expect, it } from "vitest";
import { cleanPdfText } from "./pdfText";

/**
 * Un PDF lu tel quel fait prononcer les numéros de page et l'en-tête répété.
 * Le nettoyage doit les écarter — mais jamais du vrai contenu : c'est le
 * risque réel de ce genre d'heuristique.
 */

const page = (page: number, text: string) => ({ page, text });

describe("nettoyage du texte d'un PDF", () => {
  it("écarte les numéros de page isolés", () => {
    const result = cleanPdfText([
      page(1, "Bienvenue dans FourTout.\nUn paragraphe utile.\n1"),
      page(2, "Suite du document.\n- 2 -"),
    ]);
    expect(result.text).not.toMatch(/^\s*1\s*$/m);
    expect(result.text).toContain("Bienvenue dans FourTout.");
    expect(result.removedLines).toBe(2);
  });

  it("écarte un en-tête répété sur la majorité des pages", () => {
    const pages = [1, 2, 3, 4].map((n) =>
      page(n, `FourTout - document de test\nContenu propre à la page ${n}.\n${n}`),
    );
    const result = cleanPdfText(pages);
    expect(result.text).not.toContain("FourTout - document de test");
    expect(result.text).toContain("Contenu propre à la page 3.");
  });

  it("ne supprime rien quand il y a trop peu de pages pour conclure", () => {
    const result = cleanPdfText([
      page(1, "En-tête ambigu\nContenu."),
      page(2, "En-tête ambigu\nAutre contenu."),
    ]);
    expect(result.text).toContain("En-tête ambigu");
  });

  it("ne supprime jamais une ligne longue, même répétée", () => {
    const long =
      "Cette phrase est un véritable contenu répété volontairement dans le document et dépasse largement la limite des ornements.";
    const pages = [1, 2, 3, 4].map((n) => page(n, `${long}\nContenu ${n}.`));
    const result = cleanPdfText(pages);
    expect(result.text).toContain(long);
  });

  it("ne touche pas à une ligne de contenu qui ressemble à un numéro mais est au milieu", () => {
    const result = cleanPdfText([
      page(1, "Introduction.\n2026\nConclusion.\n1"),
    ]);
    // Le « 2026 » du corps est conservé ; seul le pied de page part.
    expect(result.text).toContain("2026");
  });

  it("signale un document sans texte extractible", () => {
    const result = cleanPdfText([page(1, "   "), page(2, "")]);
    expect(result.text).toBe("");
  });

  it("sépare les pages par un saut de paragraphe", () => {
    const result = cleanPdfText([page(1, "Page une."), page(2, "Page deux.")]);
    expect(result.text).toBe("Page une.\n\nPage deux.");
  });
});
