import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Boutons de FourTout.
 *
 * Quatre variantes, et une seule règle : l'accent ne sert qu'à **l'action
 * principale** d'un écran. Tout le reste est neutre. Pas de dégradé, pas
 * d'ombre portée, pas de halo — un bouton de logiciel, pas de page web.
 */
type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  // Action principale : la seule surface colorée d'un écran.
  primary:
    "border border-[var(--ft-accent)] bg-[var(--ft-accent)] text-white hover:brightness-110 active:brightness-95 " +
    // Un bouton principal désactivé n'est pas un bouton principal pâle : du
    // blanc sur du bleu translucide devient illisible. Il redevient neutre.
    "disabled:border-[var(--ft-border)] disabled:bg-[var(--ft-surface-2)] disabled:text-[var(--ft-text-faint)]",
  // Action secondaire : surface neutre, bordure nette.
  secondary:
    "border border-[var(--ft-border-strong)] bg-[var(--ft-surface)] text-[var(--ft-text)] hover:bg-[var(--ft-hover)] disabled:opacity-50",
  // Action légère : ni surface ni bordure au repos.
  ghost:
    "border border-transparent bg-transparent text-[var(--ft-text-muted)] hover:bg-[var(--ft-hover)] hover:text-[var(--ft-text)] disabled:opacity-50",
  // Opération réellement destructrice, et rien d'autre.
  danger:
    "border border-[color-mix(in_oklch,var(--ft-danger)_45%,var(--ft-border))] bg-transparent text-[var(--ft-danger)] hover:bg-[color-mix(in_oklch,var(--ft-danger)_10%,transparent)] disabled:opacity-50",
};

const SIZES: Record<Size, string> = {
  sm: "h-[var(--ft-control-sm)] px-2 text-xs gap-1.5",
  md: "h-[var(--ft-control)] px-3 text-[13px] gap-1.5",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-md)] font-medium",
        "transition-[background-color,border-color,color,filter] duration-100",
        "disabled:pointer-events-none",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
