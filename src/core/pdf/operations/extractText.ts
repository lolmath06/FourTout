import { openWithPdfJs } from "../pdfjs";
import { report, throwIfCancelled } from "../document";
import { outputName } from "../filenames";
import type { OperationContext, OutputFile, PdfSource } from "../types";

/**
 * Extraction du texte réellement présent dans le document.
 *
 * Ce n'est **pas** de la reconnaissance de caractères : une page scannée, qui
 * ne contient qu'une image, ne produit aucun texte. L'interface le dit
 * explicitement plutôt que de laisser croire à un échec.
 */

export interface ExtractedPageText {
  /** Numéro de page, base 1. */
  page: number;
  text: string;
}

export interface ExtractedText {
  pages: ExtractedPageText[];
  /** Nombre de pages n'ayant produit aucun texte (probablement des scans). */
  emptyPages: number;
  get totalCharacters(): number;
}

export async function extractText(
  source: PdfSource,
  context?: OperationContext,
): Promise<ExtractedText> {
  const document = await openWithPdfJs(source);
  const pages: ExtractedPageText[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      throwIfCancelled(context);
      report(context, (pageNumber - 1) / document.numPages, `Page ${pageNumber}`);

      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push({ page: pageNumber, text: assembleText(content.items) });
      page.cleanup();
    }
  } finally {
    await document.loadingTask?.destroy();
  }

  report(context, 1, "Terminé");
  const emptyPages = pages.filter((page) => page.text.trim().length === 0).length;
  return {
    pages,
    emptyPages,
    get totalCharacters() {
      return pages.reduce((total, page) => total + page.text.length, 0);
    },
  };
}

/**
 * Recompose des lignes lisibles à partir des fragments de pdf.js.
 *
 * pdf.js livre le texte en morceaux positionnés, pas en lignes : on s'appuie
 * sur son indicateur de fin de ligne, et sur les écarts verticaux entre
 * fragments pour les documents qui ne le fournissent pas.
 */
function assembleText(items: readonly unknown[]): string {
  let text = "";
  let previousY: number | undefined;

  for (const item of items) {
    if (typeof item !== "object" || item === null || !("str" in item)) continue;
    const entry = item as { str: string; hasEOL?: boolean; transform?: number[] };

    const y = entry.transform?.[5];
    if (previousY !== undefined && y !== undefined && Math.abs(y - previousY) > 1) {
      if (!text.endsWith("\n")) text += "\n";
    }
    text += entry.str;
    if (entry.hasEOL) text += "\n";
    if (y !== undefined) previousY = y;
  }

  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Assemble le texte de toutes les pages avec un séparateur lisible. */
export function joinPages(extracted: ExtractedText): string {
  return extracted.pages
    .map((page) => `--- Page ${page.page} ---\n${page.text || "(aucun texte sur cette page)"}`)
    .join("\n\n");
}

/** Produit le fichier `.txt` téléchargeable. */
export function textToFile(source: PdfSource, extracted: ExtractedText): OutputFile {
  const content = joinPages(extracted);
  return {
    name: outputName(source.name, "texte", "txt"),
    bytes: new TextEncoder().encode(content),
    mimeType: "text/plain;charset=utf-8",
  };
}
