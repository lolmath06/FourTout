#!/usr/bin/env node
/**
 * État des traductions, langue par langue :
 *
 *   pnpm i18n:status          tableau lisible
 *   pnpm i18n:status --json   même contenu, pour les tests
 *
 * Signale aussi un catalogue source périmé (`pnpm i18n:extract` oublié).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSourceCatalog } from "./source.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MESSAGES = join(ROOT, "src", "i18n", "messages");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));

const { catalog, shell, collisions } = buildSourceCatalog(ROOT);
const committed = read(join(MESSAGES, "fr.json"));
const ids = Object.keys(catalog);
const stale = {
  missing: ids.filter((id) => !(id in committed)),
  obsolete: Object.keys(committed).filter((id) => !(id in catalog)),
};

const locales = {};
for (const file of readdirSync(MESSAGES).sort()) {
  const code = file.replace(/\.json$/, "");
  if (code === "fr") continue;
  const messages = read(join(MESSAGES, file));
  const translated = ids.filter((id) => id in messages).length;
  locales[code] = {
    translated,
    total: ids.length,
    percent: Math.floor((translated / ids.length) * 1000) / 10,
    missingRequired: shell.filter((id) => !(id in messages)),
    unknown: Object.keys(messages).filter((id) => !(id in catalog)),
  };
}

const report = { total: ids.length, required: shell, stale, collisions, locales };

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(report));
} else {
  console.log(`${ids.length} messages source, dont ${shell.length} requis (socle de l'interface).`);
  if (stale.missing.length || stale.obsolete.length) {
    console.log(
      `Catalogue source périmé : ${stale.missing.length} nouveaux, ${stale.obsolete.length} disparus — lancez pnpm i18n:extract.`,
    );
  }
  for (const [code, entry] of Object.entries(locales)) {
    const flags = [
      entry.missingRequired.length ? `${entry.missingRequired.length} requis manquants` : "",
      entry.unknown.length ? `${entry.unknown.length} inconnus` : "",
    ].filter(Boolean);
    console.log(
      `${code.padEnd(6)} ${String(entry.percent).padStart(5)} %  ${entry.translated}/${entry.total}${flags.length ? `  (${flags.join(", ")})` : ""}`,
    );
  }
}
