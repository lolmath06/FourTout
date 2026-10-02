import { formatPageRange } from "@/core/pdf/pageRange";
import { Icon } from "@/components/ui/Icon";
import type { PageRangeState } from "./usePageRange";
import { t, tx } from "@/i18n";

export function PageRangeInput({
  value,
  onChange,
  pageCount,
  state,
  label = t("Pages"),
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
          {tx(label)}
        </label>
        <button
          type="button"
          onClick={() => onChange(`1-${pageCount}`)}
          className="text-[11px] text-[var(--ft-accent-text)] hover:underline"
        >
          {t("Tout sélectionner ({pageCount})", { pageCount })}
        </button>
      </div>

      <input
        id="page-range"
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={tx(placeholder)}
        aria-label={tx(label)}
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
          {tx(state.error)}
        </p>
      ) : (
        <p className="text-xs text-[var(--ft-text-faint)]">
          {state.valid
            ? t("{count} {count, plural, one {page} other {pages}} : {range}", {
                count: state.pages.length,
                range: formatPageRange(state.pages),
              })
            : t("Exemples : 1,3,5 · 1-4 · 1-3,7 · 5- (jusqu'à la fin). Document de {pageCount} {pageCount, plural, one {page} other {pages}}.", { pageCount })}
        </p>
      )}
    </div>
  );
}
