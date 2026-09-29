import clsx from "clsx";
import type { ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * Message d'état : succès, avertissement, erreur, information.
 *
 * Une seule forme pour toute l'application — icône, titre, contenu — sur un
 * fond très légèrement teinté et un **filet latéral** coloré. C'est ce qui
 * remplace les grands blocs verts ou rouges pleine largeur : l'état se lit
 * immédiatement sans que le panneau prenne le dessus sur le contenu.
 */
export type CalloutTone = "success" | "warning" | "error" | "info" | "neutral";

const ICONS: Record<CalloutTone, string> = {
  success: "CircleCheck",
  warning: "TriangleAlert",
  error: "CircleAlert",
  info: "Info",
  neutral: "Info",
};

const COLORS: Record<CalloutTone, string> = {
  success: "var(--ft-ok)",
  warning: "var(--ft-warn)",
  error: "var(--ft-danger)",
  info: "var(--ft-accent)",
  neutral: "var(--ft-border-strong)",
};

export function Callout({
  tone = "info",
  title,
  icon,
  children,
  actions,
  className,
  ...rest
}: {
  tone?: CalloutTone;
  title?: ReactNode;
  icon?: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  const color = COLORS[tone];
  return (
    <div
      data-testid={rest["data-testid"]}
      className={clsx(
        "rounded-[var(--radius-card)] border border-[var(--ft-border)] border-l-2 bg-[var(--ft-surface)] px-3 py-2.5",
        className,
      )}
      style={{ borderLeftColor: color }}
    >
      <div className="flex items-start gap-2">
        <span className="mt-px shrink-0" style={{ color: tone === "neutral" ? undefined : color }}>
          <Icon name={icon ?? ICONS[tone]} size={15} />
        </span>
        <div className="min-w-0 flex-1">
          {title && <p className="text-[13px] font-medium leading-5">{title}</p>}
          {children && (
            <div className={clsx("ft-meta", title && "mt-0.5")}>{children}</div>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * Barre de progression d'une opération longue. Deux pixels, pas de dégradé :
 * l'information est l'avancement, pas la barre.
 */
export function ProgressBar({
  ratio,
  label,
  className,
}: {
  /** 0 à 1, ou `undefined` pour une opération de durée inconnue. */
  ratio?: number;
  label?: string;
  className?: string;
}) {
  const percent = Math.round((ratio ?? 0) * 100);
  return (
    <div className={clsx("space-y-1", className)}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={ratio === undefined ? undefined : percent}
        aria-label={label ?? "Progression"}
        className="h-[3px] overflow-hidden rounded-full bg-[var(--ft-surface-2)]"
      >
        <div
          className="h-full bg-[var(--ft-accent)] transition-[width] duration-150"
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>
      {label && (
        <p className="ft-meta ft-num flex items-center gap-2">
          <span className="min-w-0 truncate">{label}</span>
          {ratio !== undefined && (
            <span className="ml-auto shrink-0 text-[var(--ft-text-faint)]">{percent} %</span>
          )}
        </p>
      )}
    </div>
  );
}
