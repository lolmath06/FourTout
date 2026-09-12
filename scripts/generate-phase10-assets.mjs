#!/usr/bin/env node
/**
 * Fixtures de la phase 10 : comparaison d'images, planche-contact, couleurs,
 * canaux audio, fréquence d'images, sous-titres.
 *
 * Les images sont écrites **pixel par pixel** plutôt que dessinées : un
 * `fillRect` passe par l'anticrénelage, et deux machines n'obtiennent alors pas
 * forcément la même valeur sur le pixel de bord. Or ces fixtures servent à
 * vérifier des comptages exacts (« exactement un pixel a changé ») : elles ne
 * peuvent pas dépendre du moteur de rendu.
 *
 * L'audio et la vidéo passent par le FFmpeg du système, comme les autres
 * fixtures média ; s'il est absent, ces fichiers sont ignorés et les tests
 * correspondants se sautent d'eux-mêmes.
 *
 * Lancé par `pnpm test:assets`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-assets", "generated");
mkdirSync(OUT, { recursive: true });

const written = [];
const path = (name) => join(OUT, name);

function write(name, data) {
  writeFileSync(path(name), data);
  written.push([name, data.length]);
}

/* ------------------------------------------------------- images de comparaison */

/**
 * Rectangle dont **seule** l'opacité change.
 *
 * Le blanc et l'opacité 128 ne sont pas choisis au hasard. Un canvas stocke les
 * couleurs prémultipliées par l'alpha : relire un pixel semi-transparent le fait
 * passer par deux arrondis, et la plupart des valeurs n'en ressortent pas
 * intactes. Le blanc, lui, fait l'aller-retour exactement (255 → 128 → 255). La
 * fixture garantit ainsi que la seule différence mesurable entre les deux images
 * est bien l'alpha — sans quoi le test « l'alpha est ignoré par défaut »
 * échouerait sur un artefact d'encodage, et non sur le comportement du moteur.
 */
const ALPHA_REGION = { width: 16, height: 12, alpha: 128 };

/** Dimensions de l'image de référence et de ses variantes de même taille. */
const REF_WIDTH = 64;
const REF_HEIGHT = 48;

/**
 * Motif de référence : chaque canal est une fonction simple des coordonnées.
 * Aucun pixel n'est uniforme, ce qui évite qu'une erreur de comparaison passe
 * inaperçue sur une image plate, et la variance locale reste non nulle partout
 * — condition nécessaire pour que le SSIM ait un sens.
 */
function referencePixels(width = REF_WIDTH, height = REF_HEIGHT) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const inPatch = x < ALPHA_REGION.width && y < ALPHA_REGION.height;
      // Le coin réservé à la variante de transparence est blanc pur : voir
      // `ALPHA_REGION` pour la raison, qui n'a rien d'esthétique.
      data[i] = inPatch ? 255 : (x * 4) % 256;
      data[i + 1] = inPatch ? 255 : (y * 5) % 256;
      data[i + 2] = inPatch ? 255 : ((x + y) * 3) % 256;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Encode des pixels RVBA bruts en PNG, sans passer par un tracé. */
function encodePixels({ width, height, data }) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  const image = context.createImageData(width, height);
  image.data.set(data);
  context.putImageData(image, 0, 0);
  return canvas.toBuffer("image/png");
}

const reference = referencePixels();
write("image-reference.png", encodePixels(reference));
// Même contenu, autre fichier : la comparaison doit conclure « identiques ».
write("image-identical.png", encodePixels(reference));

/** Écart appliqué à l'unique pixel modifié (rouge), à la coordonnée ci-dessous. */
const ONE_PIXEL = { x: 30, y: 30, delta: 40 };
{
  const pixels = referencePixels();
  const i = (ONE_PIXEL.y * REF_WIDTH + ONE_PIXEL.x) * 4;
  pixels.data[i] = pixels.data[i] + ONE_PIXEL.delta;
  write("image-one-pixel.png", encodePixels(pixels));
}

{
  // Bruit léger et déterministe : un pixel sur sept, +3 sur le vert.
  const pixels = referencePixels();
  for (let p = 0; p < REF_WIDTH * REF_HEIGHT; p += 7) {
    const i = p * 4;
    pixels.data[i + 1] = Math.min(255, pixels.data[i + 1] + 3);
  }
  write("image-small-noise.png", encodePixels(pixels));
}

{
  // Moitié droite remplacée par un magenta plein.
  const pixels = referencePixels();
  for (let y = 0; y < REF_HEIGHT; y += 1) {
    for (let x = REF_WIDTH / 2; x < REF_WIDTH; x += 1) {
      const i = (y * REF_WIDTH + x) * 4;
      pixels.data[i] = 255;
      pixels.data[i + 1] = 0;
      pixels.data[i + 2] = 255;
    }
  }
  write("image-heavy-change.png", encodePixels(pixels));
}

{
  const pixels = referencePixels();
  for (let y = 0; y < ALPHA_REGION.height; y += 1) {
    for (let x = 0; x < ALPHA_REGION.width; x += 1) {
      pixels.data[(y * REF_WIDTH + x) * 4 + 3] = ALPHA_REGION.alpha;
    }
  }
  write("image-alpha-change.png", encodePixels(pixels));
}

// Moitié de chaque dimension : sert aux refus et aux recadrages explicites.
write("image-different-size.png", encodePixels(referencePixels(32, 24)));

/* ------------------------------------------------------------ planche-contact */

/** Vignettes de la planche-contact : couleurs pleines, dimensions connues. */
const CONTACT = [
  ["contact-red.png", 40, 30, [220, 38, 38]],
  ["contact-green.png", 40, 30, [22, 163, 74]],
  ["contact-blue.png", 40, 30, [37, 99, 235]],
  ["contact-yellow.png", 40, 30, [234, 179, 8]],
  ["contact-wide.png", 80, 30, [124, 58, 237]],
];

for (const [name, width, height, [r, g, b]] of CONTACT) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  write(name, encodePixels({ width, height, data }));
}

/* ------------------------------------------------------------------ couleurs */

/** Quadrants de `color-known.png` : la pipette doit y lire exactement cela. */
const COLOR_QUADRANTS = [
  [0, 0, [255, 0, 0]],
  [20, 0, [0, 255, 0]],
  [0, 20, [0, 0, 255]],
  [20, 20, [255, 255, 255]],
];
{
  const size = 40;
  const data = new Uint8ClampedArray(size * size * 4);
  for (const [originX, originY, [r, g, b]] of COLOR_QUADRANTS) {
    for (let y = originY; y < originY + 20; y += 1) {
      for (let x = originX; x < originX + 20; x += 1) {
        const i = (y * size + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
  }
  write("color-known.png", encodePixels({ width: size, height: size, data }));
}

/* ---------------------------------------------------------------- sous-titres */

// Accents, italiques et texte sur deux lignes : de quoi vérifier qu'une
// conversion ne perd ni l'Unicode ni les retours à la ligne.
write(
  "subtitle-sample.srt",
  Buffer.from(
    [
      "1",
      "00:00:01,000 --> 00:00:03,500",
      "Première réplique, accentuée.",
      "",
      "2",
      "00:00:04,000 --> 00:00:06,250",
      "Deuxième réplique",
      "sur deux lignes — avec un tiret cadratin.",
      "",
      "3",
      "00:00:10,500 --> 00:00:12,000",
      "Troisième : 日本語 et emoji 🎬",
      "",
    ].join("\n"),
    "utf8",
  ),
);

write(
  "subtitle-sample.vtt",
  Buffer.from(
    [
      "WEBVTT",
      "",
      "intro",
      "00:00:01.000 --> 00:00:03.500 line:90%",
      "Première réplique, accentuée.",
      "",
      "00:00:04.000 --> 00:00:06.250",
      "Deuxième réplique",
      "sur deux lignes — avec un tiret cadratin.",
      "",
      "00:00:10.500 --> 00:00:12.000",
      "Troisième : 日本語 et emoji 🎬",
      "",
    ].join("\n"),
    "utf8",
  ),
);

// `subtitle-offset.srt` est `subtitle-sample.srt` décalé de +2 500 ms : les
// horodatages ci-dessous sont écrits en clair pour que la fixture reste une
// référence indépendante du moteur de décalage qu'elle sert à éprouver.
write(
  "subtitle-offset.srt",
  Buffer.from(
    [
      "1",
      "00:00:03,500 --> 00:00:06,000",
      "Première réplique, accentuée.",
      "",
      "2",
      "00:00:06,500 --> 00:00:08,750",
      "Deuxième réplique",
      "sur deux lignes — avec un tiret cadratin.",
      "",
      "3",
      "00:00:13,000 --> 00:00:14,500",
      "Troisième : 日本語 et emoji 🎬",
      "",
    ].join("\n"),
    "utf8",
  ),
);

// Deux chevauchements francs : le second commence avant la fin du premier.
write(
  "subtitle-overlap.srt",
  Buffer.from(
    [
      "1",
      "00:00:01,000 --> 00:00:05,000",
      "Un.",
      "",
      "2",
      "00:00:03,000 --> 00:00:07,000",
      "Deux.",
      "",
      "3",
      "00:00:06,000 --> 00:00:09,000",
      "Trois.",
      "",
    ].join("\n"),
    "utf8",
  ),
);

// Fichier réellement abîmé : marque d'ordre des octets, CRLF, indices dans le
// désordre, réplique vide, fin avant début, doublon exact.
write(
  "subtitle-broken.srt",
  Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(
      [
        "3",
        "00:00:09,000 --> 00:00:11,000",
        "Dernière réplique.",
        "",
        "1",
        "00:00:01,000 --> 00:00:03,000",
        "Première réplique.",
        "",
        "2",
        "00:00:05,000 --> 00:00:04,000",
        "Fin avant début.",
        "",
        "4",
        "00:00:06,000 --> 00:00:07,000",
        "   ",
        "",
        "5",
        "00:00:01,000 --> 00:00:03,000",
        "Première réplique.",
        "",
      ].join("\r\n"),
      "utf8",
    ),
  ]),
);

// Second fichier à fusionner : ses répliques s'intercalent entre celles de
// l'échantillon, ce qui rend le tri chronologique visible.
write(
  "subtitle-second.srt",
  Buffer.from(
    [
      "1",
      "00:00:03,600 --> 00:00:03,900",
      "Insert A.",
      "",
      "2",
      "00:00:07,000 --> 00:00:08,000",
      "Insert B.",
      "",
      "3",
      "00:00:20,000 --> 00:00:21,000",
      "Insert C.",
      "",
    ].join("\n"),
    "utf8",
  ),
);

/* ------------------------------------------------------------- audio / vidéo */

function which(name) {
  try {
    return execFileSync("sh", ["-c", `command -v ${name}`]).toString().trim() || null;
  } catch {
    return null;
  }
}

const FFMPEG = which("ffmpeg");
const FFPROBE = which("ffprobe");

function ff(args, name) {
  const result = spawnSync(FFMPEG, ["-hide_banner", "-nostdin", "-y", ...args, path(name)], {
    stdio: "ignore",
  });
  if (result.status === 0 && existsSync(path(name))) {
    written.push([name, statSync(path(name)).size]);
    return true;
  }
  console.error(`Échec de la génération de ${name}.`);
  return false;
}

const hasEncoder = (name) => {
  try {
    return Boolean(FFMPEG) && execFileSync(FFMPEG, ["-hide_banner", "-encoders"]).toString().includes(name);
  } catch {
    return false;
  }
};

if (FFMPEG) {
  // Canaux : un mono, un stéréo dont les deux voies diffèrent (un vrai downmix
  // se voit alors), et un 5.1 pour le cas « plus de deux canaux ».
  ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-ac", "1"], "audio-mono.wav");
  ff(
    [
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=660:duration=2",
      "-filter_complex", "[0][1]join=inputs=2:channel_layout=stereo[a]", "-map", "[a]",
    ],
    "audio-stereo-distinct.wav",
  );
  ff(
    ["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-af", "pan=5.1|c0=c0|c1=c0|c2=c0|c3=c0|c4=c0|c5=c0"],
    "audio-multichannel.wav",
  );

  // Étiquettes connues, pour la lecture et la réécriture de métadonnées.
  if (hasEncoder("libmp3lame")) {
    ff(
      [
        "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
        "-c:a", "libmp3lame", "-b:a", "128k",
        "-metadata", "title=Titre d'origine",
        "-metadata", "artist=Artiste d'origine",
        "-metadata", "album=Album d'origine",
        "-metadata", "date=2019",
        "-metadata", "genre=Test",
        "-metadata", "track=3",
      ],
      "audio-tagged.mp3",
    );
  }

  // Vidéo : deux cadences franches, avec du mouvement (une mire qui défile) —
  // une image fixe se laisserait déduplicer et fausserait les comptages.
  const vcodec = hasEncoder("libx264") ? "libx264" : "libopenh264";
  const common = ["-pix_fmt", "yuv420p", "-c:v", vcodec, "-b:v", "400k"];
  ff(["-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=3", ...common, "-r", "24"], "video-24fps.mp4");
  ff(["-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=3", ...common, "-r", "30"], "video-30fps.mp4");

  // Cadence variable : on part d'une base à 30 i/s dont on supprime les images
  // redondantes. Le résultat n'est VFR que si ffprobe le confirme — sinon la
  // fixture est retirée plutôt que présentée à tort comme variable.
  const vfr = "video-vfr.mp4";
  const built = ff(
    [
      "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=4",
      "-vf", "select='lt(mod(n\\,30)\\,6)+gte(n\\,90)',setpts=N/30/TB",
      "-fps_mode", "vfr", ...common,
    ],
    vfr,
  );
  if (built && FFPROBE) {
    const json = spawnSync(
      FFPROBE,
      ["-v", "quiet", "-print_format", "json", "-show_streams", "-select_streams", "v:0", path(vfr)],
      { encoding: "utf8" },
    );
    let variable = false;
    try {
      const stream = JSON.parse(json.stdout).streams?.[0] ?? {};
      variable = stream.r_frame_rate !== stream.avg_frame_rate;
    } catch {
      variable = false;
    }
    if (!variable) {
      // Une fixture qui se prétend à cadence variable sans l'être ferait passer
      // un test pour rien : on la retire plutôt que de la garder à tort.
      rmSync(path(vfr), { force: true });
      written.splice(
        written.findIndex(([name]) => name === vfr),
        1,
      );
      console.log(
        `${vfr} retiré : ce FFmpeg produit une cadence constante ici, la fixture ne prouverait rien.`,
      );
    }
  }
} else {
  console.log("FFmpeg absent : fixtures audio et vidéo de la phase 10 ignorées.");
}

console.log("Fixtures phase 10 générées dans test-assets/generated/ :");
for (const [name, size] of written) {
  console.log(`  ${name.padEnd(28)} ${String(size).padStart(9)} octets`);
}
