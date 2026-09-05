import clsx from "clsx";
import type { ToolStatus } from "@/core/tools/types";

const OPTIONS: { value: ToolStatus | undefined; label: string }[] = [
  { value: undefined, label: "Tous" },
  { value: "available", label: "Disponibles" },
  { value: "planned", label: "Bientôt" },
];

/** Filtre segmenté, aligné sur `OptionGroup` : même hauteur, même sélection. */
export function StatusFilter({
  value,
  onChange,
}: {
  value: ToolStatus | undefined;
  onChange: (value: ToolStatus | undefined) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filtrer par disponibilité"
      className="flex h-[var(--ft-control)] items-stretch gap-px overflow-hidden rounded-[var(--radius-md)] border border-[var(--ft-border-strong)] bg-[var(--ft-border)]"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.label}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={clsx(
            "flex items-center px-2.5 text-xs font-medium transition-colors",
            value === option.value
              ? "bg-[var(--ft-surface-2)] text-[var(--ft-text)] shadow-[inset_0_-2px_0_var(--ft-accent)]"
              : "bg-[var(--ft-bg)] text-[var(--ft-text-muted)] hover:bg-[var(--ft-hover)] hover:text-[var(--ft-text)]",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
