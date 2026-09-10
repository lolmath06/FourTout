/**
 * Erreurs des outils Texte & Documents.
 *
 * Même contrat que `PdfError` et `ImageError` : un code stable pour les tests
 * et le journal, un message français pour l'interface. Ce n'est pas un
 * troisième dispositif, c'est le même, appliqué au domaine du texte.
 */
export type TextErrorCode =
  /** L'encodage source n'a pas pu être déterminé avec une confiance suffisante. */
  | "encoding-uncertain"
  /** L'encodage de destination ne sait pas écrire certains caractères. */
  | "encoding-unrepresentable"
  /** Le fichier fourni n'est pas du texte (binaire, octets nuls dispersés). */
  | "encoding-unreadable"
  /** Le format de document n'est pas pris en charge par l'extraction de texte. */
  | "document-unsupported"
  /** Le document est vide, ou son texte n'a pas pu être extrait. */
  | "document-empty"
  | "cancelled"
  | "unknown";

const MESSAGES: Record<TextErrorCode, string> = {
  "encoding-uncertain":
    "L'encodage de ce fichier n'a pas pu être déterminé de façon fiable. Choisissez-le explicitement.",
  "encoding-unrepresentable":
    "L'encodage de destination ne peut pas représenter certains caractères du texte.",
  "encoding-unreadable": "Ce fichier ne semble pas être un fichier texte.",
  "document-unsupported": "Ce format de document n'est pas pris en charge pour la comparaison.",
  "document-empty": "Aucun texte n'a pu être extrait de ce document.",
  cancelled: "Opération annulée.",
  unknown: "Une erreur inattendue est survenue.",
};

export class TextError extends Error {
  readonly code: TextErrorCode;
  readonly detail?: string;

  constructor(code: TextErrorCode, detail?: string, options?: { cause?: unknown }) {
    super(detail ? `${MESSAGES[code]} ${detail}` : MESSAGES[code], options);
    this.name = "TextError";
    this.code = code;
    this.detail = detail;
  }

  get shortMessage(): string {
    return MESSAGES[this.code];
  }
}

export function isTextError(error: unknown): error is TextError {
  return error instanceof TextError;
}

/** Convertit une erreur quelconque en `TextError` pour l'affichage. */
export function toTextError(error: unknown): TextError {
  if (isTextError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === "JobCancelledError") {
    return new TextError("cancelled", undefined, { cause: error });
  }
  return new TextError("unknown", message, { cause: error });
}
