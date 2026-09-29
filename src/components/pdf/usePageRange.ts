import { useMemo } from "react";
import { parsePageRange } from "@/core/pdf/pageRange";
import { isPdfError } from "@/core/pdf/errors";

/**
 * Validation d'une sélection de pages, séparée du composant pour rester
 * réutilisable et pour ne pas gêner le rechargement à chaud.
 */

export interface PageRangeState {
  input: string;
  pages: number[];
  error?: string;
  valid: boolean;
}

export function usePageRange(input: string, pageCount: number): PageRangeState {
  return useMemo(() => {
    if (input.trim().length === 0) {
      return { input, pages: [], valid: false };
    }
    try {
      const { pages } = parsePageRange(input, pageCount);
      return { input, pages, valid: true };
    } catch (error) {
      return {
        input,
        pages: [],
        valid: false,
        error: isPdfError(error) ? error.message : "Sélection invalide",
      };
    }
  }, [input, pageCount]);
}

