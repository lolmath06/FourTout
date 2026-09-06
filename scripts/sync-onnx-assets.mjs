#!/usr/bin/env node
/**
 * Prépare le moteur d'inférence ONNX servi localement par l'application.
 *
 * `public/ort/` reçoit le binaire WebAssembly d'ONNX Runtime Web, copié depuis
 * node_modules. Il sert à un seul outil, « Retirer l'arrière-plan », qui exécute
 * son modèle de segmentation **sur la machine** : aucune image n'est envoyée
 * nulle part, contrairement aux services en ligne équivalents.
 *
 * Seule la variante mono-fil est copiée : le multi-fil exige `SharedArrayBuffer`,
 * donc des en-têtes d'isolation d'origine que FourTout ne sert pas — et les
 * fichiers correspondants pèsent plusieurs dizaines de mégaoctets pour rien.
 *
 * Lancé automatiquement avant `dev`, `build` et `test`.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "node_modules", "onnxruntime-web", "dist");
const OUT = join(ROOT, "public", "ort");

// `ort-wasm-simd-threaded.wasm` est le binaire mono-fil avec SIMD, malgré son
// nom : ONNX Runtime livre un seul artefact et décide du nombre de fils à
// l'exécution. FourTout le fixe à 1.
const FILES = ["ort-wasm-simd-threaded.wasm"];

if (!existsSync(SRC)) {
  console.error("onnxruntime-web introuvable — lancez `pnpm install`.");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

for (const file of FILES) {
  const from = join(SRC, file);
  if (!existsSync(from)) {
    console.error(`Fichier ONNX Runtime manquant : ${file}`);
    process.exit(1);
  }
  copyFileSync(from, join(OUT, file));
  const size = (statSync(from).size / 1024 / 1024).toFixed(1);
  console.log(`onnxruntime → public/ort/${file} (${size} Mo)`);
}
