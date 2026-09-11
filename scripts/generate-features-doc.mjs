#!/usr/bin/env node
/**
 * Régénère `docs/guides/FEATURES.md` à partir du **registre des outils**.
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
const TARGET = join(ROOT, "docs", "guides", "FEATURES.md");

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
const nameOf = (id) => ordered.find((category) => category.id === id)?.name ?? id;

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

const lines = [];
lines.push("## Sommaire", "");
for (const category of ordered) {
  const count = byCategory.get(category.id).length;
  lines.push(`- [${category.name}](#${anchor(`${category.name} ${count}`)})`);
}
lines.push("", "---", "");

for (const category of ordered) {
  const tools = byCategory.get(category.id);
  lines.push(`### ${category.name} (${tools.length})`, "", `_${category.description}_`, "");
  for (const tool of tools) {
    // Un outil rattaché ailleurs est signalé là où on pourrait le chercher.
    const elsewhere = (tool.alsoIn ?? []).map((id) => `*${nameOf(id)}*`);
    const also = elsewhere.length > 0 ? ` · aussi dans ${elsewhere.join(" et ")}` : "";
    lines.push(`- **${tool.name}** — ${tool.description}${also}`);
    if (tool.note) lines.push(`  <br>_${tool.note}_`);
  }
  lines.push("");
}

const BEGIN = "<!-- OUTILS:DÉBUT -->";
const END = "<!-- OUTILS:FIN -->";
const current = readFileSync(TARGET, "utf8");
if (!current.includes(BEGIN) || !current.includes(END)) {
  throw new Error(
    `Les marqueurs ${BEGIN} / ${END} sont absents de ${TARGET} : impossible de savoir quoi remplacer.`,
  );
}

const head = current.slice(0, current.indexOf(BEGIN) + BEGIN.length);
const tail = current.slice(current.indexOf(END));
const updated = `${head}\n\n${lines.join("\n").trimEnd()}\n\n${tail}`.replace(
  /^(\d+|[A-Z][^\n]*?)\d+ outils, répartis/m,
  (match) => match,
);

writeFileSync(
  TARGET,
  updated.replace(/^\d+ outils, répartis en \w+ catégories\./m, () => {
    const words = [
      "zéro", "une", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix",
    ];
    return `${ALL_TOOLS.length} outils, répartis en ${words[ordered.length] ?? ordered.length} catégories.`;
  }),
);

console.log(`${TARGET} régénéré : ${ALL_TOOLS.length} outils, ${ordered.length} catégories.`);
export {};
