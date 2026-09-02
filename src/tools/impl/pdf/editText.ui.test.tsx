import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  historyReducer,
  keyOf,
  overlayBox,
  type EditMap,
  type HistoryState,
} from "./editTextUi";
import { PdfEditTextTool } from "./PdfEditTextTool";
import { toolRegistry } from "@/core/tools/registry";
import type { EditableTextItem } from "@/core/pdf/operations/editText";

const empty: HistoryState = { past: [], present: {}, future: [] };
const mapWith = (key: string): EditMap => ({
  [key]: {
    page: 1,
    index: 0,
    originalText: "a",
    replacementText: "b",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    fontSize: 10,
    bold: false,
    italic: false,
    fontFamily: "Helvetica",
    vertical: false,
    rotated: false,
    color: { r: 0, g: 0, b: 0 },
    background: { r: 1, g: 1, b: 1 },
    uniformBackground: true,
  },
});

describe("éditeur PDF — historique (undo/redo, modifications multiples)", () => {
  it("empile les modifications et permet d'annuler puis rétablir", () => {
    const one = mapWith(keyOf(1, 0));
    const two = { ...one, ...mapWith(keyOf(1, 1)) };

    let state = historyReducer(empty, { type: "set", map: one });
    state = historyReducer(state, { type: "set", map: two });
    expect(Object.keys(state.present)).toHaveLength(2);

    state = historyReducer(state, { type: "undo" });
    expect(Object.keys(state.present)).toHaveLength(1);
    state = historyReducer(state, { type: "undo" });
    expect(Object.keys(state.present)).toHaveLength(0);

    state = historyReducer(state, { type: "redo" });
    expect(Object.keys(state.present)).toHaveLength(1);
  });

  it("une nouvelle modification efface le futur (rétablir devient impossible)", () => {
    let state = historyReducer(empty, { type: "set", map: mapWith(keyOf(1, 0)) });
    state = historyReducer(state, { type: "undo" });
    expect(state.future).toHaveLength(1);
    state = historyReducer(state, { type: "set", map: mapWith(keyOf(2, 0)) });
    expect(state.future).toHaveLength(0);
  });

  it("réinitialise tout au changement de document", () => {
    let state = historyReducer(empty, { type: "set", map: mapWith(keyOf(1, 0)) });
    state = historyReducer(state, { type: "reset" });
    expect(state).toEqual(empty);
  });

  it("ne fait rien si rien à annuler/rétablir", () => {
    expect(historyReducer(empty, { type: "undo" })).toBe(empty);
    expect(historyReducer(empty, { type: "redo" })).toBe(empty);
  });
});

describe("éditeur PDF — géométrie de la couche de texte", () => {
  const item: EditableTextItem = {
    index: 0,
    text: "Titre",
    x: 40,
    y: 200,
    width: 120,
    height: 20,
    fontSize: 20,
    fontFamily: "Helvetica",
    bold: false,
    italic: false,
    vertical: false,
    rotated: false,
  };

  it("positionne un fragment au-dessus du rendu (origine haut-gauche)", () => {
    const box = overlayBox(item, 1, 300);
    expect(box.left).toBe(40);
    expect(box.width).toBe(120);
    // Ligne de base à 200 pt du bas → 100 px du haut, moins ~une hampe.
    expect(box.top).toBeCloseTo(100 - 20 * 0.82, 5);
    expect(box.fontSize).toBe(20);
  });

  it("suit le zoom", () => {
    const box = overlayBox(item, 2, 300);
    expect(box.left).toBe(80);
    expect(box.width).toBe(240);
    expect(box.fontSize).toBe(40);
  });
});

describe("éditeur PDF — interface", () => {
  it("affiche la zone de dépôt et l'invite d'édition", () => {
    const tool = toolRegistry.get("pdf-edit-text")!;
    render(<PdfEditTextTool tool={tool} />);
    expect(screen.getByText("Déposez votre PDF ici")).toBeInTheDocument();
    expect(screen.getByText(/Double-cliquez un texte/i)).toBeInTheDocument();
  });
});
