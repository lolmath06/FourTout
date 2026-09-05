import clsx from "clsx";
import type { ReactNode } from "react";
import type { ToolStatus } from "@/core/tools/types";

/**
 * Marqueur d'état, réduit au strict nécessaire.
 *
 * Les pastilles arrondies et colorées sont ce qui donne le plus vite un air de
 * tableau de bord générique. Celles qui restent sont basses, peu contrastées,
 * à angles serrés — et n'apparaissent que quand l'information change vraiment
 * la décision de l'utilisateur.
 */
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
        "inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5",
        "h-4 text-[10.5px] font-medium leading-none tracking-wide",
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
  available: "text-[var(--ft-ok)]",
  beta: "border border-[color-mix(in_oklch,var(--ft-warn)_40%,transparent)] text-[var(--ft-warn)]",
  planned: "border border-[var(--ft-border)] text-[var(--ft-text-faint)]",
};

/**
 * L'état d'un outil disponible n'est pas une information : c'est la norme.
 * On ne l'affiche donc que sur demande explicite (page de l'outil), et jamais
 * dans les listes, où seul « Bientôt » mérite d'être signalé.
 */
export function StatusBadge({ status }: { status: ToolStatus }) {
  if (status === "available") {
    return (
      <span
        title="Cet outil est utilisable dès maintenant"
        className="inline-flex shrink-0 items-center gap-1.5 text-[11.5px] text-[var(--ft-ok)]"
      >
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        Disponible
      </span>
    );
  }

  return (
    <Badge
      className={STATUS_CLASS[status]}
      title="Cet outil est au catalogue mais pas encore implémenté"
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}
