import { getRasterBackend, type RasterCanvas, type RasterPixels } from "../raster/types";
import { inspectPdf } from "../document";
import { pdfToImages } from "./toImages";
import { decodeImage } from "@/core/image/codec";
import { PdfError } from "../errors";
import type { OperationContext, PdfSource } from "../types";

/**
 * Comparaison visuelle de deux PDF.
 *
 * Chaque paire de pages est rendue en image (pdf.js) puis comparée pixel à
 * pixel. On produit, par page, un taux de différence et une image de
 * différence (carte de chaleur : les zones modifiées ressortent en rouge sur un
 * fond atténué de la page d'origine). C'est une comparaison **visuelle**, pas
 * sémantique : elle repère fidèlement ce qui a changé à l'écran.
 */

export type PageStatus = "identical" | "different" | "only-in-a" | "only-in-b";

export interface PageComparison {
  page: number;
  status: PageStatus;
  /** Part de pixels différents, de 0 à 1. */
  diffRatio: number;
  /** Rendu de la page A (PNG), si présente. */
  pngA?: Uint8Array;
  pngB?: Uint8Array;
  /** Carte de différence (PNG), si les deux pages existent. */
  diffPng?: Uint8Array;
}

export interface CompareResult {
  pageCountA: number;
  pageCountB: number;
  pages: PageComparison[];
  /** Différence moyenne sur les pages communes, de 0 à 1. */
  overallDiff: number;
}

export interface CompareOptions {
  dpi?: number;
  /** Écart par canal (0-255) au-delà duquel un pixel est jugé différent. */
  threshold?: number;
  /** En deçà de ce taux, la page est considérée identique. */
  sameBelow?: number;
}

export async function comparePdfs(
  a: PdfSource,
  b: PdfSource,
  options: CompareOptions = {},
  context?: OperationContext,
): Promise<CompareResult> {
  const backend = getRasterBackend();
  if (!backend) throw new PdfError("render-unavailable");

  const [infoA, infoB] = await Promise.all([inspectPdf(a), inspectPdf(b)]);
  const countA = infoA.pageCount;
  const countB = infoB.pageCount;
  const total = Math.max(countA, countB);
  const dpi = options.dpi ?? 120;
  const threshold = options.threshold ?? 30;
  const sameBelow = options.sameBelow ?? 0.001;

  const pages: PageComparison[] = [];
  let diffSum = 0;
  let common = 0;

  for (let index = 0; index < total; index += 1) {
    if (context?.signal?.aborted) throw new PdfError("cancelled");
    context?.report?.({ ratio: index / total, label: `Page ${index + 1} sur ${total}` });

    const hasA = index < countA;
    const hasB = index < countB;

    if (hasA && !hasB) {
      pages.push({ page: index + 1, status: "only-in-a", diffRatio: 1, pngA: await renderPage(a, index + 1, dpi) });
      continue;
    }
    if (!hasA && hasB) {
      pages.push({ page: index + 1, status: "only-in-b", diffRatio: 1, pngB: await renderPage(b, index + 1, dpi) });
      continue;
    }

    const canvasA = await renderCanvas(a, index + 1, dpi);
    const canvasB = await renderCanvas(b, index + 1, dpi);
    const { ratio, diff } = diffCanvases(backend, canvasA, canvasB, threshold);
    diffSum += ratio;
    common += 1;
    pages.push({
      page: index + 1,
      status: ratio <= sameBelow ? "identical" : "different",
      diffRatio: ratio,
      pngA: await canvasA.encode("png"),
      pngB: await canvasB.encode("png"),
      diffPng: await diff.encode("png"),
    });
  }

  context?.report?.({ ratio: 1, label: "Terminé" });
  return {
    pageCountA: countA,
    pageCountB: countB,
    pages,
    overallDiff: common > 0 ? diffSum / common : 0,
  };
}

async function renderCanvas(source: PdfSource, page: number, dpi: number): Promise<RasterCanvas> {
  const [rendered] = await pdfToImages(source, { format: "png", dpi, pages: [page] });
  return decodeImage(rendered.bytes, "png");
}

async function renderPage(source: PdfSource, page: number, dpi: number): Promise<Uint8Array> {
  const [rendered] = await pdfToImages(source, { format: "png", dpi, pages: [page] });
  return rendered.bytes;
}

/**
 * Compare deux canvas et renvoie le taux de différence et une carte de chaleur.
 * B est ramené aux dimensions de A ; les débordements de taille comptent comme
 * des différences.
 */
export function diffCanvases(
  backend: NonNullable<ReturnType<typeof getRasterBackend>>,
  a: RasterCanvas,
  b: RasterCanvas,
  threshold: number,
): { ratio: number; diff: RasterCanvas } {
  const pa = a.getPixels();
  const pb = b.width === a.width && b.height === a.height ? b.getPixels() : resample(backend, b, a.width, a.height);

  const diff = backend.createCanvas(a.width, a.height);
  const out: RasterPixels = { width: a.width, height: a.height, data: new Uint8ClampedArray(a.width * a.height * 4) };
  let changed = 0;

  for (let i = 0; i < pa.data.length; i += 4) {
    const dr = Math.abs(pa.data[i] - pb.data[i]);
    const dg = Math.abs(pa.data[i + 1] - pb.data[i + 1]);
    const db = Math.abs(pa.data[i + 2] - pb.data[i + 2]);
    const different = dr > threshold || dg > threshold || db > threshold;
    if (different) {
      changed += 1;
      out.data[i] = 220; out.data[i + 1] = 30; out.data[i + 2] = 40; out.data[i + 3] = 255;
    } else {
      // Fond atténué de la page A, pour situer les changements.
      const gray = (pa.data[i] + pa.data[i + 1] + pa.data[i + 2]) / 3;
      const faded = 200 + gray * 0.22;
      out.data[i] = faded; out.data[i + 1] = faded; out.data[i + 2] = faded; out.data[i + 3] = 255;
    }
  }
  diff.putPixels(out);
  return { ratio: changed / (pa.data.length / 4), diff };
}

function resample(
  backend: NonNullable<ReturnType<typeof getRasterBackend>>,
  source: RasterCanvas,
  width: number,
  height: number,
): RasterPixels {
  return backend.resize(source, width, height).getPixels();
}
