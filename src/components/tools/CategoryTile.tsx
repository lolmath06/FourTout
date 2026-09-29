import { Link } from "react-router-dom";
import { categoryRoute, type CategoryDefinition } from "@/core/tools/types";
import { Icon } from "@/components/ui/Icon";

/**
 * Tuile de catégorie.
 *
 * La couleur de la famille se lit sur un **filet latéral** et sur l'icône,
 * jamais sur un aplat : dix tuiles à fond coloré ressemblent à une palette,
 * pas à un logiciel.
 */
export function CategoryTile({
  category,
  count,
}: {
  category: CategoryDefinition;
  count: number;
}) {
  return (
    <Link
      to={categoryRoute(category.id)}
      data-accent={category.accent}
      data-testid={`category-tile-${category.id}`}
      className="group relative flex flex-col gap-1 overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] py-2.5 pl-3.5 pr-3 transition-colors hover:bg-[var(--ft-hover)]"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[2px] bg-[var(--ft-cat)] opacity-70 transition-opacity group-hover:opacity-100"
      />
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[var(--ft-cat)]">
          <Icon name={category.icon} size={15} />
        </span>
        <span className="ft-title min-w-0 flex-1 truncate">{category.name}</span>
        <span className="ft-num shrink-0 text-[11.5px] text-[var(--ft-text-faint)]">{count}</span>
      </div>
      <p className="mt-auto line-clamp-2 text-[11.5px] leading-4 text-[var(--ft-text-muted)]">
        {category.description}
      </p>
    </Link>
  );
}
