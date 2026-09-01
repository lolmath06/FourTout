import clsx from "clsx";
import type { ReactNode } from "react";
import type { ToolStatus } from "@/core/tools/types";

export function Badge({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-4",
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATUS_LABEL: Record<ToolStatus, string> = {
  available: "Disponible",
  beta: "Bêta",
  planned: "Bientôt",
};

const STATUS_CLASS: Record<ToolStatus, string> = {
  available:
    "bg-[color-mix(in_oklch,var(--ft-ok)_16%,transparent)] text-[var(--ft-ok)]",
  beta: "bg-[color-mix(in_oklch,var(--ft-warn)_18%,transparent)] text-[var(--ft-warn)]",
  planned: "bg-[var(--ft-surface-2)] text-[var(--ft-text-faint)]",
};

export function StatusBadge({ status }: { status: ToolStatus }) {
  return (
    <Badge
      className={STATUS_CLASS[status]}
      title={
        status === "available"
          ? "Cet outil est utilisable dès maintenant"
          : "Cet outil est au catalogue mais pas encore implémenté"
      }
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}
