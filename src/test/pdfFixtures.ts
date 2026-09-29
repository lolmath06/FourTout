import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import type { PdfSource } from "@/core/pdf/types";

/**
 * Fabriques de PDF pour les tests.
 *
 * Les tests d'intégration PDF travaillent sur de vrais documents produits ici :
 * un test qui « vérifie » une fusion sur un fichier factice ne prouverait rien.
 */

export interface BuildOptions {
  pageCount?: number;
  /** Libellé écrit sur chaque page ; `PAGE 1`, `PAGE 2`… par défaut. */
  labels?: string[];
  size?: [number, number];
  title?: string;
  author?: string;
}

const COLORS = [
  rgb(1, 0.82, 0.82),
  rgb(0.82, 1, 0.85),
  rgb(0.82, 0.88, 1),
  rgb(1, 0.96, 0.78),
  rgb(0.93, 0.85, 1),
];

/** Construit un PDF de test dont chaque page porte un texte identifiable. */
export async function buildPdf(options: BuildOptions = {}): Promise<Uint8Array> {
  const { pageCount = 1, size = [300, 400] } = options;
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);

  for (let index = 0; index < pageCount; index += 1) {
    const label = options.labels?.[index] ?? `PAGE ${index + 1}`;
    const page = document.addPage(size);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: size[0],
      height: size[1],
      color: COLORS[index % COLORS.length],
    });
    page.drawText(label, { x: 24, y: size[1] / 2, size: 22, font });
  }

  if (options.title) document.setTitle(options.title);
  if (options.author) document.setAuthor(options.author);

  return document.save();
}

/** Raccourci : un PDF de test emballé en source d'opération. */
export async function buildSource(
  name: string,
  options: BuildOptions = {},
): Promise<PdfSource> {
  return { name, bytes: await buildPdf(options) };
}

/** Lit le texte d'une page d'un PDF, pour vérifier l'ordre après manipulation. */
export async function readPageLabels(bytes: Uint8Array): Promise<string[]> {
  const { openWithPdfJs } = await import("@/core/pdf/pdfjs");
  const document = await openWithPdfJs({ name: "check.pdf", bytes });
  const labels: string[] = [];
  try {
    for (let page = 1; page <= document.numPages; page += 1) {
      const content = await (await document.getPage(page)).getTextContent();
      labels.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join("")
          .trim(),
      );
    }
  } finally {
    await document.loadingTask?.destroy();
  }
  return labels;
}

/** Nombre de pages d'un PDF, vérifié via pdf-lib. */
export async function pageCountOf(bytes: Uint8Array): Promise<number> {
  const document = await PDFDocument.load(bytes);
  return document.getPageCount();
}

/**
 * Construit un PNG minimal, sans dépendance : utile pour tester la conversion
 * d'images en PDF avec de vraies images plutôt que des octets arbitraires.
 */
export async function buildPng(
  width: number,
  height: number,
  color: [number, number, number],
): Promise<Uint8Array> {
  const { nodeRasterBackend } = await import("./nodeRaster");
  const canvas = nodeRasterBackend.createCanvas(width, height);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    pixels[i * 4] = color[0];
    pixels[i * 4 + 1] = color[1];
    pixels[i * 4 + 2] = color[2];
    pixels[i * 4 + 3] = 255;
  }
  canvas.putPixels({ width, height, data: pixels });
  return canvas.encode("png");
}
