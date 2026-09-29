import type { ToolDefinition } from "../tools/types";

/**
 * Contrat du résolveur d'intention.
 *
 * Chaîne visée :
 *   requête utilisateur → IntentResolver → registre → outil → navigation
 *
 * Règle non négociable : un résolveur **ne crée jamais** un outil. Il ne peut
 * que désigner des outils existants du registre. Un futur `LocalLLMIntentResolver`
 * interprétera la formulation, mais devra passer par les mêmes identifiants,
 * validés par le registre avant d'être renvoyés à l'interface.
 */

export interface IntentCandidate {
  tool: ToolDefinition;
  /** Confiance normalisée entre 0 et 1. */
  confidence: number;
  /** Explication courte, affichable telle quelle. */
  reason: string;
}

export type IntentOutcome =
  /** Un candidat nettement au-dessus des autres. */
  | "match"
  /** Plusieurs candidats plausibles : laisser l'utilisateur choisir. */
  | "ambiguous"
  /** Aucun outil du registre ne correspond. */
  | "no-match";

export interface IntentResult {
  query: string;
  outcome: IntentOutcome;
  candidates: IntentCandidate[];
  /** Identifiant du résolveur ayant produit le résultat (traçabilité, débogage). */
  resolver: string;
  /** Message prêt à afficher lorsque rien ne correspond. */
  message?: string;
}

export interface IntentResolver {
  readonly id: string;
  /** Le résolveur est-il utilisable dans cet environnement ? */
  isAvailable(): boolean;
  resolve(query: string): Promise<IntentResult>;
}
