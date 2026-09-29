import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toolRegistry } from "@/core/tools/registry";
import { constraintsForTool, validateSelection } from "@/core/files";

/**
 * Régressions de la Phase 3C.
 *
 * 1) Les aperçus de « Ajouter du texte » (PDF et image) disparaissaient sous
 *    WebKitGTK : un conteneur `inline-block` en `container-type: size` s'y
 *    effondre à 0×0 (confinement de taille). Le rendu réel des pixels n'est pas
 *    vérifiable en jsdom ; on verrouille donc au niveau source l'absence de ce
 *    motif et la présence de la mesure par `ResizeObserver`.
 * 2) Le SVG (et le GIF) étaient refusés par le validateur alors qu'annoncés
 *    supportés : on vérifie la cohérence catalogue ↔ validation.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf-8");

describe("aperçus « Ajouter du texte » (garde anti-régression CSS)", () => {
  for (const file of [
    "src/tools/impl/pdf/PdfAddTextTool.tsx",
    "src/tools/impl/image/ImageAddTextTool.tsx",
  ]) {
    it(`${file} n'utilise pas container-type: size et mesure le rendu`, () => {
      const source = read(file);
      expect(source, "container-type: size effondre l'aperçu sous WebKitGTK").not.toContain('containerType: "size"');
      expect(source).toContain("useRenderedSize");
    });
  }
});

describe("cohérence catalogue ↔ validation des fichiers", () => {
  const convert = toolRegistry.get("image-convert")!;

  it("accepte réellement un .svg dans « Convertir une image »", () => {
    const svg = new File(["<svg xmlns='http://www.w3.org/2000/svg'/>"], "image-test.svg", { type: "image/svg+xml" });
    const { accepted, rejected } = validateSelection([svg], constraintsForTool(convert));
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("accepte un .gif (première image)", () => {
    const gif = new File([new Uint8Array([0x47, 0x49, 0x46])], "anim.gif", { type: "image/gif" });
    expect(validateSelection([gif], constraintsForTool(convert)).accepted).toHaveLength(1);
  });

  it("retrouve le convertisseur par l'extension svg", () => {
    expect(toolRegistry.acceptingExtension("svg").map((t) => t.id)).toContain("image-convert");
    expect(toolRegistry.acceptingExtension(".SVG").map((t) => t.id)).toContain("image-convert");
  });

  it("le hint du convertisseur annonce bien le SVG", () => {
    expect(read("src/tools/impl/image/ImageConvertTool.tsx")).toContain("SVG");
  });
});
