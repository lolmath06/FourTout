import { DeterministicIntentResolver } from "./deterministic";
import type { IntentResolver, IntentResult } from "./types";

export type { IntentCandidate, IntentOutcome, IntentResolver, IntentResult } from "./types";
export { DeterministicIntentResolver } from "./deterministic";

const deterministicResolver = new DeterministicIntentResolver();

/**
 * Résolveurs enregistrés, du plus « intelligent » au plus sûr.
 * Le déterministe est toujours en dernier : c'est le filet de sécurité.
 */
let resolvers: IntentResolver[] = [deterministicResolver];

/**
 * Point d'extension pour la phase « assistant local » : il suffira d'appeler
 * `registerIntentResolver(new LocalLLMIntentResolver(...))` au démarrage.
 * Aucune page n'a à changer.
 */
export function registerIntentResolver(resolver: IntentResolver): void {
  resolvers = [resolver, ...resolvers.filter((r) => r.id !== resolver.id)];
}

export function listIntentResolvers(): IntentResolver[] {
  return resolvers;
}

/** Réinitialise la chaîne de résolveurs (utilisé par les tests). */
export function resetIntentResolvers(): void {
  resolvers = [deterministicResolver];
}

/**
 * Point d'entrée unique de l'application pour transformer une demande en
 * langage naturel en outils du registre.
 */
export async function resolveToolIntent(query: string): Promise<IntentResult> {
  for (const resolver of resolvers) {
    if (!resolver.isAvailable()) continue;
    const result = await resolver.resolve(query);
    if (result.outcome !== "no-match") return result;
    // Un résolveur qui ne trouve rien laisse sa chance au suivant ; le
    // déterministe étant dernier, son « aucun résultat » fait foi.
    if (resolver === resolvers[resolvers.length - 1]) return result;
  }
  return deterministicResolver.resolveSync(query);
}

/** Version synchrone garantie sans LLM, pour les rendus immédiats. */
export function resolveToolIntentSync(query: string): IntentResult {
  return deterministicResolver.resolveSync(query);
}
