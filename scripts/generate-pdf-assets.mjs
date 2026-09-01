#!/usr/bin/env node
/**
 * Fixtures PDF et images de `test-assets/generated/`.
 *
 * Objectif : que les essais manuels ne demandent aucune préparation. Chaque
 * fichier est conçu pour rendre une vérification évidente à l'œil — pages
 * fortement colorées et numérotées, métadonnées connues, mot de passe
 * documenté.
 *
 * Tout est produit localement avec les bibliothèques déjà utilisées par
 * l'application : aucun téléchargement, aucune dépendance supplémentaire.
 *
 * Lancé par `pnpm test:assets`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { createCanvas } from "@napi-rs/canvas";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-assets", "generated");
mkdirSync(OUT, { recursive: true });

/** Mot de passe des fixtures protégées. Documenté dans le README. */
export const FIXTURE_PASSWORD = "fourtout";

const written = [];
function write(name, bytes) {
  writeFileSync(join(OUT, name), bytes);
  written.push([name, bytes.length]);
}

const PALETTE = [
  { name: "ROUGE", color: rgb(0.94, 0.32, 0.32) },
  { name: "VERT", color: rgb(0.29, 0.72, 0.42) },
  { name: "BLEU", color: rgb(0.29, 0.5, 0.9) },
  { name: "ORANGE", color: rgb(0.96, 0.62, 0.24) },
  { name: "VIOLET", color: rgb(0.62, 0.42, 0.88) },
  { name: "TURQUOISE", color: rgb(0.2, 0.75, 0.76) },
];

/**
 * Construit un PDF dont chaque page porte un immense numéro et une couleur
 * distincte : après un découpage ou une réorganisation, l'ordre se vérifie
 * d'un coup d'œil, sans lire le contenu.
 */
async function buildColoredPdf(pageCount, { title, author } = {}) {
  const document = await PDFDocument.create();
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const regular = await document.embedFont(StandardFonts.Helvetica);

  for (let index = 0; index < pageCount; index += 1) {
    const swatch = PALETTE[index % PALETTE.length];
    const page = document.addPage([420, 595]); // A5 portrait
    const { width, height } = page.getSize();

    page.drawRectangle({ x: 0, y: 0, width, height, color: swatch.color });
    page.drawRectangle({
      x: 30,
      y: 30,
      width: width - 60,
      height: height - 60,
      color: rgb(1, 1, 1),
      opacity: 0.9,
    });

    const label = `PAGE ${index + 1}`;
    page.drawText(label, {
      x: (width - bold.widthOfTextAtSize(label, 46)) / 2,
      y: height / 2 + 40,
      size: 46,
      font: bold,
      color: swatch.color,
    });

    const subtitle = `${swatch.name} - page ${index + 1} sur ${pageCount}`;
    page.drawText(subtitle, {
      x: (width - regular.widthOfTextAtSize(subtitle, 13)) / 2,
      y: height / 2 - 10,
      size: 13,
      font: regular,
      color: rgb(0.25, 0.25, 0.25),
    });

    const hint = "FourTout - fichier de test genere automatiquement";
    page.drawText(hint, {
      x: (width - regular.widthOfTextAtSize(hint, 9)) / 2,
      y: 48,
      size: 9,
      font: regular,
      color: rgb(0.55, 0.55, 0.55),
    });
  }

  if (title) document.setTitle(title);
  if (author) document.setAuthor(author);
  return document.save();
}

/** Image de synthèse : dégradé bruité, donc réellement compressible en JPEG. */
function buildPhotoPng(size, seed) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");
  const image = context.createImageData(size, size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const p = (y * size + x) * 4;
      image.data[p] = (x * 255) / size;
      image.data[p + 1] = (y * 255) / size;
      image.data[p + 2] = ((x + y + seed * 57) * 131) % 255;
      image.data[p + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

/** Aplat de couleur avec une étiquette, pour l'outil Images vers PDF. */
function buildLabelledPng(label, [r, g, b]) {
  const canvas = createCanvas(600, 400);
  const context = canvas.getContext("2d");
  context.fillStyle = `rgb(${r}, ${g}, ${b})`;
  context.fillRect(0, 0, 600, 400);
  context.fillStyle = "#ffffff";
  context.fillRect(40, 40, 520, 320);
  context.fillStyle = `rgb(${r}, ${g}, ${b})`;
  context.font = "bold 64px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, 300, 200);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

/* ------------------------------------------------------------ documents */

write("pdf-single-page.pdf", await buildColoredPdf(1));
write("pdf-three-pages.pdf", await buildColoredPdf(3));
write("pdf-five-pages.pdf", await buildColoredPdf(5));
write("pdf-ten-pages.pdf", await buildColoredPdf(10));

write(
  "pdf-with-metadata.pdf",
  await buildColoredPdf(2, {
    title: "Rapport de test FourTout",
    author: "Equipe FourTout",
  }),
);

/* ----------------------------------------------------- documents illustrés */

{
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const image = await document.embedPng(buildPhotoPng(400, 1));
  const page = document.addPage([420, 595]);

  page.drawText("PDF avec une image embarquee", { x: 40, y: 545, size: 16, font });
  page.drawImage(image, { x: 40, y: 120, width: 340, height: 340 });
  page.drawText("Utile pour l'extraction d'images.", { x: 40, y: 80, size: 11, font });
  write("pdf-with-image.pdf", await document.save());
}

{
  // Volontairement lourd : quatre images non compressées, de quoi mesurer un
  // vrai gain avec l'outil de compression.
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.HelveticaBold);

  for (let index = 0; index < 4; index += 1) {
    const image = await document.embedPng(buildPhotoPng(900, index + 2));
    const page = document.addPage([595, 595]);
    page.drawImage(image, { x: 0, y: 0, width: 595, height: 595 });
    page.drawText(`IMAGE ${index + 1}`, { x: 30, y: 30, size: 24, font, color: rgb(1, 1, 1) });
  }
  write("pdf-large-images.pdf", await document.save());
}

/* ------------------------------------------------------------- protégé */

{
  const document = await PDFDocument.load(await buildColoredPdf(2));
  document.encrypt({ userPassword: FIXTURE_PASSWORD, ownerPassword: FIXTURE_PASSWORD });
  write("pdf-protected.pdf", await document.save({ useObjectStreams: false }));
}

/* ------------------------------------------------------------- invalide */

write(
  "pdf-invalid.pdf",
  new TextEncoder().encode("%PDF-1.7\nCe fichier porte l'en-tete d'un PDF mais n'en est pas un.\n"),
);

/* --------------------------------------------------------------- images */

write("page-red.png", buildLabelledPng("ROUGE", [220, 70, 70]));
write("page-green.png", buildLabelledPng("VERT", [70, 180, 100]));
write("page-blue.png", buildLabelledPng("BLEU", [70, 120, 220]));

console.log("Fixtures PDF generees dans test-assets/generated/ :");
for (const [name, size] of written) {
  console.log(`  ${name.padEnd(24)} ${String(size).padStart(9)} octets`);
}
console.log(`\nMot de passe de pdf-protected.pdf : ${FIXTURE_PASSWORD}`);
