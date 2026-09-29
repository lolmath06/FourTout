/**
 * Nombre d'outils et de catégories, lus dans le registre.
 *
 * Même méthode que `scripts/generate-features-doc.mjs` : le catalogue est du
 * TypeScript, chargé par le transpileur de Vite.
 */
import { join } from "node:path";
import { createServer } from "vite";
import { ROOT } from "./paths.mjs";

export async function catalogCounts() {
  const server = await createServer({
    root: ROOT,
    configFile: join(ROOT, "vite.config.ts"),
    server: { middlewareMode: true },
    // Pas de pré-analyse des dépendances : seul le catalogue est chargé.
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: "silent",
  });
  try {
    const { ALL_TOOLS } = await server.ssrLoadModule("/src/core/tools/catalog/index.ts");
    const { CATEGORIES } = await server.ssrLoadModule("/src/core/tools/categories.ts");
    return { tools: ALL_TOOLS.length, categories: CATEGORIES.length };
  } finally {
    await server.close();
  }
}
