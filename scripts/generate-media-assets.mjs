#!/usr/bin/env node
/**
 * Fixtures média (audio, vidéo), QR et images de finition.
 *
 * L'audio et la vidéo sont produits avec le FFmpeg du système (sources lavfi :
 * tonalités, mires). Si FFmpeg est absent, ces fichiers sont simplement ignorés
 * — les tests correspondants se sautent d'eux-mêmes. Les QR et images de
 * finition sont produits avec `qrcode` et `@napi-rs/canvas`.
 *
 * Lancé par `pnpm test:assets`.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import QRCode from "qrcode";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-assets", "generated");
mkdirSync(OUT, { recursive: true });
const written = [];
const path = (n) => join(OUT, n);

function which(name) {
  try {
    return execFileSync("sh", ["-c", `command -v ${name}`]).toString().trim() || null;
  } catch {
    return null;
  }
}
const FFMPEG = which("ffmpeg");
const hasEnc = (name) => {
  try {
    return FFMPEG && execFileSync(FFMPEG, ["-hide_banner", "-encoders"]).toString().includes(name);
  } catch {
    return false;
  }
};
const VCODEC = hasEnc("libx264") ? "libx264" : "libopenh264";

function ff(args, name) {
  execFileSync(FFMPEG, ["-hide_banner", "-y", ...args, path(name)], { stdio: "ignore" });
  written.push(name);
}

/* ------------------------------------------------------------------ audio */

if (FFMPEG) {
  ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=2"], "audio-tone.wav");
  ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "libmp3lame", "-b:a", "128k"], "audio-tone.mp3");
  ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-ac", "2"], "audio-stereo.wav");
  ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-filter:a", "volume=0.12"], "audio-quiet.wav");
  ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-filter:a", "volume=0.95"], "audio-loud.wav");
  ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=1"], "audio-two-parts-a.wav");
  ff(["-f", "lavfi", "-i", "sine=frequency=660:duration=1"], "audio-two-parts-b.wav");
  // 2 s son, 2 s silence, 2 s son.
  ff([
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-filter_complex", "[0][1][2]concat=n=3:v=0:a=1[a]", "-map", "[a]", "-ar", "22050",
  ], "audio-with-silences.wav");

  /* ---------------------------------------------------------------- vidéo */
  ff([
    "-f", "lavfi", "-i", "testsrc=duration=2:size=240x160:rate=15",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-pix_fmt", "yuv420p", "-c:v", VCODEC, "-c:a", "aac", "-shortest",
  ], "video-with-audio.mp4");
  ff(["-f", "lavfi", "-i", "testsrc=duration=1:size=160x120:rate=15", "-pix_fmt", "yuv420p", "-c:v", VCODEC], "video-short.mp4");
  ff(["-f", "lavfi", "-i", "testsrc2=duration=2:size=240x160:rate=15", "-pix_fmt", "yuv420p", "-c:v", VCODEC], "video-for-gif.mp4");
} else {
  console.warn("FFmpeg absent : fixtures audio/vidéo non générées.");
}

/* ------------------------------------------------------------ TTS (texte) */

writeFileSync(path("tts-short-fr.txt"), "Bonjour, ceci est un test de FourTout. Le numero est 2026.\n");
written.push("tts-short-fr.txt");
writeFileSync(path("tts-short-en.txt"), "Hello, this is a FourTout test. The number is 2026.\n");
written.push("tts-short-en.txt");
writeFileSync(
  path("tts-long-fr.txt"),
  "FourTout est une boite a outils locale. Elle regroupe des outils PDF, image, audio et video.\n\n" +
    "Ce texte comporte plusieurs phrases et plusieurs paragraphes. Il sert a verifier la segmentation " +
    "et la progression de la synthese vocale sur un contenu plus long.\n\n" +
    "Merci d'utiliser FourTout au quotidien.\n",
);
written.push("tts-long-fr.txt");

/* --------------------------------------------------------- QR + images */

const qr = await QRCode.toBuffer("https://example.com/fourtout-test", { width: 320, margin: 4, errorCorrectionLevel: "M" });
writeFileSync(path("qr-sample.png"), qr);
written.push("qr-sample.png");

// Logo de filigrane transparent.
{
  const c = createCanvas(200, 80);
  const x = c.getContext("2d");
  x.clearRect(0, 0, 200, 80);
  x.fillStyle = "#111827";
  x.font = "bold 40px Cantarell";
  x.textBaseline = "middle";
  x.fillText("LOGO", 20, 44);
  writeFileSync(path("watermark-logo.png"), c.toBuffer("image/png"));
  written.push("watermark-logo.png");
}

// Source de favicon (carrée, colorée).
{
  const c = createCanvas(512, 512);
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 512, 512);
  g.addColorStop(0, "#6366f1");
  g.addColorStop(1, "#ec4899");
  x.fillStyle = g;
  x.fillRect(0, 0, 512, 512);
  x.fillStyle = "#ffffff";
  x.font = "bold 300px Cantarell";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText("F", 256, 280);
  writeFileSync(path("favicon-source.png"), c.toBuffer("image/png"));
  written.push("favicon-source.png");
}

// Photo multi-couleurs pour la palette.
{
  const c = createCanvas(200, 200);
  const x = c.getContext("2d");
  const colors = ["#ef4444", "#22c55e", "#3b82f6", "#eab308", "#a855f7", "#14b8a6"];
  colors.forEach((color, i) => {
    x.fillStyle = color;
    x.fillRect((i % 3) * 67, Math.floor(i / 3) * 100, 67, 100);
  });
  writeFileSync(path("palette-photo.png"), c.toBuffer("image/png"));
  written.push("palette-photo.png");
}

console.log("Fixtures média/finition générées :");
for (const name of written.sort()) console.log("  " + name);
