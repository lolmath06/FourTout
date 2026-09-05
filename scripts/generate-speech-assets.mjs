#!/usr/bin/env node
/**
 * Fixtures de parole : `audio-speech-fr.wav` et `audio-speech-en.wav`.
 *
 * Elles sont produites par la **vraie** voix Piper installée, à partir des
 * textes de référence `tts-short-*.txt` : ce sont donc exactement les fichiers
 * que la transcription doit savoir relire (test croisé TTS → STT).
 *
 * Si les moteurs ne sont pas encore installés, le script le dit et s'arrête
 * sans erreur : il ne télécharge jamais rien de lui-même.
 *
 * Lancé par `pnpm test:assets`.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-assets", "generated");
mkdirSync(OUT, { recursive: true });

const MODELS =
  process.env.FOURTOUT_MODELS_DIR ??
  join(homedir(), ".local", "share", "app.fourtout.desktop", "models");

const exe = (name) => (process.platform === "win32" ? `${name}.exe` : name);
const piper = join(MODELS, "engines", "piper", exe("piper"));

const VOICES = [
  { file: "fr_FR-siwis-medium.onnx", source: "tts-short-fr.txt", out: "audio-speech-fr.wav" },
  { file: "en_US-lessac-medium.onnx", source: "tts-short-en.txt", out: "audio-speech-en.wav" },
];

/** FFmpeg du système, pour habiller la voix synthétisée d'une image. */
function which(name) {
  try {
    return spawnSync("sh", ["-c", `command -v ${name}`]).stdout.toString().trim() || null;
  } catch {
    return null;
  }
}

if (!existsSync(piper)) {
  console.log(
    "Moteur Piper absent : fixtures de parole ignorées.\n" +
      "Installez-le depuis un outil de synthèse vocale de FourTout, puis relancez.",
  );
  process.exit(0);
}

const espeak = join(MODELS, "engines", "piper", "espeak-ng-data");
const written = [];

for (const voice of VOICES) {
  const model = join(MODELS, "voices", voice.file);
  if (!existsSync(model)) {
    console.log(`Voix ${voice.file} absente : ${voice.out} ignoré.`);
    continue;
  }

  const text = readFileSync(join(OUT, voice.source), "utf8").trim();
  const output = join(OUT, voice.out);
  const args = ["--model", model, "--output_file", output, "--length_scale", "1", "--quiet"];
  if (existsSync(espeak)) args.push("--espeak_data", espeak);

  const result = spawnSync(piper, args, { input: `${text}\n` });
  if (result.status !== 0 || !existsSync(output)) {
    console.error(`Échec de la synthèse pour ${voice.out}.`);
    process.exit(1);
  }
  written.push([voice.out, statSync(output).size]);
}

/* --------------------------------------------------- vidéo avec de la parole
 *
 * Une fixture nommée « avec parole » doit réellement en contenir : c'est la
 * seule façon d'éprouver honnêtement les sous-titres automatiques. On habille
 * donc la voix Piper française d'une image fixe reconnaissable — ce qui donne
 * une vraie vidéo, avec une vraie bande son parlée, entièrement locale.
 */
const ffmpeg = which("ffmpeg");
const speechWav = join(OUT, "audio-speech-fr.wav");
if (ffmpeg && existsSync(speechWav)) {
  const out = join(OUT, "video-speech-fr.mp4");
  const filter = [
    "drawbox=x=0:y=0:w=320:h=180:color=red@1:t=fill",
    "drawbox=x=320:y=0:w=320:h=180:color=green@1:t=fill",
    "drawbox=x=0:y=180:w=320:h=180:color=blue@1:t=fill",
    "drawbox=x=320:y=180:w=320:h=180:color=yellow@1:t=fill",
  ].join(",");
  const encoders = spawnSync(ffmpeg, ["-hide_banner", "-encoders"]).stdout.toString();
  const vcodec = encoders.includes("libx264") ? "libx264" : "libopenh264";
  const result = spawnSync(ffmpeg, [
    "-hide_banner", "-y",
    "-f", "lavfi", "-i", "color=c=black:s=640x360:r=25",
    "-i", speechWav,
    "-vf", filter, "-pix_fmt", "yuv420p", "-c:v", vcodec, "-b:v", "300k",
    "-c:a", "aac", "-b:a", "96k", "-shortest", out,
  ]);
  if (result.status === 0 && existsSync(out)) written.push(["video-speech-fr.mp4", statSync(out).size]);
  else console.error("Échec de la génération de video-speech-fr.mp4.");
} else if (!ffmpeg) {
  console.log("FFmpeg absent : video-speech-fr.mp4 ignoré.");
}

console.log("Fixtures de parole generees dans test-assets/generated/ :");
for (const [name, size] of written) {
  console.log(`  ${name.padEnd(24)} ${String(size).padStart(9)} octets`);
}
