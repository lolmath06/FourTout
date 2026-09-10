/**
 * Écriture et relecture de CSV.
 *
 * Le CSV n'a pas de norme opposable, seulement un usage (RFC 4180) et deux
 * habitudes régionales : la virgule anglo-saxonne et le point-virgule des
 * tableurs configurés en français. Les deux sont proposés.
 *
 * Le point délicat n'est pas le séparateur mais l'échappement : un champ qui
 * contient le séparateur, un guillemet ou un saut de ligne doit être encadré de
 * guillemets, ses propres guillemets étant doublés. Un CSV qui néglige cela
 * produit des colonnes décalées à la relecture — c'est la raison d'être du
 * lecteur ci-dessous, qui sert à vérifier ce que l'on écrit.
 */

export type CsvDelimiter = "," | ";" | "\t";

export const CSV_DELIMITER_LABELS: Record<CsvDelimiter, string> = {
  ",": "Virgule",
  ";": "Point-virgule",
  "\t": "Tabulation",
};

export interface CsvOptions {
  delimiter?: CsvDelimiter;
  /**
   * Ajoute un BOM UTF-8 en tête. Excel sous Windows lit sinon un fichier
   * accentué comme du Windows-1252 et affiche « Ã© » à la place de « é ».
   */
  bom?: boolean;
  /** Fin de ligne. CRLF par défaut, comme l'attend la RFC 4180. */
  newline?: "\r\n" | "\n";
}

/** Échappe un champ selon la RFC 4180. */
export function escapeCsvField(value: string, delimiter: CsvDelimiter): string {
  const needsQuotes =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r") ||
    // Les espaces de bord seraient rognés par certains tableurs.
    value !== value.trim();
  if (!needsQuotes) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/** Sérialise un tableau de lignes en texte CSV. */
export function toCsv(rows: readonly (readonly string[])[], options: CsvOptions = {}): string {
  const delimiter = options.delimiter ?? ",";
  const newline = options.newline ?? "\r\n";
  const body = rows
    .map((row) => row.map((cell) => escapeCsvField(cell ?? "", delimiter)).join(delimiter))
    .join(newline);
  return options.bom ? `\ufeff${body}` : body;
}

/** Sérialise en octets UTF-8, prêts pour l'enregistrement. */
export function toCsvBytes(
  rows: readonly (readonly string[])[],
  options: CsvOptions = {},
): Uint8Array {
  return new TextEncoder().encode(toCsv(rows, options));
}

/**
 * Relit un texte CSV. Volontairement complet sur l'échappement — c'est ce qui
 * permet aux tests de vérifier qu'un export est réellement relisible, et non
 * seulement qu'il « ressemble » à du CSV.
 */
export function parseCsv(input: string, delimiter: CsvDelimiter = ","): string[][] {
  const text = input.startsWith("\ufeff") ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field === "") {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = "";
      index += 1;
      continue;
    }
    if (char === "\r" || char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += char === "\r" && text[index + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += char;
    index += 1;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
