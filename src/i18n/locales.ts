/**
 * Les langues de FourTout.
 *
 * Ajouter une langue = une entrée ici, puis ses deux fichiers de traduction
 * (`messages/<code>.json` pour l'interface, `catalog/<code>.json` pour les
 * outils et les catégories). Aucun composant n'a besoin d'être modifié : le
 * sélecteur des paramètres, la détection de la langue du système et les tests
 * de couverture lisent tous cette liste.
 *
 * Toutes les traductions sont embarquées dans l'application : aucune n'est
 * jamais téléchargée.
 */

export type LocaleCode =
  | "en"
  | "fr"
  | "es"
  | "de"
  | "it"
  | "pt-BR"
  | "nl"
  | "pl"
  | "ru"
  | "tr"
  | "id"
  | "hi"
  | "ja"
  | "ko"
  | "zh-CN"
  | "zh-TW";

/** Préférence enregistrée : une langue précise, ou celle du système. */
export type LanguagePreference = "system" | LocaleCode;

/** Sens d'écriture. Toutes les langues actuelles sont LTR ; RTL est prévu. */
export type TextDirection = "ltr" | "rtl";

export interface LocaleDefinition {
  code: LocaleCode;
  /** Nom de la langue dans la langue elle-même : c'est ce qu'affiche le sélecteur. */
  nativeName: string;
  /** Nom anglais, pour la documentation et les tests. */
  englishName: string;
  dir: TextDirection;
  /**
   * Étiquette BCP 47 passée à `Intl` (nombres, dates, tri) et à
   * `document.documentElement.lang`.
   */
  intl: string;
}

/** Langue de repli : toute chaîne absente d'une langue est cherchée ici. */
export const FALLBACK_LOCALE: LocaleCode = "en";

/**
 * Langue du code source. Les messages sont écrits en français dans le code :
 * c'est le dernier repli, celui qui garantit qu'aucune clé brute n'apparaît.
 */
export const SOURCE_LOCALE: LocaleCode = "fr";

export const LOCALES: readonly LocaleDefinition[] = [
  { code: "en", nativeName: "English", englishName: "English", dir: "ltr", intl: "en" },
  { code: "fr", nativeName: "Français", englishName: "French", dir: "ltr", intl: "fr" },
  { code: "es", nativeName: "Español", englishName: "Spanish", dir: "ltr", intl: "es" },
  { code: "de", nativeName: "Deutsch", englishName: "German", dir: "ltr", intl: "de" },
  { code: "it", nativeName: "Italiano", englishName: "Italian", dir: "ltr", intl: "it" },
  {
    code: "pt-BR",
    nativeName: "Português (Brasil)",
    englishName: "Portuguese (Brazil)",
    dir: "ltr",
    intl: "pt-BR",
  },
  { code: "nl", nativeName: "Nederlands", englishName: "Dutch", dir: "ltr", intl: "nl" },
  { code: "pl", nativeName: "Polski", englishName: "Polish", dir: "ltr", intl: "pl" },
  { code: "ru", nativeName: "Русский", englishName: "Russian", dir: "ltr", intl: "ru" },
  { code: "tr", nativeName: "Türkçe", englishName: "Turkish", dir: "ltr", intl: "tr" },
  {
    code: "id",
    nativeName: "Bahasa Indonesia",
    englishName: "Indonesian",
    dir: "ltr",
    intl: "id",
  },
  { code: "hi", nativeName: "हिन्दी", englishName: "Hindi", dir: "ltr", intl: "hi" },
  { code: "ja", nativeName: "日本語", englishName: "Japanese", dir: "ltr", intl: "ja" },
  { code: "ko", nativeName: "한국어", englishName: "Korean", dir: "ltr", intl: "ko" },
  {
    code: "zh-CN",
    nativeName: "简体中文",
    englishName: "Chinese (Simplified)",
    dir: "ltr",
    intl: "zh-CN",
  },
  {
    code: "zh-TW",
    nativeName: "繁體中文",
    englishName: "Chinese (Traditional)",
    dir: "ltr",
    intl: "zh-TW",
  },
];

const BY_CODE = new Map(LOCALES.map((locale) => [locale.code.toLowerCase(), locale]));

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === "string" && LOCALES.some((locale) => locale.code === value);
}

export function getLocale(code: LocaleCode): LocaleDefinition {
  return BY_CODE.get(code.toLowerCase()) ?? BY_CODE.get(FALLBACK_LOCALE)!;
}

/**
 * Rapproche une étiquette de langue du système (« fr-CA », « zh-HK »,
 * « pt-PT »…) de la langue FourTout la plus proche, ou `undefined`.
 *
 * - correspondance exacte d'abord (« pt-BR », « zh-TW ») ;
 * - chinois : l'écriture décide. Hong Kong, Macao, Taïwan et `Hant` vont au
 *   chinois traditionnel ; le reste (Chine, Singapour, `Hans`) au simplifié ;
 * - portugais : FourTout n'a qu'une variante, le portugais du Brésil, qui
 *   reste bien plus lisible pour un lecteur portugais que l'anglais ;
 * - sinon, la langue seule (« de-CH » → « de »).
 */
export function matchLocale(tag: string | undefined | null): LocaleCode | undefined {
  if (!tag) return undefined;
  const normalized = tag.trim().replace(/_/g, "-");
  if (normalized.length === 0) return undefined;
  const exact = BY_CODE.get(normalized.toLowerCase());
  if (exact) return exact.code;

  const parts = normalized.toLowerCase().split("-");
  const language = parts[0];
  const rest = parts.slice(1);

  if (language === "zh") {
    if (rest.includes("hant") || rest.some((part) => ["tw", "hk", "mo"].includes(part))) {
      return "zh-TW";
    }
    return "zh-CN";
  }
  if (language === "pt") return "pt-BR";
  // Ancien code de l'indonésien, encore renvoyé par certains systèmes.
  if (language === "in") return "id";
  const base = BY_CODE.get(language);
  return base?.code;
}

/**
 * Langue du système : la première des langues préférées que FourTout sait
 * afficher. La WebView (WebKitGTK, WebView2) expose celles du système.
 */
export function detectSystemLocale(
  candidates: readonly string[] | undefined = systemLanguages(),
): LocaleCode {
  for (const candidate of candidates ?? []) {
    const match = matchLocale(candidate);
    if (match) return match;
  }
  return FALLBACK_LOCALE;
}

function systemLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return navigator.languages;
  }
  return navigator.language ? [navigator.language] : [];
}

/** Langue effective d'une préférence. */
export function resolveLanguage(
  preference: LanguagePreference,
  candidates?: readonly string[],
): LocaleCode {
  return preference === "system" ? detectSystemLocale(candidates) : preference;
}
