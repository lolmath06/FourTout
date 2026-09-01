import { formatPageRange } from "@/core/pdf/pageRange";
import { Icon } from "@/components/ui/Icon";
import type { PageRangeState } from "./usePageRange";

export function PageRangeInput({
  value,
  onChange,
  pageCount,
  state,
  label = "Pages",
  placeholder = "1-3, 7, 10-12",
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  pageCount: number;
  state: PageRangeState;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor="page-range" className="text-xs font-medium text-[var(--ft-text-muted)]">
          {label}
        </label>
        <button
          type="button"
          onClick={() => onChange(`1-${pageCount}`)}
          className="text-[11px] text-[var(--ft-accent-text)] hover:underline"
        >
          Tout sélectionner ({pageCount})
        </button>
      </div>

      <input
        id="page-range"
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={state.error !== undefined}
        className={`h-9 w-full rounded-md border bg-[var(--ft-surface)] px-2.5 font-mono text-sm outline-none ${
          state.error
            ? "border-[var(--ft-danger)]"
            : "border-[var(--ft-border)] focus:border-[var(--ft-accent)]"
        }`}
      />

      {state.error ? (
        <p className="flex items-start gap-1.5 text-xs text-[var(--ft-danger)]">
          <Icon name="CircleAlert" size={12} className="mt-0.5 shrink-0" />
          {state.error}
        </p>
      ) : (
        <p className="text-xs text-[var(--ft-text-faint)]">
          {state.valid
            ? `${state.pages.length} page${state.pages.length > 1 ? "s" : ""} : ${formatPageRange(state.pages)}`
            : `Exemples : 1,3,5 · 1-4 · 1-3,7 · 5- (jusqu'à la fin). Document de ${pageCount} page${pageCount > 1 ? "s" : ""}.`}
        </p>
      )}
    </div>
  );
}
