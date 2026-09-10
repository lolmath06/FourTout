import { StandardFonts, TextRenderingMode, degrees, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import { loadPdf, report, savePdf, throwIfCancelled } from "../document";
import { PdfError } from "../errors";
import { outputName } from "../filenames";
import { renderPagesStream, type RenderedPage } from "./toImages";
import { extractText } from "./extractText";
import { getDefaultEngine } from "@/core/ocr";
import type { OcrEngine, OcrLanguage, OcrWord } from "@/core/ocr/types";
import { toWinAnsi } from "./documentToPdf";
import type { OperationContext, OutputFile, PdfSource } from "../types";

/**
 * PDF scanné → PDF **recherchable**.
 *
 * Le principe, et sa limite, tiennent en une phrase : les pages d'origine ne
 * sont pas touchées — ni rasterisées, ni recompressées, ni redessinées — et
 * l'on ajoute par-dessus une couche de texte **invisible** (mode de rendu 3 du
 * format PDF), mot par mot, à l'endroit exact où l'OCR a lu chaque mot.
 *
 * Conséquence : le document conserve rigoureusement son apparence, et
 * `Ctrl+F`, la sélection à la souris et l'extraction de texte fonctionnent.
 * C'est aussi pourquoi le résultat n'est pas un fichier `.txt` posé à côté :
 * le texte vit *dans* le PDF, aux bonnes coordonnées.
 *
 * Tout est local : rendu par pdf.js, reconnaissance par tesseract.js et ses
 * modèles embarqués, écriture par pdf-lib.
 */

export interface SearchablePdfOptions {
  language: OcrLanguage;
  /** Résolution de rendu des pages pour l'OCR, en points par pouce. */
  dpi?: number;
  /**
   * Confiance minimale d'un mot pour rejoindre la couche texte, de 0 à 100.
   * Filtrer trop haut appauvrit la recherche ; trop bas y injecte du bruit.
   */
  minConfidence?: number;
  /** Pages à traiter ; toutes si absent. */
  pages?: readonly number[];
  /** Moteur OCR ; celui de l'application par défaut. */
  engine?: OcrEngine;
}

/** Ce qui a été reconnu sur une page, une fois la couche écrite. */
export interface SearchablePageReport {
  page: number;
  /** Mots effectivement ajoutés à la couche texte. */
  words: number;
  /** Confiance moyenne des mots retenus, de 0 à 100. */
  confidence: number;
  /** Texte reconnu, dans l'ordre de lecture. */
  text: string;
}

export interface SearchablePdfResult {
  file: OutputFile;
  pages: SearchablePageReport[];
  /** Nombre total de mots ajoutés au document. */
  totalWords: number;
  /**
   * Le document contenait-il déjà du texte natif ? Vrai signale un PDF qui
   * n'était pas (entièrement) un scan : la couche OCR s'ajoute à l'existant.
   */
  hadNativeText: boolean;
}

/** Résolution par défaut : le compromis habituel entre finesse et durée. */
const DEFAULT_DPI = 200;

/* ---------------------------------------------------------------- géométrie */

/** Un point du repère PDF (origine bas-gauche, y vers le haut). */
export interface UserPoint {
  x: number;
  y: number;
}

/**
 * Repasse d'un point de l'**image rendue** au repère utilisateur du PDF.
 *
 * Deux pièges classiques sont traités ici, une fois pour toutes :
 *
 * 1. l'image a son origine en haut à gauche et son axe vertical vers le bas,
 *    le PDF l'a en bas à gauche et vers le haut ;
 * 2. une page portant `/Rotate` est rendue **redressée** par pdf.js : largeur
 *    et hauteur sont alors échangées, et les coordonnées de l'image ne sont
 *    plus celles du contenu.
 *
 * `viewX`/`viewY` sont en **points** dans la page affichée (pixels / échelle).
 * `width`/`height` sont les dimensions de la MediaBox, non tournées.
 */
export function viewToUserSpace(
  viewX: number,
  viewY: number,
  width: number,
  height: number,
  rotation: number,
): UserPoint {
  const angle = ((rotation % 360) + 360) % 360;
  switch (angle) {
    case 90:
      return { x: viewY, y: viewX };
    case 180:
      return { x: width - viewX, y: viewY };
    case 270:
      return { x: width - viewY, y: height - viewX };
    default:
      return { x: viewX, y: height - viewY };
  }
}

/**
 * Placement d'un mot dans la page : point d'ancrage (début de la ligne de
 * base), taille de police et angle du texte.
 */
export interface WordPlacement {
  x: number;
  y: number;
  size: number;
  /** Angle du texte en degrés, dans le repère PDF. */
  angle: number;
}

/**
 * Calcule le placement d'un mot reconnu.
 *
 * La taille est déduite de la **hauteur** de la boîte : c'est la mesure stable,
 * là où la largeur dépend du nombre de lettres. Le facteur 0,8 rapproche la
 * hauteur de boîte de la hauteur de police nominale (hampes comprises).
 */
export function placeWord(
  word: OcrWord,
  page: { scale: number; width: number; height: number; rotation: number },
): WordPlacement {
  const { box } = word;
  // Coin bas-gauche du mot dans la page affichée, en points.
  const viewX = box.x0 / page.scale;
  const viewY = box.y1 / page.scale;
  const anchor = viewToUserSpace(viewX, viewY, page.width, page.height, page.rotation);
  const boxHeightPts = (box.y1 - box.y0) / page.scale;
  return {
    x: anchor.x,
    y: anchor.y,
    size: Math.max(1, boxHeightPts * 0.8),
    angle: ((page.rotation % 360) + 360) % 360,
  };
}

/* -------------------------------------------------------------- traitement */

/**
 * Prépare un mot pour la police Helvetica (WinAnsi) : les caractères qu'elle
 * ne sait pas coder feraient échouer l'écriture entière. Les accents français
 * et l'apostrophe typographique, eux, passent sans perte.
 */
function encodableText(raw: string): string {
  // `toWinAnsi` ramène la typographie ; les codes de contrôle hauts (U+0080 à
  // U+009F) restent inencodables et n'ont aucun sens dans un mot lu.
  return toWinAnsi(raw)
    .replace(/[\u0080-\u009f]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

/**
 * Écrit la couche texte invisible d'une page.
 *
 * Isolée pour être vérifiable seule : elle ne connaît ni pdf.js, ni l'OCR, ni
 * les fichiers — seulement une page pdf-lib, une police et des mots placés.
 */
export function writeTextLayer(
  page: PDFPage,
  font: PDFFont,
  words: readonly OcrWord[],
  geometry: { scale: number; rotation: number },
  minConfidence: number,
): SearchablePageReport["words"] {
  const width = page.getWidth();
  const height = page.getHeight();
  let written = 0;

  for (const word of words) {
    if (word.confidence < minConfidence) continue;
    const text = encodableText(word.text);
    if (!text) continue;

    const placement = placeWord(word, {
      scale: geometry.scale,
      width,
      height,
      rotation: geometry.rotation,
    });

    // Taille finale : celle qui fait **coïncider la largeur du texte avec celle
    // de la boîte lue**. C'est ce qui aligne la sélection à la souris sur le mot
    // imprimé. On la borne par rapport à la taille déduite de la hauteur, pour
    // qu'un mot d'une lettre dans une boîte large ne devienne pas géant.
    //
    // L'espacement des caractères, tentant pour le même but, est à proscrire :
    // au-delà d'un certain écart, pdf.js insère un espace entre chaque lettre à
    // l'extraction, et « Résumé » ressort en « R é s u m é » — un texte que la
    // recherche ne trouve plus.
    const unitWidth = font.widthOfTextAtSize(text, 1);
    const boxWidth = (word.box.x1 - word.box.x0) / geometry.scale;
    const fitted = unitWidth > 0 ? boxWidth / unitWidth : placement.size;
    const size = Math.max(
      placement.size * 0.5,
      Math.min(placement.size * 2, fitted),
    );

    page.drawText(text, {
      x: placement.x,
      y: placement.y,
      size,
      font,
      rotate: degrees(placement.angle),
      // Le cœur du procédé : le texte est présent, sélectionnable et
      // indexable, mais n'est jamais peint.
      renderMode: TextRenderingMode.Invisible,
    });
    written += 1;
  }

  return written;
}

/** Texte d'une page, dans l'ordre de lecture approximatif de l'OCR. */
function pageText(words: readonly OcrWord[], minConfidence: number): string {
  const kept = words.filter((word) => word.confidence >= minConfidence);
  const lines: OcrWord[][] = [];
  for (const word of kept) {
    const middle = (word.box.y0 + word.box.y1) / 2;
    const height = word.box.y1 - word.box.y0;
    const line = lines.find((candidate) => {
      const reference = candidate[0];
      const referenceMiddle = (reference.box.y0 + reference.box.y1) / 2;
      return Math.abs(referenceMiddle - middle) < Math.max(4, height * 0.6);
    });
    if (line) line.push(word);
    else lines.push([word]);
  }
  return lines
    .map((line) => [...line].sort((a, b) => a.box.x0 - b.box.x0).map((w) => w.text).join(" "))
    .join("\n")
    .trim();
}

/**
 * Produit le PDF recherchable.
 *
 * Rien n'est écrit sur le disque : le fichier n'existe qu'une fois l'ensemble
 * des pages traitées. Une annulation ou une erreur en cours de route ne laisse
 * donc aucun document partiel derrière elle — il n'y en a jamais eu.
 */
export async function makeSearchablePdf(
  source: PdfSource,
  options: SearchablePdfOptions,
  context?: OperationContext,
): Promise<SearchablePdfResult> {
  const engine = options.engine ?? getDefaultEngine();
  const minConfidence = options.minConfidence ?? 30;
  const dpi = options.dpi ?? DEFAULT_DPI;

  // Le document d'origine, chargé tel quel : c'est lui qui sera enrichi, ce
  // qui garantit que l'apparence des pages ne bouge pas d'un pixel.
  const document = await loadPdf(source);
  const font = await document.embedFont(StandardFonts.Helvetica);

  // État de départ : un PDF qui contient déjà du texte n'est pas un scan, et
  // l'interface doit pouvoir le dire plutôt que de laisser l'utilisateur
  // océriser pour rien.
  let hadNativeText = false;
  try {
    const existing = await extractText(source);
    hadNativeText = existing.totalCharacters > 0;
  } catch {
    // Un document dont pdf.js ne sait pas extraire le texte n'empêche pas
    // l'OCR : c'est même exactement le cas d'usage.
  }
  throwIfCancelled(context);

  const pages: SearchablePageReport[] = [];
  let totalWords = 0;

  await renderPagesStream(
    source,
    { format: "png", dpi, ...(options.pages ? { pages: options.pages } : {}) },
    async (rendered: RenderedPage, index: number, total: number) => {
      throwIfCancelled(context);
      // Deux étapes annoncées par page : la lecture, puis l'écriture. La
      // progression décrit ce qui se passe, pas un pourcentage abstrait.
      const step = 1 / total;
      report(context, index * step, `Page ${rendered.page} / ${total} — OCR`);

      const result = await engine.recognize(
        {
          name: `page-${rendered.page}.png`,
          bytes: rendered.bytes,
          width: rendered.widthPx,
          height: rendered.heightPx,
        },
        options.language,
        {
          report: (progress) =>
            report(
              context,
              index * step + (progress.ratio ?? 0) * step * 0.8,
              `Page ${rendered.page} / ${total} — OCR`,
            ),
          signal: context?.signal,
        },
        { layout: true },
      );
      throwIfCancelled(context);

      report(
        context,
        index * step + step * 0.8,
        `Page ${rendered.page} / ${total} — écriture couche texte`,
      );

      const words = result.layout?.words ?? [];
      const target = document.getPage(rendered.page - 1);
      const written = writeTextLayer(target, font, words, rendered, minConfidence);
      totalWords += written;

      const kept = words.filter((word) => word.confidence >= minConfidence);
      pages.push({
        page: rendered.page,
        words: written,
        confidence:
          kept.length > 0
            ? Math.round(kept.reduce((sum, word) => sum + word.confidence, 0) / kept.length)
            : 0,
        text: pageText(words, minConfidence),
      });
    },
    { signal: context?.signal },
  );

  throwIfCancelled(context);

  if (totalWords === 0) {
    throw new PdfError(
      "no-text-found",
      "Aucun mot n'a été reconnu : vérifiez la langue choisie et la qualité du scan.",
    );
  }

  report(context, 1, "Écriture du document");
  const file = await savePdf(document, outputName(source.name, "recherchable"));
  return { file, pages, totalWords, hadNativeText };
}
