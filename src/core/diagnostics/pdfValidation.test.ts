import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openWithPdfJs } from "@/core/pdf/pdfjs";

/**
 * Pourquoi « pdf.js accepte de l'ouvrir » ne prouve pas qu'un document est
 * réparé.
 *
 * Ce test refabrique, octet pour octet, ce que produisait la première version
 * du correctif de table de références : un document tronqué au milieu de son
 * troisième objet, suivi d'une table, d'un trailer et d'un `%%EOF`. Le fichier
 * a toutes les apparences d'un PDF sain.
 *
 * Les lecteurs PDF sont, par conception, extrêmement tolérants : ils ont été
 * écrits pour afficher quelque chose plutôt que de refuser un document, et
 * pdf.js reconstruit lui-même ce qu'il ne trouve pas. Son acceptation ne dit
 * donc rien de la cohérence du fichier — c'est la raison pour laquelle la
 * validation structurelle de `diagnostics/pdf.rs` a été ajoutée **en plus**,
 * et non à la place.
 */
const DIR = join(process.cwd(), "test-assets", "generated");

/** Reconstruit l'ancienne sortie fautive, telle qu'elle était écrite. */
function forgeNaiveRebuild(source: Uint8Array): Uint8Array {
  const parts: number[] = [...source, 0x0a];
  const xrefOffset = parts.length;
  const pad = (value: number) => String(value).padStart(10, "0");
  const table =
    `xref\n0 4\n0000000000 65535 f \n` +
    [9, 58, 121].map((offset) => `${pad(offset)} 00000 n \n`).join("") +
    `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  for (const code of new TextEncoder().encode(table)) parts.push(code);
  return Uint8Array.from(parts);
}

describe("l'ouverture par pdf.js ne suffit pas à prouver une réparation", () => {
  it("le document tronqué porte bien la corruption attendue", () => {
    const source = new Uint8Array(readFileSync(join(DIR, "pdf-truncated-stream.pdf")));
    const text = new TextDecoder("latin1").decode(source);

    // Le fichier s'arrête au milieu du dictionnaire de l'objet 3.
    expect(text).toContain("3 0 obj");
    expect(text.endsWith("<< /Type /Page /Parent")).toBe(true);
    // Aucun `endobj` ne referme cet objet, et l'objet 4 annoncé n'existe pas.
    expect(text.lastIndexOf("endobj")).toBeLessThan(text.indexOf("3 0 obj"));
    expect(text).toContain("/Kids [3 0 R 4 0 R]");
    expect(text).not.toContain("4 0 obj");
  });

  it("pdf.js ouvre pourtant la fausse réparation, et croit ses deux pages", async () => {
    const source = new Uint8Array(readFileSync(join(DIR, "pdf-truncated-stream.pdf")));
    const forged = forgeNaiveRebuild(source);

    // Le fichier fait bien les ~295 octets observés lors du test manuel.
    expect(forged.byteLength).toBeGreaterThan(280);
    expect(forged.byteLength).toBeLessThan(320);

    let opened = false;
    let pages = 0;
    try {
      const document = await openWithPdfJs({ bytes: forged, name: "forge.pdf" });
      opened = true;
      pages = document.numPages;
      document.cleanup();
    } catch {
      opened = false;
    }

    // C'est le cœur de la régression : le moteur accepte un document dont
    // aucune page n'existe réellement, et annonce son `/Count` sur parole. Il
    // émet bien un avertissement — « invalid /Pages tree /Count: 2 » — mais il
    // ouvre, et `numPages` ne vaut pas zéro.
    //
    // Si une version future de pdf.js venait à refuser ce fichier, ce test
    // échouerait : ce serait une bonne nouvelle, et il faudrait alors le
    // réécrire en le disant. Ce qui ne changerait pas, c'est que le moteur natif
    // refuse d'écrire ce document bien avant qu'un lecteur ne soit consulté.
    expect(opened, "pdf.js a refusé la fausse réparation — mettre ce test à jour").toBe(true);
    expect(pages).toBeGreaterThan(0);
  });

  it("le document sain, lui, s'ouvre et compte ses deux pages", async () => {
    const bytes = new Uint8Array(readFileSync(join(DIR, "pdf-healthy.pdf")));
    const document = await openWithPdfJs({ bytes, name: "pdf-healthy.pdf" });
    expect(document.numPages).toBe(2);
    document.cleanup();
  });
});
