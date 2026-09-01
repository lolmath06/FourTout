import clsx from "clsx";
import type { ToolCapability, ToolDefinition } from "@/core/tools/types";
import { Badge } from "@/components/ui/Badge";

/** Libellés lisibles des capacités techniques déclarées par un outil. */
const LABELS: Partial<Record<ToolCapability, string>> = {
  local: "100 % local",
  network: "Nécessite Internet",
  batch: "Traitement par lots",
  "long-running": "Peut être long",
  destructive: "Irréversible",
  "needs-sidecar": "Moteur embarqué",
  "needs-device": "Accès micro/caméra",
};

const CLASSES: Partial<Record<ToolCapability, string>> = {
  local: "bg-[color-mix(in_oklch,var(--ft-ok)_14%,transparent)] text-[var(--ft-ok)]",
  network: "bg-[color-mix(in_oklch,var(--ft-warn)_16%,transparent)] text-[var(--ft-warn)]",
  destructive: "bg-[color-mix(in_oklch,var(--ft-danger)_14%,transparent)] text-[var(--ft-danger)]",
};

export function CapabilityList({
  tool,
  className,
}: {
  tool: ToolDefinition;
  className?: string;
}) {
  const visible = tool.capabilities.filter((capability) => capability in LABELS);
  if (visible.length === 0) return null;

  return (
    <div className={clsx("flex flex-wrap gap-1", className)}>
      {visible.map((capability) => (
        <Badge
          key={capability}
          className={CLASSES[capability] ?? "bg-[var(--ft-surface-2)] text-[var(--ft-text-muted)]"}
        >
          {LABELS[capability]}
        </Badge>
      ))}
    </div>
  );
}
