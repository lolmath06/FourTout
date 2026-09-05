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
      <div className="flex items-start gap-2.5 rounded-[var(--radius-card)] border border-dashed border-[var(--ft-border-strong)] bg-[var(--ft-surface)] px-3 py-3.5">
        <span className="mt-px shrink-0 text-[var(--ft-text-faint)]">
          <Icon name="Hammer" size={15} />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-medium">Cet outil arrive prochainement</p>
          <p className="ft-meta mt-1 max-w-xl leading-5">
            {tool.name} est inscrit au catalogue de FourTout et sera ajouté lors d'une prochaine
            mise à jour. Vous pouvez déjà l'ajouter à vos favoris pour le retrouver dès qu'il
            sera disponible.
          </p>
          {category && (
            <Link
              to={categoryRoute(category.id)}
              className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-[var(--ft-accent-text)] hover:underline"
            >
              Voir les autres outils {category.name}
              <Icon name="ArrowRight" size={12} />
            </Link>
          )}
        </div>
      </div>

      <dl className="ft-props rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] px-3 py-2">
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
          <h2 className="ft-section mb-1.5 border-b border-[var(--ft-rule)] pb-1.5">
            Outils voisins
          </h2>
          <div className="flex flex-wrap gap-1">
            {related.map((other) => (
              <Link
                key={other.id}
                to={toolRoute(other.id)}
                className="inline-flex h-[var(--ft-control-sm)] items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--ft-border)] bg-[var(--ft-surface)] px-2 text-xs transition-colors hover:bg-[var(--ft-hover)]"
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
    <>
      <dt>{label}</dt>
      <dd className="ft-value" title={value}>
        {value}
      </dd>
    </>
  );
}
