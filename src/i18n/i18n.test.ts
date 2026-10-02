import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error The extraction script is plain ESM and intentionally shared with this test.
import { buildSourceCatalog } from "../../scripts/i18n/source.mjs";
import { ALL_TOOLS } from "@/core/tools/catalog";
import { CATEGORIES } from "@/core/tools/categories";
import { categoryText, toolText } from "@/core/tools/localized";
import { searchTools } from "@/core/tools/search";
import { categoryRoute, toolRoute } from "@/core/tools/types";
import { appStore, STORAGE_KEYS } from "@/core/storage";
import { createSettingsStore, useSettings } from "@/features/settings/store";
import { applyLanguagePreference } from "@/features/settings/language";
import { isWellFormed, messageSignature, parseMessage, type MessagePart } from "./format";
import {
  bundledLocales,
  currentLocale,
  FALLBACK_LOCALE,
  formatNumber,
  LOCALES,
  matchLocale,
  detectSystemLocale,
  registerCatalog,
  setLocale,
  SOURCE_LOCALE,
  t,
  type CatalogTranslation,
  type LocaleCode,
} from "./index";

/**
 * Internationalisation : ce que chaque langue doit tenir, vérifié sur les
 * fichiers réellement embarqués.
 *
 * - toutes les langues se chargent, sans clé inconnue ni message mal formé ;
 * - chacune des seize langues couvre 100 % des messages, sans dépendre du
 *   repli anglais en fonctionnement normal ;
 * - une traduction garde les variables, les balises et les formes plurielles
 *   que sa langue demande ;
 * - les 196 outils et 12 catégories ont leurs textes dans chaque langue, sans
 *   que leurs identifiants ni leurs routes ne bougent ;
 * - repli, persistance, changement instantané et recherche multilingue.
 */

const messageFiles = import.meta.glob<Record<string, string>>("./messages/*.json", {
  eager: true,
  import: "default",
});
const catalogFiles = import.meta.glob<CatalogTranslation>("./catalog/*.json", {
  eager: true,
  import: "default",
});

const codeOf = (path: string) => path.replace(/^.*\//, "").replace(/\.json$/, "") as LocaleCode;
const MESSAGES = new Map(Object.entries(messageFiles).map(([path, data]) => [codeOf(path), data]));
const CATALOGS = new Map(Object.entries(catalogFiles).map(([path, data]) => [codeOf(path), data]));
const SOURCE = MESSAGES.get(SOURCE_LOCALE)!;
const SOURCE_IDS = Object.keys(SOURCE);

const EXPECTED_LOCALES: LocaleCode[] = [
  "en",
  "fr",
  "es",
  "de",
  "it",
  "pt-BR",
  "nl",
  "pl",
  "ru",
  "tr",
  "id",
  "hi",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
];
/** Comptes de référence du produit (voir `core/tools/catalogIntegrity.test.ts`). */
const TOOL_COUNT = 196;
const CATEGORY_COUNT = 12;

const TRANSLATED_LOCALES = EXPECTED_LOCALES.filter((code) => code !== SOURCE_LOCALE);

afterEach(async () => {
  await setLocale(SOURCE_LOCALE);
});

describe("langues disponibles", () => {
  it("déclare exactement les seize langues prévues, avec un sens d'écriture", () => {
    expect(LOCALES.map((locale) => locale.code)).toEqual(EXPECTED_LOCALES);
    for (const locale of LOCALES) {
      expect(locale.nativeName.length).toBeGreaterThan(0);
      expect(["ltr", "rtl"]).toContain(locale.dir);
      expect(() => new Intl.NumberFormat(locale.intl)).not.toThrow();
    }
  });

  it("embarque l'interface et le catalogue de chaque langue", () => {
    expect(bundledLocales()).toEqual([...EXPECTED_LOCALES].sort());
    for (const code of TRANSLATED_LOCALES) {
      expect(MESSAGES.has(code), `messages/${code}.json`).toBe(true);
      expect(CATALOGS.has(code), `catalog/${code}.json`).toBe(true);
    }
    expect(CATALOGS.has(SOURCE_LOCALE)).toBe(false);
  });

  it.each(EXPECTED_LOCALES)("charge %s et l'applique au document", async (code) => {
    await setLocale(code);
    expect(currentLocale()).toBe(code);
    expect(document.documentElement.lang).toBe(LOCALES.find((l) => l.code === code)!.intl);
    expect(document.documentElement.dir).toBe("ltr");
  });
});

describe("catalogue source", () => {
  it("est à jour avec le code (pnpm i18n:extract)", () => {
    const generated = buildSourceCatalog(process.cwd());
    expect(generated.collisions).toEqual([]);
    expect(generated.catalog).toEqual(SOURCE);
  });

  it("ne contient que des messages bien formés", () => {
    const broken = SOURCE_IDS.filter((id) => !isWellFormed(SOURCE[id]));
    expect(broken).toEqual([]);
  });
});

describe("couverture des traductions", () => {
  it.each(EXPECTED_LOCALES)("%s : 100 % des messages, aucune clé inconnue", (code) => {
    const messages = MESSAGES.get(code)!;
    expect(SOURCE_IDS.filter((id) => !(id in messages))).toEqual([]);
    expect(Object.keys(messages).filter((id) => !(id in SOURCE))).toEqual([]);
  });

  it.each(TRANSLATED_LOCALES)("%s : variables, balises et pluriels compatibles", (code) => {
    const messages = MESSAGES.get(code)!;
    const categories = pluralCategories(code);
    const problems: string[] = [];
    for (const [id, text] of Object.entries(messages)) {
      if (!(id in SOURCE)) continue;
      if (text.trim().length === 0) {
        problems.push(`${id}: vide`);
        continue;
      }
      if (!isWellFormed(text)) {
        problems.push(`${id}: mal formé`);
        continue;
      }
      if (signature(text) !== signature(SOURCE[id])) {
        problems.push(`${id}: ${signature(SOURCE[id])} ≠ ${signature(text)}`);
      }
      const gaps = pluralGaps(parseMessage(text), categories);
      if (gaps.length > 0) problems.push(`${id}: pluriel sans ${gaps.join(", ")}`);
    }
    expect(problems).toEqual([]);
  });

  it("n'affiche jamais une clé brute : repli langue → anglais → source", async () => {
    registerCatalog("nl", { [id("Copier")]: "Kopiëren" }, { categories: {}, tools: {} });
    await setLocale("nl");
    expect(t("Copier")).toBe("Kopiëren");
    // Absent en néerlandais : l'anglais prend le relais.
    expect(t("Annuler")).toBe(MESSAGES.get("en")![id("Annuler")]);
    // Inconnu partout : le texte lui-même, jamais son identifiant.
    expect(t("Texte qui n'existe dans aucun catalogue")).toBe("Texte qui n'existe dans aucun catalogue");
    registerCatalog("nl", MESSAGES.get("nl")!, CATALOGS.get("nl"));
  });

  it("interpole et accorde dans la langue affichée", async () => {
    await setLocale("en");
    expect(t("{count} {count, plural, one {résultat} other {résultats}}", { count: 1 })).toBe("1 result");
    expect(t("{count} {count, plural, one {résultat} other {résultats}}", { count: 2 })).toBe("2 results");
    // `#` est formaté selon la langue ; une variable simple reste telle quelle.
    expect(t("{n, plural, one {# page} other {# pages}}", { n: 1200 })).toBe("1,200 pages");
    await setLocale("ru");
    const russian = (count: number) =>
      t("{count} {count, plural, one {résultat} other {résultats}}", { count });
    expect(new Set([russian(1), russian(3), russian(5)]).size).toBe(3);
    expect(formatNumber(1234.5)).toBe(new Intl.NumberFormat("ru").format(1234.5));
  });
});

describe("catalogue des outils", () => {
  it(`compte ${TOOL_COUNT} outils et ${CATEGORY_COUNT} catégories`, () => {
    expect(ALL_TOOLS).toHaveLength(TOOL_COUNT);
    expect(CATEGORIES).toHaveLength(CATEGORY_COUNT);
  });

  it.each(TRANSLATED_LOCALES)("%s : chaque outil et chaque catégorie est traduit", (code) => {
    const catalog = CATALOGS.get(code)!;
    const toolIds = ALL_TOOLS.map((tool) => tool.id).sort();
    expect(Object.keys(catalog.tools).sort()).toEqual(toolIds);
    expect(Object.keys(catalog.categories).sort()).toEqual(CATEGORIES.map((category) => category.id).sort());
    for (const tool of ALL_TOOLS) {
      const entry = catalog.tools[tool.id];
      expect(entry.name?.trim(), `${code}/${tool.id}`).toBeTruthy();
      expect(entry.description?.trim(), `${code}/${tool.id}`).toBeTruthy();
      expect(entry.keywords?.length, `${code}/${tool.id}`).toBeGreaterThan(0);
      expect(Boolean(entry.note), `${code}/${tool.id} note`).toBe(Boolean(tool.note));
    }
    for (const [categoryId, entry] of Object.entries(catalog.categories)) {
      expect(entry.name?.trim(), `${code}/${categoryId}`).toBeTruthy();
      expect(entry.description?.trim(), `${code}/${categoryId}`).toBeTruthy();
    }
  });

  it("garde les identifiants et les routes, quelle que soit la langue", async () => {
    const snapshot = () => ({
      tools: ALL_TOOLS.map((tool) => [tool.id, toolRoute(tool.id)]),
      categories: CATEGORIES.map((category) => [category.id, categoryRoute(category.id)]),
    });
    const before = snapshot();
    for (const code of EXPECTED_LOCALES) {
      await setLocale(code);
      expect(snapshot()).toEqual(before);
    }
  });

  it("affiche le nom traduit sans toucher à la définition", async () => {
    const tool = ALL_TOOLS.find((entry) => entry.id === "pdf-compress")!;
    await setLocale("de");
    expect(toolText(tool).name).toBe(CATALOGS.get("de")!.tools["pdf-compress"].name);
    expect(categoryText(CATEGORIES.find((category) => category.id === "pdf")!).name).toBe(CATALOGS.get("de")!.categories.pdf.name);
    expect(tool.name).toBe("Compresser un PDF");
  });
});

describe("préférence de langue", () => {
  it("rapproche les langues du système de la plus proche", () => {
    expect(matchLocale("fr-CA")).toBe("fr");
    expect(matchLocale("de-CH")).toBe("de");
    expect(matchLocale("zh-SG")).toBe("zh-CN");
    expect(matchLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(matchLocale("zh-HK")).toBe("zh-TW");
    expect(matchLocale("zh-Hant")).toBe("zh-TW");
    expect(matchLocale("pt-PT")).toBe("pt-BR");
    expect(matchLocale("en_GB")).toBe("en");
    expect(matchLocale("sv-SE")).toBeUndefined();
    expect(detectSystemLocale(["sv-SE", "nb"])).toBe(FALLBACK_LOCALE);
    expect(detectSystemLocale(["sv-SE", "ja-JP"])).toBe("ja");
    expect(detectSystemLocale([])).toBe(FALLBACK_LOCALE);
  });

  it("persiste le choix et l'applique immédiatement", async () => {
    useSettings.getState().set("language", "ja");
    await applyLanguagePreference("ja");
    expect(currentLocale()).toBe("ja");
    expect(appStore.get<{ language?: string }>(STORAGE_KEYS.settings, {}).language).toBe("ja");
    expect(t("Paramètres")).toBe(MESSAGES.get("ja")![id("Paramètres")]);
    // Au redémarrage, le choix est relu depuis le stockage local.
    expect(createSettingsStore(appStore).getState().language).toBe("ja");

    useSettings.getState().set("language", "system");
    await applyLanguagePreference("system");
    // Le système de test est francophone (voir src/test/setup.ts).
    expect(currentLocale()).toBe("fr");
    expect(appStore.get<{ language?: string }>(STORAGE_KEYS.settings, {}).language).toBe("system");
  });
});

describe("recherche multilingue", () => {
  const top = (query: string, locale: LocaleCode, n = 3) =>
    searchTools(query, { locale }).slice(0, n).map((result) => result.tool.id);

  it.each<[LocaleCode, string]>([
    ["en", "compress a pdf"],
    ["fr", "compresser un pdf"],
    ["es", "comprimir un pdf"],
    ["de", "pdf komprimieren"],
    ["pt-BR", "comprimir pdf"],
    ["it", "comprimere pdf"],
    ["nl", "pdf comprimeren"],
    ["pl", "kompresuj pdf"],
    ["ru", "сжать pdf"],
    ["tr", "pdf sıkıştır"],
    ["id", "kompres pdf"],
    ["hi", "pdf संपीड़ित"],
    ["ja", "pdf を圧縮"],
    ["ko", "pdf 압축"],
    ["zh-CN", "压缩 pdf"],
    ["zh-TW", "壓縮 pdf"],
  ])("%s : « %s » trouve Compresser un PDF", async (locale, query) => {
    await setLocale(locale);
    expect(top(query, locale)).toContain("pdf-compress");
  });

  it.each(EXPECTED_LOCALES)("%s : les noms de formats marchent partout", async (locale) => {
    await setLocale(locale);
    const pdfResults = searchTools("pdf", { locale }).slice(0, 10);
    expect(pdfResults).toHaveLength(10);
    for (const { tool } of pdfResults) {
      expect(tool.id.includes("pdf") || tool.category === "pdf", tool.id).toBe(true);
    }
    expect(top("sha-256", locale, 5)).toContain("file-hash");
    expect(top("json", locale)).toContain("json-tools");
    expect(top("mp4", locale, 10).some((toolId) => toolId.startsWith("video"))).toBe(true);
    expect(top("zip", locale, 5)).toContain("archive-create");
    expect(top("png", locale, 10).length).toBeGreaterThan(0);
  });

  it.each<[LocaleCode, string, string]>([
    ["ja", "merge pdf", "pdf-merge"],
    ["de", "extract audio", "video-extract-audio"],
    ["zh-CN", "qr code", "qr-generate"],
    ["ru", "remove background", "image-remove-background"],
  ])("%s : une requête anglaise trouve encore %s", async (locale, query, expected) => {
    await setLocale(locale);
    expect(top(query, locale)).toContain(expected);
  });

  it("est déterministe", async () => {
    await setLocale("ko");
    const first = searchTools("이미지", { locale: "ko" }).map((result) => result.tool.id);
    const second = searchTools("이미지", { locale: "ko" }).map((result) => result.tool.id);
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });
});

function id(source: string): string {
  return Object.keys(SOURCE).find((key) => SOURCE[key] === source)!;
}

function signature(message: string): string {
  const { args, tags } = messageSignature(message);
  return JSON.stringify([[...new Set(args)].sort(), [...new Set(tags)].sort()]);
}

function pluralCategories(code: LocaleCode): Set<string> {
  const rules = new Intl.PluralRules(LOCALES.find((locale) => locale.code === code)!.intl);
  return new Set(Array.from({ length: 201 }, (_, n) => rules.select(n)));
}

function pluralGaps(parts: MessagePart[], needed: Set<string>): string[] {
  const gaps: string[] = [];
  for (const part of parts) {
    if (part.kind === "plural") {
      for (const category of needed) if (!(category in part.options)) gaps.push(category);
      for (const option of Object.values(part.options)) gaps.push(...pluralGaps(option, needed));
    } else if (part.kind === "tag" && part.children) {
      gaps.push(...pluralGaps(part.children, needed));
    }
  }
  return gaps;
}
