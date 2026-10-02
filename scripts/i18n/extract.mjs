#!/usr/bin/env node
/**
 * Régénère `src/i18n/messages/fr.json`, le catalogue source de l'interface,
 * à partir du code. À lancer après avoir ajouté ou modifié un message :
 *
 *   pnpm i18n:extract
 *
 * Puis `pnpm i18n:status` liste ce qu'il reste à traduire, langue par langue.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSourceCatalog } from "./source.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { catalog, native, dynamic, collisions } = buildSourceCatalog(ROOT);

for (const [id, first, second] of collisions) {
  console.error(`Collision d'empreinte ${id} :\n  ${first}\n  ${second}`);
}
if (collisions.length > 0) process.exit(1);

// Messages du socle natif (Rust) : reconnus à l'affichage par leur gabarit.
writeFileSync(join(ROOT, "src", "i18n", "native.json"), `${JSON.stringify(native, null, 2)}\n`);
writeFileSync(
  join(ROOT, "src", "i18n", "messages", "fr.json"),
  `${JSON.stringify(catalog, null, 2)}\n`,
);
console.log(
  `${Object.keys(catalog).length} messages (dont ${native.length} du socle natif) → src/i18n/messages/fr.json`,
);
if (dynamic.length > 0) {
  console.log(`${dynamic.length} appels à texte non littéral (traduits au rendu par tx/t) :`);
  for (const where of dynamic.slice(0, 20)) console.log(`  ${where}`);
}
