import clsx from "clsx";
import { useEffect, useRef } from "react";
import { Icon } from "./Icon";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  size?: "sm" | "lg";
  onSubmit?: () => void;
  /** Indication de raccourci affichée à droite (purement visuelle). */
  hint?: string;
  "aria-label"?: string;
}

/**
 * Champ de recherche.
 *
 * Il doit ressembler à une **ligne de commande** d'application, pas à la barre
 * de recherche d'une page d'accueil : hauteur de contrôle standard, angles
 * serrés, bordure nette, aucune ombre.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Rechercher un outil…",
  autoFocus = false,
  className,
  size = "sm",
  onSubmit,
  hint,
  ...rest
}: SearchInputProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const large = size === "lg";

  return (
    <div
      className={clsx(
        "flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--ft-border-strong)]",
        "bg-[var(--ft-bg)] transition-colors focus-within:border-[var(--ft-accent)]",
        large ? "h-[var(--ft-control-lg)] px-2.5" : "h-[var(--ft-control)] px-2",
        className,
      )}
    >
      <Icon
        name="Search"
        size={large ? 15 : 14}
        className="shrink-0 text-[var(--ft-text-faint)]"
      />
      <input
        ref={ref}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={rest["aria-label"] ?? placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSubmit?.();
          if (event.key === "Escape" && value) onChange("");
        }}
        className={clsx(
          "w-full bg-transparent text-[var(--ft-text)] outline-none",
          "placeholder:text-[var(--ft-text-faint)]",
          "[&::-webkit-search-cancel-button]:appearance-none",
          large ? "text-sm" : "text-[13px]",
        )}
      />
      {value ? (
        <button
          type="button"
          aria-label="Effacer la recherche"
          onClick={() => onChange("")}
          className="shrink-0 rounded-[var(--radius-sm)] p-0.5 text-[var(--ft-text-faint)] hover:text-[var(--ft-text)]"
        >
          <Icon name="X" size={13} />
        </button>
      ) : (
        hint && (
          <span className="ft-value shrink-0 rounded-[var(--radius-sm)] border border-[var(--ft-border)] px-1 text-[10px] leading-4 text-[var(--ft-text-faint)]">
            {hint}
          </span>
        )
      )}
    </div>
  );
}
