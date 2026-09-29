import { describe, expect, it } from "vitest";
import {
  cellDetail,
  cellForCsv,
  cellText,
  formatBytes,
  queryToCsv,
  type Cell,
  type QueryResult,
} from "./native";
import { parseCsv } from "@/core/text/csv";

const result = (columns: string[], rows: Cell[][]): QueryResult => ({
  columns,
  rows,
  rowCount: rows.length,
  truncated: false,
  limit: 500,
  elapsedMs: 1,
  sql: "SELECT …",
});

describe("cellules SQLite", () => {
  it("nomme un NULL sans le confondre avec une chaîne vide", () => {
    expect(cellText({ type: "null" })).toBe("NULL");
    expect(cellText({ type: "text", value: "" })).toBe("");
    // À l'export, c'est l'inverse qui compte : une cellule vide, pas « NULL ».
    expect(cellForCsv({ type: "null" })).toBe("");
    expect(cellForCsv({ type: "text", value: "NULL" })).toBe("NULL");
  });

  it("ne présente jamais un BLOB comme du texte", () => {
    const blob: Cell = { type: "blob", preview: { size: 16, hex: "00 11 22", truncated: true } };
    expect(cellText(blob)).toBe("BLOB · 16 octets");
    expect(cellDetail(blob)).toBe("00 11 22 …");
    // À l'export, la notation hexadécimale de sqlite3, sans espace.
    expect(cellForCsv(blob)).toBe("X'001122…'");
  });

  it("rend les nombres tels quels", () => {
    expect(cellText({ type: "integer", value: 42 })).toBe("42");
    expect(cellText({ type: "real", value: 12500.5 })).toBe("12500.5");
    expect(cellDetail({ type: "integer", value: 42 })).toBeUndefined();
  });
});

describe("export CSV d'un résultat", () => {
  it("échappe virgules, guillemets et retours à la ligne", () => {
    const csv = queryToCsv(
      result(
        ["id", "titre", "note"],
        [
          [
            { type: "integer", value: 1 },
            { type: "text", value: "Refonte, étape 2" },
            { type: "text", value: 'Il a dit "oui"' },
          ],
          [
            { type: "integer", value: 2 },
            { type: "text", value: "Deux\nlignes" },
            { type: "null" },
          ],
        ],
      ),
      { bom: false },
    );

    const rows = parseCsv(csv, ",");
    expect(rows[0]).toEqual(["id", "titre", "note"]);
    expect(rows[1]).toEqual(["1", "Refonte, étape 2", 'Il a dit "oui"']);
    expect(rows[2]).toEqual(["2", "Deux\nlignes", ""]);
  });

  it("conserve les accents et pose le BOM attendu par les tableurs", () => {
    const csv = queryToCsv(
      result(["nom"], [[{ type: "text", value: "Élodie" }]]),
    );
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Élodie");
    expect(parseCsv(csv.slice(1), ",")[1]).toEqual(["Élodie"]);
  });

  it("exporte l'en-tête même sans aucune ligne", () => {
    const csv = queryToCsv(result(["a", "b"], []), { bom: false });
    expect(csv.trim()).toBe("a,b");
  });
});

describe("taille de fichier", () => {
  it("écrit une taille lisible en unités binaires", () => {
    expect(formatBytes(512)).toBe("512 o");
    expect(formatBytes(1024)).toBe("1,0 Kio");
    expect(formatBytes(118_784)).toBe("116 Kio");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5,0 Mio");
  });
});
