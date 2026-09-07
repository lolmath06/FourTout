/**
 * Le runtime d'inférence est-il réellement livré ?
 *
 * Ce test existe à cause d'une panne réelle : `public/ort/` ne contenait que
 * le `.wasm`. ONNX Runtime charge d'abord une glu JavaScript
 * (`ort-wasm-simd-threaded.mjs`) qui instancie ensuite le binaire ; absente,
 * la requête tombait sur le repli SPA, qui répond `index.html` en `text/html`.
 * L'utilisateur voyait « 'text/html' is not a valid JavaScript MIME type »
 * puis « no available backend found » — deux messages qui ne nomment jamais le
 * fichier manquant.
 *
 * Toute la suite était verte : les tests d'inférence tournent sous Node, où
 * ONNX résout ses fichiers depuis `node_modules` et n'a que faire de
 * `public/`. Seule l'application réelle échouait. D'où ce test, qui regarde ce
 * qui est **servi**, et non ce qui s'importe.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ORT_RUNTIME_FILES } from "./segmentation";

const ROOT = process.cwd();
const PUBLIC_ORT = join(ROOT, "public", "ort");
const DIST_ORT = join(ROOT, "dist", "ort");
const PACKAGE_DIST = join(ROOT, "node_modules", "onnxruntime-web", "dist");

describe("runtime ONNX servi par l'application", () => {
  it("nomme les fichiers que la version installée fournit réellement", () => {
    // Si onnxruntime-web renomme ses artefacts lors d'une montée de version,
    // ce test tombe ici plutôt que chez l'utilisateur.
    for (const file of ORT_RUNTIME_FILES) {
      expect(existsSync(join(PACKAGE_DIST, file)), `${file} absent du paquet`).toBe(true);
    }
  });

  it("exige la glu JavaScript autant que le binaire", () => {
    // Le `.wasm` seul ne suffit pas : c'est exactement l'erreur d'origine.
    expect(ORT_RUNTIME_FILES.some((file) => file.endsWith(".mjs"))).toBe(true);
    expect(ORT_RUNTIME_FILES.some((file) => file.endsWith(".wasm"))).toBe(true);
  });

  it("copie les deux fichiers dans public/, à l'identique", () => {
    for (const file of ORT_RUNTIME_FILES) {
      const served = join(PUBLIC_ORT, file);
      expect(
        existsSync(served),
        `${file} manque dans public/ort/ — lancez \`pnpm onnx:assets\``,
      ).toBe(true);
      // Même taille que la source : un fichier tronqué ou remplacé par une
      // page HTML se verrait ici.
      expect(statSync(served).size).toBe(statSync(join(PACKAGE_DIST, file)).size);
    }
  });

  it("sert un vrai module JavaScript et un vrai binaire WebAssembly", () => {
    const glue = readFileSync(join(PUBLIC_ORT, "ort-wasm-simd-threaded.mjs"), "utf-8");
    // Du JavaScript, pas une page : le repli SPA commencerait par `<!doctype`.
    expect(glue.trimStart().startsWith("<")).toBe(false);
    expect(glue).toMatch(/export\s+default|export\{|export /);

    // En-tête WebAssembly : `\0asm` suivi de la version 1.
    const wasm = readFileSync(join(PUBLIC_ORT, "ort-wasm-simd-threaded.wasm"));
    expect(Array.from(wasm.subarray(0, 8))).toEqual([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
  });

  it.skipIf(!existsSync(DIST_ORT))(
    "les retrouve dans le build de production",
    () => {
      // `dist/` n'existe qu'après `pnpm build` ; ailleurs, ce contrôle est
      // ignoré plutôt que faussement rassurant.
      for (const file of ORT_RUNTIME_FILES) {
        const built = join(DIST_ORT, file);
        expect(existsSync(built), `${file} manque dans dist/ort/`).toBe(true);
        expect(statSync(built).size).toBe(statSync(join(PACKAGE_DIST, file)).size);
      }
    },
  );
});
