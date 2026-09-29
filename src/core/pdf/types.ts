/** Types partagés par toutes les opérations PDF. */

/** Fichier produit par une opération, en mémoire, prêt à être enregistré. */
export interface OutputFile {
  name: string;
  bytes: Uint8Array;
  /** Type MIME, utilisé pour l'enregistrement navigateur et l'aperçu. */
  mimeType: string;
}

/** Informations lisibles d'un PDF, affichées avant toute opération. */
export interface PdfInfo {
  pageCount: number;
  /** Taille de la première page en points PostScript (1 pt = 1/72 pouce). */
  firstPageSize?: { width: number; height: number };
  /** Le document est-il chiffré ? */
  encrypted: boolean;
  /** Taille du fichier source, en octets. */
  byteLength: number;
}

/** Métadonnées d'un document. Les champs absents valent `undefined`. */
export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: Date;
  modificationDate?: Date;
}

/** Champs de métadonnées modifiables par l'utilisateur. */
export type EditableMetadataField = "title" | "author" | "subject" | "keywords";

export const EDITABLE_METADATA_FIELDS: EditableMetadataField[] = [
  "title",
  "author",
  "subject",
  "keywords",
];

/** Rotation en degrés, telle qu'acceptée par le format PDF. */
export type RotationAngle = 90 | 180 | 270;

/** Emplacements possibles d'un filigrane ou d'un numéro de page. */
export type Placement =
  | "center"
  | "top"
  | "bottom"
  | "diagonal"
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

/**
 * Entrée d'une opération : les octets du fichier et son nom d'origine.
 * On ne transporte jamais de `File` dans le cœur métier, pour que les
 * opérations soient testables sans DOM.
 */
export interface PdfSource {
  name: string;
  bytes: Uint8Array;
  /** Mot de passe, si le document est protégé. */
  password?: string;
}

/** Rapport de progression d'une opération longue. */
export interface ProgressReporter {
  (progress: { ratio?: number; label?: string }): void;
}

/** Contexte optionnel passé à toute opération longue. */
export interface OperationContext {
  report?: ProgressReporter;
  signal?: AbortSignal;
}
