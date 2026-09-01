import clsx from "clsx";
import type { ToolStatus } from "@/core/tools/types";

const OPTIONS: { value: ToolStatus | undefined; label: string }[] = [
  { value: undefined, label: "Tous" },
  { value: "available", label: "Disponibles" },
  { value: "planned", label: "Bientôt" },
];

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
      className="flex h-8 items-center gap-0.5 rounded-lg border border-[var(--ft-border)] bg-[var(--ft-surface)] p-0.5"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.label}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={clsx(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === option.value
              ? "bg-[var(--ft-accent-soft)] text-[var(--ft-accent-text)]"
              : "text-[var(--ft-text-muted)] hover:text-[var(--ft-text)]",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
