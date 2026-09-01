import { Link } from "react-router-dom";
import { getCategory } from "@/core/tools/categories";
import { toolRoute, type ToolDefinition } from "@/core/tools/types";
import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/Badge";
import { FavoriteButton } from "./FavoriteButton";

/**
 * Ligne d'outil : format dense, pensé pour afficher des dizaines d'entrées
 * sans faire défiler indéfiniment.
 */
export function ToolRow({
  tool,
  showCategory = false,
  trailing,
}: {
  tool: ToolDefinition;
  showCategory?: boolean;
  trailing?: React.ReactNode;
}) {
  const category = getCategory(tool.category);

  return (
    <Link
      to={toolRoute(tool.id)}
      data-accent={category?.accent}
      data-testid={`tool-row-${tool.id}`}
      className="group flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] px-3 py-2.5 transition-colors hover:border-[var(--ft-border-strong)] hover:bg-[var(--ft-surface-2)]"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--ft-cat-soft)] text-[var(--ft-cat)]">
        <Icon name={tool.icon} size={16} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-[var(--ft-text)]">{tool.name}</span>
          {tool.status !== "available" && <StatusBadge status={tool.status} />}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--ft-text-muted)]">
          {showCategory && category && (
            <>
              <span className="shrink-0 text-[var(--ft-cat)]">{category.name}</span>
              <span className="text-[var(--ft-text-faint)]">·</span>
            </>
          )}
          <span className="truncate">{tool.description}</span>
        </span>
      </span>

      {trailing}
      <FavoriteButton toolId={tool.id} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-pressed:opacity-100" />
      <Icon
        name="ChevronRight"
        size={15}
        className="shrink-0 text-[var(--ft-text-faint)] transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}

export function ToolList({
  tools,
  showCategory = false,
}: {
  tools: ToolDefinition[];
  showCategory?: boolean;
}) {
  return (
    <div className="grid gap-1.5 lg:grid-cols-2 2xl:grid-cols-3">
      {tools.map((tool) => (
        <ToolRow key={tool.id} tool={tool} showCategory={showCategory} />
      ))}
    </div>
  );
}
