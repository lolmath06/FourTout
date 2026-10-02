import {
  catalogTranslation,
  currentLocale,
  FALLBACK_LOCALE,
  SOURCE_LOCALE,
  type CategoryTranslation,
  type LocaleCode,
  type ToolTranslation,
} from "@/i18n";
import type { CategoryDefinition, ToolDefinition } from "./types";

/**
 * Textes du catalogue dans la langue affichée.
 *
 * Les définitions (`catalog/*.ts`, `categories.ts`) portent le texte source,
 * en français, et toute la structure de l'outil. Les traductions vivent à
 * part (`src/i18n/catalog/<langue>.json`), indexées par identifiant : rien
 * n'est dupliqué, et un outil ajouté sans traduction s'affiche quand même —
 * en anglais si l'anglais existe, sinon dans sa langue source.
 *
 * L'interface n'affiche jamais `tool.name` directement : elle passe par ces
 * fonctions.
 */

export interface ToolText {
  name: string;
  description: string;
  keywords: string[];
  aliases: string[];
  note?: string;
}

export interface CategoryText {
  name: string;
  description: string;
  keywords: string[];
}

type TextField = "name" | "description";

function pick(
  field: TextField,
  primary: ToolTranslation | CategoryTranslation | undefined,
  fallback: ToolTranslation | CategoryTranslation | undefined,
  source: string,
): string {
  return primary?.[field] ?? fallback?.[field] ?? source;
}

export function toolText(tool: ToolDefinition, locale: LocaleCode = currentLocale()): ToolText {
  if (locale === SOURCE_LOCALE) return sourceToolText(tool);
  const own = catalogTranslation(locale)?.tools[tool.id];
  const fallback =
    locale === FALLBACK_LOCALE ? undefined : catalogTranslation(FALLBACK_LOCALE)?.tools[tool.id];
  const note = own?.note ?? fallback?.note ?? tool.note;
  return {
    name: pick("name", own, fallback, tool.name),
    description: pick("description", own, fallback, tool.description),
    keywords: own?.keywords ?? fallback?.keywords ?? tool.keywords ?? [],
    aliases: own?.aliases ?? fallback?.aliases ?? tool.aliases ?? [],
    ...(note ? { note } : {}),
  };
}

export function sourceToolText(tool: ToolDefinition): ToolText {
  return {
    name: tool.name,
    description: tool.description,
    keywords: tool.keywords ?? [],
    aliases: tool.aliases ?? [],
    ...(tool.note ? { note: tool.note } : {}),
  };
}

export function categoryText(
  category: CategoryDefinition,
  locale: LocaleCode = currentLocale(),
): CategoryText {
  if (locale === SOURCE_LOCALE) return sourceCategoryText(category);
  const own = catalogTranslation(locale)?.categories[category.id];
  const fallback =
    locale === FALLBACK_LOCALE
      ? undefined
      : catalogTranslation(FALLBACK_LOCALE)?.categories[category.id];
  return {
    name: pick("name", own, fallback, category.name),
    description: pick("description", own, fallback, category.description),
    keywords: own?.keywords ?? fallback?.keywords ?? category.keywords ?? [],
  };
}

export function sourceCategoryText(category: CategoryDefinition): CategoryText {
  return {
    name: category.name,
    description: category.description,
    keywords: category.keywords ?? [],
  };
}

/** Raccourcis pour l'affichage. */
export const toolName = (tool: ToolDefinition): string => toolText(tool).name;
export const toolDescription = (tool: ToolDefinition): string => toolText(tool).description;
export const toolNote = (tool: ToolDefinition): string | undefined => toolText(tool).note;
export const categoryName = (category: CategoryDefinition): string => categoryText(category).name;
export const categoryDescription = (category: CategoryDefinition): string =>
  categoryText(category).description;
