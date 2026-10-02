#!/usr/bin/env node
/* global document, window -- code évalué dans la page par Playwright */
/**
 * Démo animée (WebP) et vidéo de présentation (MP4).
 *
 * 1. Enregistrement : Chromium pilote la vraie interface (`pnpm dev`) pendant
 *    qu'un screencast DevTools capture chaque image affichée. Aucune image
 *    n'est retouchée : ce que montre la vidéo est ce que l'interface a rendu.
 * 2. `docs/assets/demo/fourtout-demo.webp` : l'enregistrement, allégé.
 * 3. `showcase-output/FourTout-<version>-demo.mp4` : carton d'ouverture,
 *    enregistrement légendé, écrans de l'application native
 *    (`native-capture.sh`), carton de fin — 1920 × 1080, sans son.
 *
 * Prérequis : FFmpeg (libx264, libwebp) dans le PATH ; `fixtures.mjs`
 * déjà exécuté.
 * Usage : `pnpm dev` dans un terminal, puis `node scripts/showcase/demo.mjs`
 *
 * Version anglaise : `SHOWCASE_LANG=en` (fixtures et `native-capture.sh` lancés
 * avec la même variable). Même scénario, interface et fichiers en anglais ;
 * l'enregistrement est recalé chapitre par chapitre sur la chronologie de la
 * vidéo de référence, pour que les deux versions aient la même timeline.
 * Sorties suffixées `-en` : la version française n'est jamais écrasée.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { APP_URL, BRANDING, CHROMIUM, DEMO, FIXTURES, OUTPUT, RAW, ROOT } from "./paths.mjs";
import { catalogCounts } from "./counts.mjs";

const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const LANG = process.env.SHOWCASE_LANG === "en" ? "en" : "fr";
const SUFFIX = LANG === "fr" ? "" : `-${LANG}`;

/** Ce que la démo tape, clique et dépose, dans la langue de l'interface. */
const SCRIPT = {
  fr: {
    locale: "fr-FR",
    favorite: "Ajouter aux favoris",
    search: "Décrivez ce que vous voulez faire",
    // [texte, délai entre deux touches en ms]
    queries: [["réduire la taille d'une vidéo", 55], ["pdf en images", 55]],
    sliderStep: 45,
    tools: "Outils",
    example: "Exemple",
    pdfs: ["rapport-annuel-exemple.pdf", "annexes-exemple.pdf", "presentation-exemple.pdf"],
    image: "paysage-exemple.jpg",
    raw: RAW,
  },
  en: {
    locale: "en-US",
    favorite: "Add to favorites",
    search: "Describe what you want to do",
    // Délais réglés pour retrouver, à l'écran, les vitesses de la référence :
    // frappe des deux recherches (2,35 s et 0,99 s) et curseurs (2,42 s).
    queries: [["reduce the size of a video", 47], ["pdf to images", 29]],
    sliderStep: 36,
    tools: "Tools",
    example: "Example",
    pdfs: ["annual-report-sample.pdf", "appendices-sample.pdf", "presentation-sample.pdf"],
    image: "landscape-sample.jpg",
    raw: join(OUTPUT, "raw-en"),
  },
}[LANG];

/**
 * Chronologie de la vidéo de référence (`FourTout-1.0.0-demo.mp4`, française),
 * mesurée sur l'apparition de ses légendes : début de chaque chapitre et durée
 * de l'enregistrement, en secondes. Les autres langues s'y recalent.
 */
const REFERENCE = { marks: [1.19, 7.86, 11.42, 14.85, 20.02, 23.38], duration: 28.1333 };

const WORK = join(OUTPUT, `demo-work${SUFFIX}`);
const FRAMES = join(WORK, "frames");
const SESSION = join(WORK, "session.mp4");

const ffmpeg = (...args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);
const probeDuration = (file) =>
  Number(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file])
      .toString()
      .trim(),
  );
const fixture = (name) => join(FIXTURES, name);
const queryArgs = ([text, delay]) => [text, { delay }];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------- enregistrement

async function record() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1.5,
    colorScheme: "dark",
    locale: SCRIPT.locale,
    timezoneId: "Europe/Paris",
  });
  // Langue de l'interface choisie explicitement, comme dans les Réglages.
  await context.addInitScript((language) => {
    const key = "fourtout:settings";
    let settings = {};
    try {
      settings = JSON.parse(window.localStorage.getItem(key) ?? "{}") ?? {};
    } catch {
      settings = {};
    }
    window.localStorage.setItem(key, JSON.stringify({ ...settings, language }));
  }, LANG);
  const page = await context.newPage();
  const go = async (route) => {
    await page.evaluate((hash) => (window.location.hash = hash), route);
    await page.waitForLoadState("networkidle");
    await sleep(400);
  };

  // Historique crédible, comme pour les captures : favoris et récents.
  await page.goto(`${APP_URL}/#/`, { waitUntil: "networkidle" });
  for (const id of ["text-compare", "calc-timezone", "video-compress", "pdf-compress", "image-convert", "pdf-merge"]) {
    await go(`/tools/t/${id}`);
  }
  for (const id of ["pdf-merge", "image-convert", "json-tools"]) {
    await go(`/tools/t/${id}`);
    await page.getByRole("button", { name: SCRIPT.favorite }).first().click();
  }
  await page.goto(`${APP_URL}/#/`, { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(() => document.activeElement?.blur());
  await page.mouse.move(1270, 790);

  // Screencast : une image par rendu, horodatée par le navigateur.
  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const file = join(FRAMES, `${String(frames.length).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, t: metadata.timestamp });
    await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1200 });
  const start = Date.now() / 1000;
  /** Légendes de la vidéo : instant de début, en secondes depuis le départ. */
  const marks = [];
  const mark = (text) => marks.push({ text, at: Date.now() / 1000 - start });

  await sleep(1200);
  mark("Describe what you need");
  const search = page.getByLabel(SCRIPT.search);
  await search.click();
  await search.pressSequentially(...queryArgs(SCRIPT.queries[0]));
  await sleep(1800);
  await search.fill("");
  await search.pressSequentially(...queryArgs(SCRIPT.queries[1]));
  await sleep(1500);

  mark("Organized in categories");
  await page.getByRole("link", { name: SCRIPT.tools, exact: true }).click();
  await page.evaluate(() => document.activeElement?.blur());
  await sleep(2000);
  await page.getByRole("link", { name: /^PDF/ }).first().click();
  await sleep(1500);

  mark("PDF & documents");
  await go("/tools/t/pdf-merge");
  await sleep(600);
  await page.locator('input[type="file"]').first().setInputFiles(SCRIPT.pdfs.map(fixture));
  await sleep(2400);

  mark("Images, with live preview");
  await go("/tools/t/image-adjust");
  await page.locator('input[type="file"]').first().setInputFiles(fixture(SCRIPT.image));
  await page.waitForSelector('input[type="range"]', { timeout: 10000 });
  await sleep(1000);
  const sliders = page.locator('input[type="range"]');
  for (const [index, steps] of [[1, 14], [2, 22], [0, 6]]) {
    await sliders.nth(index).focus();
    for (let i = 0; i < steps; i++) {
      await page.keyboard.press("ArrowRight");
      await sleep(SCRIPT.sliderStep);
    }
  }
  await page.evaluate(() => document.activeElement?.blur());
  await sleep(1400);

  mark("Developer tools");
  await go("/tools/t/json-tools");
  await sleep(700);
  await page.getByRole("button", { name: SCRIPT.example }).first().click();
  await sleep(2200);

  mark("Files & archives");
  await go("/tools/files");
  await sleep(1200);
  await page.mouse.move(640, 500);
  await page.mouse.wheel(0, 500);
  await sleep(1600);

  await go("/");
  await page.evaluate(() => document.activeElement?.blur());
  await sleep(1500);

  await cdp.send("Page.stopScreencast");
  await browser.close();

  // Concat FFmpeg à durées variables : chaque image reste affichée jusqu'à
  // la suivante, comme à l'écran.
  const lines = ["ffconcat version 1.0"];
  frames.forEach((frame, i) => {
    const next = frames[i + 1]?.t ?? frame.t + 1;
    lines.push(`file '${frame.file}'`, `duration ${Math.max(0.001, next - frame.t).toFixed(4)}`);
  });
  lines.push(`file '${frames.at(-1).file}'`);
  const list = join(WORK, "frames.ffconcat");
  writeFileSync(list, lines.join("\n"));
  ffmpeg(
    "-f", "concat", "-safe", "0", "-i", list,
    "-vf", "fps=30,scale=1920:1200:flags=lanczos,format=yuv420p",
    "-c:v", "libx264", "-crf", "14", "-preset", "slow",
    SESSION,
  );
  // Les marques sont relatives au départ du screencast.
  const offset = frames[0].t - start;
  return marks.map((m) => ({ ...m, at: Math.max(0, m.at - offset) }));
}

// ------------------------------------------------------------ WebP animé

/** WebP du README : la vidéo MP4 finale, réduite à 1280 px de large et 15 i/s. */
function animatedWebp(mp4) {
  mkdirSync(DEMO, { recursive: true });
  const out = join(DEMO, `fourtout-demo${SUFFIX}.webp`);
  ffmpeg(
    "-i", mp4,
    "-vf", "fps=15,scale=1280:-2:flags=lanczos",
    "-c:v", "libwebp", "-lossless", "0", "-quality", "88", "-compression_level", "6",
    "-preset", "picture", "-loop", "0", "-an", "-map_metadata", "-1",
    out,
  );
  return out;
}

// ------------------------------------------------------- recalage

/**
 * Recale l'enregistrement sur la chronologie de référence : chaque chapitre
 * est légèrement accéléré ou ralenti pour durer exactement comme dans la
 * vidéo de référence. Aucune image n'est retouchée, seules leurs durées.
 */
function alignToReference(marks) {
  if (marks.length !== REFERENCE.marks.length) {
    throw new Error(`${marks.length} chapitres enregistrés, ${REFERENCE.marks.length} attendus`);
  }
  const raw = join(WORK, "session-raw.mp4");
  renameSync(SESSION, raw);
  const from = [0, ...marks.map((m) => m.at), probeDuration(raw)];
  const to = [0, ...REFERENCE.marks, REFERENCE.duration];
  let graph = "";
  for (let i = 0; i < from.length - 1; i++) {
    const factor = (to[i + 1] - to[i]) / (from[i + 1] - from[i]);
    graph += `[0:v]trim=start=${from[i].toFixed(4)}:end=${from[i + 1].toFixed(4)},setpts=(PTS-STARTPTS)*${factor.toFixed(5)}[p${i}];`;
  }
  const count = from.length - 1;
  graph += `${Array.from({ length: count }, (_, i) => `[p${i}]`).join("")}concat=n=${count}:v=1:a=0,fps=30,format=yuv420p[out]`;
  ffmpeg(
    "-i", raw, "-filter_complex", graph, "-map", "[out]",
    "-t", REFERENCE.duration.toFixed(4),
    "-c:v", "libx264", "-crf", "14", "-preset", "slow",
    SESSION,
  );
  return marks.map((m, i) => ({ ...m, at: REFERENCE.marks[i] }));
}

// ------------------------------------------------------------ vidéo MP4

const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: 1920px; height: 1080px; overflow: hidden; font-family: "Inter", sans-serif;
         color: #f4f7fb; -webkit-font-smoothing: antialiased; }
  .bg { background:
          radial-gradient(1400px 800px at 70% 30%, rgba(10,132,255,0.15), transparent 60%),
          linear-gradient(160deg, #132a44 0%, #0b1a2e 45%, #060f1d 100%); }
  .center { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; }
  .brand { display: flex; align-items: center; gap: 30px; }
  .brand img { width: 140px; height: 140px; border-radius: 32px; }
  .brand span { font-size: 120px; font-weight: 700; letter-spacing: -4px; }
  .line { margin-top: 44px; font-size: 52px; font-weight: 600; letter-spacing: -1px; }
  .muted { color: #9fb0c6; font-weight: 500; }
  .chips { display: flex; gap: 16px; margin-top: 44px; }
  .chip { font-size: 30px; padding: 12px 26px; border-radius: 999px; font-weight: 500;
          border: 1px solid rgba(159,176,198,0.3); background: rgba(255,255,255,0.05); color: #d5deea; }
`;

function card(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body class="bg">${body}</body></html>`;
}

/**
 * Écrans de l'application installée (native-capture.sh), montrés en fin de
 * vidéo : ce sont les outils que l'aperçu navigateur ne peut pas exécuter.
 */
const NATIVE_STILLS = [
  { scene: "fichiers", text: "Native engines: hashing &amp; archives" },
  { scene: "media", text: "Audio & video, read by FFmpeg" },
  { scene: "diagnostic", text: "Diagnostics & recovery" },
];
const STILL_SECONDS = 2.4;

async function renderCards({ tools, categories }, marks) {
  const logo = `data:image/png;base64,${readFileSync(join(BRANDING, "fourtout-icon-1024.png")).toString("base64")}`;
  const brand = `<div class="brand"><img src="${logo}"><span>FourTout</span></div>`;
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const shoot = async (html, file, transparent = false) => {
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: file, omitBackground: transparent });
  };

  await shoot(
    card(`<div class="center">${brand}
      <div class="line">${tools} tools. ${categories} categories. <span class="muted">One local desktop app.</span></div></div>`),
    join(WORK, "intro.png"),
  );
  await shoot(
    card(`<div class="center">${brand}
      <div class="chips"><span class="chip">Local-first</span><span class="chip">Windows + Linux</span>
      <span class="chip">${tools} tools · ${categories} categories</span></div></div>`),
    join(WORK, "outro.png"),
  );
  // Fond de la séquence enregistrée.
  await shoot(card(""), join(WORK, "stage.png"));
  // Légendes : une pastille par chapitre, sur fond transparent.
  for (const [i, m] of marks.entries()) {
    await shoot(
      `<!doctype html><html><head><meta charset="utf-8"><style>${css}
        body { background: transparent; }
        .cap { position: absolute; left: 0; right: 0; bottom: 18px; display: flex; justify-content: center; }
        .cap span { font-size: 34px; font-weight: 600; letter-spacing: -0.4px; color: #f4f7fb; }
        .cap span::before { content: ""; display: inline-block; width: 12px; height: 12px; border-radius: 3px;
                            background: #0a84ff; margin-right: 16px; vertical-align: middle; }
      </style></head><body><div class="cap"><span>${m.text}</span></div></body></html>`,
      join(WORK, `caption-${i}.png`),
      true,
    );
  }
  // Écrans natifs : capture réelle posée sur le fond, avec sa légende.
  for (const still of NATIVE_STILLS) {
    const shot = join(SCRIPT.raw, `${still.scene}-dark.png`);
    if (!existsSync(shot)) throw new Error(`Capture native manquante : ${shot} (native-capture.sh)`);
    await shoot(
      card(`<style>
          .app { position: absolute; left: 192px; top: 30px; width: 1536px; height: 960px; }
          .cap { position: absolute; left: 0; right: 0; bottom: 18px; display: flex; justify-content: center; }
          .cap span { font-size: 34px; font-weight: 600; letter-spacing: -0.4px; }
          .cap span::before { content: ""; display: inline-block; width: 12px; height: 12px; border-radius: 3px;
                              background: #0a84ff; margin-right: 16px; vertical-align: middle; }
        </style>
        <img class="app" src="data:image/png;base64,${readFileSync(shot).toString("base64")}">
        <div class="cap"><span>${still.text}</span></div>`),
      join(WORK, `native-${still.scene}.png`),
    );
  }
  await browser.close();
}

function video(marks) {
  const sessionDuration = probeDuration(SESSION);
  const INTRO = 3.5;
  const OUTRO = 3.5;
  const FADE = 0.6;

  // Séquence enregistrée, posée sur le fond, avec ses légendes.
  const captionInputs = marks.flatMap((_, i) => ["-loop", "1", "-i", join(WORK, `caption-${i}.png`)]);
  let chain = "[1:v]scale=1536:960:flags=lanczos[app];[0:v][app]overlay=192:30[s0]";
  marks.forEach((m, i) => {
    const until = marks[i + 1]?.at ?? sessionDuration;
    chain += `;[s${i}][${i + 2}:v]overlay=0:0:enable='between(t,${m.at.toFixed(2)},${(until - 0.05).toFixed(2)})'[s${i + 1}]`;
  });
  const staged = join(WORK, "staged.mp4");
  ffmpeg(
    "-loop", "1", "-i", join(WORK, "stage.png"),
    "-i", SESSION,
    ...captionInputs,
    "-filter_complex", `${chain};[s${marks.length}]format=yuv420p[out]`,
    "-map", "[out]", "-t", sessionDuration.toFixed(2), "-r", "30",
    "-c:v", "libx264", "-crf", "16", "-preset", "slow",
    staged,
  );

  // Cartons : léger zoom avant, puis fondus enchaînés.
  const still = (png, seconds, out) =>
    ffmpeg(
      "-loop", "1", "-i", png,
      "-vf", `scale=3840:2160,zoompan=z='1+0.04*on/(${seconds}*30)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.round(seconds * 30)}:s=1920x1080:fps=30,format=yuv420p`,
      "-t", String(seconds), "-c:v", "libx264", "-crf", "16", "-preset", "slow",
      out,
    );
  still(join(WORK, "intro.png"), INTRO, join(WORK, "intro.mp4"));
  still(join(WORK, "outro.png"), OUTRO, join(WORK, "outro.mp4"));
  for (const { scene } of NATIVE_STILLS) {
    still(join(WORK, `native-${scene}.png`), STILL_SECONDS, join(WORK, `native-${scene}.mp4`));
  }

  // Enchaînement : ouverture, enregistrement, écrans natifs, fin.
  const parts = [
    { file: join(WORK, "intro.mp4"), seconds: INTRO },
    { file: staged, seconds: sessionDuration },
    ...NATIVE_STILLS.map(({ scene }) => ({ file: join(WORK, `native-${scene}.mp4`), seconds: STILL_SECONDS })),
    { file: join(WORK, "outro.mp4"), seconds: OUTRO },
  ];
  let graph = "";
  let label = "[0:v]";
  let elapsed = parts[0].seconds;
  for (let i = 1; i < parts.length; i++) {
    const next = `[x${i}]`;
    graph += `${label}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${(elapsed - FADE).toFixed(3)}${next};`;
    elapsed += parts[i].seconds - FADE;
    label = next;
  }

  const out = join(OUTPUT, `FourTout-${VERSION}-demo${SUFFIX}.mp4`);
  ffmpeg(
    ...parts.flatMap((part) => ["-i", part.file]),
    "-filter_complex", graph.replace(/;$/, ""),
    "-map", label, "-c:v", "libx264", "-crf", "20", "-preset", "slow",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-map_metadata", "-1",
    out,
  );
  return out;
}

async function main() {
  const counts = await catalogCounts();
  let marks = await record();
  console.log(`✓ enregistrement : ${probeDuration(SESSION).toFixed(1)} s`);
  console.log(`  chapitres : ${marks.map((m) => m.at.toFixed(2)).join(" / ")}`);
  if (LANG !== "fr") {
    marks = alignToReference(marks);
    console.log(`✓ recalé sur la référence : ${probeDuration(SESSION).toFixed(2)} s`);
  }
  await renderCards(counts, marks);
  const mp4 = video(marks);
  console.log(`✓ ${mp4}`);
  console.log(`✓ ${animatedWebp(mp4)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
