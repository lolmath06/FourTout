/** Chemins partagés par les scripts de vitrine. */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const OUTPUT = join(ROOT, "showcase-output");
export const FIXTURES = join(OUTPUT, "fixtures");
/** Captures brutes, en pleine définition (2×), avant export. */
export const RAW = join(OUTPUT, "raw");
export const BRANDING = join(ROOT, "docs", "assets", "branding");
export const SCREENSHOTS = join(ROOT, "docs", "assets", "screenshots");
export const DEMO = join(ROOT, "docs", "assets", "demo");

/** URL du serveur Vite lancé par `pnpm dev`. */
export const APP_URL = process.env.FOURTOUT_URL ?? "http://localhost:1420";

/** Chromium utilisé par Playwright ; surchargeable pour un autre poste. */
export const CHROMIUM = process.env.CHROMIUM_PATH || undefined;
