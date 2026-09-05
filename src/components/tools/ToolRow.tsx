import { Link } from "react-router-dom";
import { getCategory } from "@/core/tools/categories";
import { toolRoute, type ToolDefinition } from "@/core/tools/types";
import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/Badge";
import { FavoriteButton } from "./FavoriteButton";

/**
 * Ligne d'outil.
 *
 * Format « catalogue de logiciel » : une ligne, pas une carte. L'icône reste
 * petite et colorée par la catégorie, le nom domine, la description passe en
 * gris. Les lignes vivent dans un panneau unique séparé par des filets — c'est
 * ce qui remplace la grille de cartes encadrées, et ce qui permet d'afficher
 * beaucoup d'outils sans donner une impression de mur.
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
      className="group flex items-center gap-2.5 px-2.5 py-1.5 transition-colors hover:bg-[var(--ft-hover)]"
    >
      <span className="shrink-0 text-[var(--ft-cat,var(--ft-text-muted))]">
        <Icon name={tool.icon} size={15} />
      </span>

      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="shrink-0 truncate text-[13px] font-medium text-[var(--ft-text)]">
          {tool.name}
        </span>
        {tool.status !== "available" && <StatusBadge status={tool.status} />}
        <span className="ft-meta min-w-0 truncate">
          {showCategory && category && (
            <span className="text-[var(--ft-text-faint)]">{category.name} · </span>
          )}
          {tool.description}
        </span>
      </span>

      {trailing}
      <FavoriteButton
        toolId={tool.id}
        size={13}
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-pressed:opacity-100"
      />
      <Icon
        name="ChevronRight"
        size={14}
        className="shrink-0 text-[var(--ft-text-faint)] opacity-0 transition-opacity group-hover:opacity-100"
      />
    </Link>
  );
}

/**
 * Liste d'outils : un panneau, des filets, deux colonnes au-delà de 1280 px.
 *
 * Les colonnes gardent leur propre séparateur vertical, ce qui donne à la vue
 * l'allure d'un tableau plutôt que d'une mosaïque.
 */
export function ToolList({
  tools,
  showCategory = false,
}: {
  tools: ToolDefinition[];
  showCategory?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
      <div className="grid xl:grid-cols-2 2xl:grid-cols-3">
        {tools.map((tool, index) => (
          <div
            key={tool.id}
            className={
              // Filet entre les lignes, et filet vertical entre les colonnes.
              "border-[var(--ft-rule)] " +
              (index > 0 ? "border-t " : "") +
              "xl:[&:nth-child(-n+2)]:border-t-0 xl:[&:nth-child(even)]:border-l " +
              "2xl:[&:nth-child(even)]:border-l-0 2xl:[&:nth-child(-n+3)]:border-t-0 " +
              "2xl:[&:not(:nth-child(3n+1))]:border-l"
            }
          >
            <ToolRow tool={tool} showCategory={showCategory} />
          </div>
        ))}
      </div>
    </div>
  );
}
