import type { ReactNode } from "react";
import clsx from "clsx";
import { Icon } from "./Icon";

/**
 * En-tête de page.
 *
 * Hauteur réduite, hiérarchie nette : un titre, une ligne d'explication, et
 * les actions alignées à droite. Pas d'icône surdimensionnée ni de sous-titre
 * de page d'accueil.
 */
export function PageHeader({
  icon,
  title,
  description,
  actions,
}: {
  icon?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center gap-2.5 border-b border-[var(--ft-rule)] pb-3">
      {icon && (
        <span className="shrink-0 text-[var(--ft-cat,var(--ft-text-muted))]">
          <Icon name={icon} size={17} />
        </span>
      )}
      <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
        <h1 className="ft-page-title shrink-0">{title}</h1>
        {description && (
          <p className="ft-meta min-w-0 truncate">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Gabarit de page.
 *
 * `wide` est réservé aux outils qui ont réellement besoin d'espace
 * (comparaison, rognage, aperçu vidéo, tables larges) ; partout ailleurs une
 * largeur de lecture bornée évite qu'un écran 1920 étale trois contrôles sur
 * toute la largeur.
 */
export function Page({
  children,
  width = "default",
}: {
  children: ReactNode;
  width?: "default" | "wide";
}) {
  return (
    <div
      className={clsx(
        "mx-auto w-full px-5 py-4",
        width === "wide" ? "max-w-[1600px]" : "max-w-5xl",
      )}
    >
      {children}
    </div>
  );
}
