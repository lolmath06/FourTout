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

console.log("Fixtures de parole generees dans test-assets/generated/ :");
for (const [name, size] of written) {
  console.log(`  ${name.padEnd(24)} ${String(size).padStart(9)} octets`);
}
