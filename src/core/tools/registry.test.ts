import { describe, expect, it } from "vitest";
import { ToolRegistry, toolRegistry } from "./registry";
import { CATEGORIES, listCategories } from "./categories";
import { ALL_TOOLS } from "./catalog";
import { implementedToolIds } from "@/tools/implementations";
import { toolRoute, categoryRoute } from "./types";

describe("registre des outils", () => {
  it("expose tout le catalogue", () => {
    expect(toolRegistry.all()).toHaveLength(ALL_TOOLS.length);
    expect(toolRegistry.all().length).toBeGreaterThan(100);
  });

  it("n'a aucun identifiant dupliqué", () => {
    const ids = ALL_TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("utilise des identifiants en kebab-case", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.id, `id invalide : ${tool.id}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("refuse un catalogue contenant des doublons", () => {
    const duplicated = [ALL_TOOLS[0], ALL_TOOLS[0]];
    expect(() => new ToolRegistry(duplicated, CATEGORIES)).toThrow(/dupliqu/i);
  });

  it("refuse une catégorie inconnue", () => {
    const broken = [{ ...ALL_TOOLS[0], category: "inexistante" as never }];
    expect(() => new ToolRegistry(broken, CATEGORIES)).toThrow(/inconnues/i);
  });

  it("ne référence que des catégories déclarées", () => {
    const known = new Set(CATEGORIES.map((category) => category.id));
    for (const tool of ALL_TOOLS) {
      expect(known.has(tool.category)).toBe(true);
      for (const extra of tool.alsoIn ?? []) expect(known.has(extra)).toBe(true);
    }
  });

  it("remplit chaque catégorie déclarée", () => {
    for (const category of listCategories()) {
      expect(
        toolRegistry.byCategoryId(category.id).length,
        `catégorie vide : ${category.id}`,
      ).toBeGreaterThan(0);
    }
  });

  it("rend un outil découvrable depuis ses catégories secondaires", () => {
    const tool = toolRegistry.get("gif-to-video");
    expect(tool?.alsoIn).toContain("converters");
    const ids = toolRegistry.byCategoryId("converters").map((t) => t.id);
    expect(ids).toContain("gif-to-video");
    // Sans duplication : une seule définition dans tout le catalogue.
    expect(ALL_TOOLS.filter((t) => t.id === "gif-to-video")).toHaveLength(1);
  });

  it("décrit des entrées et sorties exploitables", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.acceptedInputs.length, `entrées manquantes : ${tool.id}`).toBeGreaterThan(0);
      expect(tool.outputs.length, `sorties manquantes : ${tool.id}`).toBeGreaterThan(0);
      expect(tool.capabilities.length, `capacités manquantes : ${tool.id}`).toBeGreaterThan(0);
    }
  });

  it("déclare « local » partout sauf pour les outils réseau assumés", () => {
    const networked = ALL_TOOLS.filter((tool) => tool.capabilities.includes("network"));
    expect(networked.map((tool) => tool.id)).toEqual(["calc-currency"]);
    for (const tool of ALL_TOOLS) {
      if (tool.capabilities.includes("network")) continue;
      expect(tool.capabilities, `outil ni local ni réseau : ${tool.id}`).toContain("local");
    }
  });

  it("retrouve les outils par type de donnée et par extension", () => {
    expect(toolRegistry.acceptingKind("pdf").map((t) => t.id)).toContain("pdf-merge");
    expect(toolRegistry.acceptingExtension("webp").map((t) => t.id)).toContain("image-convert");
    expect(toolRegistry.acceptingExtension(".WEBP").map((t) => t.id)).toContain("image-convert");
  });

  it("ignore les identifiants inconnus lors de la résolution", () => {
    expect(toolRegistry.resolveMany(["pdf-merge", "inexistant"]).map((t) => t.id)).toEqual([
      "pdf-merge",
    ]);
  });

  it("compte les outils par catégorie", () => {
    const counts = toolRegistry.countsByCategory();
    expect(counts.pdf).toBe(toolRegistry.byCategoryId("pdf").length);
    expect(Object.keys(counts)).toHaveLength(CATEGORIES.length);
  });

  it("garde le catalogue et les implémentations exactement alignés", () => {
    // La règle du produit : figurer au catalogue, c'est fonctionner. Ni outil
    // sans implémentation, ni implémentation sans outil.
    const catalogued = toolRegistry.all().map((tool) => tool.id).sort();
    const implemented = [...implementedToolIds()].sort();
    expect(catalogued).toEqual(implemented);
  });

  it("construit des routes cohérentes", () => {
    expect(toolRoute("pdf-compress")).toBe("/tools/t/pdf-compress");
    expect(categoryRoute("pdf")).toBe("/tools/pdf");
  });
});

describe("catégories", () => {
  it("n'a aucun identifiant ni ordre dupliqué", () => {
    const ids = CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const orders = CATEGORIES.map((c) => c.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("les trie par ordre croissant", () => {
    const orders = listCategories().map((c) => c.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});
