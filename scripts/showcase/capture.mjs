#!/usr/bin/env node
/* global document -- code évalué dans la page par Playwright */
/**
 * Captures du vrai frontend de FourTout.
 *
 * Le serveur Vite (`pnpm dev`) sert l'interface réelle ; Chromium headless la
 * pilote comme un utilisateur : il ouvre des outils, dépose des fichiers
 * fictifs (`fixtures.mjs`), tape une recherche. Aucune maquette : chaque image
 * est un rendu de l'application telle qu'elle est.
 *
 * Seuls les écrans qui fonctionnent dans l'aperçu navigateur sont capturés ici.
 * Les outils qui exigent le socle natif (empreintes, archives, FFmpeg,
 * diagnostic) sont capturés dans l'application installée par
 * `native-capture.sh`.
 *
 * Fenêtre : 1280 × 800, rendue en 2× → `showcase-output/raw/<scène>-<thème>.png`
 * (2560 × 1600). Les exports allégés sont produits par `branding.mjs`.
 *
 * Usage : `pnpm dev` dans un terminal, puis `node scripts/showcase/capture.mjs`
 * Options : `--only=accueil,pdf` · `--theme=dark|light`
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { APP_URL, CHROMIUM, FIXTURES, RAW } from "./paths.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")),
);
const only = args.only?.split(",");
const themes = args.theme ? [args.theme] : ["light", "dark"];

export const VIEWPORT = { width: 1280, height: 800 };

const fixture = (name) => join(FIXTURES, name);

async function open(page, route) {
  await page.goto(`${APP_URL}/#${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
}

async function settle(page, ms = 700, { keepFocus = false } = {}) {
  // Retire le focus et le curseur de saisie : ils n'ont rien à faire sur une
  // capture figée — sauf quand la saisie est le sujet (recherche).
  if (!keepFocus) await page.evaluate(() => document.activeElement?.blur());
  await page.mouse.move(VIEWPORT.width - 4, VIEWPORT.height - 4);
  await page.waitForTimeout(ms);
}

/** Prépare un historique crédible : quelques favoris, quelques récents. */
async function seedHistory(page) {
  const favorites = ["pdf-merge", "image-convert", "json-tools", "pdf-compress"];
  const recents = [
    "text-compare",
    "calc-timezone",
    "file-hash",
    "video-compress",
    "qr-generate",
    "pdf-compress",
    "image-convert",
    "pdf-merge",
  ];
  for (const id of recents) await open(page, `/tools/t/${id}`);
  for (const id of favorites) {
    await open(page, `/tools/t/${id}`);
    const star = page.getByRole("button", { name: "Ajouter aux favoris" });
    if (await star.count()) await star.first().click();
  }
  // Rechargement : les notifications « ajouté aux favoris » disparaissent,
  // les favoris et les récents restent (ils sont persistés).
  await page.reload({ waitUntil: "networkidle" });
}

/**
 * Les scènes. Chacune reçoit une page déjà préparée (historique semé) et
 * laisse l'écran dans l'état à capturer.
 */
export const SCENES = {
  async accueil(page) {
    await open(page, "/");
  },

  async recherche(page) {
    await open(page, "/");
    const input = page.getByLabel("Décrivez ce que vous voulez faire");
    await input.pressSequentially("réduire la taille d'une vidéo", { delay: 15 });
    await page.waitForTimeout(600);
  },

  async outils(page) {
    await open(page, "/tools");
  },

  async pdf(page) {
    await open(page, "/tools/t/pdf-merge");
    await page.locator('input[type="file"]').first().setInputFiles([
      fixture("rapport-annuel-exemple.pdf"),
      fixture("annexes-exemple.pdf"),
      fixture("presentation-exemple.pdf"),
    ]);
    await page.waitForTimeout(2500);
  },

  async images(page) {
    await open(page, "/tools/t/image-adjust");
    await page.locator('input[type="file"]').first().setInputFiles(fixture("paysage-exemple.jpg"));
    await page.waitForTimeout(1500);
    // Quelques réglages, au clavier, comme le ferait un utilisateur.
    const sliders = page.locator('input[type="range"]');
    for (const [index, steps] of [[1, 12], [2, 18]]) {
      await sliders.nth(index).focus();
      for (let i = 0; i < steps; i++) await page.keyboard.press("ArrowRight");
    }
    await page.waitForTimeout(1500);
  },

  async developpeur(page) {
    await open(page, "/tools/t/json-tools");
    await page.getByRole("button", { name: "Exemple" }).first().click();
    await page.waitForTimeout(800);
  },
};

async function main() {
  mkdirSync(RAW, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  for (const theme of themes) {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      colorScheme: theme,
      reducedMotion: "reduce",
      locale: "fr-FR",
      timezoneId: "Europe/Paris",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.warn(`  ! ${error.message}`));
    await seedHistory(page);
    for (const [name, scene] of Object.entries(SCENES)) {
      if (only && !only.includes(name)) continue;
      await scene(page);
      await settle(page, 700, { keepFocus: name === "recherche" });
      const file = join(RAW, `${name}-${theme}.png`);
      await page.screenshot({ path: file });
      console.log(`✓ ${name} (${theme})`);
    }
    await context.close();
  }
  await browser.close();
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
