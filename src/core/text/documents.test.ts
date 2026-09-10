// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { configurePdfJsForNode } from "@/test/nodeRaster";
import { HEAVY_TIMEOUT } from "@/test/timeouts";
import { TextError } from "./errors";
import {
  compareDocuments,
  docxToText,
  documentToText,
  formatForExtension,
  normalizeForCompare,
  wordXmlToText,
  type DocumentInput,
} from "./documents";

const DIR = join(process.cwd(), "test-assets", "generated");

function input(name: string): DocumentInput {
  return {
    name,
    bytes: new Uint8Array(readFileSync(join(DIR, name))),
    extension: name.slice(name.lastIndexOf(".") + 1),
  };
}

/** Phrases connues des fixtures (voir le générateur). */
const COMMON = "Article premier : objet du contrat.";
const ONLY_A = "Le montant est fixé à 1 200 euros.";
const ONLY_B = "Le montant est fixé à 1 450 euros.";

beforeAll(() => {
  configurePdfJsForNode();
  execFileSync(process.execPath, [join(process.cwd(), "scripts/generate-document-assets.mjs")], {
    stdio: "ignore",
  });
}, HEAVY_TIMEOUT);

/* ============================================================== formats */

describe("reconnaissance du format", () => {
  it("associe chaque extension à son format", () => {
    expect(formatForExtension("pdf")).toBe("pdf");
    expect(formatForExtension(".DOCX")).toBe("docx");
    expect(formatForExtension("md")).toBe("markdown");
    expect(formatForExtension("htm")).toBe("html");
    expect(formatForExtension("txt")).toBe("txt");
  });

  it("ne reconnaît pas ce qu'il ne sait pas lire", () => {
    expect(formatForExtension("odt")).toBeUndefined();
    expect(formatForExtension("xlsx")).toBeUndefined();
  });
});

/* ================================================================= DOCX */

describe("lecture d'un DOCX", () => {
  it("extrait les paragraphes d'un document Word réel", () => {
    const text = docxToText(input("compare.docx").bytes);
    expect(text).toContain(COMMON);
    expect(text).toContain(ONLY_B);
    expect(text).toContain("Genève");
    // Un paragraphe par ligne.
    expect(text.split("\n").filter(Boolean).length).toBe(5);
  });

  it("lit aussi la fixture historique, tableaux compris", () => {
    const text = docxToText(input("sample.docx").bytes);
    expect(text).toContain("éàçùô");
    expect(text).toContain("&");
  });

  it("traduit tabulations, sauts de ligne et cellules", () => {
    const xml =
      '<w:document><w:body>' +
      "<w:p><w:r><w:t>Un</w:t><w:tab/><w:t>Deux</w:t></w:r></w:p>" +
      "<w:p><w:r><w:t>Trois</w:t><w:br/><w:t>Quatre</w:t></w:r></w:p>" +
      "</w:body></w:document>";
    expect(wordXmlToText(xml)).toBe("Un\tDeux\nTrois\nQuatre");
  });

  it("décode les entités XML", () => {
    const xml =
      '<w:document><w:body><w:p><w:r><w:t>a &amp; b &lt;c&gt; &#233; &#xe0;</w:t></w:r></w:p></w:body></w:document>';
    expect(wordXmlToText(xml)).toBe("a & b <c> é à");
  });

  it("préserve les espaces déclarés", () => {
    const xml =
      '<w:document><w:body><w:p><w:r><w:t xml:space="preserve">Avant </w:t><w:t>après</w:t></w:r></w:p></w:body></w:document>';
    expect(wordXmlToText(xml)).toBe("Avant après");
  });

  it("refuse un fichier qui n'est pas un DOCX", () => {
    expect(() => docxToText(input("compare-a.pdf").bytes)).toThrowError(TextError);
  });
});

/* =========================================================== extraction */

describe("extraction, tous formats", () => {
  it("lit un PDF", async () => {
    const document = await documentToText(input("compare-a.pdf"));
    expect(document.format).toBe("pdf");
    expect(document.pages).toBe(1);
    expect(document.text).toContain(COMMON);
    expect(document.text).toContain(ONLY_A);
  });

  it("lit un DOCX", async () => {
    const document = await documentToText(input("compare.docx"));
    expect(document.format).toBe("docx");
    expect(document.text).toContain(ONLY_B);
  });

  it("lit un fichier texte en détectant son encodage", async () => {
    const document = await documentToText(input("encoding-win1252.txt"));
    expect(document.format).toBe("txt");
    expect(document.encoding).toBe("windows-1252");
    expect(document.text).toContain("Genève");
  });

  it("lit un Markdown tel quel", async () => {
    const document = await documentToText(input("sample.md"));
    expect(document.format).toBe("markdown");
    expect(document.text.length).toBeGreaterThan(10);
  });

  it("réduit un HTML à son texte", async () => {
    const document = await documentToText(input("sample.html"));
    expect(document.format).toBe("html");
    expect(document.text).not.toContain("<");
  });

  it("refuse un format qu'il ne sait pas lire", async () => {
    await expect(documentToText(input("sample.png"))).rejects.toMatchObject({
      code: "document-unsupported",
    });
  });

  it("dirige vers le PDF recherchable devant un scan", async () => {
    await expect(documentToText(input("scanned-two-page.pdf"))).rejects.toMatchObject({
      code: "document-empty",
    });
    await expect(documentToText(input("scanned-two-page.pdf"))).rejects.toThrow(/recherchable/);
  }, HEAVY_TIMEOUT);
});

/* ========================================================= normalisation */

describe("normalisation", () => {
  it("uniformise les fins de ligne", () => {
    expect(normalizeForCompare("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("réduit les espaces multiples et de bord", () => {
    expect(normalizeForCompare("a    b  \n   c ")).toBe("a b\nc");
  });

  it("ramène les espaces insécables à des espaces ordinaires", () => {
    expect(normalizeForCompare("1 200 euros")).toBe("1 200 euros");
  });

  it("recolle les césures de fin de ligne d'un PDF", () => {
    expect(normalizeForCompare("docu-\nment")).toBe("document");
    expect(normalizeForCompare("docu­\nment")).toBe("document");
  });

  it("ne recolle pas un vrai trait d'union en fin de ligne", () => {
    // Majuscule après le retour : c'est un nom composé coupé, pas une césure.
    expect(normalizeForCompare("Saint-\nÉtienne")).toContain("\n");
  });

  it("ne supprime jamais un mot", () => {
    const text = "Le montant est fixé à 1 200 euros.";
    expect(normalizeForCompare(text).split(/\s+/)).toHaveLength(text.split(/\s+/).length);
  });
});

/* ========================================================== comparaison */

describe("comparaison de documents", () => {
  it("compare deux PDF et pointe la seule ligne qui change", async () => {
    const result = await compareDocuments(input("compare-a.pdf"), input("compare-b.pdf"));
    expect(result.diff.identical).toBe(false);
    expect(result.diff.stats.modified + result.diff.stats.added).toBeGreaterThan(0);

    const changed = result.diff.rows.filter((row) => row.op !== "equal");
    expect(changed).toHaveLength(1);
    expect(changed[0].leftText).toContain("1 200");
    expect(changed[0].rightText).toContain("1 450");
  }, HEAVY_TIMEOUT);

  it("compare un PDF et un DOCX de contenu équivalent", async () => {
    const result = await compareDocuments(input("compare-b.pdf"), input("compare.docx"));
    expect(result.left.format).toBe("pdf");
    expect(result.right.format).toBe("docx");
    // Même contenu, deux formats : la normalisation doit les rapprocher.
    expect(result.diff.identical).toBe(true);
  }, HEAVY_TIMEOUT);

  it("compare deux fichiers texte", async () => {
    const result = await compareDocuments(input("compare-a.txt"), input("compare-b.txt"));
    const changed = result.diff.rows.filter((row) => row.op !== "equal");
    expect(changed).toHaveLength(1);
    expect(changed[0].leftWords?.some((part) => part.changed)).toBe(true);
  });

  it("voit identiques deux copies du même document", async () => {
    const result = await compareDocuments(input("compare-a.pdf"), input("compare-a.pdf"));
    expect(result.diff.identical).toBe(true);
    expect(result.diff.stats.added).toBe(0);
    expect(result.diff.stats.removed).toBe(0);
  }, HEAVY_TIMEOUT);

  it("distingue le mode exact du mode normalisé", async () => {
    const spaced: DocumentInput = {
      name: "espace.txt",
      bytes: new TextEncoder().encode("Une   ligne   espacée\n"),
      extension: "txt",
    };
    const tight: DocumentInput = {
      name: "serre.txt",
      bytes: new TextEncoder().encode("Une ligne espacée\r\n"),
      extension: "txt",
    };

    expect((await compareDocuments(spaced, tight, { mode: "exact" })).diff.identical).toBe(false);
    expect((await compareDocuments(spaced, tight, { mode: "normalized" })).diff.identical).toBe(
      true,
    );
  });

  it("ne masque jamais un changement de mot, même normalisé", async () => {
    const a: DocumentInput = {
      name: "a.txt",
      bytes: new TextEncoder().encode("Le  montant  est  de  100  euros\n"),
      extension: "txt",
    };
    const b: DocumentInput = {
      name: "b.txt",
      bytes: new TextEncoder().encode("Le montant est de 200 euros\n"),
      extension: "txt",
    };
    const result = await compareDocuments(a, b, { mode: "normalized" });
    expect(result.diff.identical).toBe(false);
  });

  it("s'interrompt à l'annulation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      compareDocuments(input("compare-a.txt"), input("compare-b.txt"), {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "cancelled" });
  });

  it("publie une progression", async () => {
    const labels: string[] = [];
    await compareDocuments(
      input("compare-a.txt"),
      input("compare-b.txt"),
      {},
      { report: (progress) => progress.label && labels.push(progress.label) },
    );
    expect(labels).toContain("Comparaison");
    expect(labels.at(-1)).toBe("Terminé");
  });
});
