import { Suspense, useEffect, useMemo } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { getCategory } from "@/core/tools/categories";
import { toolRegistry } from "@/core/tools/registry";
import { categoryRoute } from "@/core/tools/types";
import { getToolComponent } from "@/tools/implementations";
import { useRecents } from "@/features/recents/store";
import { useSettings } from "@/features/settings/store";
import { Icon } from "@/components/ui/Icon";
import { Page } from "@/components/ui/PageHeader";
import { PrivacyNote } from "@/components/ui/PrivacyNote";
import { FavoriteButton } from "@/components/tools/FavoriteButton";
import { CapabilityList } from "@/components/tools/CapabilityList";

/**
 * Outils dont le contenu a réellement besoin de largeur : comparaison côte à
 * côte, rognage visuel, aperçu vidéo, tables techniques longues. Partout
 * ailleurs, une largeur de lecture bornée vaut mieux qu'un écran 1920 étalé.
 */
const WIDE_TOOLS = new Set([
  "text-compare",
  "code-diff",
  "pdf-compare",
  "image-crop",
  "video-crop",
  "pdf-edit-text",
  "pdf-add-text",
  "image-add-text",
  "file-find-duplicates",
  "folder-size",
  "folder-tree",
  "file-bulk-rename",
  "video-batch",
  "image-batch-convert",
]);

/**
 * Hôte générique des pages d'outil.
 *
 * Il fournit l'en-tête, les favoris, l'enregistrement dans les récents et le
 * rappel de confidentialité, puis délègue le contenu à l'implémentation de
 * l'outil. Figurer au catalogue, c'est fonctionner : un identifiant sans
 * implémentation n'est pas un outil « à venir », c'est un lien mort — il
 * ramène donc à la liste, comme un identifiant inconnu.
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

  if (!tool || !Implementation) return <Navigate to="/tools" replace />;

  const category = getCategory(tool.category);
  const needsNetwork = tool.capabilities.includes("network");

  return (
    <Page width={WIDE_TOOLS.has(tool.id) ? "wide" : "default"}>
      <div data-accent={category?.accent}>
        {/*
          En-tête compact : fil d'Ariane, identité, propriétés secondaires.
          Une seule ligne de métadonnées remplace la rangée de pastilles —
          l'information reste, l'encombrement disparaît.
        */}
        <div className="mb-1 flex items-center gap-2">
          {category && (
            <Link
              to={categoryRoute(category.id)}
              className="ft-meta inline-flex items-center gap-1 transition-colors hover:text-[var(--ft-text)]"
            >
              <Icon name="ArrowLeft" size={12} />
              {category.name}
            </Link>
          )}
        </div>

        <header className="mb-4 border-b border-[var(--ft-rule)] pb-3">
          <div className="flex items-center gap-2.5">
            <span className="shrink-0 text-[var(--ft-cat)]">
              <Icon name={tool.icon} size={17} />
            </span>
            <h1 className="ft-page-title min-w-0 flex-1 truncate">{tool.name}</h1>
            <FavoriteButton toolId={tool.id} size={14} />
          </div>
          <p className="mt-1 text-[13px] leading-5 text-[var(--ft-text-muted)]">
            {tool.description}
          </p>
          <CapabilityList tool={tool} className="mt-1.5" />
        </header>
      </div>

      {tool.note && (
        <p className="mb-4 flex items-start gap-2 border-l-2 border-[var(--ft-border-strong)] bg-[var(--ft-surface-2)] px-3 py-2 text-[11.5px] leading-5 text-[var(--ft-text-muted)]">
          <Icon name="Info" size={13} className="mt-px shrink-0" />
          {tool.note}
        </p>
      )}

      <Suspense
        fallback={
          <div className="ft-meta flex items-center gap-2 py-8">
            <Icon name="Loader" size={14} className="animate-spin" />
            Chargement de l'outil…
          </div>
        }
      >
        <Implementation tool={tool} />
      </Suspense>

      {showPrivacyNotes && (
        <div className="mt-6 border-t border-[var(--ft-rule)] pt-2.5">
          <PrivacyNote requiresNetwork={needsNetwork} />
        </div>
      )}
    </Page>
  );
}
