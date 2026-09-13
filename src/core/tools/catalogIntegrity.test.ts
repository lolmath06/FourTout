import { describe, expect, it } from "vitest";
import { ALL_TOOLS } from "./catalog";
import { CATEGORIES, listCategories } from "./categories";
import { toolRegistry } from "./registry";
import { searchTools } from "./search";
import { toolRoute, categoryRoute } from "./types";
import { ICONS } from "@/components/ui/icons";
import { getToolComponent, TOOL_IMPLEMENTATIONS } from "@/tools/implementations";
import { handoffTargetIds, DIAGNOSTIC_SPECIALISTS } from "@/features/handoff/targets";

/**
 * Intégrité du catalogue, vérifiée par la machine plutôt que recomptée à la
 * main.
 *
 * Ce fichier existe parce que la documentation avait déjà dérivé une fois : un
 * guide annonçait quatre fichiers `.txt` là où il y en avait six. Un catalogue
 * de deux cents outils ne se vérifie pas à l'œil, et les chiffres écrits en dur
 * ailleurs doivent pouvoir être confrontés à une source unique.
 *
 * Les deux constantes ci-dessous sont donc **le** compte de référence du
 * produit. Les modifier volontairement est le geste qui accompagne l'ajout ou
 * le retrait d'un outil ; les voir changer sans qu'on l'ait voulu est un
 * signal.
 */
export const TOOL_COUNT = 196;
export const CATEGORY_COUNT = 12;

/** Formulations qui trahiraient une fonction annoncée mais absente. */
const PLACEHOLDER_PATTERNS = [
  /bient[oô]t/i,
  /coming soon/i,
  /à venir/i,
  /\bTODO\b/,
  /\bFIXME\b/,
  /lorem ipsum/i,
  /placeholder/i,
  /\bWIP\b/,
  /example\.com/i,
];

/**
 * Le générateur de faux texte s'appelle « Lorem Ipsum » : c'est son nom, pas un
 * reste de maquette. C'est la seule exception, et elle est nommée.
 */
const LEGITIMATE_LOREM = "lorem-ipsum";

function userVisibleText(): { where: string; text: string }[] {
  const entries: { where: string; text: string }[] = [];
  for (const tool of ALL_TOOLS) {
    entries.push({ where: `${tool.id}.name`, text: tool.name });
    entries.push({ where: `${tool.id}.description`, text: tool.description });
    if (tool.note) entries.push({ where: `${tool.id}.note`, text: tool.note });
  }
  for (const category of CATEGORIES) {
    entries.push({ where: `${category.id}.name`, text: category.name });
    entries.push({ where: `${category.id}.description`, text: category.description });
  }
  return entries;
}

describe("intégrité du catalogue", () => {
  it("compte exactement ce que la documentation annonce", () => {
    expect(ALL_TOOLS).toHaveLength(TOOL_COUNT);
    expect(CATEGORIES).toHaveLength(CATEGORY_COUNT);
  });

  it("n'a aucun identifiant en double", () => {
    const ids = ALL_TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    const categories = CATEGORIES.map((category) => category.id);
    expect(new Set(categories).size).toBe(categories.length);
  });

  it("n'a ni outil orphelin ni implémentation orpheline", () => {
    const catalogued = ALL_TOOLS.map((tool) => tool.id).sort();
    const implemented = Object.keys(TOOL_IMPLEMENTATIONS).sort();
    expect(catalogued).toEqual(implemented);
    // Et chaque identifiant résout réellement vers un composant.
    for (const tool of ALL_TOOLS) {
      expect(getToolComponent(tool.id), `composant introuvable : ${tool.id}`).toBeDefined();
    }
  });

  it("ne laisse aucune catégorie vide", () => {
    for (const category of listCategories()) {
      expect(
        toolRegistry.byCategoryId(category.id).length,
        `catégorie vide : ${category.id}`,
      ).toBeGreaterThan(0);
    }
  });

  it("ne référence que des catégories déclarées, y compris en secondaire", () => {
    const known = new Set(CATEGORIES.map((category) => category.id));
    for (const tool of ALL_TOOLS) {
      expect(known.has(tool.category), `${tool.id} → ${tool.category}`).toBe(true);
      for (const extra of tool.alsoIn ?? []) {
        expect(known.has(extra), `${tool.id} → alsoIn ${extra}`).toBe(true);
        expect(extra, `${tool.id} se range deux fois dans ${extra}`).not.toBe(tool.category);
      }
    }
  });

  it("n'emploie que des icônes réellement présentes au registre", () => {
    // `getIcon` retombe silencieusement sur une clé à molette : un nom d'icône
    // fautif ne se voit donc pas à l'écran, seulement ici.
    for (const tool of ALL_TOOLS) {
      expect(ICONS[tool.icon], `icône inconnue : ${tool.icon} (${tool.id})`).toBeDefined();
    }
    for (const category of CATEGORIES) {
      expect(
        ICONS[category.icon],
        `icône de catégorie inconnue : ${category.icon} (${category.id})`,
      ).toBeDefined();
    }
  });

  it("décrit des entrées, des sorties et des capacités exploitables", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.acceptedInputs.length, `entrées manquantes : ${tool.id}`).toBeGreaterThan(0);
      expect(tool.outputs.length, `sorties manquantes : ${tool.id}`).toBeGreaterThan(0);
      expect(tool.capabilities.length, `capacités manquantes : ${tool.id}`).toBeGreaterThan(0);
      for (const input of tool.acceptedInputs) {
        if (input.kind === "none") continue;
        expect(input.extensions.length, `extensions vides : ${tool.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("ne promet nulle part une fonction qui n'existe pas", () => {
    for (const { where, text } of userVisibleText()) {
      if (where.startsWith(LEGITIMATE_LOREM)) continue;
      for (const pattern of PLACEHOLDER_PATTERNS) {
        expect(pattern.test(text), `« ${pattern} » dans ${where} : ${text}`).toBe(false);
      }
    }
  });

  it("construit des routes uniques et bien formées", () => {
    const routes = ALL_TOOLS.map((tool) => toolRoute(tool.id));
    expect(new Set(routes).size).toBe(routes.length);
    for (const route of routes) expect(route).toMatch(/^\/tools\/t\/[a-z0-9-]+$/);
    for (const category of CATEGORIES) {
      expect(categoryRoute(category.id)).toMatch(/^\/tools\/[a-z0-9-]+$/);
    }
  });

  it("ne vise aucun outil inexistant depuis un passage de relais", () => {
    for (const id of handoffTargetIds()) {
      expect(toolRegistry.get(id), `relais mort : ${id}`).toBeDefined();
      expect(TOOL_IMPLEMENTATIONS[id], `relais sans implémentation : ${id}`).toBeDefined();
    }
    for (const [format, specialist] of Object.entries(DIAGNOSTIC_SPECIALISTS)) {
      expect(
        toolRegistry.get(specialist.tool),
        `spécialiste mort pour ${format} : ${specialist.tool}`,
      ).toBeDefined();
    }
  });

  it("garde des libellés et des descriptions dignes d'un produit fini", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.name.trim(), `nom vide : ${tool.id}`).not.toBe("");
      expect(tool.description.trim().length, `description trop courte : ${tool.id}`)
        .toBeGreaterThan(15);
      // Une description est une phrase, pas un titre répété.
      expect(tool.description, `description = nom : ${tool.id}`).not.toBe(tool.name);
    }
  });
});

describe("découvrabilité des 196 outils", () => {
  /**
   * Un outil que la recherche ne trouve pas n'existe pas pour l'utilisateur :
   * la page Outils compte douze catégories et deux cents entrées, personne ne
   * la parcourt à l'œil. Ces tests vérifient donc le minimum vital — le nom
   * propre de l'outil le remonte — plutôt que d'inventer des mots-clés.
   */
  it("retrouve chaque outil par son nom exact", () => {
    for (const tool of ALL_TOOLS) {
      const results = searchTools(tool.name, { limit: 5 }).map((result) => result.tool.id);
      expect(results, `« ${tool.name} » ne remonte pas ${tool.id}`).toContain(tool.id);
    }
  });

  it("retrouve chaque outil sans les accents de son nom", () => {
    // C'est ainsi qu'on tape vite : « verifier », « recuperer », « telecharger ».
    for (const tool of ALL_TOOLS) {
      const plain = tool.name.normalize("NFD").replace(/[̀-ͯ]/g, "");
      const results = searchTools(plain, { limit: 5 }).map((result) => result.tool.id);
      expect(results, `« ${plain} » ne remonte pas ${tool.id}`).toContain(tool.id);
    }
  });

  it("retrouve chaque outil par au moins un de ses alias", () => {
    for (const tool of ALL_TOOLS) {
      if (!tool.aliases || tool.aliases.length === 0) continue;
      const found = tool.aliases.some((alias) =>
        searchTools(alias, { limit: 5 }).some((result) => result.tool.id === tool.id),
      );
      expect(found, `aucun alias ne remonte ${tool.id} : ${tool.aliases.join(", ")}`).toBe(true);
    }
  });

  it("retrouve chaque catégorie par son nom", () => {
    for (const category of CATEGORIES) {
      const results = searchTools(category.name, { limit: 8 });
      expect(results.length, `« ${category.name} » ne remonte rien`).toBeGreaterThan(0);
    }
  });
});
