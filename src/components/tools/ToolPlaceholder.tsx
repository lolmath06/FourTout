import { Link } from "react-router-dom";
import { getCategory } from "@/core/tools/categories";
import { toolRegistry } from "@/core/tools/registry";
import { categoryRoute, toolRoute, type ToolDefinition } from "@/core/tools/types";
import { Icon } from "@/components/ui/Icon";

/**
 * Vue affichée tant qu'un outil du catalogue n'a pas d'implémentation.
 *
 * Elle est volontairement informative plutôt que décorative : l'utilisateur
 * comprend ce que l'outil fera, et peut rebondir sur des outils voisins.
 */
export function ToolPlaceholder({ tool }: { tool: ToolDefinition }) {
  const category = getCategory(tool.category);
  const related = toolRegistry
    .byCategoryId(tool.category)
    .filter((other) => other.id !== tool.id)
    .slice(0, 5);

  const inputs = tool.acceptedInputs.filter((input) => input.kind !== "none");
  const outputs = tool.outputs.filter((output) => output.kind !== "none");

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-dashed border-[var(--ft-border-strong)] bg-[var(--ft-surface)] px-4 py-6">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--ft-surface-2)] text-[var(--ft-text-muted)]">
          <Icon name="Hammer" size={17} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">Cet outil arrive prochainement</p>
          <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--ft-text-muted)]">
            {tool.name} est inscrit au catalogue de FourTout et sera ajouté lors d'une prochaine
            mise à jour. Vous pouvez déjà l'ajouter à vos favoris pour le retrouver dès qu'il
            sera disponible.
          </p>
          {category && (
            <Link
              to={categoryRoute(category.id)}
              className="mt-2.5 inline-flex items-center gap-1 text-xs text-[var(--ft-accent-text)] hover:underline"
            >
              Voir les autres outils {category.name}
              <Icon name="ArrowRight" size={12} />
            </Link>
          )}
        </div>
      </div>

      <dl className="grid gap-1.5 sm:grid-cols-3">
        <Detail label="Catégorie" value={category?.name ?? tool.category} />
        <Detail
          label="Fichiers acceptés"
          value={
            inputs.length === 0
              ? "Saisie directe"
              : [...new Set(inputs.flatMap((input) => input.extensions))]
                  .slice(0, 8)
                  .map((ext) => (ext === "*" ? "tous" : `.${ext}`))
                  .join(", ")
          }
        />
        <Detail
          label="Résultat"
          value={
            outputs.length === 0
              ? "Affiché dans l'application"
              : [...new Set(outputs.flatMap((output) => output.extensions))]
                  .slice(0, 8)
                  .map((ext) => (ext === "*" ? "fichiers" : `.${ext}`))
                  .join(", ")
          }
        />
      </dl>

      {related.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ft-text-muted)]">
            Outils voisins
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {related.map((other) => (
              <Link
                key={other.id}
                to={toolRoute(other.id)}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface)] px-2.5 py-1.5 text-xs transition-colors hover:border-[var(--ft-border-strong)]"
              >
                <Icon name={other.icon} size={13} className="text-[var(--ft-text-faint)]" />
                {other.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface)] px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-[var(--ft-text-faint)]">{label}</dt>
      <dd className="mt-0.5 truncate text-sm" title={value}>
        {value}
      </dd>
    </div>
  );
}
