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

  // Audio destiné à remplacer la bande son d'une vidéo : durée volontairement
  // différente des vidéos (8 s), pour éprouver les modes « caler sur la
  // vidéo / sur l'audio / boucler ».
  ff([
    "-f", "lavfi", "-i", "sine=frequency=330:duration=8",
    "-filter:a", "volume=0.8",
  ], "audio-for-video.wav");

  /* ---------------------------------------------------------------- vidéo */

  // Mire à quatre quadrants colorés + barre en mouvement.
  //
  // Le contenu n'est pas décoratif : les quatre couleurs rendent une rotation,
  // un miroir ou un rognage **immédiatement vérifiables à l'œil** (rouge en
  // haut à gauche au départ), et la barre mobile donne du mouvement réel — sans
  // quoi une compression ne mesurerait rien. Aucune police n'est requise, donc
  // la fixture est identique sur toutes les machines.
  const quadrants = (w, h, colors, moving = "horizontal") => {
    const hw = Math.round(w / 2);
    const hh = Math.round(h / 2);
    const bar =
      moving === "horizontal"
        ? `drawbox=x='(t/DUR)*(${w}-60)':y=${Math.round(h / 2 - 10)}:w=60:h=20:color=white@1:t=fill`
        : `drawbox=x=${Math.round(w / 2 - 10)}:y='(t/DUR)*(${h}-60)':w=20:h=60:color=white@1:t=fill`;
    return [
      `drawbox=x=0:y=0:w=${hw}:h=${hh}:color=${colors[0]}@1:t=fill`,
      `drawbox=x=${hw}:y=0:w=${w - hw}:h=${hh}:color=${colors[1]}@1:t=fill`,
      `drawbox=x=0:y=${hh}:w=${hw}:h=${h - hh}:color=${colors[2]}@1:t=fill`,
      `drawbox=x=${hw}:y=${hh}:w=${w - hw}:h=${h - hh}:color=${colors[3]}@1:t=fill`,
      bar,
    ].join(",");
  };

  const mire = (name, { w, h, seconds, fps = 25, colors, moving, audio, extra = [] }) => {
    const filter = quadrants(w, h, colors, moving).replaceAll("DUR", String(seconds));
    const args = ["-f", "lavfi", "-i", `color=c=black:s=${w}x${h}:r=${fps}:d=${seconds}`];
    if (audio) args.push("-f", "lavfi", "-i", audio);
    // Une image-clé par seconde : sans quoi le « découpage rapide » (recopie
    // des flux) remonterait jusqu'à la seule image-clé du début et produirait
    // un extrait bien plus long que demandé.
    args.push("-vf", filter, "-pix_fmt", "yuv420p", "-c:v", VCODEC, "-g", String(fps), ...extra);
    if (audio) args.push("-c:a", "aac", "-b:a", "96k", "-shortest");
    ff(args, name);
  };

  const WARM = ["red", "green", "blue", "yellow"];
  const COOL = ["cyan", "magenta", "orange", "purple"];

  mire("video-short.mp4", { w: 640, h: 360, seconds: 5, colors: WARM, extra: ["-b:v", "300k"] });
  mire("video-short-2.mp4", { w: 640, h: 360, seconds: 4, colors: COOL, moving: "vertical", extra: ["-b:v", "300k"] });
  mire("video-with-audio.mp4", {
    w: 640, h: 360, seconds: 5, colors: WARM,
    audio: "sine=frequency=440:duration=5", extra: ["-b:v", "300k"],
  });
  mire("video-landscape.mp4", { w: 1280, h: 720, seconds: 3, colors: WARM, extra: ["-b:v", "600k"] });
  mire("video-portrait.mp4", { w: 720, h: 1280, seconds: 3, colors: COOL, moving: "vertical", extra: ["-b:v", "600k"] });

  // Vidéo volontairement lourde, encodée à haut débit : c'est la seule façon de
  // mesurer un gain de compression **réel**. Une mire plate à 300 kb/s est déjà
  // au plancher — la compresser ne prouverait rien.
  ff([
    "-f", "lavfi", "-i", "mandelbrot=s=1280x720:rate=30", "-t", "4",
    "-vf", "format=yuv420p", "-c:v", VCODEC, "-b:v", "8000k",
  ], "video-large.mp4");

  ff(["-f", "lavfi", "-i", "testsrc2=duration=2:size=240x160:rate=15", "-pix_fmt", "yuv420p", "-c:v", VCODEC], "video-for-gif.mp4");

  /* ---------------------------------------------------------- sous-titres */

  const SRT = [
    "1", "00:00:00,500 --> 00:00:02,000", "Première ligne de sous-titre.", "",
    "2", "00:00:02,200 --> 00:00:03,800", "Deuxième ligne, avec accents : éàçù.", "",
    "3", "00:00:04,000 --> 00:00:04,900", "Fin du test FourTout.", "",
  ].join("\n");
  writeFileSync(path("sample.srt"), SRT);
  written.push("sample.srt");

  writeFileSync(
    path("sample.vtt"),
    "WEBVTT\n\n" +
      [
        "00:00:00.500 --> 00:00:02.000", "Première ligne de sous-titre.", "",
        "00:00:02.200 --> 00:00:03.800", "Deuxième ligne, avec accents : éàçù.", "",
        "00:00:04.000 --> 00:00:04.900", "Fin du test FourTout.", "",
      ].join("\n"),
  );
  written.push("sample.vtt");

  // MKV portant une vraie piste de sous-titres (le MP4 exigerait `mov_text`,
  // absent de nombreux builds : on écrit donc le conteneur qui convient).
  ff([
    "-i", path("video-with-audio.mp4"), "-i", path("sample.srt"),
    "-map", "0", "-map", "1:0", "-c", "copy", "-c:s", "srt",
    "-metadata:s:s:0", "language=fra", "-metadata:s:s:0", "title=Test FourTout",
  ], "video-subtitles.mkv");
} else {
  console.warn("FFmpeg absent : fixtures audio/vidéo non générées.");
}

/* ------------------------------------------------------------ TTS (texte) */

writeFileSync(path("tts-short-fr.txt"), "Bonjour, ceci est un test de FourTout. Le numero est 2026.\n");
written.push("tts-short-fr.txt");
writeFileSync(path("tts-short-en.txt"), "Hello, this is a FourTout test. The number is 2026.\n");
written.push("tts-short-en.txt");
// Texte long : plusieurs pages, accentuees, pour eprouver reellement la
// segmentation, la progression, la navigation pendant un job et l'annulation.
// Un texte de quelques lignes se synthetise en une fraction de seconde et ne
// permettrait de verifier aucun de ces comportements.
const LONG_SECTIONS = [
  "FourTout est une boite a outils locale. Elle regroupe des outils PDF, image, audio et video, " +
    "et les execute entierement sur votre appareil. Aucune donnee n'est envoyee sur le reseau.",
  "La synthese vocale decoupe ce texte en segments, phrase par phrase, puis les assemble en un " +
    "seul fichier audio. Ce decoupage suit la ponctuation francaise : le point, le point " +
    "d'interrogation, le point d'exclamation et le point-virgule ferment une phrase, mais une " +
    "abreviation comme M. Dupont ou la page p. 12 ne la ferme pas.",
  "La progression affichee correspond au segment en cours. Vous pouvez quitter l'outil pendant " +
    "la generation : le traitement continue et reste visible depuis n'importe quelle page. En " +
    "revenant, vous retrouvez l'avancement exact, puis le resultat.",
  "L'annulation arrete reellement le moteur de synthese. Les segments deja produits sont " +
    "supprimes et aucun fichier partiel ne vous est presente comme un resultat valable.",
  "Un document plus long, comme un cours ou un rapport, se lit de la meme facon. Les numeros de " +
    "page et les en-tetes repetes sont ecartes avant la lecture, pour ne pas les entendre a " +
    "chaque page. Le texte reste modifiable avant de lancer la synthese.",
  "La transcription fait le chemin inverse. Elle accepte un fichier audio ou une video, en " +
    "extrait la bande son, puis produit un texte horodate que vous pouvez corriger passage par " +
    "passage avant d'exporter un fichier de sous-titres.",
];

writeFileSync(
  path("tts-long-fr.txt"),
  // Dix-huit sections : environ dix mille caracteres, soit plusieurs pages et
  // une bonne minute de lecture a voix haute.
  Array.from({ length: 3 }, (_, pass) =>
    LONG_SECTIONS.map(
      (section, index) => `Partie ${pass * LONG_SECTIONS.length + index + 1}.\n\n${section}`,
    ).join("\n\n"),
  ).join("\n\n") + "\n",
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
