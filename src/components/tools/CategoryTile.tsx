import { Link } from "react-router-dom";
import { categoryRoute, type CategoryDefinition } from "@/core/tools/types";
import { Icon } from "@/components/ui/Icon";

export function CategoryTile({
  category,
  count,
  availableCount,
}: {
  category: CategoryDefinition;
  count: number;
  availableCount: number;
}) {
  return (
    <Link
      to={categoryRoute(category.id)}
      data-accent={category.accent}
      data-testid={`category-tile-${category.id}`}
      className="group flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3.5 transition-colors hover:border-[var(--ft-cat)]"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--ft-cat-soft)] text-[var(--ft-cat)]">
          <Icon name={category.icon} size={16} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{category.name}</span>
        <Icon
          name="ChevronRight"
          size={15}
          className="shrink-0 text-[var(--ft-text-faint)] transition-transform group-hover:translate-x-0.5"
        />
      </div>
      <p className="line-clamp-2 text-xs text-[var(--ft-text-muted)]">{category.description}</p>
      <p className="mt-auto pt-1 text-[11px] text-[var(--ft-text-faint)]">
        {count} outil{count > 1 ? "s" : ""}
        {availableCount > 0 && (
          <span className="text-[var(--ft-ok)]"> · {availableCount} disponible{availableCount > 1 ? "s" : ""}</span>
        )}
      </p>
    </Link>
  );
}
