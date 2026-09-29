import { readZip, readZipEntry, ZipReadError } from "@/core/archive/unzip";
import { extractText } from "@/core/pdf/operations/extractText";
import type { OperationContext } from "@/core/pdf/types";
import { detectEncoding } from "./encoding";
import { TextError } from "./errors";
import { htmlToText } from "./html";
import { diffLines, type DiffResult } from "./diff";

/**
 * Amener n'importe quel document à du **texte comparable**.
 *
 * FourTout sait déjà comparer deux textes (`diffLines`) et deux PDF page à page
 * (comparaison visuelle). Ce module ne rajoute aucun troisième algorithme de
 * différence : il fournit l'étage manquant en amont — « document → texte
 * normalisé » — puis appelle le moteur existant.
 *
 * L'extraction réutilise elle aussi ce qui est là : pdf.js pour les PDF, le
 * lecteur d'archives pour les `.docx`, la détection d'encodage pour les
 * fichiers texte, le convertisseur HTML pour les pages web.
 */

/** Formats que la comparaison de documents sait lire. */
export type DocumentFormat = "pdf" | "docx" | "txt" | "markdown" | "html";

export const DOCUMENT_FORMAT_LABELS: Record<DocumentFormat, string> = {
  pdf: "PDF",
  docx: "Word (DOCX)",
  txt: "Texte",
  markdown: "Markdown",
  html: "HTML",
};

/** Extensions acceptées, par format. */
export const DOCUMENT_EXTENSIONS: Record<DocumentFormat, string[]> = {
  pdf: ["pdf"],
  docx: ["docx"],
  txt: ["txt", "text", "log", "csv"],
  markdown: ["md", "markdown"],
  html: ["html", "htm", "xhtml"],
};

/** Toutes les extensions acceptées, pour le catalogue et le dépôt de fichiers. */
export const COMPARABLE_EXTENSIONS = Object.values(DOCUMENT_EXTENSIONS).flat();

export function formatForExtension(extension: string): DocumentFormat | undefined {
  const clean = extension.replace(/^\./, "").toLowerCase();
  for (const [format, extensions] of Object.entries(DOCUMENT_EXTENSIONS)) {
    if (extensions.includes(clean)) return format as DocumentFormat;
  }
  return undefined;
}

export interface DocumentInput {
  name: string;
  bytes: Uint8Array;
  /** Extension, sans point. Sert à choisir l'extracteur. */
  extension: string;
}

export interface DocumentText {
  name: string;
  format: DocumentFormat;
  /** Texte extrait, sans normalisation. */
  text: string;
  /** Nombre de pages, pour les formats paginés. */
  pages?: number;
  /** Encodage détecté, pour les formats texte. */
  encoding?: string;
}

/* ---------------------------------------------------------------- DOCX */

/**
 * Texte d'un `.docx`, lu directement depuis l'archive.
 *
 * Le socle Rust sait déjà lire un `.docx` complet (styles, tableaux,
 * métadonnées), mais il travaille à partir d'un **chemin de fichier** : un
 * document glissé dans la fenêtre n'en a pas. Pour la seule comparaison, ce qui
 * compte est la suite des paragraphes ; on la lit ici, à partir des octets.
 */
export function docxToText(bytes: Uint8Array): string {
  let xml: string;
  try {
    const entry = readZipEntry(readZip(bytes), "word/document.xml");
    if (!entry) {
      throw new TextError(
        "document-unsupported",
        "Ce fichier .docx ne contient pas de partie « word/document.xml ».",
      );
    }
    xml = new TextDecoder("utf-8").decode(entry);
  } catch (error) {
    if (error instanceof TextError) throw error;
    if (error instanceof ZipReadError) {
      throw new TextError("document-unsupported", error.message, { cause: error });
    }
    throw error;
  }

  return wordXmlToText(xml);
}

/**
 * Réduit le corps d'un document Word à son texte.
 *
 * Seules quatre balises portent du sens ici : `w:t` (le texte), `w:tab` et
 * `w:br` (des séparateurs), `w:p` (la fin d'un paragraphe). Le reste est de la
 * mise en forme, sans effet sur une comparaison de contenu.
 */
export function wordXmlToText(xml: string): string {
  const body = xml.replace(/^[\s\S]*?<w:body[^>]*>/, "").replace(/<\/w:body>[\s\S]*$/, "");
  let out = "";
  const pattern = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>|<\/w:p>|<\/w:tc>/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(body)) !== null) {
    const token = match[0];
    if (match[1] !== undefined) out += decodeXmlEntities(match[1]);
    else if (token.startsWith("<w:tab")) out += "\t";
    else if (token.startsWith("<w:br")) out += "\n";
    else if (token === "</w:tc>") out += "\t";
    else out += "\n";
  }

  return out.replace(/\t+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

/* ---------------------------------------------------------- extraction */

/**
 * Extrait le texte d'un document, quel que soit son format.
 *
 * Le format est déduit de l'extension : le contenu d'un `.docx` et celui d'un
 * `.pdf` ne se confondent pas, et un fichier mal nommé produit une erreur
 * explicite plutôt qu'un charabia.
 */
export async function documentToText(
  input: DocumentInput,
  context?: OperationContext,
): Promise<DocumentText> {
  const format = formatForExtension(input.extension);
  if (!format) {
    throw new TextError(
      "document-unsupported",
      `« ${input.name} » : formats acceptés — ${Object.values(DOCUMENT_FORMAT_LABELS).join(", ")}.`,
    );
  }

  if (format === "pdf") {
    const extracted = await extractText({ name: input.name, bytes: input.bytes }, context);
    const text = extracted.pages.map((page) => page.text).join("\n\n").trim();
    if (!text) {
      throw new TextError(
        "document-empty",
        `« ${input.name} » ne contient aucun texte : s'il s'agit d'un scan, produisez d'abord un PDF recherchable.`,
      );
    }
    return { name: input.name, format, text, pages: extracted.pages.length };
  }

  if (format === "docx") {
    const text = docxToText(input.bytes);
    if (!text) throw new TextError("document-empty", `« ${input.name} » ne contient aucun texte.`);
    return { name: input.name, format, text };
  }

  // Formats texte : l'encodage n'est pas connu d'avance, on le détecte avec le
  // même moteur que l'outil « Détecter l'encodage ».
  const detection = detectEncoding(input.bytes);
  if (detection.binary) {
    throw new TextError("encoding-unreadable", `« ${input.name} » n'est pas un fichier texte.`);
  }
  const raw = detection.text;
  const text = format === "html" ? htmlToText(raw) : raw;
  if (!text.trim()) {
    throw new TextError("document-empty", `« ${input.name} » est vide.`);
  }
  return { name: input.name, format, text, encoding: detection.encoding };
}

/* -------------------------------------------------------- normalisation */

export type CompareMode =
  /** Compare les textes tels quels, à la lettre près. */
  | "exact"
  /**
   * Ignore ce qui relève de la mise en forme et non du contenu : espaces
   * multiples, espaces de fin de ligne, conventions CRLF/LF, et les césures que
   * les PDF laissent en fin de ligne. **Aucun mot n'est jamais masqué.**
   */
  | "normalized";

export const COMPARE_MODE_LABELS: Record<CompareMode, string> = {
  exact: "Texte exact",
  normalized: "Texte normalisé",
};

/**
 * Normalise un texte pour la comparaison de contenu.
 *
 * Chaque règle est là pour neutraliser une différence de **présentation**
 * connue. Aucune ne touche à un mot : recoller une césure de fin de ligne
 * restitue le mot d'origine, elle n'en supprime aucun.
 */
export function normalizeForCompare(text: string): string {
  return (
    text
      .replace(/\r\n?/g, "\n")
      // Césure de fin de ligne d'un PDF : « docu-\nment » redevient « document ».
      .replace(/(\p{Ll})[-\u00ad\u2010]\n(\p{Ll})/gu, "$1$2")
      // Espaces insécables et fines, invisibles à l'œil et fréquentes en PDF.
      .replace(/[\u00a0\u202f\u2009\u2007]/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/* ---------------------------------------------------------- comparaison */

export interface DocumentComparison {
  left: DocumentText;
  right: DocumentText;
  mode: CompareMode;
  diff: DiffResult;
  /** Textes réellement comparés, après normalisation éventuelle. */
  leftText: string;
  rightText: string;
}

/**
 * Compare deux documents. L'extraction est faite ici, la comparaison est
 * déléguée au moteur de différence de l'application — le même que celui de
 * « Comparer deux textes ».
 */
export async function compareDocuments(
  a: DocumentInput,
  b: DocumentInput,
  options: { mode?: CompareMode } = {},
  context?: OperationContext,
): Promise<DocumentComparison> {
  const mode = options.mode ?? "normalized";

  context?.report?.({ ratio: 0, label: `Lecture de ${a.name}` });
  const left = await documentToText(a, { signal: context?.signal });
  if (context?.signal?.aborted) throw new TextError("cancelled");

  context?.report?.({ ratio: 0.4, label: `Lecture de ${b.name}` });
  const right = await documentToText(b, { signal: context?.signal });
  if (context?.signal?.aborted) throw new TextError("cancelled");

  context?.report?.({ ratio: 0.8, label: "Comparaison" });
  const leftText = mode === "normalized" ? normalizeForCompare(left.text) : left.text;
  const rightText = mode === "normalized" ? normalizeForCompare(right.text) : right.text;
  const diff = diffLines(leftText, rightText);

  context?.report?.({ ratio: 1, label: "Terminé" });
  return { left, right, mode, diff, leftText, rightText };
}
