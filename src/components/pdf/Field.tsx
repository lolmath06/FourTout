import type { ReactNode } from "react";

/**
 * Contrôles de formulaire des outils PDF.
 *
 * Regroupés ici pour que les seize outils partagent exactement la même
 * présentation : c'est ce qui évite que chaque page invente son propre style.
 */

export function Fieldset({ children, columns = 2 }: { children: ReactNode; columns?: 1 | 2 | 3 }) {
  const layout = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" }[columns];
  return (
    <div
      className={`grid gap-3 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-4 ${layout}`}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  full = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${full ? "sm:col-span-full" : ""}`}>
      <span className="text-xs font-medium text-[var(--ft-text-muted)]">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-[var(--ft-text-faint)]">{hint}</span>}
    </label>
  );
}

const CONTROL =
  "h-9 w-full rounded-md border border-[var(--ft-border)] bg-[var(--ft-bg)] px-2.5 text-sm outline-none focus:border-[var(--ft-accent)]";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CONTROL} ${props.className ?? ""}`} />;
}

export function NumberInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" {...props} className={`${CONTROL} ${props.className ?? ""}`} />;
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  ...rest
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  return (
    <select
      {...rest}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className={CONTROL}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** Groupe de boutons exclusifs, plus lisible qu'un menu pour 2 à 4 choix. */
export function OptionGroup<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  disabled = false,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string; hint?: string }[];
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={`flex flex-wrap gap-1 rounded-lg border border-[var(--ft-border)] bg-[var(--ft-bg)] p-1 ${
        disabled ? "opacity-60" : ""
      }`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.hint}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
            value === option.value
              ? "bg-[var(--ft-accent-soft)] text-[var(--ft-accent-text)]"
              : "text-[var(--ft-text-muted)] hover:text-[var(--ft-text)]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Sélecteur de position sur une page, en grille 3 × 2. */
export function PositionPicker<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <div role="radiogroup" aria-label="Position" className="grid grid-cols-3 gap-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-md border px-2 py-2 text-[11px] transition-colors ${
            value === option.value
              ? "border-[var(--ft-accent)] bg-[var(--ft-accent-soft)] text-[var(--ft-accent-text)]"
              : "border-[var(--ft-border)] text-[var(--ft-text-muted)] hover:border-[var(--ft-border-strong)]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <span className="flex items-center gap-2.5">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 flex-1 accent-[var(--ft-accent)]"
      />
      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-[var(--ft-text-muted)]">
        {value}
        {suffix}
      </span>
    </span>
  );
}
