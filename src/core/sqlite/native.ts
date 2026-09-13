/**
 * Client de l'explorateur SQLite natif.
 *
 * Aucune requête n'est construite ici à partir d'un nom de table : c'est le
 * moteur natif qui échappe les identifiants et qui refuse tout ce qui n'est pas
 * une lecture. La WebView ne peut donc pas, même par accident, formuler une
 * écriture — et si elle le faisait, la connexion en lecture seule et
 * l'autorisateur SQLite la refuseraient.
 */

import { isTauri } from "@/core/platform";
import { toCsv, type CsvDelimiter } from "@/core/text/csv";

export const SQLITE_NATIVE_REQUIRED =
  "L'explorateur SQLite lit un fichier de base sur votre disque : il nécessite l'application " +
  "FourTout installée et n'est pas disponible dans l'aperçu navigateur.";

/** Rappel affiché en permanence par l'outil. */
export const SQLITE_READ_ONLY_NOTE =
  "La base est ouverte en lecture seule : connexion `SQLITE_OPEN_READ_ONLY`, `PRAGMA query_only` " +
  "et autorisateur SQLite refusant toute action qui n'est pas une lecture. Aucune requête, même " +
  "détournée, ne peut modifier le fichier.";

export interface ColumnInfo {
  name: string;
  declaredType: string;
  notNull: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
}

export interface IndexInfo {
  name: string;
  unique: boolean;
  origin: string;
  partial: boolean;
  columns: string[];
}

export interface ForeignKeyInfo {
  column: string;
  referencesTable: string;
  referencesColumn: string;
  onUpdate: string;
  onDelete: string;
}

export interface ObjectInfo {
  name: string;
  kind: "table" | "view";
  rows: number | null;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
  sql: string;
}

export interface DatabaseOverview {
  path: string;
  fileSize: number;
  pageSize: number;
  pageCount: number;
  encoding: string;
  userVersion: number;
  applicationId: number;
  sqliteVersion: string;
  objects: ObjectInfo[];
  tables: number;
  views: number;
  integrity: string;
}

export interface BlobPreview {
  size: number;
  hex: string;
  truncated: boolean;
}

/** Une cellule telle que le moteur la rend, sans conversion abusive. */
export type Cell =
  | { type: "null" }
  | { type: "integer"; value: number }
  | { type: "real"; value: number }
  | { type: "text"; value: string }
  | { type: "blob"; preview: BlobPreview };

export interface QueryResult {
  columns: string[];
  rows: Cell[][];
  rowCount: number;
  truncated: boolean;
  limit: number;
  elapsedMs: number;
  sql: string;
}

export const DEFAULT_ROW_LIMIT = 500;
export const MAX_ROW_LIMIT = 5000;

async function invokeNative<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error(SQLITE_NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    const message =
      typeof error === "string" ? error : error instanceof Error ? error.message : "";
    throw new Error(message || "L'explorateur SQLite a échoué.");
  }
}

/** Schéma complet d'une base. */
export function openDatabase(path: string): Promise<DatabaseOverview> {
  return invokeNative<DatabaseOverview>("sqlite_overview", { path });
}

/** Exécute une requête de lecture. */
export function runQuery(
  path: string,
  sql: string,
  limit = DEFAULT_ROW_LIMIT,
): Promise<QueryResult> {
  return invokeNative<QueryResult>("sqlite_query", { path, sql, limit });
}

/** Consulte les lignes d'une table, par pages. */
export function browseTable(
  path: string,
  table: string,
  limit = DEFAULT_ROW_LIMIT,
  offset = 0,
): Promise<QueryResult> {
  return invokeNative<QueryResult>("sqlite_browse", { path, table, limit, offset });
}

/* ------------------------------------------------------------------------ */
/* Affichage et export                                                       */
/* ------------------------------------------------------------------------ */

/** Texte affiché dans une cellule du tableau. */
export function cellText(cell: Cell): string {
  switch (cell.type) {
    case "null":
      return "NULL";
    case "integer":
    case "real":
      return String(cell.value);
    case "text":
      return cell.value;
    case "blob":
      return `BLOB · ${cell.preview.size} octet${cell.preview.size > 1 ? "s" : ""}`;
  }
}

/** Détail d'une cellule, affiché en info-bulle ou en seconde ligne. */
export function cellDetail(cell: Cell): string | undefined {
  if (cell.type !== "blob") return undefined;
  return cell.preview.hex.length > 0
    ? `${cell.preview.hex}${cell.preview.truncated ? " …" : ""}`
    : undefined;
}

/**
 * Valeur écrite dans un CSV.
 *
 * `NULL` devient une cellule **vide**, et non la chaîne « NULL » : sans quoi on
 * ne distinguerait plus une absence de valeur d'un texte valant « NULL ». Un
 * BLOB devient sa représentation hexadécimale préfixée, comme le ferait la
 * ligne de commande `sqlite3`.
 */
export function cellForCsv(cell: Cell): string {
  switch (cell.type) {
    case "null":
      return "";
    case "integer":
    case "real":
      return String(cell.value);
    case "text":
      return cell.value;
    case "blob":
      return `X'${cell.preview.hex.replace(/ /g, "")}${cell.preview.truncated ? "…" : ""}'`;
  }
}

/** Convertit un résultat de requête en CSV, avec l'écriture maison. */
export function queryToCsv(
  result: QueryResult,
  options: { delimiter?: CsvDelimiter; bom?: boolean } = {},
): string {
  const rows = [result.columns, ...result.rows.map((row) => row.map(cellForCsv))];
  return toCsv(rows, { delimiter: options.delimiter ?? ",", bom: options.bom ?? true });
}

/** Taille lisible d'un fichier de base. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Kio", "Mio", "Gio", "Tio"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1).replace(".", ",")} ${units[index]}`;
}
