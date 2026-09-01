import { PDFDocument, PDFDict, PDFName } from "@cantoo/pdf-lib";
import { PdfError, toPdfError } from "./errors";
import type { OperationContext, OutputFile, PdfInfo, PdfSource } from "./types";

/**
 * Primitives de chargement et d'enregistrement, partagées par toutes les
 * opérations PDF. Aucune opération ne parle directement à pdf-lib pour ouvrir
 * ou écrire un document : tout passe par ici, ce qui garantit une validation
 * et des erreurs homogènes.
 */

/** Signature d'un fichier PDF : les 5 premiers octets valent `%PDF-`. */
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d];

/**
 * Vérifie la nature d'un fichier par son contenu et non par son extension.
 * L'en-tête peut être précédé de quelques octets parasites : la spécification
 * tolère un décalage, les lecteurs réels aussi.
 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 1024);
  for (let offset = 0; offset <= limit - PDF_HEADER.length; offset += 1) {
    let matches = true;
    for (let i = 0; i < PDF_HEADER.length; i += 1) {
      if (bytes[offset + i] !== PDF_HEADER[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

export interface LoadOptions {
  /** Autorise le chargement d'un document chiffré sans le déchiffrer. */
  ignoreEncryption?: boolean;
  /** Laisse pdf-lib réécrire Producer/ModDate. Désactivé par défaut : une */
  /** opération FourTout ne doit pas modifier ce que l'utilisateur n'a pas touché. */
  updateMetadata?: boolean;
}

/**
 * Charge un PDF en validant réellement son contenu.
 *
 * Ordre des vérifications choisi pour produire le message le plus utile :
 * fichier vide, puis signature, puis chiffrement, puis analyse complète.
 */
export async function loadPdf(
  source: PdfSource,
  options: LoadOptions = {},
): Promise<PDFDocument> {
  const { ignoreEncryption = false, updateMetadata = false } = options;

  if (source.bytes.length === 0) throw new PdfError("corrupted", "Le fichier est vide.");
  if (!looksLikePdf(source.bytes)) throw new PdfError("not-a-pdf");

  try {
    const document = await PDFDocument.load(source.bytes, {
      ignoreEncryption,
      updateMetadata,
      ...(source.password !== undefined ? { password: source.password } : {}),
    });
    if (!ignoreEncryption) {
      if (pageCountOrNull(document) === 0) throw new PdfError("empty-document");
    }
    return document;
  } catch (error) {
    throw toPdfError(error);
  }
}

/**
 * Nombre de pages d'un document, ou une erreur claire s'il est inexploitable.
 *
 * pdf-lib accepte volontiers des octets qui commencent par `%PDF-` sans
 * contenir de structure valide ; le problème n'apparaît qu'en accédant à
 * l'arborescence des pages, sous la forme d'une erreur technique. On le
 * traduit ici en « document endommagé », seul message utile à l'utilisateur.
 */
export function pageCountOrNull(document: PDFDocument): number {
  try {
    return document.getPageCount();
  } catch (error) {
    throw new PdfError("corrupted", undefined, { cause: error });
  }
}

/**
 * Décrit un PDF sans exiger de mot de passe : permet à l'interface d'afficher
 * le nombre de pages, ou de demander un mot de passe si le document est
 * protégé, avant de proposer quoi que ce soit.
 */
export async function inspectPdf(source: PdfSource): Promise<PdfInfo> {
  if (source.bytes.length === 0) throw new PdfError("corrupted", "Le fichier est vide.");
  if (!looksLikePdf(source.bytes)) throw new PdfError("not-a-pdf");

  let document: PDFDocument;
  try {
    document = await PDFDocument.load(source.bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      ...(source.password !== undefined ? { password: source.password } : {}),
    });
  } catch (error) {
    throw toPdfError(error);
  }

  try {
    // Sur un document encore chiffré, la structure des pages n'est pas fiable.
    if (document.isEncrypted) {
      return { pageCount: 0, encrypted: true, byteLength: source.bytes.length };
    }

    const pageCount = pageCountOrNull(document);
    const firstPage = pageCount > 0 ? document.getPage(0) : undefined;
    return {
      pageCount,
      encrypted: false,
      byteLength: source.bytes.length,
      firstPageSize: firstPage
        ? { width: firstPage.getWidth(), height: firstPage.getHeight() }
        : undefined,
    };
  } catch (error) {
    // Un document dont l'arborescence de pages est tronquée se manifeste ici,
    // et non au chargement : on le signale comme endommagé.
    throw toPdfError(error);
  }
}

export interface SaveOptions {
  /**
   * Regroupe les objets pour un fichier plus compact. Désactivé lorsqu'on
   * chiffre le document : le chiffrement doit voir chaque objet séparément.
   */
  useObjectStreams?: boolean;
}

/** Sérialise un document et l'emballe en fichier de sortie nommé. */
export async function savePdf(
  document: PDFDocument,
  name: string,
  options: SaveOptions = {},
): Promise<OutputFile> {
  try {
    const bytes = await document.save({ useObjectStreams: options.useObjectStreams ?? true });
    return { name, bytes, mimeType: "application/pdf" };
  } catch (error) {
    throw toPdfError(error);
  }
}

/**
 * Retire toute trace de chiffrement d'un document déjà déchiffré en mémoire.
 *
 * pdf-lib efface `trailerInfo.Encrypt` au chargement, mais le dictionnaire de
 * sécurité subsiste comme objet indirect et se retrouve réécrit à
 * l'enregistrement : le fichier produit serait encore vu comme protégé.
 */
export function stripEncryption(document: PDFDocument): void {
  const { context } = document;
  const encryptionDicts = [];

  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict && object.get(PDFName.of("Filter"))?.toString() === "/Standard") {
      encryptionDicts.push(ref);
    }
  }
  for (const ref of encryptionDicts) context.delete(ref);
  delete context.trailerInfo.Encrypt;
}

/** Interrompt l'opération si l'utilisateur a demandé l'annulation. */
export function throwIfCancelled(context?: OperationContext): void {
  if (context?.signal?.aborted) throw new PdfError("cancelled");
}

/** Publie un avancement, si un rapporteur est fourni. */
export function report(
  context: OperationContext | undefined,
  ratio: number,
  label?: string,
): void {
  context?.report?.({ ratio: Math.max(0, Math.min(1, ratio)), label });
}
