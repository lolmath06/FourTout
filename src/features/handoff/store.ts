import { useState } from "react";
import type { SelectedFile } from "@/core/files";

/**
 * Passage de relais entre outils.
 *
 * Le convertisseur universel n'exécute rien lui-même : il ouvre l'outil
 * spécialisé, **déjà chargé** avec le fichier et le format choisis. Le même
 * mécanisme sert à « Comparer deux fichiers » qui bascule vers la comparaison
 * de textes, ou à tout enchaînement futur.
 *
 * Le relais vit hors de React (module singleton) : il survit à la navigation,
 * et il est consommé **une seule fois** par l'outil destinataire — revenir sur
 * l'outil plus tard ne doit pas recharger un fichier oublié là.
 */
export interface Handoff {
  /** Outil destinataire. */
  toolId: string;
  /** Fichiers déjà lus (dépôt navigateur). */
  files?: SelectedFile[];
  /** Chemins natifs, pour les outils Fichiers. */
  paths?: string[];
  /** Réglages préremplis, interprétés par l'outil destinataire. */
  preset?: Record<string, unknown>;
}

let pending: Handoff | undefined;

/** Prépare le relais, juste avant de naviguer vers l'outil destinataire. */
export function setHandoff(handoff: Handoff): void {
  pending = handoff;
}

/** Consulte le relais sans le consommer (tests, diagnostics). */
export function peekHandoff(toolId?: string): Handoff | undefined {
  if (!pending) return undefined;
  return toolId === undefined || pending.toolId === toolId ? pending : undefined;
}

/** Récupère et efface le relais destiné à un outil. */
export function takeHandoff(toolId: string): Handoff | undefined {
  if (pending?.toolId !== toolId) return undefined;
  const handoff = pending;
  pending = undefined;
  return handoff;
}

/** Oublie un relais en attente (changement d'avis, navigation annulée). */
export function clearHandoff(): void {
  pending = undefined;
}

/**
 * Consomme le relais au premier rendu de l'outil. Le résultat est stable :
 * un re-rendu ne recharge rien.
 */
export function useHandoff(toolId: string): Handoff | undefined {
  const [handoff] = useState(() => takeHandoff(toolId));
  return handoff;
}

/** Lecture typée d'un réglage préremplis. */
export function presetString(handoff: Handoff | undefined, key: string): string | undefined {
  const value = handoff?.preset?.[key];
  return typeof value === "string" ? value : undefined;
}
