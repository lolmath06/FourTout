import { loadPdf, savePdf } from "../document";
import { outputName } from "../filenames";
import type {
  EditableMetadataField,
  OutputFile,
  PdfMetadata,
  PdfSource,
} from "../types";

/**
 * Lecture et écriture des métadonnées du document.
 *
 * Règle importante : seuls les champs explicitement fournis sont écrits. Un
 * champ absent de `changes` reste tel quel dans le document — FourTout ne
 * modifie jamais en silence ce que l'utilisateur n'a pas touché.
 */

export async function readMetadata(source: PdfSource): Promise<PdfMetadata> {
  const document = await loadPdf(source);
  return {
    title: emptyToUndefined(document.getTitle()),
    author: emptyToUndefined(document.getAuthor()),
    subject: emptyToUndefined(document.getSubject()),
    keywords: emptyToUndefined(normalizeKeywords(document.getKeywords())),
    creator: emptyToUndefined(document.getCreator()),
    producer: emptyToUndefined(document.getProducer()),
    creationDate: document.getCreationDate(),
    modificationDate: document.getModificationDate(),
  };
}

export type MetadataChanges = Partial<Record<EditableMetadataField, string>>;

export async function writeMetadata(
  source: PdfSource,
  changes: MetadataChanges,
): Promise<OutputFile> {
  const document = await loadPdf(source);

  if (changes.title !== undefined) document.setTitle(changes.title);
  if (changes.author !== undefined) document.setAuthor(changes.author);
  if (changes.subject !== undefined) document.setSubject(changes.subject);
  if (changes.keywords !== undefined) {
    // pdf-lib assemble un tableau avec des espaces : en passant la chaîne
    // entière comme unique entrée, la saisie de l'utilisateur est restituée
    // à l'identique, virgules comprises.
    const keywords = changes.keywords.trim();
    document.setKeywords(keywords.length > 0 ? [keywords] : []);
  }
  // La date de modification reflète l'édition qui vient d'avoir lieu.
  document.setModificationDate(new Date());

  return savePdf(document, outputName(source.name, "metadonnees"));
}

/** `"facture, 2026"` devient `["facture", "2026"]`. */
export function splitKeywords(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0);
}

/** pdf-lib renvoie les mots-clés sous forme de chaîne unique. */
function normalizeKeywords(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
