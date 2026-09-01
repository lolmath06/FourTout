import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-[var(--ft-accent)] text-white hover:opacity-90 border border-transparent",
  secondary:
    "bg-[var(--ft-surface)] text-[var(--ft-text)] border border-[var(--ft-border)] hover:bg-[var(--ft-surface-2)]",
  ghost:
    "bg-transparent text-[var(--ft-text-muted)] border border-transparent hover:bg-[var(--ft-surface-2)] hover:text-[var(--ft-text)]",
  danger:
    "bg-transparent text-[var(--ft-danger)] border border-[var(--ft-border)] hover:bg-[var(--ft-surface-2)]",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
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
        "inline-flex items-center justify-center rounded-md font-medium transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
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
