import { PDFDocument, StandardFonts, rgb, type PDFFont } from "@cantoo/pdf-lib";
import { report } from "../document";
import { outputName } from "../filenames";
import { PdfError } from "../errors";
import type { OperationContext, OutputFile } from "../types";

/**
 * Conversion d'un document texte en PDF.
 *
 * Prend en charge le texte brut, le Markdown (titres, listes, gras/italique) et
 * un HTML simple (balises de bloc et d'emphase). Le but n'est pas de reproduire
 * un traitement de texte, mais de produire un PDF propre, paginé et lisible —
 * entièrement en local, sans dépendance.
 */

export type DocumentKind = "text" | "markdown" | "html";

export interface DocumentToPdfOptions {
  kind: DocumentKind;
  /** Titre affiché en tête du document (facultatif). */
  title?: string;
  /** Corps du texte des paragraphes, en points. */
  fontSize?: number;
  /** Marge de page en points. */
  margin?: number;
  /** Format de page. */
  pageSize?: "a4" | "letter";
}

const PAGE_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
} as const;

/** Fragment de texte avec son style. */
interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

/** Bloc de contenu. */
interface Block {
  type: "heading" | "paragraph" | "listitem";
  level?: number;
  runs: Run[];
}

export async function documentToPdf(
  name: string,
  content: string,
  options: DocumentToPdfOptions,
  context?: OperationContext,
): Promise<OutputFile> {
  const blocks = parseDocument(content, options.kind);
  if (options.title) {
    blocks.unshift({ type: "heading", level: 1, runs: [{ text: toWinAnsi(options.title), bold: true }] });
  }
  if (blocks.length === 0) throw new PdfError("empty-document", "Le document est vide.");

  const document = await PDFDocument.create();
  const fonts = {
    regular: await document.embedFont(StandardFonts.Helvetica),
    bold: await document.embedFont(StandardFonts.HelveticaBold),
    italic: await document.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await document.embedFont(StandardFonts.HelveticaBoldOblique),
  };

  const size = PAGE_SIZES[options.pageSize ?? "a4"];
  const margin = options.margin ?? 56;
  const baseFont = options.fontSize ?? 11;
  const maxWidth = size.width - margin * 2;

  let page = document.addPage([size.width, size.height]);
  let y = size.height - margin;

  const newPage = () => {
    page = document.addPage([size.width, size.height]);
    y = size.height - margin;
  };
  const ensure = (needed: number) => {
    if (y - needed < margin) newPage();
  };

  for (const [index, block] of blocks.entries()) {
    report(context, index / blocks.length, `Bloc ${index + 1} sur ${blocks.length}`);
    const fontSize = block.type === "heading" ? headingSize(block.level ?? 1, baseFont) : baseFont;
    const lineHeight = fontSize * 1.4;
    const indent = block.type === "listitem" ? 18 : 0;

    if (block.type === "heading" && y < size.height - margin) y -= fontSize * 0.6;

    const lines = wrapRuns(block.runs, fonts, fontSize, maxWidth - indent);
    for (const [lineIndex, line] of lines.entries()) {
      ensure(lineHeight);
      let x = margin + indent;
      if (block.type === "listitem" && lineIndex === 0) {
        page.drawText("-", { x: margin, y: y - fontSize, size: fontSize, font: fonts.regular });
      }
      for (const run of line) {
        const font = pickFont(fonts, run);
        page.drawText(run.text, { x, y: y - fontSize, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) });
        x += font.widthOfTextAtSize(run.text, fontSize);
      }
      y -= lineHeight;
    }
    y -= block.type === "heading" ? fontSize * 0.4 : fontSize * 0.5;
  }

  report(context, 1, "Écriture du document");
  const bytes = await document.save();
  return { name: outputName(name, "", "pdf"), bytes, mimeType: "application/pdf" };
}

function headingSize(level: number, base: number): number {
  return Math.round(base * (level === 1 ? 1.9 : level === 2 ? 1.5 : 1.25));
}

function pickFont(fonts: Record<string, PDFFont>, run: Run): PDFFont {
  if (run.bold && run.italic) return fonts.boldItalic;
  if (run.bold) return fonts.bold;
  if (run.italic) return fonts.italic;
  return fonts.regular;
}

/** Découpe des runs en lignes qui tiennent dans la largeur donnée. */
function wrapRuns(runs: Run[], fonts: Record<string, PDFFont>, fontSize: number, maxWidth: number): Run[][] {
  const lines: Run[][] = [];
  let current: Run[] = [];
  let width = 0;

  for (const run of runs) {
    const font = pickFont(fonts, run);
    const words = run.text.split(/(\s+)/).filter((w) => w.length > 0);
    for (const word of words) {
      const w = font.widthOfTextAtSize(word, fontSize);
      if (width + w > maxWidth && current.length > 0 && word.trim().length > 0) {
        lines.push(current);
        current = [];
        width = 0;
      }
      if (width === 0 && /^\s+$/.test(word)) continue;
      current.push({ ...run, text: word });
      width += w;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [[{ text: "" }]];
}

/** Remplace les caractères hors WinAnsi que pdf-lib ne sait pas encoder. */
export function toWinAnsi(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201a\u2039\u203a]/g, "'")
    .replace(/[\u201c\u201d\u201e\u00ab\u00bb]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/\u2022/g, "-")
    // Tout ce qui reste au-dessus de Latin-1 (U+00FF), hors saut de ligne, est
    // remplacé par « ? » plutôt que de faire échouer l'encodage WinAnsi.
    .replace(/[^\u0020-\u00ff\n]/g, "?");
}

/** Analyse un document en blocs selon son type. */
export function parseDocument(content: string, kind: DocumentKind): Block[] {
  const clean = kind === "html" ? htmlToText(content) : content;
  return kind === "markdown" || kind === "html" ? parseMarkdown(clean) : parsePlainText(clean);
}

function parsePlainText(content: string): Block[] {
  return content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter((para) => para.length > 0)
    .map((para) => ({ type: "paragraph" as const, runs: [{ text: toWinAnsi(para.replace(/\n/g, " ")) }] }));
}

function parseMarkdown(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", runs: parseInline(paragraph.join(" ")) });
      paragraph = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const listItem = /^\s*[-*+]\s+(.*)$/.exec(line) || /^\s*\d+\.\s+(.*)$/.exec(line);
    if (line.trim() === "") {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length, runs: parseInline(heading[2], true) });
    } else if (listItem) {
      flush();
      blocks.push({ type: "listitem", runs: parseInline(listItem[1]) });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

/** Découpe une ligne en runs gras/italique à partir de **…**, *…*, _…_. */
export function parseInline(text: string, forceBold = false): Run[] {
  const runs: Run[] = [];
  const regex = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3/g;
  let last = 0;
  let match: RegExpExecArray | null;
  const push = (t: string, bold: boolean, italic: boolean) => {
    if (t.length === 0) return;
    runs.push({ text: toWinAnsi(t), bold: bold || forceBold, italic });
  };
  while ((match = regex.exec(text)) !== null) {
    push(text.slice(last, match.index), false, false);
    if (match[2] !== undefined) push(match[2], true, false);
    else push(match[4], false, true);
    last = regex.lastIndex;
  }
  push(text.slice(last), false, false);
  return runs.length > 0 ? runs : [{ text: toWinAnsi(text), bold: forceBold }];
}

/** Convertit un HTML simple en texte structuré Markdown-compatible. */
function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\s*(script|style)[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<\s*h([1-6])[^>]*>/gi, (_m, l) => `\n\n${"#".repeat(Number(l))} `)
    .replace(/<\s*\/\s*h[1-6]\s*>/gi, "\n\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\s*\/\s*(p|div|ul|ol|tr)\s*>/gi, "\n\n")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*(strong|b)\s*>/gi, "**").replace(/<\s*\/\s*(strong|b)\s*>/gi, "**")
    .replace(/<\s*(em|i)\s*>/gi, "*").replace(/<\s*\/\s*(em|i)\s*>/gi, "*")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
