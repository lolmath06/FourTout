import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_TOOLS } from "./catalog";
import { CATEGORIES } from "./categories";

/**
 * Les chiffres écrits dans la documentation doivent être **ceux du registre**.
 *
 * `docs/guides/FEATURES.md` est déjà dérivé (`pnpm docs:features`), mais une
 * poignée de pages annoncent le total en toutes lettres — la première ligne du
 * README, l'index de la documentation, la feuille de route. Ces chiffres ont
 * déjà dérivé : le README a annoncé 181 outils alors qu'il y en avait 191, et
 * un guide a annoncé onze catégories après la douzième.
 *
 * Ce test ne construit pas un moteur documentaire : il confronte simplement ce
 * qui est écrit à ce qui existe, et échoue si les deux divergent.
 */
const ROOT = process.cwd();
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const TOOLS = ALL_TOOLS.length;
const CATEGORY_COUNT = CATEGORIES.length;

/** Nombres écrits en lettres, tels que la documentation les emploie. */
const SPELLED: Record<number, string> = {
  10: "dix",
  11: "onze",
  12: "douze",
  13: "treize",
};

describe("les chiffres de la documentation suivent le registre", () => {
  it("le README annonce le bon nombre d'outils", () => {
    expect(read("README.md")).toContain(`${TOOLS} outils`);
  });

  it("l'index de la documentation annonce le bon nombre d'outils", () => {
    expect(read("docs/README.md")).toContain(`Les ${TOOLS} outils`);
  });

  it("la feuille de route annonce le bon nombre d'outils", () => {
    expect(read("ROADMAP.md")).toContain(`${TOOLS} outils`);
  });

  it("le journal des versions annonce le bon nombre d'outils et de catégories", () => {
    const changelog = read("CHANGELOG.md");
    expect(changelog).toContain(`**${TOOLS} outils, tous utilisables**`);
    expect(changelog).toContain(`réparti${TOOLS > 1 ? "s" : ""} en ${SPELLED[CATEGORY_COUNT]} catégories`);
  });

  it("la liste dérivée du registre est à jour", () => {
    // `pnpm docs:features` régénère ce fichier ; s'il annonce autre chose, il
    // n'a pas été régénéré depuis le dernier changement de catalogue.
    const features = read("docs/guides/FEATURES.md");
    expect(features).toContain(`${TOOLS} outils, répartis en ${CATEGORY_COUNT} catégories`);
    for (const category of CATEGORIES) {
      const count = ALL_TOOLS.filter(
        (tool) => tool.category === category.id,
      ).length;
      expect(features, `section manquante ou périmée : ${category.name}`).toContain(
        `### ${category.name} (${count})`,
      );
    }
  });

  it("le guide d'utilisation annonce le bon nombre de catégories", () => {
    expect(read("docs/guides/USER_GUIDE.md")).toContain(
      `les ${SPELLED[CATEGORY_COUNT]} catégories`,
    );
  });

  it("ne laisse traîner aucun ancien total dans les pages d'état actuel", () => {
    // Les totaux des étapes précédentes n'ont rien à faire dans une page qui
    // décrit le produit d'aujourd'hui. Le journal des versions, lui, a le droit
    // de raconter l'histoire — il n'est donc pas vérifié ici.
    const stale = [152, 160, 174, 181, 191].filter((count) => count !== TOOLS);
    for (const page of ["README.md", "docs/README.md", "ROADMAP.md", "docs/guides/FEATURES.md"]) {
      const text = read(page);
      for (const count of stale) {
        expect(text.includes(`${count} outils`), `« ${count} outils » dans ${page}`).toBe(false);
      }
    }
  });
});
