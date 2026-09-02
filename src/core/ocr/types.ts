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

export interface OcrResult {
  /** Texte reconnu, lignes conservées. */
  text: string;
  /** Confiance moyenne, de 0 à 100. */
  confidence: number;
  /** Nombre de mots reconnus. */
  words: number;
  /** Nombre de caractères (texte nettoyé). */
  chars: number;
}

/** Une image d'entrée pour l'OCR : ses octets et un nom pour l'affichage. */
export interface OcrInput {
  name: string;
  bytes: Uint8Array;
}

export interface OcrEngine {
  readonly id: string;
  recognize(
    input: OcrInput,
    language: OcrLanguage,
    context?: OperationContext,
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
