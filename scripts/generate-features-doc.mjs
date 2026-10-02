#!/usr/bin/env node
/**
 * Regenerates the English and French feature indexes from the tool registry.
 *
 * La liste était tenue à la main, et elle avait dérivé : des notes y
 * annonçaient encore comme absentes des fonctions livrées depuis. Un catalogue
 * de cent soixante-dix outils ne se recopie pas sans se tromper — il se
 * dérive. Seules l'introduction et la note finale restent rédigées à la main :
 * elles sont conservées telles quelles entre les marqueurs.
 *
 * Usage : `pnpm docs:features`
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = {
  en: join(ROOT, "docs", "guides", "FEATURES.md"),
  fr: join(ROOT, "docs", "fr", "guides", "FEATURES.md"),
};
const englishCatalog = JSON.parse(
  readFileSync(join(ROOT, "src", "i18n", "catalog", "en.json"), "utf8"),
);

// Le catalogue est du TypeScript : on le charge via le transpileur de Vite,
// qui est déjà une dépendance du projet — aucun outil supplémentaire.
const { createServer } = await import("vite");
const server = await createServer({
  root: ROOT,
  configFile: join(ROOT, "vite.config.ts"),
  server: { middlewareMode: true },
  logLevel: "error",
});
const { ALL_TOOLS } = await server.ssrLoadModule("/src/core/tools/catalog/index.ts");
const { CATEGORIES } = await server.ssrLoadModule("/src/core/tools/categories.ts");
await server.close();

const ordered = [...CATEGORIES].sort((a, b) => a.order - b.order);
// Un outil n'est listé que dans sa catégorie **propriétaire** : ses
// rattachements secondaires sont signalés en fin de ligne, pas dupliqués en
// entrée. Sans quoi la liste compterait cent soixante-quatorze outils pour
// deux cent quarante lignes.
const byCategory = new Map(
  ordered.map((category) => [
    category.id,
    ALL_TOOLS.filter((tool) => tool.category === category.id),
  ]),
);
const sourceCategory = (category) => ({
  name: category.name,
  description: category.description,
});
const englishCategory = (category) => englishCatalog.categories[category.id] ?? sourceCategory(category);
const sourceTool = (tool) => ({ name: tool.name, description: tool.description, note: tool.note });
const englishTool = (tool) => englishCatalog.tools[tool.id] ?? sourceTool(tool);

/**
 * Ancre GitHub d'un titre.
 *
 * GitHub garde les lettres accentuées, retire la ponctuation et remplace
 * **chaque** espace par un tiret — « Fichiers & Archives (16) » devient donc
 * `fichiers--archives-16`, avec deux tirets là où l'esperluette a disparu.
 */
function anchor(title) {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

function generatedLines(locale) {
  const categoryText = locale === "en" ? englishCategory : sourceCategory;
  const toolText = locale === "en" ? englishTool : sourceTool;
  const lines = [];
  lines.push(locale === "en" ? "## Contents" : "## Sommaire", "");
  for (const category of ordered) {
    const text = categoryText(category);
    const count = byCategory.get(category.id).length;
    lines.push(`- [${text.name}](#${anchor(`${text.name} ${count}`)})`);
  }
  lines.push("", "---", "");

  for (const category of ordered) {
    const tools = byCategory.get(category.id);
    const categoryCopy = categoryText(category);
    lines.push(`### ${categoryCopy.name} (${tools.length})`, "", `_${categoryCopy.description}_`, "");
    for (const tool of tools) {
      const copy = toolText(tool);
      const elsewhere = (tool.alsoIn ?? []).map((id) => `*${categoryText(ordered.find((item) => item.id === id)).name}*`);
      const also = elsewhere.length > 0
        ? locale === "en"
          ? ` · also in ${elsewhere.join(" and ")}`
          : ` · aussi dans ${elsewhere.join(" et ")}`
        : "";
      lines.push(`- **${copy.name}** — ${copy.description}${also}`);
      if (copy.note) lines.push(`  <br>_${copy.note}_`);
    }
    lines.push("");
  }
  return lines;
}

const BEGIN = "<!-- OUTILS:DÉBUT -->";
const END = "<!-- OUTILS:FIN -->";
for (const [locale, target] of Object.entries(TARGETS)) {
  const current = readFileSync(target, "utf8");
  if (!current.includes(BEGIN) || !current.includes(END)) {
    throw new Error(`Missing ${BEGIN} / ${END} markers in ${target}.`);
  }
  const head = current.slice(0, current.indexOf(BEGIN) + BEGIN.length);
  const tail = current.slice(current.indexOf(END));
  let updated = `${head}\n\n${generatedLines(locale).join("\n").trimEnd()}\n\n${tail}`;
  if (locale === "en") {
    updated = updated.replace(/^\d+ tools across \d+ categories\./m, `${ALL_TOOLS.length} tools across ${ordered.length} categories.`);
  } else {
    const words = ["zéro", "une", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix"];
    updated = updated.replace(/^\d+ outils, répartis en \w+ catégories\./m, `${ALL_TOOLS.length} outils, répartis en ${words[ordered.length] ?? ordered.length} catégories.`);
  }
  writeFileSync(target, updated);
  console.log(`${target} regenerated: ${ALL_TOOLS.length} tools, ${ordered.length} categories.`);
}
export {};
