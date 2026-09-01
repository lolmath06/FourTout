import { degrees, PDFDocument } from "@cantoo/pdf-lib";
import { loadPdf, report, savePdf, throwIfCancelled } from "../document";
import { PdfError } from "../errors";
import { formatPageRange, invertSelection } from "../pageRange";
import { numberedName, outputName } from "../filenames";
import type {
  OperationContext,
  OutputFile,
  PdfSource,
  RotationAngle,
} from "../types";

/**
 * Opérations de structure : fusion, découpage, extraction, suppression,
 * réorganisation et rotation.
 *
 * Toutes suivent le même contrat : elles reçoivent des sources en octets,
 * renvoient de nouveaux fichiers et ne modifient jamais l'entrée.
 */

/** Fusionne plusieurs PDF dans l'ordre fourni. */
export async function mergePdfs(
  sources: readonly PdfSource[],
  context?: OperationContext,
): Promise<OutputFile> {
  if (sources.length < 2) throw new PdfError("not-enough-files");

  const merged = await PDFDocument.create();

  for (const [index, source] of sources.entries()) {
    throwIfCancelled(context);
    report(context, index / sources.length, `Ajout de ${source.name}`);

    const document = await loadPdf(source);
    const pageCount = document.getPageCount();
    if (pageCount === 0) {
      throw new PdfError("empty-document", `« ${source.name} » ne contient aucune page.`);
    }
    const pages = await merged.copyPages(document, document.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }

  report(context, 1, "Écriture du document");
  return savePdf(merged, outputName(sources[0].name, "fusionne"));
}

/**
 * Construit un nouveau document à partir de pages choisies, dans l'ordre donné.
 * Base commune de l'extraction, de la suppression, de la réorganisation et du
 * découpage : une seule implémentation de la copie de pages.
 */
async function documentFromPages(
  source: PdfSource,
  pages: readonly number[],
  context?: OperationContext,
): Promise<PDFDocument> {
  if (pages.length === 0) throw new PdfError("no-pages-selected");

  const document = await loadPdf(source);
  const pageCount = document.getPageCount();
  const invalid = pages.filter((page) => page < 1 || page > pageCount);
  if (invalid.length > 0) {
    throw new PdfError(
      "page-out-of-range",
      `Ce document a ${pageCount} page${pageCount > 1 ? "s" : ""} ; page(s) demandée(s) : ${invalid.join(", ")}.`,
    );
  }

  throwIfCancelled(context);
  const output = await PDFDocument.create();
  const copied = await output.copyPages(
    document,
    pages.map((page) => page - 1),
  );
  copied.forEach((page) => output.addPage(page));
  return output;
}

/** Crée un PDF ne contenant que les pages demandées, dans l'ordre demandé. */
export async function extractPages(
  source: PdfSource,
  pages: readonly number[],
  context?: OperationContext,
): Promise<OutputFile> {
  const document = await documentFromPages(source, pages, context);
  report(context, 1, "Écriture du document");
  return savePdf(document, outputName(source.name, `pages-${formatPageRange(pages).replace(/,\s*/g, "_")}`));
}

/** Crée un PDF privé des pages demandées. */
export async function removePages(
  source: PdfSource,
  pages: readonly number[],
  context?: OperationContext,
): Promise<OutputFile> {
  const probe = await loadPdf(source);
  const pageCount = probe.getPageCount();
  const kept = invertSelection(pages, pageCount);

  if (kept.length === 0) throw new PdfError("would-remove-all-pages");

  const document = await documentFromPages(source, kept, context);
  report(context, 1, "Écriture du document");
  return savePdf(document, outputName(source.name, "pages-supprimees"));
}

/**
 * Réécrit le document dans un nouvel ordre de pages.
 * `order` contient chaque numéro de page exactement une fois.
 */
export async function reorderPages(
  source: PdfSource,
  order: readonly number[],
  context?: OperationContext,
): Promise<OutputFile> {
  const probe = await loadPdf(source);
  const pageCount = probe.getPageCount();

  const unique = new Set(order);
  if (unique.size !== order.length || order.length !== pageCount) {
    throw new PdfError(
      "invalid-range",
      "Le nouvel ordre doit contenir chaque page du document exactement une fois.",
    );
  }

  const document = await documentFromPages(source, order, context);
  report(context, 1, "Écriture du document");
  return savePdf(document, outputName(source.name, "reorganise"));
}

export type SplitMode = "each-page" | "groups";

export interface SplitOptions {
  mode: SplitMode;
  /** Groupes de pages, requis en mode `groups`. */
  groups?: number[][];
}

/** Découpe un PDF, page par page ou par groupes de pages. */
export async function splitPdf(
  source: PdfSource,
  options: SplitOptions,
  context?: OperationContext,
): Promise<OutputFile[]> {
  const probe = await loadPdf(source);
  const pageCount = probe.getPageCount();

  const groups: number[][] =
    options.mode === "each-page"
      ? Array.from({ length: pageCount }, (_, index) => [index + 1])
      : (options.groups ?? []);

  if (groups.length === 0) throw new PdfError("no-pages-selected");

  const outputs: OutputFile[] = [];
  for (const [index, pages] of groups.entries()) {
    throwIfCancelled(context);
    report(context, index / groups.length, `Document ${index + 1} sur ${groups.length}`);

    const document = await documentFromPages(source, pages, context);
    const label = formatPageRange(pages).replace(/,\s*/g, "_");
    const name =
      options.mode === "each-page"
        ? numberedName(source.name, pages[0], pageCount, "pdf")
        : outputName(source.name, `pages-${label}`);
    outputs.push(await savePdf(document, name));
  }

  report(context, 1, "Terminé");
  return outputs;
}

export interface RotateOptions {
  angle: RotationAngle;
  /** Pages à faire pivoter ; toutes les pages si absent. */
  pages?: readonly number[];
}

/**
 * Fait pivoter des pages. La rotation s'ajoute à celle déjà présente dans le
 * document : faire pivoter de 90° une page déjà à 90° donne 180°, comme dans
 * un lecteur PDF classique.
 */
export async function rotatePages(
  source: PdfSource,
  options: RotateOptions,
  context?: OperationContext,
): Promise<OutputFile> {
  const document = await loadPdf(source);
  const pageCount = document.getPageCount();
  const targets = options.pages ?? Array.from({ length: pageCount }, (_, i) => i + 1);

  if (targets.length === 0) throw new PdfError("no-pages-selected");
  const invalid = targets.filter((page) => page < 1 || page > pageCount);
  if (invalid.length > 0) {
    throw new PdfError("page-out-of-range", `Page(s) inexistante(s) : ${invalid.join(", ")}.`);
  }

  for (const [index, pageNumber] of targets.entries()) {
    throwIfCancelled(context);
    const page = document.getPage(pageNumber - 1);
    const current = page.getRotation().angle;
    page.setRotation(degrees(normalizeAngle(current + options.angle)));
    report(context, index / targets.length);
  }

  report(context, 1, "Écriture du document");
  return savePdf(document, outputName(source.name, "pivote"));
}

/** Ramène un angle dans [0, 360) et l'aligne sur un quart de tour. */
export function normalizeAngle(angle: number): number {
  const rounded = Math.round(angle / 90) * 90;
  return ((rounded % 360) + 360) % 360;
}
