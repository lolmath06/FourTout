/**
 * Recette de la carte « Word (DOCX) vers PDF ».
 *
 * L'outil enchaîne deux moteurs : le lecteur DOCX natif (éprouvé côté Rust
 * contre `test-assets/generated/sample.docx`) puis la mise en page PDF. Ce
 * fichier couvre la seconde moitié — la seule qui puisse produire un PDF
 * illisible sans que rien ne le signale — en repartant du Markdown **réellement
 * produit** par le lecteur natif sur la fixture.
 *
 * Le PDF obtenu est relu avec pdf.js : un fichier qui s'écrit n'est pas un
 * fichier qui se lit.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { configurePdfJsForNode } from "@/test/nodeRaster";
import { documentToPdf } from "./documentToPdf";
import { extractText, joinPages } from "./extractText";
import { inspectPdf } from "../document";

beforeAll(() => {
  configurePdfJsForNode();
});

/**
 * Sortie exacte de `docx::to_markdown` sur `sample.docx`, relevée sur la
 * fixture. Titres, sous-titre, gras, italique, liste, tableau et accents : tout
 * ce que la carte annonce savoir mettre en page.
 */
const FIXTURE_MARKDOWN = `# Rapport FourTout

Un paragraphe avec du **gras** et de l'*italique*.

## Sous-titre

- Premier point de la liste
- Second point de la liste
| Colonne A | Colonne B |
| 1 | deux |
Dernier paragraphe, avec des accents : éàçùô et une esperluette &.
`;

describe("Word (DOCX) vers PDF", () => {
  it("produit un PDF valide et relisible à partir de la fixture", async () => {
    const file = await documentToPdf("sample.docx", FIXTURE_MARKDOWN, {
      kind: "markdown",
      title: "Rapport de test FourTout",
    });
    expect(file.name).toBe("sample.pdf");
    expect(file.bytes.length).toBeGreaterThan(0);

    // Le fichier s'ouvre réellement, et il a au moins une page.
    const info = await inspectPdf({ name: file.name, bytes: file.bytes });
    expect(info.pageCount).toBeGreaterThan(0);

    const text = await joinPages(await extractText({ name: file.name, bytes: file.bytes }));

    // Titre et sous-titre.
    expect(text).toContain("Rapport FourTout");
    expect(text).toContain("Sous-titre");
    // Le gras et l'italique restent du texte, pas des marqueurs Markdown.
    expect(text).toContain("gras");
    expect(text).not.toContain("**gras**");
    // Liste.
    expect(text).toContain("Premier point de la liste");
    expect(text).toContain("Second point de la liste");
    // Tableau simple.
    expect(text).toContain("Colonne A");
    expect(text).toContain("Colonne B");
    // UTF-8 : accents et esperluette. Les caractères hors WinAnsi sont
    // translittérés plutôt que perdus, mais les accents latins survivent tels
    // quels.
    expect(text).toContain("éàçùô");
    expect(text).toContain("esperluette &");
  });

  it("répartit un document long sur plusieurs pages", async () => {
    const long = Array.from({ length: 220 }, (_, i) => `Paragraphe numéro ${i + 1}.`).join("\n\n");
    const file = await documentToPdf("long.docx", long, { kind: "markdown" });
    const info = await inspectPdf({ name: file.name, bytes: file.bytes });
    expect(info.pageCount).toBeGreaterThan(1);

    const text = await joinPages(await extractText({ name: file.name, bytes: file.bytes }));
    expect(text).toContain("Paragraphe numéro 1.");
    expect(text).toContain("Paragraphe numéro 220.");
  });
});
