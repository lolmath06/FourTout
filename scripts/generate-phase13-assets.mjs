#!/usr/bin/env node
/**
 * Fixtures du jalon Internet, ISO et conversions de contenu.
 *
 * Tout est déterministe et local : aucun téléchargement. Les fichiers qui
 * demandent FFmpeg sont sautés (avec un message) quand il est absent.
 *
 *   animated.webp / animated.png   WebP animé et APNG de 12 images, 160×120
 *   still.webp                     WebP fixe (même image)
 *   video.webm / audio-only.webm   WebM complet, puis WebM sans image
 *   sample.avif / sample.heic      images de référence 64×64 (octets figés)
 *   photo-mislabeled.jpg           un PNG qui se fait passer pour un JPEG
 *   photo-no-extension             le même PNG, sans extension
 *   iso-source/                    dossier à réunir en ISO (noms Unicode, profondeur)
 *   web-sample/                    page locale pour la capture web et le téléchargeur
 *   sample.iso / sample-boot.iso   produits par l'exemple Rust `phase13_fixtures`
 *
 * Usage : `node scripts/generate-phase13-assets.mjs`
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { which } from "./lib/which.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-assets", "generated");
mkdirSync(OUT, { recursive: true });

const ffmpeg = which("ffmpeg");
const run = (args) => spawnSync(ffmpeg, ["-v", "error", "-y", "-hide_banner", ...args], { encoding: "utf8" });
const done = (name) => console.log(`  ${name}`);

/** Octets pseudo-aléatoires reproductibles. */
function bytes(length, seed) {
  const out = Buffer.alloc(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = state >>> 16;
  }
  return out;
}

console.log("Fixtures du jalon Internet / ISO / formats :");

/* ------------------------------------------------- images fixes et animées */
if (ffmpeg) {
  const source = ["-f", "lavfi", "-i", "testsrc2=size=160x120:rate=10:duration=1.2", "-pix_fmt", "rgba"];
  let r = run([...source, "-c:v", "libwebp_anim", "-loop", "0", join(OUT, "animated.webp")]);
  if (r.status === 0) done("animated.webp");
  else console.log("  (animated.webp ignoré : pas d'encodeur libwebp_anim)");
  r = run([...source, "-c:v", "apng", "-plays", "0", "-f", "apng", join(OUT, "animated.png")]);
  if (r.status === 0) done("animated.png (APNG)");
  r = run(["-f", "lavfi", "-i", "testsrc2=size=160x120:rate=10:duration=0.1", "-frames:v", "1", join(OUT, "still.webp")]);
  if (r.status === 0) done("still.webp");
  r = run([
    "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
    "-c:v", "libvpx-vp9", "-b:v", "300k", "-c:a", "libopus", "-shortest", join(OUT, "video.webm"),
  ]);
  if (r.status === 0) done("video.webm");
  r = run(["-f", "lavfi", "-i", "sine=frequency=330:duration=3", "-c:a", "libopus", join(OUT, "audio-only.webm")]);
  if (r.status === 0) done("audio-only.webm");
} else {
  console.log("  (FFmpeg absent : images animées et WebM ignorés)");
}

/* ----------------------------------------------- HEIC / AVIF (octets figés) */
const fixtures = join(ROOT, "src-tauri", "tests", "fixtures");
for (const [from, to] of [["still.heic", "sample.heic"], ["still.avif", "sample.avif"]]) {
  if (existsSync(join(fixtures, from))) {
    copyFileSync(join(fixtures, from), join(OUT, to));
    done(to);
  }
}

/* ---------------------------------------------- le contenu contredit le nom */
const png = join(OUT, "sample.png");
if (existsSync(png)) {
  copyFileSync(png, join(OUT, "photo-mislabeled.jpg"));
  copyFileSync(png, join(OUT, "photo-no-extension"));
  done("photo-mislabeled.jpg, photo-no-extension");
}

/* --------------------------------------------------------- dossier pour ISO */
const iso = join(OUT, "iso-source");
for (const dir of ["documents/rapports/2026", "Photos de vacances", "données"]) mkdirSync(join(iso, dir), { recursive: true });
writeFileSync(join(iso, "LISEZMOI.txt"), "Bonjour FourTout.\nCe dossier sert à créer une image ISO.\n");
writeFileSync(join(iso, "documents/rapports/2026/été-à-la-mer.txt"), "accentué — nom Unicode\n");
writeFileSync(join(iso, "documents/rapports/2026/rapport-avec-un-nom-vraiment-tres-long-pour-tester-joliet-et-rock-ridge.txt"), "nom long\n");
writeFileSync(join(iso, "Photos de vacances/日本語のファイル.txt"), "unicode\n");
writeFileSync(join(iso, "données/aleatoire.bin"), bytes(300_000, 7));
writeFileSync(join(iso, "vide.dat"), "");
done("iso-source/ (dossier)");

/* ------------------------------------------------------- page web locale */
const web = join(OUT, "web-sample");
mkdirSync(web, { recursive: true });
writeFileSync(
  join(web, "index.html"),
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Page de test FourTout</title>
<link rel="stylesheet" href="style.css"></head><body>
<h1>Page de test FourTout</h1><p>Cette page est servie localement : aucune connexion Internet n'est nécessaire.</p>
<div class="degrade"></div><p id="fin">Fin de la page — texte accentué : é à ç ü ñ 日本語.</p></body></html>`,
);
writeFileSync(join(web, "style.css"), "body{font:16px sans-serif;margin:2rem}.degrade{height:2400px;background:linear-gradient(#e03131,#1971c2)}");
writeFileSync(join(web, "fichier.bin"), bytes(5_000_000, 11));
done("web-sample/ (page, feuille de style, fichier.bin de 5 Mo)");

console.log("Terminé. ISO : `cargo run --example phase13_fixtures` (inclus dans pnpm test:assets).");
console.log("Serveur local pour les essais manuels : `pnpm fixtures:serve`.");
