import { getCategory } from "./categories";
import type { ToolRegistry } from "./registry";
import { toolRegistry } from "./registry";
import { categoryText, toolText } from "./localized";
import { DIRECTION_WORDS, isCompactScript, normalizeText, STOP_WORDS } from "./searchLanguages";
import type { CategoryId, ToolDefinition } from "./types";
import {
  compareText,
  currentLocale,
  FALLBACK_LOCALE,
  SOURCE_LOCALE,
  useI18n,
  type LocaleCode,
} from "@/i18n";

/**
 * Recherche déterministe sur le registre.
 *
 * Elle doit répondre aussi bien à un mot-clé brut (« pdf ») qu'à une phrase en
 * langage courant (« réduire la taille d'un pdf », « compress a pdf »,
 * « pdf を圧縮 »). C'est aujourd'hui le moteur de l'accueil, et ce sera demain le
 * repli du résolveur d'intention basé LLM : il ne doit donc jamais inventer de
 * résultat, quitte à ne rien renvoyer.
 *
 * Multilingue : l'index d'une langue réunit les textes traduits de cette
 * langue (poids pleins) et, à poids réduit, ceux de l'anglais et du français
 * source. Une requête anglaise trouve donc encore son outil dans une
 * interface en japonais, sans jamais passer devant une correspondance dans la
 * langue affichée. Les formats (PDF, PNG, MP4, JSON, SHA-256…) sont des mots
 * comme les autres : ils sont dans les mots-clés de toutes les langues.
 */

export interface SearchResult {
  tool: ToolDefinition;
  score: number;
  /** Part des mots de la requête effectivement retrouvés (0 → 1). */
  coverage: number;
  /** Champs ayant contribué au score, utile pour déboguer le classement. */
  matchedOn: string[];
}

export interface SearchOptions {
  limit?: number;
  category?: CategoryId;
  /** Score minimal pour être retenu. */
  minScore?: number;
  /** Part minimale des mots de la requête devant être retrouvés. */
  minCoverage?: number;
  /** Langue de l'index ; par défaut, la langue affichée. */
  locale?: LocaleCode;
}

export function normalize(input: string): string {
  return normalizeText(input);
}

function isMeaningful(token: string): boolean {
  if (token.length === 0 || STOP_WORDS.has(token)) return false;
  // Un mot d'un caractère n'a de sens qu'en chiffre — ou en chinois, en
  // japonais et en coréen, où un seul caractère peut être un mot.
  return token.length >= 2 || /^\d$/.test(token) || isCompactScript(token);
}

export function tokenize(input: string): string[] {
  return normalize(input).split(" ").filter(isMeaningful);
}

interface FieldWeight {
  field: string;
  weight: number;
  values: string[];
}

interface IndexedTool {
  tool: ToolDefinition;
  /** Nom affiché, pour départager les égalités dans l'ordre de la langue. */
  name: string;
  fields: FieldWeight[];
  /** Toutes les valeurs normalisées, pour les recherches de motifs. */
  haystack: string[];
}

/**
 * Poids des champs. Les textes des autres langues (anglais, français source)
 * comptent moins que ceux de la langue affichée, mais assez pour franchir le
 * seuil à eux seuls.
 */
const SECONDARY_WEIGHT = { name: 6, alias: 6, keyword: 5, category: 3 } as const;

function buildIndex(tools: ToolDefinition[], locale: LocaleCode): IndexedTool[] {
  const secondary = [FALLBACK_LOCALE, SOURCE_LOCALE].filter((code) => code !== locale);
  return tools.map((tool) => {
    const text = toolText(tool, locale);
    const category = getCategory(tool.category);
    const categoryWords = category
      ? (() => {
          const own = categoryText(category, locale);
          return [normalize(own.name), ...own.keywords.map(normalize)];
        })()
      : [];
    const fields: FieldWeight[] = [
      { field: "name", weight: 10, values: [normalize(text.name)] },
      { field: "alias", weight: 8, values: text.aliases.map(normalize) },
      { field: "keyword", weight: 7, values: text.keywords.map(normalize) },
      { field: "id", weight: 6, values: [normalize(tool.id)] },
      // Assez pour qu'un nom de catégorie tapé seul franchisse le seuil
      // (5 × 1 > 4,5) : « Développeur », « Réseau » ou « Sécurité » doivent
      // remonter leurs outils, et pas un écran vide. Le poids reste sous
      // celui des mots-clés propres à l'outil, qui doivent continuer de
      // l'emporter sur son voisinage.
      { field: "category", weight: 5, values: categoryWords },
      { field: "description", weight: 2, values: [normalize(text.description)] },
    ];
    for (const code of secondary) {
      const other = toolText(tool, code);
      fields.push(
        { field: "name", weight: SECONDARY_WEIGHT.name, values: [normalize(other.name)] },
        { field: "alias", weight: SECONDARY_WEIGHT.alias, values: other.aliases.map(normalize) },
        {
          field: "keyword",
          weight: SECONDARY_WEIGHT.keyword,
          values: other.keywords.map(normalize),
        },
      );
      if (category) {
        const otherCategory = categoryText(category, code);
        fields.push({
          field: "category",
          weight: SECONDARY_WEIGHT.category,
          values: [normalize(otherCategory.name), ...otherCategory.keywords.map(normalize)],
        });
      }
    }
    const haystack = fields
      .filter((f) => f.field !== "description" && f.field !== "category")
      .flatMap((f) => f.values);
    return { tool, name: text.name, fields, haystack };
  });
}

/** Score du meilleur appariement entre un mot et une valeur de champ. */
function tokenScore(token: string, value: string): number {
  if (value.length === 0) return 0;
  const words = value.split(" ");
  const compact = isCompactScript(token);
  let best = 0;
  for (const word of words) {
    if (word === token) return 1;
    if (compact || isCompactScript(word)) {
      // Pas d'espaces entre les mots : « 圧縮する » contient « 圧縮 ».
      if (word.length >= 2 && token.includes(word)) best = Math.max(best, 0.8);
      else if (token.length >= 2 && word.startsWith(token)) best = Math.max(best, 0.7);
      else if (token.length >= 2 && word.includes(token)) best = Math.max(best, 0.5);
      continue;
    }
    if (token.length >= 3 && word.startsWith(token)) best = Math.max(best, 0.7);
    else if (word.length >= 3 && token.startsWith(word)) best = Math.max(best, 0.6);
  }
  if (best === 0 && token.length >= 4 && value.includes(token)) best = 0.4;
  return best;
}

/**
 * Détecte les conversions dirigées (« gif en vidéo », « gif to video ») pour
 * départager un outil et son symétrique. Utilise la requête brute, connecteurs
 * compris.
 */
function directionPair(rawQuery: string): [string, string] | null {
  const words = normalize(rawQuery).split(" ").filter(Boolean);
  for (let i = 1; i < words.length - 1; i += 1) {
    if (!DIRECTION_WORDS.has(words[i])) continue;
    const before = words.slice(0, i).filter((w) => !STOP_WORDS.has(w)).at(-1);
    const after = words.slice(i + 1).find((w) => !STOP_WORDS.has(w));
    if (before && after && before !== after) return [before, after];
  }
  return null;
}

/** Vrai si une valeur contient un mot commençant par `a`, puis un mot commençant par `b`. */
function hasOrderedPair(haystack: string[], a: string, b: string): boolean {
  return haystack.some((value) => {
    const words = value.split(" ");
    const first = words.findIndex((word) => word.startsWith(a));
    return first >= 0 && words.slice(first + 1).some((word) => word.startsWith(b));
  });
}

export class ToolSearchEngine {
  private readonly indexes = new Map<string, IndexedTool[]>();

  constructor(private readonly registry: ToolRegistry) {}

  /** Index d'une langue, construit au premier besoin. */
  private indexFor(locale: LocaleCode): IndexedTool[] {
    const key = `${locale}:${useI18n.getState().revision}`;
    let index = this.indexes.get(key);
    if (!index) {
      index = buildIndex(this.registry.all(), locale);
      this.indexes.set(key, index);
    }
    return index;
  }

  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const {
      limit = 20,
      category,
      /**
       * Le seuil absorbe la prime d'un et demi qui allait autrefois à tout
       * outil livré : elle s'appliquait à tous, elle ne départageait plus rien
       * depuis que le catalogue est entièrement livré.
       */
      minScore = 4.5,
      minCoverage = 0.5,
      locale = currentLocale(),
    } = options;

    const index = this.indexFor(locale);
    const tokens = tokenize(query);
    const normalizedQuery = normalize(query);

    // Requête vide : on renvoie le catalogue filtré plutôt que rien, ce qui
    // permet à la page Outils d'utiliser le même chemin de code.
    if (tokens.length === 0) {
      return index
        .filter(({ tool }) => matchesFilters(tool, category))
        .slice(0, limit)
        .map(({ tool }) => ({ tool, score: 0, coverage: 0, matchedOn: [] }));
    }

    const pair = directionPair(query);
    const results: (SearchResult & { name: string })[] = [];

    for (const entry of index) {
      if (!matchesFilters(entry.tool, category)) continue;

      let score = 0;
      let matchedTokens = 0;
      const matchedOn = new Set<string>();

      for (const token of tokens) {
        let bestForToken = 0;
        let bestField = "";
        for (const field of entry.fields) {
          for (const value of field.values) {
            const ratio = tokenScore(token, value);
            if (ratio === 0) continue;
            const weighted = ratio * field.weight;
            if (weighted > bestForToken) {
              bestForToken = weighted;
              bestField = field.field;
            }
          }
        }
        if (bestForToken > 0) {
          score += bestForToken;
          matchedTokens += 1;
          matchedOn.add(bestField);
        }
      }

      if (matchedTokens === 0) continue;

      // Bonus de phrase : la requête complète apparaît telle quelle.
      const phraseLength = isCompactScript(normalizedQuery) ? 2 : 4;
      if (
        normalizedQuery.length >= phraseLength &&
        entry.haystack.some((v) => v.includes(normalizedQuery))
      ) {
        score += 25;
        matchedOn.add("phrase");
      }

      // Bonus/malus directionnel : « gif en vidéo » ≠ « vidéo en gif ».
      if (pair) {
        const [from, to] = pair;
        if (hasOrderedPair(entry.haystack, from, to)) {
          score += 18;
          matchedOn.add("direction");
        } else if (hasOrderedPair(entry.haystack, to, from)) {
          score -= 8;
        }
      }

      const coverage = matchedTokens / tokens.length;
      if (coverage < minCoverage || score < minScore) continue;

      results.push({
        tool: entry.tool,
        name: entry.name,
        score,
        coverage,
        matchedOn: [...matchedOn],
      });
    }

    return results
      .sort((a, b) => b.score - a.score || compareText(a.name, b.name))
      .slice(0, limit)
      .map(({ tool, score, coverage, matchedOn }) => ({ tool, score, coverage, matchedOn }));
  }
}

function matchesFilters(tool: ToolDefinition, category?: CategoryId): boolean {
  if (category && tool.category !== category && !tool.alsoIn?.includes(category)) return false;
  return true;
}

/** Moteur par défaut, adossé au registre par défaut. */
export const toolSearch = new ToolSearchEngine(toolRegistry);

export function searchTools(query: string, options?: SearchOptions): SearchResult[] {
  return toolSearch.search(query, options);
}
