import type { EditableTextItem, PdfTextEdit } from "@/core/pdf/operations/editText";

/**
 * Logique pure de l'éditeur de texte PDF, isolée du composant : historique
 * (annuler/rétablir) et géométrie de la couche de texte. Séparée pour être
 * testable sans DOM et ne pas gêner le rechargement à chaud du composant.
 */

/** Modifications en cours, indexées par `page:index`. */
export type EditMap = Record<string, PdfTextEdit>;

export interface HistoryState {
  past: EditMap[];
  present: EditMap;
  future: EditMap[];
}

export type HistoryAction =
  | { type: "set"; map: EditMap }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset" };

/** Réducteur d'historique : chaque `set` empile l'état et vide le futur. */
export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "set":
      return { past: [...state.past, state.present], present: action.map, future: [] };
    case "undo": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
      };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return { past: [...state.past, state.present], present: next, future: rest };
    }
    case "reset":
      return { past: [], present: {}, future: [] };
    default:
      return state;
  }
}

export const initialHistory: HistoryState = { past: [], present: {}, future: [] };

export const keyOf = (page: number, index: number) => `${page}:${index}`;

export interface OverlayBox {
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
}

/** Position CSS d'un fragment au-dessus de l'image (origine haut-gauche). */
export function overlayBox(item: EditableTextItem, zoom: number, heightPts: number): OverlayBox {
  const fontSize = Math.max(6, item.fontSize * zoom);
  const baselineFromTop = (heightPts - item.y) * zoom;
  return {
    left: item.x * zoom,
    top: baselineFromTop - fontSize * 0.82,
    width: Math.max(6, item.width * zoom),
    height: fontSize * 1.18,
    fontSize,
  };
}

/** Largeur cible du rendu, en points, selon le zoom (avant multiplication DPR). */
export function pageWidthTarget(zoom: number): number {
  // On rend un peu plus large que l'affichage pour garder de la netteté au zoom.
  return 800 * Math.max(1, zoom);
}

export function toCss(color: { r: number; g: number; b: number }): string {
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${c(color.r)}, ${c(color.g)}, ${c(color.b)})`;
}
