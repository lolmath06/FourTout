import { useState } from "react";
import { useHandoff } from "./store";

/**
 * Chemins reçus d'un autre outil, consommés une seule fois.
 *
 * Les outils « Fichiers » travaillent sur des chemins : c'est par là qu'ils
 * reçoivent le fichier qu'un outil voisin vient de leur passer. Revenir sur
 * l'outil plus tard ne recharge rien — le relais est consommé au premier rendu.
 */
export function useHandoffPaths(toolId: string): string[] {
  const handoff = useHandoff(toolId);
  const [paths] = useState<string[]>(() => handoff?.paths ?? []);
  return paths;
}
