import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { ToolDefinition } from "@/core/tools/types";

/**
 * Table des implémentations d'outils.
 *
 * Le registre (`core/tools`) dit ce qui existe ; cette table dit ce qui est
 * réellement branché. Un outil absent d'ici s'affiche avec la vue « bientôt
 * disponible » : c'est le point d'extension des prochaines phases.
 *
 * Ajouter un outil implémenté = créer son composant dans `src/tools/impl/`,
 * l'ajouter ici, et passer son `status` à `"available"` dans le catalogue.
 * Un test vérifie que ces deux listes restent cohérentes.
 */
export interface ToolComponentProps {
  tool: ToolDefinition;
}

export type ToolComponent =
  | ComponentType<ToolComponentProps>
  | LazyExoticComponent<ComponentType<ToolComponentProps>>;

export const TOOL_IMPLEMENTATIONS: Record<string, ToolComponent> = {
  "text-statistics": lazy(() =>
    import("./impl/TextStatisticsTool").then((m) => ({ default: m.TextStatisticsTool })),
  ),
  "text-case": lazy(() =>
    import("./impl/TextCaseTool").then((m) => ({ default: m.TextCaseTool })),
  ),
  base64: lazy(() => import("./impl/Base64Tool").then((m) => ({ default: m.Base64Tool }))),
};

export function getToolComponent(toolId: string): ToolComponent | undefined {
  return TOOL_IMPLEMENTATIONS[toolId];
}

export function implementedToolIds(): string[] {
  return Object.keys(TOOL_IMPLEMENTATIONS);
}
