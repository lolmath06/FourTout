import { create } from "zustand";
import {
  FALLBACK_LOCALE,
  getLocale,
  SOURCE_LOCALE,
  type LocaleCode,
} from "./locales";
import { formatMessageToString, messageId, type MessageValues } from "./format";
import { matchNativeMessage } from "./native";
import english from "./messages/en.json";
import englishCatalog from "./catalog/en.json";

/**
 * État de la langue et traduction des messages.
 *
 * Un message est identifié par son **texte source** (français), écrit tel quel
 * dans le code : `t("Fichier illisible.")`. Les fichiers de traduction le
 * retrouvent par son empreinte (`messageId`). Ordre de recherche :
 *
 *   langue active → anglais → texte source.
 *
 * Le texte source étant toujours disponible, une clé brute n'apparaît jamais.
 *
 * `t()` est une fonction ordinaire, utilisable hors de React (messages
 * d'erreur, résumés calculés). Les composants sont rendus à nouveau quand la
 * langue change : l'application est remontée sous une clé de langue (voir
 * `App.tsx`).
 */

export type MessageCatalog = Record<string, string>;

/** Textes traduits d'un outil : chaque champ est facultatif, le repli est par champ. */
export interface ToolTranslation {
  name?: string;
  description?: string;
  keywords?: string[];
  aliases?: string[];
  note?: string;
}

export interface CategoryTranslation {
  name?: string;
  description?: string;
  keywords?: string[];
}

/**
 * Traduction du catalogue, par identifiant. Les données structurelles des
 * outils (catégorie, entrées, sorties, capacités…) n'y figurent pas : elles
 * restent uniques, dans `core/tools/catalog/`.
 */
export interface CatalogTranslation {
  categories: Record<string, CategoryTranslation>;
  tools: Record<string, ToolTranslation>;
}

/** Catalogues chargés, par langue. Le français est la source : pas de fichier. */
const catalogs = new Map<LocaleCode, MessageCatalog>([["en", english as MessageCatalog]]);

/**
 * Toutes les traductions sont embarquées dans l'application ; seule leur
 * analyse est différée, pour ne pas charger dix-sept langues au démarrage.
 */
const loaders = import.meta.glob<{ default: MessageCatalog }>("./messages/*.json");
const catalogLoaders = import.meta.glob<{ default: CatalogTranslation }>("./catalog/*.json");

const toolCatalogs = new Map<LocaleCode, CatalogTranslation>([
  ["en", englishCatalog as CatalogTranslation],
]);

interface I18nState {
  locale: LocaleCode;
  /** Incrémenté à chaque catalogue chargé : force un rendu des abonnés. */
  revision: number;
}

export const useI18n = create<I18nState>(() => ({ locale: SOURCE_LOCALE, revision: 0 }));

let activeLocale: LocaleCode = SOURCE_LOCALE;
let activeIntl = getLocale(SOURCE_LOCALE).intl;

/** Langue actuellement affichée. */
export function currentLocale(): LocaleCode {
  return activeLocale;
}

/** Étiquette BCP 47 de la langue affichée, pour `Intl`. */
export function currentIntlLocale(): string {
  return activeIntl;
}

export function isLocaleLoaded(code: LocaleCode): boolean {
  return code === SOURCE_LOCALE || (catalogs.has(code) && toolCatalogs.has(code));
}

/** Charge (une fois) les traductions d'une langue : interface et catalogue. */
export async function loadLocale(code: LocaleCode): Promise<void> {
  if (isLocaleLoaded(code)) return;
  const [messages, catalog] = await Promise.all([
    loaders[`./messages/${code}.json`]?.(),
    catalogLoaders[`./catalog/${code}.json`]?.(),
  ]);
  if (messages) catalogs.set(code, messages.default);
  if (catalog) toolCatalogs.set(code, catalog.default);
}

/** Langues dont les traductions sont embarquées (en plus du français source). */
export function bundledLocales(): LocaleCode[] {
  return Object.keys(loaders)
    .map((path) => path.replace("./messages/", "").replace(".json", "") as LocaleCode)
    .sort();
}

/** Traduction du catalogue d'une langue chargée, ou `undefined`. */
export function catalogTranslation(code: LocaleCode): CatalogTranslation | undefined {
  return toolCatalogs.get(code);
}

/** Installe des traductions directement (tests, outillage). */
export function registerCatalog(
  code: LocaleCode,
  messages: MessageCatalog,
  catalog?: CatalogTranslation,
): void {
  catalogs.set(code, messages);
  if (catalog) toolCatalogs.set(code, catalog);
  useI18n.setState((state) => ({ revision: state.revision + 1 }));
}

/**
 * Change la langue affichée. Synchrone si le catalogue est déjà chargé ; la
 * langue n'est appliquée qu'une fois ses traductions disponibles.
 */
export async function setLocale(code: LocaleCode): Promise<void> {
  await loadLocale(code);
  applyLocale(code);
}

/** Applique une langue déjà chargée. */
export function applyLocale(code: LocaleCode): void {
  const definition = getLocale(code);
  activeLocale = definition.code;
  activeIntl = definition.intl;
  if (typeof document !== "undefined") {
    document.documentElement.lang = definition.intl;
    document.documentElement.dir = definition.dir;
  }
  useI18n.setState({ locale: definition.code });
}

const idCache = new Map<string, string>();

function idOf(source: string): string {
  let id = idCache.get(source);
  if (id === undefined) {
    id = messageId(source);
    idCache.set(source, id);
  }
  return id;
}

/** Traduction brute (sans interpolation) d'un texte source dans une langue. */
export function lookup(source: string, locale: LocaleCode = activeLocale): string | undefined {
  if (locale === SOURCE_LOCALE) return source;
  return catalogs.get(locale)?.[idOf(source)];
}

/** Message traduit, sans interpolation : utile au rendu riche (`<Trans>`). */
export function translateRaw(source: string): string {
  if (activeLocale === SOURCE_LOCALE) return source;
  const id = idOf(source);
  return (
    catalogs.get(activeLocale)?.[id] ??
    (activeLocale === FALLBACK_LOCALE ? undefined : catalogs.get(FALLBACK_LOCALE)?.[id]) ??
    source
  );
}

/**
 * Traduit un message.
 *
 * Appliquée à une chaîne qui n'est pas un message connu (une donnée de
 * l'utilisateur, un nom de fichier), elle la rend telle quelle : c'est ce qui
 * permet aux composants partagés de traduire leurs libellés sans savoir d'où
 * ils viennent.
 */
export function t(source: string, values?: MessageValues): string {
  if (typeof source !== "string") return source;
  return formatMessageToString(translateRaw(source), values, activeIntl);
}

/**
 * Traduit une valeur quelconque si c'est un texte, et la rend telle quelle
 * sinon (`undefined`, élément React, nombre). C'est la forme des composants
 * partagés : un libellé peut venir d'une constante, d'une traduction déjà
 * faite ou d'une donnée — seul un message connu change.
 */
export function tx<T>(value: T): T {
  return (typeof value === "string" ? translateText(value) : value) as T;
}

/**
 * Texte quelconque : message connu, message du socle natif reconnu par son
 * gabarit (« Création impossible : {e} »), ou texte rendu tel quel.
 */
function translateText(text: string, depth = 0): string {
  const direct = translateRaw(text);
  if (direct !== text || activeLocale === SOURCE_LOCALE) {
    return formatMessageToString(direct, undefined, activeIntl);
  }
  const native = matchNativeMessage(text);
  if (!native) return text;
  // Les valeurs peuvent être elles-mêmes des messages natifs
  // (« Opération interrompue : Lecture impossible : … »).
  const values: MessageValues = {};
  for (const [name, value] of Object.entries(native.values)) {
    values[name] = depth < 2 ? translateText(value, depth + 1) : value;
  }
  return t(native.template, values);
}

/**
 * Constante de module dans la langue affichée.
 *
 * Un tableau ou un objet de libellés (`STATUS_LABELS`, une liste d'options…)
 * est évalué au chargement du module, une seule fois. Déclaré avec
 * `localized(() => …)`, il est réévalué pour chaque langue — puis gardé tant
 * qu'elle ne change pas — et tous ses usages (`LABELS[clé]`, `.map`, `.find`,
 * `Object.entries`) lisent la version de la langue affichée, sans rien changer
 * à leur code.
 *
 * Réservé aux tableaux et aux objets simples : un `Map`, un `Set` ou une chaîne
 * ne peuvent pas être servis ainsi.
 */
export function localized<T extends object>(factory: () => T): T {
  const initial = factory();
  if (!isPlainContainer(initial)) {
    throw new TypeError("localized() n'accepte que des tableaux et des objets simples");
  }
  let key = `${activeLocale}:${useI18n.getState().revision}`;
  let value = initial;
  const current = (): T => {
    const now = `${activeLocale}:${useI18n.getState().revision}`;
    if (now !== key) {
      value = factory();
      key = now;
    }
    return value;
  };
  const target = (Array.isArray(initial) ? [] : {}) as T;
  return new Proxy(target, {
    get: (_, property) => Reflect.get(current(), property),
    set: (_, property, next) => Reflect.set(current(), property, next),
    has: (_, property) => Reflect.has(current(), property),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_, property) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(current(), property);
      if (!descriptor) return undefined;
      // `length` d'un tableau reste non configurable, comme celui de la cible.
      if (Array.isArray(target) && property === "length") {
        return { ...descriptor, configurable: false, writable: true };
      }
      return { ...descriptor, configurable: true };
    },
    getPrototypeOf: () => Reflect.getPrototypeOf(current()),
  });
}

function isPlainContainer(value: unknown): value is object {
  if (Array.isArray(value)) return true;
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Marque un texte source à traduire **plus tard**, au rendu.
 *
 * Pour les constantes de module, évaluées une seule fois : elles gardent leur
 * texte source, et c'est le composant qui les affiche qui appelle `t()`.
 */
export function msg<T extends string>(source: T): T {
  return source;
}
