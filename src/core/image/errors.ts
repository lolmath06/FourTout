/**
 * Erreurs des outils Image.
 *
 * Même principe que les erreurs PDF : un code stable, un message français, les
 * tests assertent sur le code et l'interface affiche le message.
 */
export type ImageErrorCode =
  | "not-an-image"
  | "decode-failed"
  | "encode-failed"
  | "render-unavailable"
  | "empty-selection"
  | "too-large"
  | "unsupported-format"
  | "invalid-crop"
  | "no-text-found"
  | "ocr-unavailable"
  | "segmentation-unavailable"
  | "segmentation-failed"
  | "cancelled"
  | "unknown";

const MESSAGES: Record<ImageErrorCode, string> = {
  "not-an-image": "Ce fichier n'est pas une image reconnue.",
  "decode-failed": "Cette image est illisible ou dans un format non pris en charge.",
  "encode-failed": "L'image n'a pas pu être encodée.",
  "render-unavailable": "Le traitement d'image n'est pas disponible dans cet environnement.",
  "empty-selection": "Aucune image à traiter.",
  "too-large": "Cette image est trop grande pour être traitée sans risque de saturation mémoire.",
  "unsupported-format": "Ce format d'image n'est pas pris en charge.",
  "invalid-crop": "La zone de recadrage est vide ou hors de l'image.",
  "no-text-found": "Aucun texte n'a été détecté sur cette image.",
  "ocr-unavailable": "Le moteur de reconnaissance de texte n'est pas disponible.",
  "segmentation-unavailable":
    "Le modèle de détourage n'est pas disponible. Installez-le depuis Paramètres → Modèles.",
  "segmentation-failed": "Le détourage a échoué.",
  cancelled: "Opération annulée.",
  unknown: "Une erreur inattendue est survenue.",
};

export class ImageError extends Error {
  readonly code: ImageErrorCode;
  readonly detail?: string;

  constructor(code: ImageErrorCode, detail?: string, options?: { cause?: unknown }) {
    super(detail ? `${MESSAGES[code]} ${detail}` : MESSAGES[code], options);
    this.name = "ImageError";
    this.code = code;
    this.detail = detail;
  }

  get shortMessage(): string {
    return MESSAGES[this.code];
  }
}

export function isImageError(error: unknown): error is ImageError {
  return error instanceof ImageError;
}

/** Convertit une erreur quelconque en `ImageError` pour l'affichage. */
export function toImageError(error: unknown): ImageError {
  if (isImageError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/cancel/i.test(message) || (error instanceof Error && error.name === "JobCancelledError")) {
    return new ImageError("cancelled", undefined, { cause: error });
  }
  return new ImageError("unknown", message, { cause: error });
}
