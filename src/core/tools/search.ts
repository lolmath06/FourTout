import { getCategory } from "./categories";
import type { ToolRegistry } from "./registry";
import { toolRegistry } from "./registry";
import type { CategoryId, ToolDefinition } from "./types";

/**
 * Recherche déterministe sur le registre.
 *
 * Elle doit répondre aussi bien à un mot-clé brut (« pdf ») qu'à une phrase en
 * langage courant (« réduire la taille d'un pdf »). C'est aujourd'hui le moteur
 * de l'accueil, et ce sera demain le repli du résolveur d'intention basé LLM :
 * il ne doit donc jamais inventer de résultat, quitte à ne rien renvoyer.
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
}

/** Mots vides : ils ne portent pas d'information de recherche. */
const STOP_WORDS = new Set([
  "je", "j", "tu", "il", "elle", "on", "nous", "vous", "ils", "veux", "voudrais",
  "aimerais", "souhaite", "besoin", "comment", "faire", "fait", "pour", "avec",
  "sur", "dans", "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses",
  "le", "la", "les", "un", "une", "des", "du", "de", "d", "l", "et", "ou", "au",
  "aux", "ce", "cet", "cette", "ces", "qui", "que", "quoi", "est", "sont", "se",
  "ne", "pas", "y", "en", "vers", "a", "the", "my", "i", "want", "to", "into",
  "from", "of", "please", "s", "il", "y",
]);

/** Connecteurs marquant une conversion « X vers Y ». */
const DIRECTION_WORDS = ["en", "vers", "to", "into", "->", "→"];

export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokenize(input: string): string[] {
  return normalize(input)
    .split(" ")
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token))
    .filter((token) => token.length >= 2 || /^\d$/.test(token));
}

interface FieldWeight {
  field: string;
  weight: number;
  values: string[];
}

interface IndexedTool {
  tool: ToolDefinition;
  fields: FieldWeight[];
  /** Toutes les valeurs normalisées, pour les recherches de motifs. */
  haystack: string[];
}

function buildIndex(tools: ToolDefinition[]): IndexedTool[] {
  return tools.map((tool) => {
    const category = getCategory(tool.category);
    const fields: FieldWeight[] = [
      { field: "name", weight: 10, values: [normalize(tool.name)] },
      { field: "alias", weight: 8, values: (tool.aliases ?? []).map(normalize) },
      { field: "keyword", weight: 7, values: (tool.keywords ?? []).map(normalize) },
      { field: "id", weight: 6, values: [normalize(tool.id)] },
      {
        field: "category",
        weight: 3,
        values: category
          ? [normalize(category.name), ...(category.keywords ?? []).map(normalize)]
          : [],
      },
      { field: "description", weight: 2, values: [normalize(tool.description)] },
    ];
    const haystack = fields
      .filter((f) => f.field !== "description" && f.field !== "category")
      .flatMap((f) => f.values);
    return { tool, fields, haystack };
  });
}

/** Score du meilleur appariement entre un mot et une valeur de champ. */
function tokenScore(token: string, value: string): number {
  if (value.length === 0) return 0;
  const words = value.split(" ");
  let best = 0;
  for (const word of words) {
    if (word === token) return 1;
    if (token.length >= 3 && word.startsWith(token)) best = Math.max(best, 0.7);
    else if (word.length >= 3 && token.startsWith(word)) best = Math.max(best, 0.6);
  }
  if (best === 0 && token.length >= 4 && value.includes(token)) best = 0.4;
  return best;
}

/**
 * Détecte les conversions dirigées (« gif en vidéo ») pour départager un outil
 * et son symétrique. Utilise la requête brute, connecteurs compris.
 */
function directionPair(rawQuery: string): [string, string] | null {
  const words = normalize(rawQuery).split(" ").filter(Boolean);
  for (let i = 1; i < words.length - 1; i += 1) {
    if (!DIRECTION_WORDS.includes(words[i])) continue;
    const before = words.slice(0, i).filter((w) => !STOP_WORDS.has(w)).at(-1);
    const after = words.slice(i + 1).find((w) => !STOP_WORDS.has(w));
    if (before && after && before !== after) return [before, after];
  }
  return null;
}

function hasOrderedPair(haystack: string[], a: string, b: string): boolean {
  const pattern = new RegExp(`\\b${a}\\w*\\b.*\\b${b}\\w*\\b`);
  return haystack.some((value) => pattern.test(value));
}

export class ToolSearchEngine {
  private readonly index: IndexedTool[];

  constructor(registry: ToolRegistry) {
    this.index = buildIndex(registry.all());
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
    } = options;

    const tokens = tokenize(query);
    const normalizedQuery = normalize(query);

    // Requête vide : on renvoie le catalogue filtré plutôt que rien, ce qui
    // permet à la page Outils d'utiliser le même chemin de code.
    if (tokens.length === 0) {
      return this.index
        .filter(({ tool }) => matchesFilters(tool, category))
        .slice(0, limit)
        .map(({ tool }) => ({ tool, score: 0, coverage: 0, matchedOn: [] }));
    }

    const pair = directionPair(query);
    const results: SearchResult[] = [];

    for (const entry of this.index) {
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
      if (normalizedQuery.length >= 4 && entry.haystack.some((v) => v.includes(normalizedQuery))) {
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

      results.push({ tool: entry.tool, score, coverage, matchedOn: [...matchedOn] });
    }

    return results
      .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name, "fr"))
      .slice(0, limit);
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
