#!/usr/bin/env node
/* global document -- code évalué dans la page par Playwright */
/**
 * Bannière, aperçu social et exports allégés des captures.
 *
 * La bannière et l'aperçu social sont des pages HTML rendues par Chromium :
 * le logo est celui de `docs/assets/branding/`, la police est Inter (celle de
 * l'interface), et la seule interface montrée est une **vraie capture**
 * produite par `capture.mjs`. Les chiffres sont lus dans le registre des
 * outils, jamais recopiés.
 *
 * Entrées : `showcase-output/raw/*.png` (capture.mjs, native-capture.sh)
 * Sorties :
 *   docs/assets/branding/fourtout-hero.webp           2400 × 1080
 *   docs/assets/branding/fourtout-social-preview.png  1280 × 640
 *   docs/assets/screenshots/<scène>-<thème>.webp      1440 × 900
 *
 * Prérequis : FFmpeg (encodeur libwebp) dans le PATH.
 * Usage : `node scripts/showcase/branding.mjs`
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { BRANDING, CHROMIUM, OUTPUT, RAW, SCREENSHOTS } from "./paths.mjs";
import { catalogCounts } from "./counts.mjs";

/** Captures publiées dans le README, dans l'ordre de la galerie. */
export const GALLERY = ["accueil", "recherche", "pdf", "images", "fichiers", "media", "developpeur", "diagnostic"];

const ffmpeg = (...args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);
const dataUri = (file, type = "image/png") =>
  `data:${type};base64,${readFileSync(file).toString("base64")}`;

// ------------------------------------------------------------ captures

function exportScreenshots() {
  mkdirSync(SCREENSHOTS, { recursive: true });
  for (const scene of GALLERY) {
    for (const theme of ["light", "dark"]) {
      const source = join(RAW, `${scene}-${theme}.png`);
      if (!existsSync(source)) throw new Error(`Capture manquante : ${source} (lancez capture.mjs)`);
      ffmpeg(
        "-i", source,
        "-vf", "scale=1440:900:flags=lanczos",
        "-c:v", "libwebp", "-quality", "90", "-compression_level", "6",
        "-map_metadata", "-1",
        join(SCREENSHOTS, `${scene}-${theme}.webp`),
      );
    }
  }
}

// ------------------------------------------------------------ gabarits

const BRAND = {
  navyTop: "#132a44",
  navy: "#0b1a2e",
  navyDeep: "#060f1d",
  blue: "#0a84ff",
  blueSoft: "#5fb0ff",
  text: "#f4f7fb",
  muted: "#9fb0c6",
};

const baseCss = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; }
  body {
    font-family: "Inter", system-ui, sans-serif;
    color: ${BRAND.text};
    background:
      radial-gradient(1200px 700px at 78% 30%, rgba(10, 132, 255, 0.16), transparent 60%),
      radial-gradient(900px 600px at 10% 110%, rgba(10, 132, 255, 0.08), transparent 60%),
      linear-gradient(160deg, ${BRAND.navyTop} 0%, ${BRAND.navy} 45%, ${BRAND.navyDeep} 100%);
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
  }
  .grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
    background-size: 48px 48px;
    mask-image: radial-gradient(ellipse at 30% 40%, black 20%, transparent 75%);
  }
  .shot {
    position: absolute;
    border-radius: 14px;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,0.10);
    box-shadow: 0 40px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(0,0,0,0.4);
  }
  .shot img { display: block; width: 100%; height: auto; }
  .dot { color: ${BRAND.blue}; }
  .chips { display: flex; gap: 10px; flex-wrap: wrap; }
  .chip {
    border: 1px solid rgba(159, 176, 198, 0.28);
    background: rgba(255,255,255,0.04);
    color: #d5deea;
    border-radius: 999px;
    font-weight: 500;
    white-space: nowrap;
  }
`;

function heroHtml({ tools, categories, shot }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    ${baseCss}
    .copy { position: absolute; left: 88px; top: 0; bottom: 0; width: 470px;
            display: flex; flex-direction: column; justify-content: center; }
    .brand { display: flex; align-items: center; gap: 18px; margin-bottom: 30px; }
    .brand img { width: 76px; height: 76px; border-radius: 18px; }
    .brand span { font-size: 54px; font-weight: 700; letter-spacing: -1.5px; }
    h1 { font-size: 38px; line-height: 1.18; font-weight: 600; letter-spacing: -0.8px; }
    h1 .muted { color: ${BRAND.muted}; font-weight: 500; }
    .chips { margin-top: 30px; }
    .chip { font-size: 15px; padding: 7px 14px; }
    .shot { left: 620px; top: 84px; width: 1080px;
            -webkit-mask-image: linear-gradient(to bottom, black 62%, transparent 92%); }
  </style></head><body>
    <div class="grid"></div>
    <div class="copy">
      <div class="brand"><img src="${dataUri(join(BRANDING, "fourtout-icon-1024.png"))}"><span>FourTout</span></div>
      <h1>${tools} tools.<br>${categories} categories.<br><span class="muted">One local desktop app.</span></h1>
      <div class="chips"><span class="chip">Windows</span><span class="chip">Linux</span><span class="chip">Local-first</span></div>
    </div>
    <div class="shot"><img src="${shot}"></div>
  </body></html>`;
}

function socialHtml({ tools, categories, shot }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    ${baseCss}
    .copy { position: absolute; left: 72px; top: 0; bottom: 0; width: 560px;
            display: flex; flex-direction: column; justify-content: center; }
    .brand { display: flex; align-items: center; gap: 22px; margin-bottom: 34px; }
    .brand img { width: 104px; height: 104px; border-radius: 24px; }
    .brand span { font-size: 82px; font-weight: 700; letter-spacing: -2.5px; }
    .stats { font-size: 46px; font-weight: 600; line-height: 1.2; letter-spacing: -1px; }
    .chips { margin-top: 34px; gap: 12px; }
    .chip { font-size: 24px; padding: 9px 20px; }
    .shot { left: 690px; top: 96px; width: 820px;
            -webkit-mask-image: linear-gradient(to bottom, black 60%, transparent 95%); }
  </style></head><body>
    <div class="grid"></div>
    <div class="copy">
      <div class="brand"><img src="${dataUri(join(BRANDING, "fourtout-icon-1024.png"))}"><span>FourTout</span></div>
      <div class="stats">${tools} tools<br>${categories} categories</div>
      <div class="chips"><span class="chip">Windows + Linux</span><span class="chip">Local-first</span></div>
    </div>
    <div class="shot"><img src="${shot}"></div>
  </body></html>`;
}

async function render(browser, html, { width, height, scale, file }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file });
  await page.close();
}

async function main() {
  const counts = await catalogCounts();
  console.log(`Registre : ${counts.tools} outils, ${counts.categories} catégories`);
  exportScreenshots();
  console.log("✓ captures exportées (WebP 1440 × 900)");

  mkdirSync(BRANDING, { recursive: true });
  const shot = dataUri(join(RAW, "accueil-dark.png"));
  const browser = await chromium.launch({ executablePath: CHROMIUM });

  const heroPng = join(OUTPUT, "fourtout-hero.png");
  await render(browser, heroHtml({ ...counts, shot }), { width: 1600, height: 720, scale: 1.5, file: heroPng });
  ffmpeg(
    "-i", heroPng,
    "-c:v", "libwebp", "-quality", "88", "-compression_level", "6", "-map_metadata", "-1",
    join(BRANDING, "fourtout-hero.webp"),
  );
  console.log("✓ fourtout-hero.webp");

  await render(browser, socialHtml({ ...counts, shot }), {
    width: 1280,
    height: 640,
    scale: 1,
    file: join(BRANDING, "fourtout-social-preview.png"),
  });
  console.log("✓ fourtout-social-preview.png");

  await browser.close();
  rmSync(heroPng, { force: true });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
