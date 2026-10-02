import { format, type FormatOptionsWithLanguage, type SqlLanguage } from "sql-formatter";
import { localized, t } from "@/i18n";

/**
 * Formatage SQL.
 *
 * L'outil **ne se connecte à rien et n'exécute rien** : il réécrit une chaîne.
 * C'est une précision qui compte, parce qu'un « outil SQL » laisse souvent
 * croire le contraire.
 *
 * Les dialectes proposés sont ceux que la bibliothèque sait réellement
 * analyser. Annoncer un dialecte non pris en charge produirait un formatage
 * approximatif sur les syntaxes propres à ce dialecte — exactement le moment
 * où l'utilisateur a besoin qu'on ne se trompe pas.
 */

export class SqlFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SqlFormatError";
  }
}

export interface SqlDialect {
  value: SqlLanguage;
  label: string;
  hint: string;
}

export const SQL_DIALECTS: SqlDialect[] = localized(() => [
  { value: "sql", label: t("Standard"), hint: t("SQL standard, sans extension propriétaire") },
  { value: "postgresql", label: t("PostgreSQL"), hint: t("types, opérateurs et fonctions PostgreSQL") },
  { value: "mysql", label: t("MySQL"), hint: t("guillemets obliques, LIMIT … OFFSET") },
  { value: "sqlite", label: t("SQLite"), hint: t("dialecte embarqué") },
  { value: "mariadb", label: t("MariaDB"), hint: t("proche de MySQL") },
  { value: "bigquery", label: t("BigQuery"), hint: t("SQL standard Google") },
  { value: "transactsql", label: t("SQL Server"), hint: t("Transact-SQL") },
  { value: "plsql", label: t("Oracle"), hint: "PL/SQL" },
]);

export type KeywordCase = "upper" | "lower" | "preserve";

export interface SqlFormatSettings {
  dialect: SqlLanguage;
  indentation: "2" | "4" | "tab";
  keywordCase: KeywordCase;
  /** Une expression par ligne dans les listes de colonnes. */
  expandLists: boolean;
}

export const DEFAULT_SQL_SETTINGS: SqlFormatSettings = {
  dialect: "sql",
  indentation: "2",
  keywordCase: "upper",
  expandLists: true,
};

export function formatSql(source: string, settings: SqlFormatSettings): string {
  if (source.trim().length === 0) throw new SqlFormatError(t("Aucune requête à formater."));
  const options: FormatOptionsWithLanguage = {
    language: settings.dialect,
    tabWidth: settings.indentation === "tab" ? 2 : Number(settings.indentation),
    useTabs: settings.indentation === "tab",
    keywordCase: settings.keywordCase,
    expressionWidth: settings.expandLists ? 1 : 50,
    linesBetweenQueries: 2,
  };
  try {
    return format(source, options);
  } catch (error) {
    throw new SqlFormatError(
      error instanceof Error
        ? t("Requête non analysable : {value}", { value: error.message.split("\n")[0] })
        : t("Requête non analysable."),
    );
  }
}

/** Compacte une requête sur une seule ligne, utile pour la coller dans du code. */
export function compactSql(source: string): string {
  if (source.trim().length === 0) throw new SqlFormatError(t("Aucune requête à compacter."));
  return source
    // Les commentaires de fin de ligne disparaissent : sur une seule ligne, ils
    // avaleraient tout ce qui suit.
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const SQL_NOTE =
  "FourTout ne se connecte à aucune base et n'exécute aucune requête : le texte est " +
  "uniquement réécrit.";
