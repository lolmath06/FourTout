// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { configurePdfJsForNode } from "@/test/nodeRaster";
import { HEAVY_TIMEOUT } from "@/test/timeouts";
import { parseCsv, toCsv } from "@/core/text/csv";
import { readZip, readZipEntry } from "@/core/archive/unzip";
import type { PdfSource } from "../types";
import {
  detectTables,
  extractTables,
  findColumnBoundaries,
  groupIntoRows,
  tableToCsvFile,
  tablesToXlsxFile,
  type PositionedItem,
} from "./tables";

const DIR = join(process.cwd(), "test-assets", "generated");

function source(name: string): PdfSource {
  return { name, bytes: new Uint8Array(readFileSync(join(DIR, name))) };
}

beforeAll(() => {
  configurePdfJsForNode();
  execFileSync(process.execPath, [join(process.cwd(), "scripts/generate-document-assets.mjs")], {
    stdio: "ignore",
  });
}, HEAVY_TIMEOUT);

/* ============================================ reconstruction, sans PDF */

/** Fabrique un fragment positionné, comme en livre pdf.js. */
function item(text: string, x: number, y: number, width = text.length * 6): PositionedItem {
  return { text, x, y, width, height: 11 };
}

describe("regroupement en lignes", () => {
  it("réunit les fragments d'une même ligne de base", () => {
    const rows = groupIntoRows([
      item("Quantité", 360, 700),
      item("Référence", 56, 700),
      item("FR-001", 56, 666),
      item("12", 360, 666),
    ]);
    expect(rows).toHaveLength(2);
    // Les lignes descendent, les fragments d'une ligne sont ordonnés à gauche.
    expect(rows[0].map((entry) => entry.text)).toEqual(["Référence", "Quantité"]);
    expect(rows[1].map((entry) => entry.text)).toEqual(["FR-001", "12"]);
  });

  it("tolère un léger décalage de ligne de base", () => {
    const rows = groupIntoRows([item("a", 10, 500), item("b", 100, 502.5)]);
    expect(rows).toHaveLength(1);
  });

  it("sépare deux lignes distinctes", () => {
    const rows = groupIntoRows([item("a", 10, 500), item("b", 10, 480)]);
    expect(rows).toHaveLength(2);
  });
});

describe("détection des colonnes", () => {
  it("trouve les couloirs verticaux vides", () => {
    const rows = [
      [item("Référence", 56, 700, 60), item("Quantité", 300, 700, 50)],
      [item("FR-001", 56, 670, 40), item("12", 300, 670, 12)],
    ];
    const boundaries = findColumnBoundaries(rows, 10);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toBeGreaterThan(116);
    expect(boundaries[0]).toBeLessThan(300);
  });

  it("ne coupe pas une phrase continue", () => {
    const rows = [[item("Une phrase entière sans colonne", 56, 700, 300)]];
    expect(findColumnBoundaries(rows, 10)).toEqual([]);
  });
});

describe("reconstruction d'un tableau", () => {
  const grid = [
    ["Référence", "Désignation", "Quantité"],
    ["FR-001", "Câble tressé", "12"],
    ["FR-002", "Boîtier alu", "3"],
  ];
  const items = grid.flatMap((row, rowIndex) =>
    row.map((cell, columnIndex) =>
      item(cell, [56, 200, 400][columnIndex], 700 - rowIndex * 30, cell.length * 5),
    ),
  );

  it("restitue lignes, colonnes et cellules accentuées", () => {
    const [table] = detectTables(items, 1);
    expect(table.rowCount).toBe(3);
    expect(table.columnCount).toBe(3);
    expect(table.rows).toEqual(grid);
    expect(table.page).toBe(1);
    expect(table.fillRatio).toBe(1);
  });

  it("coupe le tableau sur une ligne de texte courant", () => {
    const withHeading = [
      item("Un titre de section qui traverse la page", 56, 760, 300),
      ...items,
    ];
    const tables = detectTables(withHeading, 1);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toEqual(grid);
  });

  it("ne voit pas de tableau dans du texte courant", () => {
    expect(
      detectTables(
        [
          item("Première ligne d'un paragraphe ordinaire", 56, 700, 300),
          item("Deuxième ligne du même paragraphe", 56, 680, 290),
        ],
        1,
      ),
    ).toEqual([]);
  });
});

/* ================================================= extraction réelle, PDF */

describe("extraction réelle depuis un PDF", () => {
  const expected = [
    ["Référence", "Désignation", "Quantité", "Prix unitaire"],
    ["FR-001", "Câble tressé", "12", "4,50"],
    ["FR-002", "Boîtier alu", "3", "18,90"],
    ["FR-003", "Vis à tête plate", "250", "0,07"],
    ["FR-004", "Écrou hexagonal", "250", "0,05"],
  ];

  it("lit un tableau quadrillé", async () => {
    const result = await extractTables(source("table-grid.pdf"));
    expect(result.tables).toHaveLength(1);
    const table = result.tables[0];
    expect(table.rowCount).toBe(5);
    expect(table.columnCount).toBe(4);
    expect(table.rows).toEqual(expected);
  });

  it("lit un tableau sans aucune bordure", async () => {
    const result = await extractTables(source("table-columns.pdf"));
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].rows).toEqual(expected);
  });

  it("signale l'absence de tableau plutôt que d'en inventer un", async () => {
    await expect(extractTables(source("compare-a.pdf"))).rejects.toMatchObject({
      code: "table-not-found",
    });
  });

  it("respecte l'annulation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractTables(source("table-grid.pdf"), {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "cancelled" });
  });

  it("refuse une page inexistante", async () => {
    await expect(extractTables(source("table-grid.pdf"), { pages: [9] })).rejects.toMatchObject({
      code: "page-out-of-range",
    });
  });
});

/* ================================================================== CSV */

describe("export CSV", () => {
  it("échappe séparateurs, guillemets et sauts de ligne", () => {
    const rows = [
      ["simple", 'avec "guillemets"', "avec;point-virgule"],
      ["avec\nretour", "avec,virgule", " espaces "],
    ];
    const csv = toCsv(rows, { delimiter: ";" });
    // La relecture est la seule vérification qui compte.
    expect(parseCsv(csv, ";")).toEqual(rows);
  });

  it("se relit à l'identique avec l'autre séparateur", () => {
    const rows = [["a;b", "c,d"], ["e", "f"]];
    expect(parseCsv(toCsv(rows, { delimiter: "," }), ",")).toEqual(rows);
  });

  it("préserve les caractères français et pose un BOM à la demande", async () => {
    const result = await extractTables(source("table-grid.pdf"));
    const file = tableToCsvFile("table-grid.pdf", result.tables[0], { delimiter: ";", bom: true });

    expect(file.name).toBe("table-grid-tableau-p1-1.csv");
    expect([...file.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    const rows = parseCsv(new TextDecoder().decode(file.bytes), ";");
    expect(rows[0]).toEqual(["Référence", "Désignation", "Quantité", "Prix unitaire"]);
    expect(rows[3][1]).toBe("Vis à tête plate");
    expect(rows[4][1]).toBe("Écrou hexagonal");
  });

  it("laisse le BOM de côté quand il n'est pas demandé", async () => {
    const result = await extractTables(source("table-columns.pdf"));
    const file = tableToCsvFile("t.pdf", result.tables[0], { bom: false });
    expect(file.bytes[0]).not.toBe(0xef);
  });
});

/* ================================================================= XLSX */

describe("export XLSX", () => {
  it("produit une archive relisible, une feuille par tableau", async () => {
    const result = await extractTables(source("table-grid.pdf"));
    const file = tablesToXlsxFile("table-grid.pdf", result.tables);

    expect(file.name).toBe("table-grid-tableaux.xlsx");
    // Un .xlsx est une archive : on l'ouvre réellement avec notre lecteur ZIP.
    const entries = readZip(file.bytes);
    const names = entries.map((entry) => entry.name);
    expect(names).toContain("[Content_Types].xml");
    expect(names).toContain("xl/workbook.xml");
    expect(names).toContain("xl/_rels/workbook.xml.rels");
    expect(names).toContain("xl/worksheets/sheet1.xml");

    const sheet = new TextDecoder().decode(readZipEntry(entries, "xl/worksheets/sheet1.xml")!);
    expect(sheet).toContain("Référence");
    expect(sheet).toContain("Vis à tête plate");
    // Cinq lignes de données.
    expect(sheet.match(/<row /g)).toHaveLength(5);

    const workbook = new TextDecoder().decode(readZipEntry(entries, "xl/workbook.xml")!);
    expect(workbook).toContain('name="Page 1 (1)"');
  });

  it("échappe ce qui casserait le XML", async () => {
    const { createXlsx } = await import("@/core/files/xlsx");
    const bytes = createXlsx([
      { name: "Test", rows: [["a & b", "<balise>", 'guillemet "x"']] },
    ]);
    const sheet = new TextDecoder().decode(
      readZipEntry(readZip(bytes), "xl/worksheets/sheet1.xml")!,
    );
    expect(sheet).toContain("a &amp; b");
    expect(sheet).toContain("&lt;balise&gt;");
    expect(sheet).not.toContain("<balise>");
  });

  it("assainit et dédoublonne les noms d'onglets", async () => {
    const { createXlsx, sanitizeSheetName } = await import("@/core/files/xlsx");
    expect(sanitizeSheetName("Page 1/2 [test]")).toBe("Page 1 2 test");
    expect(sanitizeSheetName("")).toBe("Feuille");
    expect(sanitizeSheetName("x".repeat(50))).toHaveLength(31);

    const workbook = new TextDecoder().decode(
      readZipEntry(
        readZip(createXlsx([{ name: "Même", rows: [["a"]] }, { name: "Même", rows: [["b"]] }])),
        "xl/workbook.xml",
      )!,
    );
    expect(workbook).toContain('name="Même"');
    expect(workbook).toContain('name="Même (2)"');
  });

  it("nomme les colonnes comme un tableur", async () => {
    const { columnLetter } = await import("@/core/files/xlsx");
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(27)).toBe("AB");
    expect(columnLetter(51)).toBe("AZ");
  });
});
