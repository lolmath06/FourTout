import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { toolRegistry } from "@/core/tools/registry";
import type { Handoff } from "./store";
import { useOpenTool } from "./useOpenTool";

/**
 * Bouton de passage de relais. Il ne s'affiche que si l'outil visé existe
 * réellement au registre : plutôt aucun bouton qu'un bouton mort.
 */
export function OpenToolButton({
  toolId,
  paths,
  files,
  preset,
  label,
  icon,
  variant = "secondary",
}: {
  toolId: string;
  paths?: string[];
  files?: Handoff["files"];
  preset?: Record<string, unknown>;
  /** Libellé ; à défaut, le nom de l'outil visé. */
  label?: string;
  icon?: string;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const open = useOpenTool();
  const target = toolRegistry.get(toolId);
  if (!target) return null;

  return (
    <Button
      size="sm"
      variant={variant}
      onClick={() => open(toolId, { paths, files, preset })}
      data-testid={`open-tool-${toolId}`}
    >
      <Icon name={icon ?? target.icon} size={13} />
      {label ?? target.name}
    </Button>
  );
}
