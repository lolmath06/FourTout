// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { extractText } from "@/core/pdf/operations/extractText";
import { setRasterBackend } from "@/core/pdf/raster/types";
import { configurePdfJsForNode, nodeRasterBackend } from "@/test/nodeRaster";
import { cleanPdfText } from "./pdfText";
import { segmentText } from "./segment";

/**
 * Chaîne réelle « PDF → texte prêt à lire », sur la fixture livrée à
 * l'utilisateur : extraction pdf.js, nettoyage, segmentation. Seule la synthèse
 * elle-même est hors de portée d'un test Node — elle est couverte contre le
 * vrai moteur dans `src-tauri/tests/speech_integration.rs`.
 */

const DIR = join(process.cwd(), "test-assets", "generated");

beforeAll(() => {
  configurePdfJsForNode();
  setRasterBackend(nodeRasterBackend);
  execFileSync(process.execPath, [join(process.cwd(), "scripts/generate-pdf-assets.mjs")], {
    stdio: "ignore",
  });
}, 60_000);

describe("PDF vers audio", () => {
  it("extrait, nettoie et segmente la fixture livrée", async () => {
    const bytes = new Uint8Array(readFileSync(join(DIR, "pdf-to-audio.pdf")));
    const extracted = await extractText({ name: "pdf-to-audio.pdf", bytes });
    expect(extracted.pages).toHaveLength(3);

    const cleaned = cleanPdfText(extracted.pages);

    // Les phrases attendues sont bien là.
    expect(cleaned.text).toContain("Bienvenue dans FourTout.");
    expect(cleaned.text).toContain("Ce document sert a tester la conversion d'un PDF en audio.");
    expect(cleaned.text).toContain("Aucun texte n'est envoye sur le reseau.");

    // L'en-tête répété et les numéros de page ne seront pas prononcés.
    expect(cleaned.text).not.toContain("FourTout - document de test");
    expect(cleaned.text.split("\n").some((line) => /^\d$/.test(line.trim()))).toBe(false);
    expect(cleaned.removedLines).toBeGreaterThanOrEqual(6);

    // Le texte se découpe en segments prononçables.
    const segments = segmentText(cleaned.text);
    expect(segments.length).toBeGreaterThanOrEqual(3);
    expect(segments[0]).toContain("Bienvenue dans FourTout.");
    expect(segments.every((segment) => segment.trim().length > 0)).toBe(true);
  }, 30_000);

  it("signale un PDF sans couche texte au lieu de produire un audio vide", async () => {
    const bytes = new Uint8Array(readFileSync(join(DIR, "pdf-scan-fr.pdf")));
    const extracted = await extractText({ name: "pdf-scan-fr.pdf", bytes });
    const cleaned = cleanPdfText(extracted.pages);
    expect(cleaned.text.trim()).toBe("");
    expect(segmentText(cleaned.text)).toEqual([]);
  }, 30_000);
});
