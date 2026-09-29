import type { OperationContext } from "@/core/pdf/types";

/**
 * Reconnaissance de texte (OCR), moteur abstrait.
 *
 * Le cœur métier ne connaît que cette interface : l'application y branche
 * tesseract.js (WebAssembly, 100 % local), les tests un moteur réel en Node ou
 * un moteur simulé. Aucune image ne quitte la machine.
 */

/** Langues proposées. `fra+eng` reconnaît les deux simultanément. */
export type OcrLanguage = "fra" | "eng" | "fra+eng" | "deu" | "spa" | "ita" | "por";

/**
 * Rectangle d'un mot dans l'image analysée, en **pixels image**, origine
 * haut-gauche (convention canvas). C'est la convention de tesseract ; la
 * conversion vers le repère PDF (origine bas-gauche) est faite une seule fois,
 * dans `searchablePdf`.
 */
export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Un mot reconnu et sa position. */
export interface OcrWord {
  text: string;
  /** Confiance de ce mot, de 0 à 100. */
  confidence: number;
  box: OcrBox;
}

/**
 * Mise en page reconnue : les mots positionnés et les dimensions de l'image
 * dans laquelle ils ont été repérés. Sans ces dimensions, les coordonnées ne
 * veulent rien dire — c'est ce qui permet la mise à l'échelle vers la page PDF.
 */
export interface OcrLayout {
  imageWidth: number;
  imageHeight: number;
  words: OcrWord[];
}

export interface OcrResult {
  /** Texte reconnu, lignes conservées. */
  text: string;
  /** Confiance moyenne, de 0 à 100. */
  confidence: number;
  /** Nombre de mots reconnus. */
  words: number;
  /** Nombre de caractères (texte nettoyé). */
  chars: number;
  /**
   * Mots positionnés, présents uniquement si l'appelant les a demandés
   * (`RecognizeRequest.layout`). Le surcoût est réel : on ne le paye que pour
   * les usages qui en ont besoin, la couche texte d'un PDF recherchable.
   */
  layout?: OcrLayout;
}

/** Une image d'entrée pour l'OCR : ses octets et un nom pour l'affichage. */
export interface OcrInput {
  name: string;
  bytes: Uint8Array;
  /**
   * Dimensions de l'image, en pixels. Facultatives, mais nécessaires pour
   * exploiter `OcrResult.layout` : sans elles, les coordonnées des mots ne
   * peuvent être rapportées à aucune surface.
   */
  width?: number;
  height?: number;
}

/** Réglages d'une reconnaissance. */
export interface RecognizeRequest {
  /** Renvoyer aussi la position de chaque mot. */
  layout?: boolean;
}

export interface OcrEngine {
  readonly id: string;
  recognize(
    input: OcrInput,
    language: OcrLanguage,
    context?: OperationContext,
    request?: RecognizeRequest,
  ): Promise<OcrResult>;
  /** Libère les ressources (worker WebAssembly). */
  dispose(): Promise<void>;
}

/** Libellés français des langues, pour l'interface. */
export const OCR_LANGUAGE_LABELS: Record<OcrLanguage, string> = {
  fra: "Français",
  eng: "Anglais",
  "fra+eng": "Français + Anglais",
  deu: "Allemand",
  spa: "Espagnol",
  ita: "Italien",
  por: "Portugais",
};

/** Langues dont le modèle est réellement embarqué dans l'application. */
export const BUNDLED_LANGUAGES: OcrLanguage[] = ["fra", "eng", "fra+eng"];
