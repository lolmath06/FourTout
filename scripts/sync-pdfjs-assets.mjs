#!/usr/bin/env node
/**
 * Copie les ressources de pdf.js dans `public/pdfjs/`.
 *
 * pdf.js a besoin de deux jeux de fichiers pour rendre correctement un PDF :
 *  - `standard_fonts/` : les 14 polices standard PDF, quand le document ne les
 *    embarque pas (cas très fréquent) ;
 *  - `cmaps/` : les tables de correspondance des textes CJK.
 *
 * Ils sont servis depuis l'application elle-même : FourTout ne va jamais les
 * chercher sur un CDN, conformément au principe local-first.
 *
 * Lancé automatiquement avant `dev`, `build` et `test`.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "node_modules", "pdfjs-dist");
const TARGET = join(ROOT, "public", "pdfjs");

if (!existsSync(SOURCE)) {
  console.error("pdfjs-dist introuvable — lancez `pnpm install` d'abord.");
  process.exit(1);
}

mkdirSync(TARGET, { recursive: true });

for (const folder of ["standard_fonts", "cmaps"]) {
  const from = join(SOURCE, folder);
  const to = join(TARGET, folder);
  if (!existsSync(from)) {
    console.error(`Ressource pdf.js manquante : ${folder}`);
    process.exit(1);
  }
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  console.log(`pdf.js → public/pdfjs/${folder}`);
}
