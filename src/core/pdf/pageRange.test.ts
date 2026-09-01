import { describe, expect, it } from "vitest";
import {
  formatPageRange,
  invertSelection,
  parsePageRange,
  parseSplitGroups,
  splitIntoChunks,
} from "./pageRange";
import { PdfError } from "./errors";
import {
  baseName,
  numberedName,
  outputName,
  sanitizeFileNamePart,
  uniqueName,
} from "./filenames";

const pages = (input: string, count = 10) => parsePageRange(input, count).pages;

describe("analyse d'une sélection de pages", () => {
  it("comprend une liste simple", () => {
    expect(pages("1,3,5")).toEqual([1, 3, 5]);
  });

  it("comprend une plage", () => {
    expect(pages("1-4")).toEqual([1, 2, 3, 4]);
  });

  it("comprend un mélange de listes et de plages", () => {
    expect(pages("1-3,7,9-10")).toEqual([1, 2, 3, 7, 9, 10]);
  });

  it("tolère les espaces et les points-virgules", () => {
    expect(pages("  1 - 3 ;  7 ")).toEqual([1, 2, 3, 7]);
  });

  it("tolère un tiret long issu d'un copier-coller", () => {
    expect(pages("2–4")).toEqual([2, 3, 4]);
  });

  it("accepte une plage écrite à l'envers", () => {
    expect(pages("5-3")).toEqual([3, 4, 5]);
  });

  it("comprend les plages ouvertes", () => {
    expect(pages("8-")).toEqual([8, 9, 10]);
    expect(pages("-3")).toEqual([1, 2, 3]);
  });

  it("supprime les doublons sans perdre l'ordre de saisie", () => {
    const parsed = parsePageRange("3,1,3,2,1", 10);
    expect(parsed.ordered).toEqual([3, 1, 2]);
    expect(parsed.pages).toEqual([1, 2, 3]);
  });

  it("refuse une page hors du document en expliquant pourquoi", () => {
    try {
      parsePageRange("2,11", 10);
      expect.unreachable("aurait dû lever une erreur");
    } catch (error) {
      expect(error).toBeInstanceOf(PdfError);
      expect((error as PdfError).code).toBe("page-out-of-range");
      expect((error as PdfError).message).toContain("11");
      expect((error as PdfError).message).toContain("10 pages");
    }
  });

  it("refuse une saisie qui n'a pas de sens", () => {
    for (const input of ["abc", "1-2-3", "1,,x", "-"]) {
      expect(() => parsePageRange(input, 10), input).toThrowError(PdfError);
    }
  });

  it("refuse une sélection vide", () => {
    expect(() => parsePageRange("   ", 10)).toThrowError(/Aucune page/);
  });

  it("refuse un document sans page", () => {
    expect(() => parsePageRange("1", 0)).toThrowError(/aucune page/i);
  });

  it("accepte la page 0 comme hors limites et non comme un décalage", () => {
    expect(() => parsePageRange("0", 10)).toThrowError(/n'existent pas|inexistant/i);
  });
});

describe("sélection inverse", () => {
  it("garde les pages non listées", () => {
    expect(invertSelection([2, 5, 6, 7], 10)).toEqual([1, 3, 4, 8, 9, 10]);
  });

  it("renvoie une liste vide si tout est sélectionné", () => {
    expect(invertSelection([1, 2, 3], 3)).toEqual([]);
  });
});

describe("mise en forme d'une sélection", () => {
  it("regroupe les pages contiguës", () => {
    expect(formatPageRange([1, 2, 3, 7])).toBe("1-3, 7");
    expect(formatPageRange([4])).toBe("4");
    expect(formatPageRange([])).toBe("");
  });

  it("découpe en groupes contigus", () => {
    expect(splitIntoChunks([1, 2, 3, 5, 8, 9])).toEqual([[1, 2, 3], [5], [8, 9]]);
  });
});

describe("groupes de découpage", () => {
  it("produit un groupe par segment", () => {
    expect(parseSplitGroups("1-3, 4-5, 6", 6)).toEqual([[1, 2, 3], [4, 5], [6]]);
  });

  it("accepte une page seule comme groupe", () => {
    expect(parseSplitGroups("2", 6)).toEqual([[2]]);
  });

  it("refuse un groupe hors limites", () => {
    expect(() => parseSplitGroups("1-3, 9", 6)).toThrowError(PdfError);
  });
});

describe("noms de fichiers de sortie", () => {
  it("retire l'extension", () => {
    expect(baseName("rapport.final.pdf")).toBe("rapport.final");
    expect(baseName("sans-extension")).toBe("sans-extension");
  });

  it("ajoute un suffixe explicite", () => {
    expect(outputName("document.pdf", "fusionne")).toBe("document-fusionne.pdf");
    expect(outputName("document.pdf", "texte", "txt")).toBe("document-texte.txt");
  });

  it("ne répète pas un suffixe déjà présent", () => {
    expect(outputName("document-fusionne.pdf", "fusionne")).toBe("document-fusionne.pdf");
  });

  it("conserve les accents mais retire les caractères interdits", () => {
    expect(sanitizeFileNamePart("Rapport été: final?")).toBe("Rapport été- final-");
    expect(outputName("mon:fichier*.pdf", "pivote")).toBe("mon-fichier--pivote.pdf");
  });

  it("survit à un nom vide", () => {
    expect(outputName("", "compresse")).toBe("document-compresse.pdf");
  });

  it("numérote les pages avec un remplissage cohérent", () => {
    expect(numberedName("doc.pdf", 3, 12, "png")).toBe("doc-page-03.png");
    expect(numberedName("doc.pdf", 3, 120, "png")).toBe("doc-page-003.png");
    expect(numberedName("doc.pdf", 1, 4, "jpg", "image")).toBe("doc-image-01.jpg");
  });

  it("évite d'écraser un fichier existant", () => {
    expect(uniqueName("doc.pdf", [])).toBe("doc.pdf");
    expect(uniqueName("doc.pdf", ["doc.pdf"])).toBe("doc (2).pdf");
    expect(uniqueName("doc.pdf", ["doc.pdf", "doc (2).pdf"])).toBe("doc (3).pdf");
    expect(uniqueName("doc.pdf", ["DOC.PDF"])).toBe("doc (2).pdf");
  });
});
