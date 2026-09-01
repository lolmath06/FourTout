/**
 * Erreurs PDF.
 *
 * Toutes les opérations remontent une `PdfError` porteuse d'un code stable :
 * l'interface affiche le message, les tests assertent sur le code.
 */
export type PdfErrorCode =
  | "not-a-pdf"
  | "corrupted"
  | "encrypted"
  | "wrong-password"
  | "empty-document"
  | "no-pages-selected"
  | "page-out-of-range"
  | "invalid-range"
  | "would-remove-all-pages"
  | "not-enough-files"
  | "unsupported-image"
  | "render-unavailable"
  | "no-text-found"
  | "no-images-found"
  | "cancelled"
  | "unknown";

const MESSAGES: Record<PdfErrorCode, string> = {
  "not-a-pdf": "Ce fichier n'est pas un PDF.",
  corrupted: "Ce PDF est illisible ou endommagé.",
  encrypted: "Ce PDF est protégé par un mot de passe.",
  "wrong-password": "Mot de passe incorrect.",
  "empty-document": "Ce PDF ne contient aucune page.",
  "no-pages-selected": "Aucune page sélectionnée.",
  "page-out-of-range": "La sélection désigne des pages qui n'existent pas.",
  "invalid-range": "La sélection de pages est mal écrite.",
  "would-remove-all-pages": "Cette opération supprimerait toutes les pages du document.",
  "not-enough-files": "Il faut au moins deux fichiers pour cette opération.",
  "unsupported-image": "Ce format d'image n'est pas pris en charge.",
  "render-unavailable": "Le rendu des pages n'est pas disponible dans cet environnement.",
  "no-text-found": "Aucun texte n'a pu être extrait de ce PDF.",
  "no-images-found": "Aucune image exploitable n'a été trouvée dans ce PDF.",
  cancelled: "Opération annulée.",
  unknown: "Une erreur inattendue est survenue.",
};

export class PdfError extends Error {
  readonly code: PdfErrorCode;
  /** Détail technique optionnel, affiché en complément du message. */
  readonly detail?: string;

  constructor(code: PdfErrorCode, detail?: string, options?: { cause?: unknown }) {
    super(detail ? `${MESSAGES[code]} ${detail}` : MESSAGES[code], options);
    this.name = "PdfError";
    this.code = code;
    this.detail = detail;
  }

  /** Message court, sans le détail technique. */
  get shortMessage(): string {
    return MESSAGES[this.code];
  }
}

export function isPdfError(error: unknown): error is PdfError {
  return error instanceof PdfError;
}

/**
 * Convertit une erreur quelconque (pdf-lib, pdf.js, DOM) en `PdfError`.
 * Centralisé ici pour que chaque opération n'ait pas à deviner les libellés
 * des bibliothèques sous-jacentes.
 */
export function toPdfError(error: unknown): PdfError {
  if (isPdfError(error)) return error;

  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);

  if (name === "PasswordException" || /password/i.test(message)) {
    return /incorrect|invalid/i.test(message)
      ? new PdfError("wrong-password", undefined, { cause: error })
      : new PdfError("encrypted", undefined, { cause: error });
  }
  if (name === "EncryptedPDFError" || /is encrypted/i.test(message)) {
    return new PdfError("encrypted", undefined, { cause: error });
  }
  if (name === "InvalidPDFException" || /invalid pdf|no pdf header|failed to parse/i.test(message)) {
    return new PdfError("corrupted", undefined, { cause: error });
  }
  return new PdfError("unknown", message, { cause: error });
}
