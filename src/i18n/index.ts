/**
 * Internationalisation de FourTout : point d'entrée unique.
 *
 * - `t("Texte source", { valeur })` traduit un message ;
 * - `msg("Texte source")` le marque pour une traduction au rendu ;
 * - `<Trans source="… <0>…</0> …" components={[<strong />]} />` traduit un
 *   message balisé ;
 * - `formatNumber`, `formatDate`… mettent en forme selon la langue.
 *
 * Voir `docs/technical/I18N.md`.
 */
export {
  t,
  tx,
  msg,
  localized,
  lookup,
  translateRaw,
  currentLocale,
  currentIntlLocale,
  loadLocale,
  setLocale,
  applyLocale,
  registerCatalog,
  isLocaleLoaded,
  bundledLocales,
  catalogTranslation,
  useI18n,
  type MessageCatalog,
  type CatalogTranslation,
  type ToolTranslation,
  type CategoryTranslation,
} from "./runtime";
export { Trans } from "./Trans";
export {
  LOCALES,
  FALLBACK_LOCALE,
  SOURCE_LOCALE,
  getLocale,
  isLocaleCode,
  matchLocale,
  detectSystemLocale,
  resolveLanguage,
  type LocaleCode,
  type LanguagePreference,
  type LocaleDefinition,
  type TextDirection,
} from "./locales";
export {
  formatNumber,
  formatDecimal,
  formatPercent,
  formatDate,
  formatDateTime,
  formatRelativeTime,
  compareText,
  numberSeparators,
  localizeNumberString,
  byteSymbols,
  formatBinarySize,
  formatDecimalSize,
} from "./intl";
export { messageId, type MessageValues } from "./format";
