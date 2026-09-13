import { describe, expect, it } from "vitest";
import { toolRegistry } from "./registry";
import { searchTools } from "./search";
import { getCategory, listCategories } from "./categories";
import { TOOL_IMPLEMENTATIONS } from "@/tools/implementations";
import { DIAGNOSTIC_SPECIALISTS, handoffTargetIds } from "@/features/handoff/targets";

/**
 * Ce que la phase 12 ajoute au catalogue.
 *
 * Cinq outils, pas un de plus : la phase n'avait pas pour but d'allonger la
 * liste mais de fermer quelques vrais trous. Les tests ci-dessous vérifient
 * surtout que les promesses tenues par le catalogue sont les bonnes — un outil
 * de réparation qui n'annoncerait pas ses limites serait pire que son absence.
 */
const NEW_TOOLS = [
  "file-diagnose",
  "archive-repair",
  "pdf-repair",
  "image-repair",
  "disk-inspect",
];

const QUERIES: [string, string][] = [
  ["diagnostiquer fichier", "file-diagnose"],
  ["fichier corrompu", "file-diagnose"],
  ["reparer zip", "archive-repair"],
  ["zip cassé", "archive-repair"],
  ["recuperer archive", "archive-repair"],
  ["reparer pdf", "pdf-repair"],
  ["pdf corrompu", "pdf-repair"],
  ["xref pdf", "pdf-repair"],
  ["recuperer image", "image-repair"],
  ["image corrompue", "image-repair"],
  ["jpeg cassé", "image-repair"],
  ["png corrompu", "image-repair"],
  ["disque", "disk-inspect"],
  ["partitions", "disk-inspect"],
  ["smart", "disk-inspect"],
  ["sante disque", "disk-inspect"],
  ["ssd", "disk-inspect"],
  ["nvme", "disk-inspect"],
  ["filesystem", "disk-inspect"],
  ["espace disque", "disk-inspect"],
];

describe("catalogue de la phase 12", () => {
  it("enregistre les cinq outils et leur implémentation", () => {
    for (const id of NEW_TOOLS) {
      const tool = toolRegistry.get(id);
      expect(tool, `outil absent du catalogue : ${id}`).toBeDefined();
      expect(TOOL_IMPLEMENTATIONS[id], `implémentation absente : ${id}`).toBeDefined();
    }
  });

  it("ajoute la catégorie Diagnostic, à sa place dans l'ordre", () => {
    const category = getCategory("diagnostics");
    expect(category?.name).toBe("Diagnostic & récupération");
    const order = listCategories().map((entry) => entry.id);
    expect(order.indexOf("diagnostics")).toBeGreaterThan(order.indexOf("network"));
    expect(order.indexOf("diagnostics")).toBeLessThan(order.indexOf("security"));
  });

  it("rend chaque outil trouvable par ce qu'on tape vraiment", () => {
    for (const [query, expected] of QUERIES) {
      const results = searchTools(query, { limit: 5 });
      expect(results.length, `aucun résultat pour « ${query} »`).toBeGreaterThan(0);
      expect(
        results.slice(0, 3).map((result) => result.tool.id),
        `« ${query} » ne remonte pas ${expected}`,
      ).toContain(expected);
    }
  });

  it("dit dans le catalogue ce que chaque outil ne garantit pas", () => {
    // Ces phrases sont le contrat de la phase : elles doivent être lisibles
    // avant d'ouvrir l'outil, pas découvertes après avoir cliqué.
    expect(toolRegistry.get("file-diagnose")!.note).toMatch(/jamais modifié/);
    expect(toolRegistry.get("archive-repair")!.note).toMatch(/jamais reconstituées/);
    expect(toolRegistry.get("archive-repair")!.note).toMatch(/n'est pas touchée/);
    expect(toolRegistry.get("pdf-repair")!.note).toMatch(/réparation est déclarée manquée/);
    expect(toolRegistry.get("pdf-repair")!.note).toMatch(/signature numérique/);
    expect(toolRegistry.get("image-repair")!.note).toMatch(/jamais recalculée/);
    expect(toolRegistry.get("image-repair")!.note).toMatch(/jamais inventées/);
    expect(toolRegistry.get("disk-inspect")!.note).toMatch(/Lecture seule/);
  });

  it("ne promet nulle part d'écrire sur un disque", () => {
    // Le contrôle porte sur le **nom** et la **description** : c'est là que
    // vivrait une promesse. Les notes, elles, ont le droit d'employer ces mots
    // — c'est même leur rôle, puisqu'elles disent ce que FourTout ne fait pas.
    const forbidden = [
      "partitionner",
      "formater le disque",
      "réparer le disque",
      "cloner",
      "image disque",
      "optimiser le disque",
      "corriger les secteurs",
      "effacer le disque",
    ];
    for (const tool of toolRegistry.all()) {
      const promise = `${tool.name} ${tool.description}`.toLowerCase();
      for (const phrase of forbidden) {
        expect(promise.includes(phrase), `« ${phrase} » promis par ${tool.id}`).toBe(false);
      }
    }
    // Et la note de l'outil disque emploie bien ces mots, pour les nier.
    const note = toolRegistry.get("disk-inspect")!.note!;
    expect(note).toMatch(/ne sait ni partitionner/);
  });

  it("garde les outils de diagnostic entièrement locaux", () => {
    for (const id of NEW_TOOLS) {
      const tool = toolRegistry.get(id)!;
      expect(tool.capabilities).toContain("local");
      expect(tool.capabilities).not.toContain("network");
      expect(tool.capabilities).not.toContain("destructive");
    }
  });
});

describe("passages de relais de la phase 12", () => {
  it("ne vise que des outils qui existent et fonctionnent", () => {
    for (const id of handoffTargetIds()) {
      expect(toolRegistry.get(id), `cible de relais inconnue : ${id}`).toBeDefined();
      expect(TOOL_IMPLEMENTATIONS[id], `cible sans implémentation : ${id}`).toBeDefined();
    }
  });

  it("envoie chaque format vers l'outil qui le connaît en profondeur", () => {
    expect(DIAGNOSTIC_SPECIALISTS.zip.tool).toBe("archive-repair");
    expect(DIAGNOSTIC_SPECIALISTS.pdf.tool).toBe("pdf-repair");
    expect(DIAGNOSTIC_SPECIALISTS.png.tool).toBe("image-repair");
    expect(DIAGNOSTIC_SPECIALISTS.jpg.tool).toBe("image-repair");
    // Et rien pour les formats que FourTout n'analyse pas en profondeur : le
    // diagnostic universel prend alors le relais, sans promettre davantage.
    expect(DIAGNOSTIC_SPECIALISTS.mp3).toBeUndefined();
    expect(DIAGNOSTIC_SPECIALISTS.sqlite).toBeUndefined();
  });

  it("laisse intact le relais SQLite de la phase 11", () => {
    // Blast radius : la phase 12 ajoute des relais, elle n'en déplace aucun.
    expect(toolRegistry.get("sqlite-explorer")).toBeDefined();
    expect(handoffTargetIds()).toContain("sqlite-explorer");
  });
});
