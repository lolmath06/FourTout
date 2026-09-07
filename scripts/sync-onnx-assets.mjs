#!/usr/bin/env node
/**
 * Prépare le moteur d'inférence ONNX servi localement par l'application.
 *
 * `public/ort/` reçoit le runtime d'ONNX Runtime Web, copié depuis
 * node_modules. Il sert à un seul outil, « Retirer l'arrière-plan », qui
 * exécute son modèle de segmentation **sur la machine** : aucune image n'est
 * envoyée nulle part, contrairement aux services en ligne équivalents.
 *
 * # Deux fichiers, pas un
 *
 * Le `.wasm` ne suffit pas. ONNX Runtime charge d'abord une **glu JavaScript**
 * — `ort-wasm-simd-threaded.mjs` — par un `import()` dynamique, et c'est elle
 * qui instancie ensuite le `.wasm`. Si ce `.mjs` manque, la requête tombe sur
 * le repli SPA, qui répond `index.html` en `text/html`, et le moteur échoue
 * sur « 'text/html' is not a valid JavaScript MIME type », puis « no available
 * backend found ». L'erreur ne nomme jamais le fichier manquant : d'où ce
 * commentaire.
 *
 * Seule la variante mono-fil est copiée : le multi-fil exige
 * `SharedArrayBuffer`, donc des en-têtes d'isolation d'origine que FourTout ne
 * sert pas. Les variantes JSEP, Asyncify et JSPI pèsent 16 à 28 Mo chacune et
 * ne servent qu'à WebGPU, que FourTout n'utilise pas.
 *
 * Lancé automatiquement avant `dev`, `build` et `test`.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "node_modules", "onnxruntime-web", "dist");
const OUT = join(ROOT, "public", "ort");

/**
 * Les deux fichiers du runtime par défaut, tels que les nomme ONNX Runtime.
 *
 * Ces noms sont ceux que la bibliothèque demande d'elle-même : ils sont donc
 * partagés avec le code applicatif et avec le test de non-régression, pour que
 * les trois ne puissent pas diverger.
 */
export const ORT_RUNTIME_FILES = [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
];

/** Copie le runtime, et échoue bruyamment si un fichier manque. */
export function syncOnnxAssets({ quiet = false } = {}) {
  if (!existsSync(SRC)) {
    throw new Error("onnxruntime-web introuvable — lancez `pnpm install`.");
  }
  mkdirSync(OUT, { recursive: true });

  for (const file of ORT_RUNTIME_FILES) {
    const from = join(SRC, file);
    if (!existsSync(from)) {
      throw new Error(
        `Fichier ONNX Runtime manquant : ${file}. La version installée ` +
          "d'onnxruntime-web ne porte pas ce nom — vérifiez `dist/` avant de " +
          "mettre à jour la liste.",
      );
    }
    copyFileSync(from, join(OUT, file));
    if (!quiet) {
      const size = (statSync(from).size / 1024 / 1024).toFixed(1);
      console.log(`onnxruntime → public/ort/${file} (${size} Mo)`);
    }
  }
  return ORT_RUNTIME_FILES;
}

// Exécution directe (`node scripts/sync-onnx-assets.mjs`), par opposition à un
// import depuis un test.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    syncOnnxAssets();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
