#!/usr/bin/env node
/**
 * Prépare les ressources OCR servies localement par l'application.
 *
 *  - `public/tesseract/` : le script du worker (tesseract.js) et le cœur
 *    WebAssembly (tesseract.js-core), copiés depuis node_modules ;
 *  - `public/tessdata/`  : les modèles de langue (français, anglais), au format
 *    `tessdata_fast`, téléchargés une seule fois s'ils sont absents.
 *
 * Comme pour pdf.js, tout est ensuite servi par FourTout lui-même : l'OCR
 * fonctionne 100 % hors ligne, sans dépendre d'un Tesseract installé sur la
 * machine ni d'un CDN. Lancé automatiquement avant `dev`, `build` et `test`.
 */
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE_SRC = join(ROOT, "node_modules", "tesseract.js-core");
const WORKER_SRC = join(ROOT, "node_modules", "tesseract.js", "dist", "worker.min.js");
const TESS_DIR = join(ROOT, "public", "tesseract");
const DATA_DIR = join(ROOT, "public", "tessdata");

// Cœurs LSTM (OEM 1) : variante SIMD + repli sans SIMD. On évite les variantes
// « legacy » plus lourdes dont FourTout n'a pas besoin.
// tesseract.js v6 charge la variante « single-file » (`*.wasm.js`), qui
// embarque le WebAssembly : aucune requête .wasm séparée, plus simple à servir.
const CORE_FILES = [
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-lstm.wasm.js",
];

// Modèles à embarquer. tessdata_fast : bon compromis taille/qualité.
const LANGUAGES = ["eng", "fra"];
const TESSDATA_BASE = "https://github.com/tesseract-ocr/tessdata_fast/raw/main";

mkdirSync(TESS_DIR, { recursive: true });
mkdirSync(DATA_DIR, { recursive: true });

if (!existsSync(CORE_SRC) || !existsSync(WORKER_SRC)) {
  console.error("tesseract.js / tesseract.js-core introuvables — lancez `pnpm install`.");
  process.exit(1);
}

copyFileSync(WORKER_SRC, join(TESS_DIR, "worker.min.js"));
for (const file of CORE_FILES) {
  const from = join(CORE_SRC, file);
  if (!existsSync(from)) {
    console.error(`Fichier cœur manquant : ${file}`);
    process.exit(1);
  }
  copyFileSync(from, join(TESS_DIR, file));
}
console.log("tesseract → public/tesseract/ (worker + cœur WebAssembly)");

let totalData = 0;
for (const lang of LANGUAGES) {
  const target = join(DATA_DIR, `${lang}.traineddata`);
  if (!existsSync(target)) {
    console.log(`Téléchargement du modèle ${lang}…`);
    const response = await fetch(`${TESSDATA_BASE}/${lang}.traineddata`);
    if (!response.ok) {
      console.error(`Échec du téléchargement de ${lang}.traineddata (${response.status}).`);
      console.error("Une connexion est requise une seule fois pour récupérer les modèles.");
      process.exit(1);
    }
    writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  }
  totalData += statSync(target).size;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
console.log(`tessdata → public/tessdata/ (${LANGUAGES.join(", ")}, ${mb(totalData)})`);
