import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { routes } from "@/app/routes";
import { toolRegistry } from "@/core/tools/registry";
import { CATEGORIES } from "@/core/tools/categories";
import sourceMessages from "./messages/fr.json";
import { applyLocale, registerCatalog, type CatalogTranslation } from "./runtime";
import { LOCALES } from "./locales";
import { APP_TIMEOUT } from "@/test/timeouts";

/**
 * Chaînes visibles qui échapperaient à la traduction.
 *
 * Pseudo-localisation : chaque message connu est remplacé par lui-même entre
 * ⟦ ⟧, puis chaque page et chaque outil sont rendus. Tout texte visible —
 * contenu, `title`, `aria-label`, `placeholder`, `alt` — qui ressemble encore
 * à du français **hors** de ces marques est une chaîne codée en dur : elle ne
 * passe ni par `t()`, ni par le catalogue.
 *
 * Seul l'écran initial de chaque outil est observé : les résultats dépendent
 * des fichiers fournis. Les exceptions légitimes sont listées, et justifiées,
 * dans `ALLOWED`.
 */

const OPEN = "⟦";
const CLOSE = "⟧";

/**
 * Textes admis à l'écran, quelle que soit la langue.
 *
 * - les noms des langues, écrits dans leur propre langue par le sélecteur
 *   (« Português (Brasil) », « Türkçe ») : c'est voulu, chacun doit pouvoir
 *   retrouver la sienne.
 */
const ALLOWED: RegExp[] = [
  new RegExp(`^(${LOCALES.map((locale) => locale.nativeName.replace(/[()]/g, "\\$&")).join("|")})$`),
];

const FRENCH =
  /[àâçéèêëîïôûùüÿœ]|\b(le|la|les|une|des|du|vos|votre|est|pour|avec|sans|aucun|fichier|fichiers|dossier|et|ou|dans|sur|par)\b/i;

function pseudo(): { messages: Record<string, string>; catalog: CatalogTranslation } {
  const messages: Record<string, string> = {};
  for (const [id, source] of Object.entries(sourceMessages as Record<string, string>)) {
    // Les marques entrent aussi dans chaque balise : le contenu d'un
    // `<strong>` est traduit avec la phrase qui l'entoure.
    const marked = source.replace(/<(\d+)>/g, `<$1>${OPEN}`).replace(/<\/(\d+)>/g, `${CLOSE}</$1>`);
    messages[id] = `${OPEN}${marked}${CLOSE}`;
  }
  const catalog: CatalogTranslation = { categories: {}, tools: {} };
  for (const category of CATEGORIES) {
    catalog.categories[category.id] = {
      name: `${OPEN}${category.name}${CLOSE}`,
      description: `${OPEN}${category.description}${CLOSE}`,
    };
  }
  for (const tool of toolRegistry.all()) {
    catalog.tools[tool.id] = {
      name: `${OPEN}${tool.name}${CLOSE}`,
      description: `${OPEN}${tool.description}${CLOSE}`,
      ...(tool.note ? { note: `${OPEN}${tool.note}${CLOSE}` } : {}),
    };
  }
  return { messages, catalog };
}

/** Retire les segments marqués, y compris imbriqués. */
function unmarked(text: string): string {
  let current = text;
  for (;;) {
    const next = current.replace(/⟦[^⟦⟧]*⟧/g, " ");
    if (next === current) return current;
    current = next;
  }
}

function leaks(root: HTMLElement): string[] {
  const found = new Set<string>();
  const check = (value: string | null) => {
    if (!value) return;
    const rest = unmarked(value).replace(/\s+/g, " ").trim();
    if (rest && FRENCH.test(rest) && !ALLOWED.some((pattern) => pattern.test(rest))) {
      found.add(rest.slice(0, 120));
    }
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.currentNode as Element | null; node; node = walker.nextNode() as Element | null) {
    if (node.tagName === "SCRIPT" || node.tagName === "STYLE") continue;
    // Texte propre à l'élément (pas celui de ses enfants, déjà parcourus).
    const own = [...node.childNodes]
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent ?? "")
      .join("");
    check(own);
    for (const attribute of ["title", "aria-label", "placeholder", "alt", "aria-description"]) {
      check(node.getAttribute(attribute));
    }
  }
  return [...found];
}

async function screenOf(path: string, ready: (root: HTMLElement) => boolean): Promise<string[]> {
  const { container } = render(
    <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />,
  );
  await waitFor(() => expect(ready(container)).toBe(true), { timeout: APP_TIMEOUT });
  // Laisse les effets de premier rendu (détections, chargements) se poser.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const result = leaks(container);
  if (process.env.I18N_AUDIT_OUT) {
    const { appendFileSync } = await import("node:fs");
    for (const leak of result) appendFileSync(process.env.I18N_AUDIT_OUT, `${path}\t${leak}\n`);
  }
  cleanup();
  return result;
}

describe("aucune chaîne visible n'échappe à la traduction", () => {
  beforeAll(() => {
    const { messages, catalog } = pseudo();
    registerCatalog("en", messages, catalog);
    applyLocale("en");
  });
  afterAll(() => applyLocale("fr"));

  const pages = ["/", "/tools", "/favorites", "/recents", "/settings", ...CATEGORIES.map((c) => `/tools/${c.id}`)];
  it.each(pages)("page %s", async (path) => {
    const found = await screenOf(path, (root) => root.querySelector("h1, h2") !== null);
    expect(found, `chaînes non traduites :\n${found.join("\n")}`).toEqual([]);
  });

  it.each(toolRegistry.all().map((tool) => tool.id))(
    "outil %s",
    async (id) => {
      const found = await screenOf(`/tools/t/${id}`, (root) =>
        (root.querySelector("h1")?.textContent ?? "").startsWith(OPEN),
      );
      expect(found, `chaînes non traduites :\n${found.join("\n")}`).toEqual([]);
    },
    APP_TIMEOUT * 2,
  );
});
