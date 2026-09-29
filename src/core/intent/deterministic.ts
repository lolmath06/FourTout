import type { ToolRegistry } from "../tools/registry";
import { toolRegistry } from "../tools/registry";
import type { ToolSearchEngine } from "../tools/search";
import { toolSearch } from "../tools/search";
import type { IntentCandidate, IntentResolver, IntentResult } from "./types";

/**
 * Résolveur par défaut : 100 % déterministe, hors ligne, instantané.
 *
 * Il sert aujourd'hui l'accueil et restera le repli lorsque l'assistant local
 * sera branché (LLM indisponible, modèle non téléchargé, réponse invalide).
 */
export class DeterministicIntentResolver implements IntentResolver {
  readonly id = "deterministic";

  constructor(
    private readonly search: ToolSearchEngine = toolSearch,
    private readonly registry: ToolRegistry = toolRegistry,
  ) {}

  isAvailable(): boolean {
    return true;
  }

  async resolve(query: string): Promise<IntentResult> {
    return this.resolveSync(query);
  }

  /** Variante synchrone : pratique pour l'interface et les tests. */
  resolveSync(query: string): IntentResult {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return {
        query,
        outcome: "no-match",
        candidates: [],
        resolver: this.id,
        message: "Décrivez ce que vous voulez faire.",
      };
    }

    const results = this.search.search(trimmed, { limit: 6 });
    if (results.length === 0) {
      return {
        query,
        outcome: "no-match",
        candidates: [],
        resolver: this.id,
        message: `Aucun outil de FourTout ne correspond à « ${trimmed} ».`,
      };
    }

    const top = results[0].score;
    const candidates: IntentCandidate[] = results.map((result) => ({
      // Le registre reste l'autorité : on ne renvoie que des outils qu'il connaît.
      tool: this.registry.get(result.tool.id) ?? result.tool,
      confidence: Math.min(1, result.score / Math.max(top, 1)) * result.coverage,
      reason: describeMatch(result.matchedOn),
    }));

    // « Nettement au-dessus » : au moins 40 % de mieux que le suivant, ou seul.
    const decisive =
      results.length === 1 || top >= results[1].score * 1.4;

    return {
      query,
      outcome: decisive ? "match" : "ambiguous",
      candidates,
      resolver: this.id,
    };
  }
}

function describeMatch(matchedOn: string[]): string {
  if (matchedOn.includes("phrase")) return "Correspondance exacte";
  if (matchedOn.includes("direction")) return "Conversion correspondante";
  if (matchedOn.includes("name")) return "Nom de l'outil";
  if (matchedOn.includes("alias")) return "Autre nom de l'outil";
  if (matchedOn.includes("keyword")) return "Mot-clé associé";
  if (matchedOn.includes("category")) return "Catégorie correspondante";
  return "Description";
}
