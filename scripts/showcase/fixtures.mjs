#!/usr/bin/env node
/**
 * Fichiers fictifs utilisés pendant les captures.
 *
 * Aucune donnée réelle : des PDF et des images synthétiques, dessinés ici,
 * avec des noms et des contenus manifestement fictifs. Ils sont écrits dans
 * `showcase-output/fixtures/`, qui n'est pas versionné.
 *
 * Usage : `node scripts/showcase/fixtures.mjs` — `SHOWCASE_LANG=en` écrit la
 * variante anglaise (noms et contenus en anglais), à côté de la française.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { FIXTURES } from "./paths.mjs";

mkdirSync(FIXTURES, { recursive: true });

/** Noms et textes visibles à l'écran, par langue de la vitrine. */
export const FIXTURE_TEXT = {
  fr: {
    author: "Exemple",
    footer: "Document d'exemple — contenu fictif",
    pdfs: [
      ["rapport-annuel-exemple.pdf", "Rapport annuel (exemple)", 6],
      ["annexes-exemple.pdf", "Annexes (exemple)", 3],
      ["presentation-exemple.pdf", "Présentation (exemple)", 4],
    ],
    image: "paysage-exemple",
  },
  en: {
    author: "Sample",
    footer: "Sample document — fictitious content",
    pdfs: [
      ["annual-report-sample.pdf", "Annual report (sample)", 6],
      ["appendices-sample.pdf", "Appendices (sample)", 3],
      ["presentation-sample.pdf", "Presentation (sample)", 4],
    ],
    image: "landscape-sample",
  },
};
const TEXT = FIXTURE_TEXT[process.env.SHOWCASE_LANG ?? "fr"] ?? FIXTURE_TEXT.fr;

// ---------------------------------------------------------------- PDF

async function pdf(file, title, pages) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor(TEXT.author);
  doc.setProducer("FourTout showcase fixtures");
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawRectangle({ x: 0, y: 782, width: 595, height: 60, color: rgb(0.07, 0.12, 0.22) });
    page.drawText(title, { x: 48, y: 805, size: 18, font: bold, color: rgb(1, 1, 1) });
    page.drawText(`Page ${i + 1} / ${pages}`, { x: 48, y: 740, size: 11, font: regular, color: rgb(0.4, 0.45, 0.5) });
    for (let line = 0; line < 22; line++) {
      const width = 380 + ((line * 37 + i * 53) % 110);
      page.drawRectangle({ x: 48, y: 700 - line * 24, width, height: 8, color: rgb(0.86, 0.88, 0.91) });
    }
    page.drawRectangle({ x: 48, y: 90, width: 499, height: 70, color: rgb(0.93, 0.95, 0.99) });
    page.drawText(TEXT.footer, { x: 64, y: 120, size: 11, font: regular, color: rgb(0.2, 0.3, 0.55) });
  }
  writeFileSync(join(FIXTURES, file), await doc.save());
}

for (const [file, title, pages] of TEXT.pdfs) await pdf(file, title, pages);

// ------------------------------------------------------------- images

/** Un paysage synthétique : ciel, montagnes, lac. Rien de photographique. */
function landscape(width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, height * 0.62);
  sky.addColorStop(0, "#1d3b6e");
  sky.addColorStop(0.55, "#4f7fbf");
  sky.addColorStop(1, "#f2c48d");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(255, 236, 200, 0.9)";
  ctx.beginPath();
  ctx.arc(width * 0.7, height * 0.42, height * 0.07, 0, Math.PI * 2);
  ctx.fill();

  const ridge = (base, amp, freq, color, seed) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += 4) {
      const t = x / width;
      const y =
        base -
        amp * (0.55 * Math.sin(t * freq + seed) + 0.3 * Math.sin(t * freq * 2.7 + seed * 2) + 0.15 * Math.sin(t * freq * 6.1));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
  };
  ridge(height * 0.56, height * 0.14, 5, "#5b6f93", 1);
  ridge(height * 0.62, height * 0.12, 7, "#34476b", 3);
  ridge(height * 0.68, height * 0.08, 9, "#1c2a45", 5);

  const lake = ctx.createLinearGradient(0, height * 0.68, 0, height);
  lake.addColorStop(0, "#2e4f80");
  lake.addColorStop(1, "#0f1d36");
  ctx.fillStyle = lake;
  ctx.fillRect(0, height * 0.68, width, height * 0.32);
  ctx.fillStyle = "rgba(255, 220, 170, 0.35)";
  for (let i = 0; i < 18; i++) {
    const w = width * (0.02 + 0.05 * Math.abs(Math.sin(i * 12.9898)));
    ctx.fillRect(width * 0.7 - w / 2, height * 0.7 + i * height * 0.015, w, 2);
  }
  return canvas;
}

writeFileSync(join(FIXTURES, `${TEXT.image}.png`), landscape(1600, 1000).toBuffer("image/png"));
writeFileSync(join(FIXTURES, `${TEXT.image}.jpg`), landscape(1600, 1000).toBuffer("image/jpeg", 90));

console.log(`Fixtures écrites dans ${FIXTURES}`);
