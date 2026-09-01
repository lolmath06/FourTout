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
  "aria-label"?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Rechercher un outil…",
  autoFocus = false,
  className,
  size = "sm",
  onSubmit,
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
        "flex items-center gap-2 rounded-lg border border-[var(--ft-border)] bg-[var(--ft-surface)] transition-colors",
        "focus-within:border-[var(--ft-accent)]",
        large ? "h-12 px-4" : "h-8 px-2.5",
        className,
      )}
    >
      <Icon
        name="Search"
        size={large ? 18 : 14}
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
          "w-full bg-transparent text-[var(--ft-text)] outline-none placeholder:text-[var(--ft-text-faint)]",
          "[&::-webkit-search-cancel-button]:appearance-none",
          large ? "text-base" : "text-sm",
        )}
      />
      {value && (
        <button
          type="button"
          aria-label="Effacer la recherche"
          onClick={() => onChange("")}
          className="shrink-0 rounded p-0.5 text-[var(--ft-text-faint)] hover:text-[var(--ft-text)]"
        >
          <Icon name="X" size={large ? 16 : 13} />
        </button>
      )}
    </div>
  );
}
