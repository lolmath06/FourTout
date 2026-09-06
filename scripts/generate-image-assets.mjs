#!/usr/bin/env node
/**
 * Génère les fixtures d'images de `test-assets/generated/`.
 *
 * Contrairement au générateur de base (stdlib uniquement), ce script s'appuie
 * sur `@napi-rs/canvas` — déjà présent comme dépendance de développement et
 * utilisé par la suite de tests — pour produire de vraies images : dégradés,
 * transparence, blocs de couleur et surtout du texte net et vérifiable pour
 * l'OCR. Les métadonnées EXIF (orientation, appareil, GPS) sont injectées à la
 * main, `@napi-rs/canvas` ne les écrivant pas.
 *
 * Usage : `pnpm test:assets`
 */
import { createCanvas } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-assets", "generated");
mkdirSync(OUT, { recursive: true });

const written = [];
function write(name, data) {
  writeFileSync(join(OUT, name), data);
  written.push([name, data.length]);
}

/** Texte OCR : fond blanc, texte noir net, marges généreuses. */
function textImage(lines, { width = 620, lineHeight = 58, font = "34px Cantarell" } = {}) {
  const height = 40 + lines.length * lineHeight;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#111111";
  ctx.font = font;
  ctx.textBaseline = "top";
  lines.forEach((line, index) => ctx.fillText(line, 24, 24 + index * lineHeight));
  return canvas;
}

/** Dégradé coloré simple. */
function gradient(width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, "#2563eb");
  grad.addColorStop(0.5, "#10b981");
  grad.addColorStop(1, "#f59e0b");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "bold 28px Cantarell";
  ctx.fillText("FourTout", 16, 16);
  return canvas;
}

/* ------------------------------------------------------------ conversions */

write("image-landscape.jpg", gradient(240, 160).toBuffer("image/jpeg", 90));
write("image-portrait.jpg", gradient(160, 240).toBuffer("image/jpeg", 90));
write("image-small.png", gradient(8, 8).toBuffer("image/png"));

// Grande image (dimensions élevées, fichier léger car aplat) : test perf.
{
  const c = createCanvas(4000, 3000);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#3b82f6";
  ctx.fillRect(0, 0, 4000, 3000);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 200px Cantarell";
  ctx.fillText("4000 x 3000", 200, 200);
  write("image-large.jpg", c.toBuffer("image/jpeg", 70));
}

// WebP de référence.
write("image-sample.webp", gradient(120, 120).toBuffer("image/webp", 85));

/* ----------------------------------------------------------- transparence */

{
  const c = createCanvas(96, 96);
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, 96, 96); // fond transparent
  ctx.fillStyle = "#e11d48";
  ctx.beginPath();
  ctx.arc(48, 48, 36, 0, Math.PI * 2);
  ctx.fill();
  write("image-transparent.png", c.toBuffer("image/png"));
}

/* --------------------------------------------------------- blocs couleurs */

{
  const c = createCanvas(80, 80);
  const ctx = c.getContext("2d");
  const colors = ["#ff0000", "#00ff00", "#0000ff", "#ffffff"];
  colors.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect((i % 2) * 40, Math.floor(i / 2) * 40, 40, 40);
  });
  write("image-colors.png", c.toBuffer("image/png"));
}

/* ----------------------------------------------------------------- OCR */

write(
  "image-text-fr.png",
  textImage([
    "FourTout reconnait ce texte.",
    "Facture numero 2026-042.",
    "Montant total : 128,50 euros.",
  ]).toBuffer("image/png"),
);

write(
  "image-text-en.png",
  textImage([
    "FourTout reads this text.",
    "Invoice number 2026-042.",
    "Total amount: 128.50 euros.",
  ]).toBuffer("image/png"),
);

/* ----------------------------------------------------------------- EXIF */

write(
  "image-exif.jpg",
  injectExif(gradient(240, 160).toBuffer("image/jpeg", 90), {
    orientation: 1,
    make: "FourTout",
    model: "TestCam 100",
    dateTime: "2026:01:15 10:30:00",
    gps: { lat: 48.8584, lon: 2.2945 }, // Tour Eiffel
  }),
);

// Pixels paysage mais orientation 6 : une fois redressée, l'image est portrait.
write(
  "image-rotated-exif.jpg",
  injectExif(landscapeMarker().toBuffer("image/jpeg", 90), { orientation: 6 }),
);

/** Image paysage marquée (coin haut-gauche rouge) pour vérifier l'orientation. */
function landscapeMarker() {
  const c = createCanvas(200, 100);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 0, 200, 100);
  ctx.fillStyle = "#ef4444";
  ctx.fillRect(0, 0, 40, 20); // repère haut-gauche
  write.__marker = true;
  return c;
}

/* ------------------------------------------------------------------ SVG */

// Contient volontairement un <script> et une référence externe : la
// sanitisation doit les retirer avant tout rendu.
write(
  "image-test.svg",
  Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="120" height="120" viewBox="0 0 120 120">
  <script>window.__pwned = true;</script>
  <rect width="120" height="120" fill="#0ea5e9"/>
  <circle cx="60" cy="60" r="40" fill="#f59e0b"/>
  <image href="https://example.com/track.png" x="0" y="0" width="10" height="10"/>
  <text x="16" y="105" font-family="sans-serif" font-size="18" fill="#ffffff">SVG</text>
</svg>
`,
    "utf8",
  ),
);

/* ------------------------------------------------------------- GIF animé */

write("image-animated.gif", makeAnimatedGif());

/* ================================================================= EXIF */

/**
 * Insère un segment APP1/EXIF (TIFF gros-boutiste) juste après le SOI d'un
 * JPEG. Suffisant pour orientation, appareil, date et coordonnées GPS.
 */
function injectExif(jpeg, { orientation = 1, make, model, dateTime, gps } = {}) {
  const ifd0 = [];
  if (orientation) ifd0.push({ tag: 0x0112, type: 3, values: [orientation] });
  if (make) ifd0.push({ tag: 0x010f, type: 2, values: ascii(make) });
  if (model) ifd0.push({ tag: 0x0110, type: 2, values: ascii(model) });
  if (dateTime) ifd0.push({ tag: 0x0132, type: 2, values: ascii(dateTime) });

  let gpsBlock = null;
  if (gps) {
    const gpsEntries = [
      { tag: 0x0001, type: 2, values: ascii(gps.lat >= 0 ? "N" : "S") },
      { tag: 0x0002, type: 5, values: dmsRationals(Math.abs(gps.lat)) },
      { tag: 0x0003, type: 2, values: ascii(gps.lon >= 0 ? "E" : "W") },
      { tag: 0x0004, type: 5, values: dmsRationals(Math.abs(gps.lon)) },
    ];
    gpsBlock = gpsEntries;
  }

  const tiff = buildTiff(ifd0, gpsBlock);
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1]),
    u16be(exif.length + 2),
    exif,
  ]);
  // Insère après le SOI (2 premiers octets).
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

function ascii(str) {
  return [...Buffer.from(str, "latin1"), 0];
}

function dmsRationals(deg) {
  const d = Math.floor(deg);
  const m = Math.floor((deg - d) * 60);
  const s = Math.round((deg - d - m / 60) * 3600 * 100);
  return [[d, 1], [m, 1], [s, 100]];
}

/** Construit un bloc TIFF gros-boutiste avec IFD0 et un IFD GPS optionnel. */
function buildTiff(ifd0Entries, gpsEntries) {
  // On calcule d'abord les tailles pour placer les zones de valeurs.
  const header = Buffer.concat([Buffer.from("MM", "latin1"), u16be(0x2a), u32be(8)]);
  const entries = [...ifd0Entries];

  // Réserve la place du pointeur GPS si nécessaire.
  let gpsPointerEntry = null;
  if (gpsEntries) {
    gpsPointerEntry = { tag: 0x8825, type: 4, values: [0] }; // rempli plus tard
    entries.push(gpsPointerEntry);
  }
  entries.sort((a, b) => a.tag - b.tag);

  const ifd0Offset = 8;
  const ifd0Size = 2 + entries.length * 12 + 4;
  let valueOffset = ifd0Offset + ifd0Size;

  // Sérialise IFD0 et récupère la position des valeurs longues.
  const valueChunks = [];
  const ifd0Body = serializeIfd(entries, valueOffset, valueChunks);
  valueOffset += valueChunks.reduce((sum, c) => sum + c.length, 0);

  let gpsSection = Buffer.alloc(0);
  if (gpsEntries) {
    const gpsOffset = valueOffset;
    gpsPointerEntry.values = [gpsOffset];
    // Réécrit IFD0 avec le bon pointeur GPS.
    const chunks2 = [];
    const ifd0Body2 = serializeIfd(entries, ifd0Offset + ifd0Size, chunks2);
    const gpsSize = 2 + gpsEntries.length * 12 + 4;
    const gpsValueChunks = [];
    const gpsBody = serializeIfd(gpsEntries, gpsOffset + gpsSize, gpsValueChunks);
    gpsSection = Buffer.concat([gpsBody, ...gpsValueChunks]);
    return Buffer.concat([header, ifd0Body2, ...chunks2, gpsSection]);
  }

  return Buffer.concat([header, ifd0Body, ...valueChunks]);
}

function serializeIfd(entries, valueBase, outChunks) {
  const count = entries.length;
  const buf = Buffer.alloc(2 + count * 12 + 4);
  buf.writeUInt16BE(count, 0);
  let offset = valueBase;
  entries.forEach((entry, i) => {
    const at = 2 + i * 12;
    buf.writeUInt16BE(entry.tag, at);
    buf.writeUInt16BE(entry.type, at + 2);
    const { data, count: valueCount } = encodeValues(entry);
    buf.writeUInt32BE(valueCount, at + 4);
    if (data.length <= 4) {
      data.copy(buf, at + 8);
    } else {
      buf.writeUInt32BE(offset, at + 8);
      outChunks.push(data);
      offset += data.length;
    }
  });
  buf.writeUInt32BE(0, 2 + count * 12); // pas d'IFD suivant
  return buf;
}

function encodeValues(entry) {
  if (entry.type === 2) {
    // ASCII : values est déjà un tableau d'octets terminé par 0.
    return { data: Buffer.from(entry.values), count: entry.values.length };
  }
  if (entry.type === 3) {
    const data = Buffer.alloc(Math.max(4, entry.values.length * 2));
    entry.values.forEach((v, i) => data.writeUInt16BE(v, i * 2));
    return { data: data.subarray(0, Math.max(4, entry.values.length * 2)), count: entry.values.length };
  }
  if (entry.type === 4) {
    const data = Buffer.alloc(4 * entry.values.length);
    entry.values.forEach((v, i) => data.writeUInt32BE(v, i * 4));
    return { data, count: entry.values.length };
  }
  if (entry.type === 5) {
    const data = Buffer.alloc(8 * entry.values.length);
    entry.values.forEach(([num, den], i) => {
      data.writeUInt32BE(num, i * 8);
      data.writeUInt32BE(den, i * 8 + 4);
    });
    return { data, count: entry.values.length };
  }
  throw new Error(`type EXIF non géré : ${entry.type}`);
}

function u16be(value) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(value);
  return b;
}
function u32be(value) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value);
  return b;
}

/* ================================================================= GIF */

/** GIF89a animé minimal, deux frames 4×4 (rouge puis bleu). */
function makeAnimatedGif() {
  const parts = [];
  parts.push(Buffer.from("GIF89a", "latin1"));
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(4, 0);
  lsd.writeUInt16LE(4, 2);
  lsd[4] = 0b10010001; // GCT présente, table de 4 couleurs
  parts.push(lsd);
  // Rouge, bleu, blanc, noir.
  parts.push(Buffer.from([255, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0]));
  // Boucle infinie (NETSCAPE2.0).
  parts.push(Buffer.from([0x21, 0xff, 0x0b]));
  parts.push(Buffer.from("NETSCAPE2.0", "latin1"));
  parts.push(Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]));

  for (const colorIndex of [0, 1]) {
    parts.push(Buffer.from([0x21, 0xf9, 0x04, 0x00, 0x32, 0x00, 0x00])); // délai 0,5 s
    const desc = Buffer.alloc(10);
    desc[0] = 0x2c;
    desc.writeUInt16LE(4, 5);
    desc.writeUInt16LE(4, 7);
    parts.push(desc);
    const indices = new Array(16).fill(colorIndex);
    parts.push(encodeLzw(indices, 2));
  }
  parts.push(Buffer.from([0x3b])); // trailer
  return Buffer.concat(parts);
}

/**
 * Encodeur LZW GIF volontairement simplifié : un CLEAR est émis avant chaque
 * pixel, de sorte que le dictionnaire ne grandit jamais et que la largeur de
 * code reste fixe. Inefficace, mais rigoureusement conforme et sans piège de
 * « early change » — adapté à nos frames minuscules (16 pixels).
 */
function encodeLzw(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const codeSize = minCodeSize + 1;

  const bytes = [];
  let bitBuffer = 0;
  let bitCount = 0;
  const emit = (code) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      bytes.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  emit(clearCode);
  for (const index of indices) {
    emit(index);
    emit(clearCode);
  }
  emit(endCode);
  if (bitCount > 0) bytes.push(bitBuffer & 0xff);

  const out = [minCodeSize];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0x00);
  return Buffer.from(out);
}

/* ------------------------------------------------- détourage (segmentation) */

/**
 * Fixtures de l'outil « Retirer l'arrière-plan ».
 *
 * Un modèle de segmentation cherche le **sujet saillant** : il lui faut donc
 * une forme bien détachée d'un fond distinct, sinon la fixture ne prouve rien.
 * Trois cas volontairement différents : une silhouette de personne, un objet
 * compact, et une forme à bords durs avec un trou — le trou est ce qui casse
 * les détoureurs qui se contentent d'un contour extérieur.
 */
function backgroundScene(width, height, paint) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  // Fond dégradé, comme un mur éclairé : uniforme serait trop facile.
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#b9d8f2");
  sky.addColorStop(1, "#7fa9cc");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  paint(ctx, width, height);
  return canvas;
}

{
  // Silhouette : tête, épaules, buste. De loin, c'est une personne.
  const c = backgroundScene(360, 480, (ctx, w, h) => {
    ctx.fillStyle = "#2f2a26";
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.24, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w / 2 - 118, h);
    ctx.quadraticCurveTo(w / 2 - 108, h * 0.44, w / 2, h * 0.40);
    ctx.quadraticCurveTo(w / 2 + 108, h * 0.44, w / 2 + 118, h);
    ctx.closePath();
    ctx.fill();
  });
  write("background-person.png", c.toBuffer("image/png"));
}

{
  // Objet compact et saturé, encodé en JPEG : le décodeur doit aussi passer.
  const c = backgroundScene(400, 300, (ctx, w, h) => {
    ctx.fillStyle = "#d94f2b";
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, 104, 82, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#7a2f18";
    ctx.fillRect(w / 2 - 8, h / 2 - 110, 16, 34);
  });
  write("background-object.jpg", c.toBuffer("image/jpeg", 92));
}

{
  // Bords durs et trou central : un contour extérieur seul le raterait.
  const c = backgroundScene(360, 360, (ctx, w, h) => {
    ctx.fillStyle = "#1d2f5c";
    ctx.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.6);
    ctx.fillStyle = "#b9d8f2";
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 52, 0, Math.PI * 2);
    ctx.fill();
  });
  write("background-hard-edges.png", c.toBuffer("image/png"));
}

console.log("Fixtures images générées dans test-assets/generated/ :");
for (const [name, size] of written.sort()) {
  console.log(`  ${name.padEnd(24)} ${String(size).padStart(8)} octets`);
}
