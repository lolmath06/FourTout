import { Suspense, useEffect, useMemo } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { getCategory } from "@/core/tools/categories";
import { toolRegistry } from "@/core/tools/registry";
import { categoryRoute } from "@/core/tools/types";
import { getToolComponent } from "@/tools/implementations";
import { useRecents } from "@/features/recents/store";
import { useSettings } from "@/features/settings/store";
import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/Badge";
import { Page } from "@/components/ui/PageHeader";
import { PrivacyNote } from "@/components/ui/PrivacyNote";
import { FavoriteButton } from "@/components/tools/FavoriteButton";
import { ToolPlaceholder } from "@/components/tools/ToolPlaceholder";
import { CapabilityList } from "@/components/tools/CapabilityList";

/**
 * Hôte générique des pages d'outil.
 *
 * Il fournit l'en-tête, les favoris, l'enregistrement dans les récents et le
 * rappel de confidentialité, puis délègue le contenu à l'implémentation de
 * l'outil — ou à la vue « bientôt disponible » s'il n'y en a pas encore.
 */
export function ToolPage() {
  const { toolId } = useParams();
  const record = useRecents((state) => state.record);
  const showPrivacyNotes = useSettings((state) => state.showPrivacyNotes);

  const tool = toolId ? toolRegistry.get(toolId) : undefined;
  const Implementation = useMemo(
    () => (tool ? getToolComponent(tool.id) : undefined),
    [tool],
  );

  useEffect(() => {
    if (tool) record(tool.id);
  }, [tool, record]);

  if (!tool) return <Navigate to="/tools" replace />;

  const category = getCategory(tool.category);
  const needsNetwork = tool.capabilities.includes("network");

  return (
    <Page>
      <div data-accent={category?.accent}>
        {category && (
          <Link
            to={categoryRoute(category.id)}
            className="mb-3 inline-flex items-center gap-1 text-xs text-[var(--ft-text-muted)] transition-colors hover:text-[var(--ft-text)]"
          >
            <Icon name="ArrowLeft" size={13} />
            {category.name}
          </Link>
        )}

        <header className="mb-5 flex items-start gap-3">
          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--ft-cat-soft)] text-[var(--ft-cat)]">
            <Icon name={tool.icon} size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight">{tool.name}</h1>
              <StatusBadge status={tool.status} />
            </div>
            <p className="mt-0.5 text-sm text-[var(--ft-text-muted)]">{tool.description}</p>
            <CapabilityList tool={tool} className="mt-2" />
          </div>
          <FavoriteButton toolId={tool.id} size={16} withLabel className="mt-0.5 border border-[var(--ft-border)] px-2.5" />
        </header>
      </div>

      {tool.note && (
        <p className="mb-4 flex items-start gap-2 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-xs text-[var(--ft-text-muted)]">
          <Icon name="Info" size={14} className="mt-px shrink-0" />
          {tool.note}
        </p>
      )}

      {Implementation ? (
        <Suspense
          fallback={
            <div className="flex items-center gap-2 p-8 text-sm text-[var(--ft-text-muted)]">
              <Icon name="Loader" size={15} className="animate-spin" />
              Chargement de l'outil…
            </div>
          }
        >
          <Implementation tool={tool} />
        </Suspense>
      ) : (
        <ToolPlaceholder tool={tool} />
      )}

      {showPrivacyNotes && (
        <div className="mt-6 border-t border-[var(--ft-border)] pt-3">
          <PrivacyNote requiresNetwork={needsNetwork} />
        </div>
      )}
    </Page>
  );
}
