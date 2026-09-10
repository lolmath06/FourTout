import { createZip } from "@/core/archive/zip";

/**
 * Écriture de classeurs XLSX.
 *
 * **Pourquoi sans bibliothèque.** Le besoin de FourTout est d'écrire des
 * tableaux de texte — pas de formules, pas de styles, pas de lecture de
 * classeurs existants. Or un `.xlsx` est une archive ZIP contenant quelques
 * parties XML, et FourTout sait déjà écrire des archives ZIP (`core/archive`).
 * Les bibliothèques candidates pèsent de plusieurs centaines de kilo-octets à
 * quelques mégaoctets, apportent un analyseur complet dont rien n'est utilisé,
 * et l'une des plus connues — `xlsx` sur npm — n'est plus publiée sur le
 * registre public et a connu des avis de sécurité. Écrire les six parties
 * nécessaires est plus court que d'auditer tout cela.
 *
 * **Ce que le format produit promet.** Un classeur lisible par Excel,
 * LibreOffice Calc et Google Sheets, une feuille par tableau, tout le contenu
 * en texte. Les valeurs ne sont pas typées : un tableau reconstruit à partir
 * d'un PDF ne dit pas si « 12,50 » est un nombre, une référence ou un morceau
 * de phrase, et deviner à la place de l'utilisateur ferait plus de dégâts que
 * de service.
 */

export interface XlsxSheet {
  /** Nom de l'onglet. Assaini automatiquement. */
  name: string;
  rows: readonly (readonly string[])[];
}

/**
 * Caractères interdits dans un nom d'onglet par le format, plus la limite de
 * 31 caractères. Un nom invalide fait refuser le fichier entier par Excel.
 */
export function sanitizeSheetName(name: string, fallback = "Feuille"): string {
  const cleaned = name
    .replace(/[\\/?*[\]:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31);
  return cleaned.length > 0 ? cleaned : fallback;
}

/** Échappe le texte pour du contenu XML. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Les caractères de contrôle sont interdits par XML 1.0 : les laisser
    // passer ferait rejeter le classeur entier par Excel. Les viser
    // explicitement est donc le propos de cette expression.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

/** `0` → `A`, `25` → `Z`, `26` → `AA`. Référence de colonne du tableur. */
export function columnLetter(index: number): string {
  let value = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return letters;
}

function sheetXml(rows: readonly (readonly string[])[]): string {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const text = value ?? "";
          if (text === "") return "";
          // `inlineStr` évite la table de chaînes partagées : une partie de
          // moins à écrire et à tenir cohérente, pour le même résultat.
          return `<c r="${columnLetter(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/**
 * Assemble le classeur. Chaque feuille reçoit un nom unique : deux onglets
 * homonymes rendent le fichier illisible.
 */
export function createXlsx(sheets: readonly XlsxSheet[]): Uint8Array {
  if (sheets.length === 0) throw new Error("Un classeur doit contenir au moins une feuille.");

  const used = new Set<string>();
  const names = sheets.map((sheet, index) => {
    let name = sanitizeSheetName(sheet.name, `Feuille ${index + 1}`);
    let counter = 2;
    while (used.has(name.toLowerCase())) {
      const suffix = ` (${counter})`;
      name = `${sanitizeSheetName(sheet.name, `Feuille ${index + 1}`).slice(0, 31 - suffix.length)}${suffix}`;
      counter += 1;
    }
    used.add(name.toLowerCase());
    return name;
  });

  const encoder = new TextEncoder();
  const entry = (name: string, xml: string) => ({ name, bytes: encoder.encode(xml) });

  const sheetOverrides = sheets
    .map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");

  const sheetEntries = names
    .map(
      (name, index) =>
        `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("");

  const workbookRels = names
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join("");

  return createZip([
    entry(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetOverrides}</Types>`,
    ),
    entry(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    entry(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries}</sheets></workbook>`,
    ),
    entry(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}</Relationships>`,
    ),
    ...sheets.map((sheet, index) =>
      entry(`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet.rows)),
    ),
  ]);
}
