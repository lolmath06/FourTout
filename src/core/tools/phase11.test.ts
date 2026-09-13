import { describe, expect, it } from "vitest";
import { toolRegistry } from "./registry";
import { searchTools } from "./search";
import { getCategory, listCategories } from "./categories";
import { TOOL_IMPLEMENTATIONS } from "@/tools/implementations";

/**
 * Ce que la phase 11 ajoute au catalogue, et ce qu'on doit pouvoir taper pour
 * le retrouver.
 *
 * La recherche est écrite sans accents dans plusieurs cas, à dessein : c'est
 * ainsi que les gens tapent, et un catalogue qui exige « intérêts composés »
 * pour trouver l'outil d'intérêts composés n'est pas trouvable.
 */
const NEW_TOOLS = [
  "toml-format",
  "base32",
  "sqlite-explorer",
  "calc-timezone",
  "calc-bandwidth",
  "calc-transfer-time",
  "calc-interest",
  "network-ping",
  "network-ports",
  "network-lan",
];

/** Requête → outil qui doit arriver en tête. */
const QUERIES: [string, string][] = [
  ["toml", "toml-format"],
  ["formater toml", "toml-format"],
  ["valider toml", "toml-format"],
  ["base32", "base32"],
  ["encoder en base32", "base32"],
  ["sqlite", "sqlite-explorer"],
  ["base sqlite", "sqlite-explorer"],
  ["explorer une base de données", "sqlite-explorer"],
  ["fuseau horaire", "calc-timezone"],
  ["timezone", "calc-timezone"],
  ["heure paris tokyo", "calc-timezone"],
  ["bande passante", "calc-bandwidth"],
  ["debit", "calc-bandwidth"],
  ["temps transfert", "calc-transfer-time"],
  ["temps de transfert", "calc-transfer-time"],
  ["interets composes", "calc-interest"],
  ["calculer des interets", "calc-interest"],
  ["ping", "network-ping"],
  ["tester port", "network-ports"],
  ["port tcp", "network-ports"],
  ["reseau local", "network-lan"],
  ["lan", "network-lan"],
  ["scanner réseau local", "network-lan"],
];

describe("catalogue de la phase 11", () => {
  it("enregistre les dix outils et leur implémentation", () => {
    for (const id of NEW_TOOLS) {
      const tool = toolRegistry.get(id);
      expect(tool, `outil absent du catalogue : ${id}`).toBeDefined();
      expect(TOOL_IMPLEMENTATIONS[id], `implémentation absente : ${id}`).toBeDefined();
    }
  });

  it("ajoute la catégorie Réseau, à sa place dans l'ordre d'affichage", () => {
    const network = getCategory("network");
    expect(network?.name).toBe("Réseau");
    const order = listCategories().map((category) => category.id);
    expect(order.indexOf("network")).toBeGreaterThan(order.indexOf("calculators"));
    expect(order.indexOf("network")).toBeLessThan(order.indexOf("security"));
  });

  it("range la vérification JWT dans l'outil existant, sans en créer un second", () => {
    const jwtTools = toolRegistry.all().filter((tool) => tool.id.includes("jwt"));
    expect(jwtTools.map((tool) => tool.id)).toEqual(["jwt-decode"]);
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

  it("n'annonce « local » sur aucun outil qui ouvre une connexion", () => {
    for (const id of ["network-ping", "network-ports", "network-lan"]) {
      const tool = toolRegistry.get(id)!;
      expect(tool.capabilities).toContain("network");
      expect(tool.capabilities).not.toContain("local");
      expect(tool.note, `note manquante : ${id}`).toBeTruthy();
    }
  });

  it("dit dans le catalogue ce que chaque outil ne garantit pas", () => {
    // Trois limites que l'utilisateur doit connaître avant d'ouvrir l'outil,
    // pas après : elles sont donc dans la note du catalogue.
    expect(toolRegistry.get("toml-format")!.note).toMatch(/commentaires/);
    expect(toolRegistry.get("sqlite-explorer")!.note).toMatch(/lecture seule/);
    expect(toolRegistry.get("calc-transfer-time")!.note).toMatch(/théorique/);
    expect(toolRegistry.get("calc-interest")!.note).toMatch(/pas conseil financier/);
    expect(toolRegistry.get("network-lan")!.note).toMatch(/256 adresses/);
  });
});
