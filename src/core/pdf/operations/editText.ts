import { StandardFonts, rgb, type PDFFont } from "@cantoo/pdf-lib";
import { loadPdf, savePdf } from "../document";
import { openWithPdfJs } from "../pdfjs";
import { outputName } from "../filenames";
import { PdfError } from "../errors";
import type { RasterPixels } from "../raster/types";
import type { OutputFile, PdfSource } from "../types";

/**
 * Édition visuelle du texte d'un PDF.
 *
 * ## Nature réelle de l'édition (à lire avant de juger l'approche)
 *
 * On ne réécrit **pas** les flux de contenu ni les polices *subset* du document
 * d'origine : c'est irréalisable de façon fiable sur des PDF quelconques
 * (encodages de glyphes, `Tj`/`TJ`, matrices, sous-ensembles de polices). On
 * procède par **remplacement visuel** : on recouvre le texte d'origine par un
 * aplat de la couleur de fond **échantillonnée** sous la zone, puis on redessine
 * le nouveau texte (taille, graisse, couleur approchées).
 *
 * Le risque d'un remplacement visuel naïf est de détruire un fond coloré, une
 * photo ou un graphique situé derrière le texte. On l'évite en **détectant**
 * l'uniformité du fond autour de la zone (`sampleTextStyle`) : si le fond n'est
 * pas uniforme, l'édition est **refusée** et signalée à l'utilisateur plutôt que
 * d'abîmer la page. Les textes pivotés/verticaux sont également refusés (v1).
 *
 * L'extraction des positions s'appuie sur pdf.js (`getTextContent`), dont les
 * `transform` sont exprimés en points utilisateur PDF (origine en bas à gauche),
 * exactement le repère de pdf-lib : aucune conversion d'axe n'est nécessaire au
 * dessin.
 */

/** Couleur en composantes 0–1 (repère de pdf-lib). */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Un fragment de texte éditable, positionné en points PDF (origine bas-gauche). */
export interface EditableTextItem {
  /** Indice stable du fragment dans la page. */
  index: number;
  text: string;
  /** Abscisse gauche, en points. */
  x: number;
  /** Ordonnée de la ligne de base, en points (origine en bas). */
  y: number;
  /** Largeur d'avance du fragment, en points. */
  width: number;
  /** Hauteur du fragment (~corps de la police), en points. */
  height: number;
  /** Corps de police estimé, en points. */
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  /** Écriture verticale (limitation : non éditable proprement). */
  vertical: boolean;
  /** Texte pivoté/incliné (limitation : non éditable proprement). */
  rotated: boolean;
}

/** Le texte éditable d'une page, avec ses dimensions en points. */
export interface EditablePage {
  pageNumber: number;
  widthPts: number;
  heightPts: number;
  items: EditableTextItem[];
}

/** Une modification demandée par l'utilisateur, prête pour l'export. */
export interface PdfTextEdit {
  page: number;
  index: number;
  originalText: string;
  replacementText: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  fontFamily: string;
  vertical: boolean;
  rotated: boolean;
  /** Couleur du texte échantillonnée (défaut : quasi-noir). */
  color: RGB;
  /** Couleur de fond échantillonnée, pour recouvrir l'ancien texte. */
  background: RGB;
  /** Le fond est-il uniforme ? Sinon l'édition est refusée à l'export. */
  uniformBackground: boolean;
}

/** Bilan d'un export. */
export interface ApplyEditsResult {
  file: OutputFile;
  /** Modifications réellement dessinées. */
  applied: number;
  /** Modifications refusées (fond non uniforme, texte pivoté/vertical). */
  refused: number;
  /** Modifications dessinées mais dont le texte déborde probablement. */
  overflowed: number;
}

/** Extrait les fragments de texte éditables d'une page (base 1). */
export async function extractPageText(
  source: PdfSource,
  pageNumber: number,
): Promise<EditablePage> {
  const document = await openWithPdfJs(source);
  try {
    if (pageNumber < 1 || pageNumber > document.numPages) {
      throw new PdfError("page-out-of-range", `Page ${pageNumber} inexistante.`);
    }
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = (await page.getTextContent()) as {
      items: unknown[];
      styles: Record<string, { fontFamily?: string; vertical?: boolean }>;
    };

    const items: EditableTextItem[] = [];
    let index = 0;
    for (const raw of content.items) {
      const item = raw as {
        str?: string;
        width?: number;
        height?: number;
        transform?: number[];
        fontName?: string;
      };
      const text = item.str ?? "";
      const transform = item.transform;
      // On ne garde que les fragments réellement textuels (les sauts de ligne
      // « marker » de pdf.js n'ont pas de transform et sont vides).
      if (!transform || text.trim().length === 0) continue;

      const [a, b, c, d] = transform;
      const fontSize = Math.hypot(c, d) || Math.abs(d) || item.height || 0;
      const style = (item.fontName && content.styles[item.fontName]) || {};
      const family = style.fontFamily ?? "sans-serif";
      const lowered = `${family} ${item.fontName ?? ""}`.toLowerCase();
      // Pivoté si les termes de cisaillement sont significatifs par rapport à
      // l'échelle : le texte horizontal a b ≈ c ≈ 0.
      const rotated = Math.abs(b) > 0.01 * Math.abs(a) + 0.01 || Math.abs(c) > 0.01 * Math.abs(d) + 0.01;

      items.push({
        index,
        text,
        x: transform[4],
        y: transform[5],
        width: item.width ?? 0,
        height: item.height ?? fontSize,
        fontSize,
        fontFamily: family,
        bold: /bold|black|heavy|semibold|demibold/.test(lowered),
        italic: /italic|oblique/.test(lowered),
        vertical: style.vertical === true,
        rotated,
      });
      index += 1;
    }

    return {
      pageNumber,
      widthPts: viewport.width,
      heightPts: viewport.height,
      items,
    };
  } finally {
    await document.loadingTask?.destroy();
  }
}

/** Peut-on éditer proprement ce fragment (fond uniforme, non pivoté) ? */
export function canEditCleanly(edit: Pick<PdfTextEdit, "uniformBackground" | "rotated" | "vertical">): boolean {
  return edit.uniformBackground && !edit.rotated && !edit.vertical;
}

/**
 * Applique un ensemble de modifications et produit une **copie** du PDF.
 * Ne touche jamais au fichier source. Les zones non éditables proprement sont
 * ignorées et comptées dans `refused`.
 */
export async function applyTextEdits(
  source: PdfSource,
  edits: readonly PdfTextEdit[],
): Promise<ApplyEditsResult> {
  const document = await loadPdf(source);
  const pageCount = document.getPageCount();

  // Cache des polices standard, embarquées à la demande.
  const fontCache = new Map<string, PDFFont>();
  const fontFor = async (edit: PdfTextEdit): Promise<PDFFont> => {
    const key = standardFontFor(edit);
    const cached = fontCache.get(key);
    if (cached) return cached;
    const font = await document.embedFont(key as StandardFonts);
    fontCache.set(key, font);
    return font;
  };

  let applied = 0;
  let refused = 0;
  let overflowed = 0;

  for (const edit of edits) {
    if (edit.replacementText === edit.originalText) continue; // aucun changement
    if (edit.page < 1 || edit.page > pageCount) continue;
    if (!canEditCleanly(edit)) {
      refused += 1;
      continue;
    }

    const page = document.getPage(edit.page - 1);
    const font = await fontFor(edit);

    // 1) Recouvrir l'ancien texte avec la couleur de fond échantillonnée.
    const pad = edit.fontSize * 0.12;
    const coverY = edit.y - edit.fontSize * 0.28;
    const coverHeight = edit.fontSize * 1.18;
    page.drawRectangle({
      x: edit.x - pad,
      y: coverY,
      width: edit.width + pad * 2,
      height: coverHeight,
      color: rgb(edit.background.r, edit.background.g, edit.background.b),
    });

    // 2) Redessiner le nouveau texte, ajusté pour tenir dans la largeur.
    if (edit.replacementText.length > 0) {
      const { size, overflow } = fitFontSize(font, edit.replacementText, edit.fontSize, edit.width);
      if (overflow) overflowed += 1;
      page.drawText(edit.replacementText, {
        x: edit.x,
        y: edit.y,
        size,
        font,
        color: rgb(edit.color.r, edit.color.g, edit.color.b),
      });
    }
    applied += 1;
  }

  const file = await savePdf(document, outputName(source.name, "edite"));
  return { file, applied, refused, overflowed };
}

/**
 * Réduit le corps pour tenir dans la largeur d'origine, sans descendre sous
 * 60 % (au-delà le texte deviendrait illisible : on laisse alors déborder et on
 * le signale). Renvoie la taille retenue et si un débordement subsiste.
 */
export function fitFontSize(
  font: PDFFont,
  text: string,
  desiredSize: number,
  maxWidth: number,
): { size: number; overflow: boolean } {
  if (maxWidth <= 0) return { size: desiredSize, overflow: false };
  const naturalWidth = font.widthOfTextAtSize(text, desiredSize);
  if (naturalWidth <= maxWidth) return { size: desiredSize, overflow: false };

  const minSize = desiredSize * 0.6;
  const fitted = (desiredSize * maxWidth) / naturalWidth;
  if (fitted >= minSize) return { size: fitted, overflow: false };
  // Même à 60 % le texte dépasse : on garde 60 % et on prévient d'un débordement.
  return { size: minSize, overflow: true };
}

/** Choisit une police standard proche de la famille d'origine. */
export function standardFontFor(edit: Pick<PdfTextEdit, "fontFamily" | "bold" | "italic">): StandardFonts {
  const family = edit.fontFamily.toLowerCase();
  const serif = /times|serif|georgia|garamond|roman|minion/.test(family) && !/sans/.test(family);
  const mono = /mono|courier|consolas|menlo|code/.test(family);

  if (mono) {
    if (edit.bold && edit.italic) return StandardFonts.CourierBoldOblique;
    if (edit.bold) return StandardFonts.CourierBold;
    if (edit.italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (serif) {
    if (edit.bold && edit.italic) return StandardFonts.TimesRomanBoldItalic;
    if (edit.bold) return StandardFonts.TimesRomanBold;
    if (edit.italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (edit.bold && edit.italic) return StandardFonts.HelveticaBoldOblique;
  if (edit.bold) return StandardFonts.HelveticaBold;
  if (edit.italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

/** Zone rectangulaire en pixels (repère image, origine haut-gauche). */
export interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Style échantillonné sous une zone de texte. */
export interface SampledStyle {
  background: RGB;
  text: RGB;
  /** Le fond est-il uniforme (donc reconstituable par un aplat) ? */
  uniform: boolean;
}

/**
 * Échantillonne le fond et la couleur du texte sous une zone.
 *
 * Le fond est estimé à partir d'un **anneau** juste autour de la zone de texte
 * (là où il n'y a pas d'encre de glyphe) : on prend la médiane par canal, et on
 * mesure la dispersion. Si l'anneau est dispersé (photo, dégradé, graphique), on
 * déclare le fond **non uniforme** — l'édition sera refusée. La couleur du texte
 * est le pixel de la zone le plus éloigné du fond (l'encre).
 *
 * `pixels` est en RVBA 8 bits ; `box` est en pixels du même rendu.
 */
export function sampleTextStyle(
  pixels: RasterPixels,
  box: PixelBox,
  options: { uniformThreshold?: number } = {},
): SampledStyle {
  const threshold = options.uniformThreshold ?? 22;
  const { width, height, data } = pixels;
  const at = (x: number, y: number): [number, number, number] => {
    const cx = Math.min(width - 1, Math.max(0, Math.round(x)));
    const cy = Math.min(height - 1, Math.max(0, Math.round(y)));
    const p = (cy * width + cx) * 4;
    return [data[p], data[p + 1], data[p + 2]];
  };

  // Anneau de fond : bordure autour de la zone, épaisseur ~30 % de la hauteur.
  const margin = Math.max(2, Math.round(box.h * 0.3));
  const ring: [number, number, number][] = [];
  const x0 = box.x - margin;
  const x1 = box.x + box.w + margin;
  const y0 = box.y - margin;
  const y1 = box.y + box.h + margin;
  const step = Math.max(1, Math.round((x1 - x0) / 40));
  for (let x = x0; x <= x1; x += step) {
    ring.push(at(x, y0));
    ring.push(at(x, y1));
  }
  const vstep = Math.max(1, Math.round((y1 - y0) / 20));
  for (let y = y0; y <= y1; y += vstep) {
    ring.push(at(x0, y));
    ring.push(at(x1, y));
  }

  const background = medianColor(ring);
  const spread = maxChannelSpread(ring, background);
  const uniform = spread <= threshold;

  // Couleur du texte : pixel de la zone le plus éloigné du fond.
  let text: [number, number, number] = [0, 0, 0];
  let bestDist = -1;
  const sx = Math.max(1, Math.round(box.w / 40));
  const sy = Math.max(1, Math.round(box.h / 12));
  for (let y = box.y; y < box.y + box.h; y += sy) {
    for (let x = box.x; x < box.x + box.w; x += sx) {
      const c = at(x, y);
      const dist = colorDistance(c, [background.r * 255, background.g * 255, background.b * 255]);
      if (dist > bestDist) {
        bestDist = dist;
        text = c;
      }
    }
  }
  // Si aucune encre nette (zone quasi vide), texte quasi-noir par défaut.
  if (bestDist < 40) text = [17, 17, 17];

  return {
    background,
    text: { r: text[0] / 255, g: text[1] / 255, b: text[2] / 255 },
    uniform,
  };
}

function medianColor(samples: [number, number, number][]): RGB {
  if (samples.length === 0) return { r: 1, g: 1, b: 1 };
  const channel = (i: number) => {
    const values = samples.map((s) => s[i]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  return { r: channel(0) / 255, g: channel(1) / 255, b: channel(2) / 255 };
}

function maxChannelSpread(samples: [number, number, number][], reference: RGB): number {
  let max = 0;
  const ref = [reference.r * 255, reference.g * 255, reference.b * 255];
  for (const s of samples) {
    for (let i = 0; i < 3; i += 1) max = Math.max(max, Math.abs(s[i] - ref[i]));
  }
  return max;
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}
