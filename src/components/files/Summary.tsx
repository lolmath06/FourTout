import type { ReactNode } from "react";
import clsx from "clsx";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { revealFile } from "@/core/output/save";

/**
 * Briques de restitution partagées par les outils Fichiers.
 *
 * Comparer deux dossiers, planifier une synchronisation, analyser un disque ou
 * vérifier un manifeste aboutissent tous à la même forme : quelques chiffres
 * qui donnent le verdict d'un coup d'œil, puis une liste détaillée. Les
 * rassembler ici évite que chaque outil réinvente sa propre mise en page — et
 * garantit qu'un « 0 » s'y lit partout de la même façon.
 */

export interface Stat {
  label: string;
  value: string | number;
  /** Teinte facultative : réservée aux chiffres qui demandent l'attention. */
  tone?: "neutral" | "ok" | "warn" | "danger";
}

const TONE_COLOR: Record<NonNullable<Stat["tone"]>, string> = {
  neutral: "var(--ft-text)",
  ok: "var(--ft-ok)",
  warn: "var(--ft-warn)",
  danger: "var(--ft-danger)",
};

/** Bandeau de chiffres clés. */
export function StatGrid({ stats, columns = 4 }: { stats: Stat[]; columns?: 3 | 4 | 5 }) {
  const layout = { 3: "sm:grid-cols-3", 4: "sm:grid-cols-4", 5: "sm:grid-cols-5" }[columns];
  return (
    <div className={clsx("grid grid-cols-2 gap-1.5", layout)} data-testid="stat-grid">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface)] px-2.5 py-2"
        >
          <p
            className="text-lg font-semibold leading-6 tabular-nums"
            style={{ color: TONE_COLOR[stat.tone ?? "neutral"] }}
          >
            {typeof stat.value === "number" ? stat.value.toLocaleString("fr-FR") : stat.value}
          </p>
          <p className="text-[11px] text-[var(--ft-text-muted)]">{stat.label}</p>
        </div>
      ))}
    </div>
  );
}

/** Barre de proportion, deux pixels : l'information est le rapport, pas la barre. */
export function Bar({ ratio, tone = "accent" }: { ratio: number; tone?: "accent" | "danger" }) {
  return (
    <span className="block h-1.5 overflow-hidden rounded-full bg-[var(--ft-surface-2)]">
      <span
        className="block h-full rounded-full"
        style={{
          width: `${Math.max(2, Math.round(Math.min(1, Math.max(0, ratio)) * 100))}%`,
          background: tone === "danger" ? "var(--ft-danger)" : "var(--ft-accent)",
        }}
      />
    </span>
  );
}

/** Panneau à en-tête, pour une liste de résultats. */
export function Panel({
  title,
  count,
  actions,
  children,
  testId,
}: {
  title: string;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)]"
      data-testid={testId}
    >
      <header className="flex items-center gap-2 border-b border-[var(--ft-rule)] bg-[var(--ft-surface)] px-3 py-1.5">
        <h3 className="ft-section">{title}</h3>
        {count !== undefined && (
          <span className="ft-meta tabular-nums">{count.toLocaleString("fr-FR")}</span>
        )}
        <div className="flex-1" />
        {actions}
      </header>
      {children}
    </section>
  );
}

/** Liste de chemins, coupée et avec un bouton pour aller voir sur le disque. */
export function PathList({
  paths,
  max = 200,
  reveal = false,
}: {
  paths: string[];
  max?: number;
  reveal?: boolean;
}) {
  return (
    <ul className="max-h-72 divide-y divide-[var(--ft-rule)] overflow-y-auto text-xs">
      {paths.slice(0, max).map((path) => (
        <li key={path} className="flex items-center gap-2 px-3 py-1">
          <span className="min-w-0 flex-1 truncate font-mono" title={path}>
            {path}
          </span>
          {reveal && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Ouvrir l'emplacement de ${path}`}
              onClick={() => revealFile(path)}
            >
              <Icon name="FolderTree" size={13} />
            </Button>
          )}
        </li>
      ))}
      {paths.length > max && (
        <li className="px-3 py-1 text-[var(--ft-text-faint)]">
          … et {(paths.length - max).toLocaleString("fr-FR")} de plus
        </li>
      )}
    </ul>
  );
}

/** Avertissements collectés pendant un parcours : visibles, jamais bloquants. */
export function Warnings({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-xs text-[var(--ft-warn)]">
      <p className="flex items-center gap-1.5 font-medium">
        <Icon name="TriangleAlert" size={13} />
        {title} ({items.length})
      </p>
      <ul className="mt-1 max-h-32 overflow-y-auto">
        {items.slice(0, 50).map((item) => (
          <li key={item} className="truncate font-mono" title={item}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
