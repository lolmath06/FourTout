import type { ReactNode } from "react";

/**
 * Contrôles de formulaire des outils PDF.
 *
 * Regroupés ici pour que les seize outils partagent exactement la même
 * présentation : c'est ce qui évite que chaque page invente son propre style.
 */

export function Fieldset({
  children,
  columns = 2,
  title,
}: {
  children: ReactNode;
  columns?: 1 | 2 | 3;
  /** Intitulé de section, affiché au-dessus d'un filet. */
  title?: string;
}) {
  const layout = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" }[columns];
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
      {title && (
        <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">{title}</h3>
      )}
      <div className={`grid gap-x-4 gap-y-3 p-3 ${layout}`}>{children}</div>
    </section>
  );
}

/**
 * Groupe de réglages **sans panneau** : un intitulé, un filet, des contrôles.
 *
 * C'est la forme à préférer quand plusieurs groupes se suivent : empiler des
 * panneaux encadrés produit des cartes dans des cartes, ce qui brouille la
 * hiérarchie au lieu de la porter.
 */
export function FieldGroup({
  title,
  children,
  columns = 2,
  actions,
}: {
  title: string;
  children: ReactNode;
  columns?: 1 | 2 | 3;
  actions?: ReactNode;
}) {
  const layout = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" }[columns];
  return (
    <section>
      <div className="mb-2 flex items-center gap-3 border-b border-[var(--ft-rule)] pb-1.5">
        <h3 className="ft-section">{title}</h3>
        <div className="flex-1" />
        {actions}
      </div>
      <div className={`grid gap-x-4 gap-y-3 ${layout}`}>{children}</div>
    </section>
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
    <label className={`flex flex-col gap-1 ${full ? "sm:col-span-full" : ""}`}>
      <span className="ft-label">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-4 text-[var(--ft-text-faint)]">{hint}</span>}
    </label>
  );
}

const CONTROL =
  "h-[var(--ft-control)] w-full rounded-[var(--radius-md)] border border-[var(--ft-border-strong)] bg-[var(--ft-bg)] px-2 text-[13px] outline-none transition-colors focus:border-[var(--ft-accent)] disabled:opacity-45";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CONTROL} ${props.className ?? ""}`} />;
}

export function NumberInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="number"
      {...props}
      className={`${CONTROL} ft-num ${props.className ?? ""}`}
    />
  );
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

/**
 * Groupe de choix exclusifs.
 *
 * Volontairement plus proche d'un segmented control d'application native que
 * d'un gros sélecteur de tableau de bord : hauteur de contrôle standard, angles
 * serrés, sélection portée par une surface neutre et une bordure, pas par un
 * aplat coloré.
 */
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
      // `w-fit` : un segmented control se dimensionne sur ses libellés. Étiré sur
      // toute une colonne, il redevient une grande barre colorée — exactement ce
      // que la passe visuelle cherche à éviter.
      className={`flex h-[var(--ft-control)] w-fit max-w-full items-stretch gap-px self-start overflow-hidden rounded-[var(--radius-md)] border border-[var(--ft-border-strong)] bg-[var(--ft-border)] ${
        disabled ? "opacity-45" : ""
      }`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          // `Field` enveloppe ses enfants dans un `<label>`, et un `<button>`
          // est un élément étiquetable : sans nom explicite, la première option
          // hériterait du libellé du champ au lieu du sien.
          aria-label={option.label}
          title={option.hint}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={`flex min-w-16 flex-1 items-center justify-center px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
            value === option.value
              ? "bg-[var(--ft-surface-2)] text-[var(--ft-text)] shadow-[inset_0_-2px_0_var(--ft-accent)]"
              : "bg-[var(--ft-bg)] text-[var(--ft-text-muted)] hover:bg-[var(--ft-hover)] hover:text-[var(--ft-text)]"
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
          className={`rounded-[var(--radius-sm)] border px-2 py-1.5 text-[11px] transition-colors ${
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
