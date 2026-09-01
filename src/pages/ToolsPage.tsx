import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { toolRegistry } from "@/core/tools/registry";
import { searchTools } from "@/core/tools/search";
import type { ToolStatus } from "@/core/tools/types";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { EmptyState } from "@/components/ui/EmptyState";
import { CategoryTile } from "@/components/tools/CategoryTile";
import { ToolList } from "@/components/tools/ToolRow";
import { StatusFilter } from "@/components/tools/StatusFilter";

/**
 * Page Outils : vue d'ensemble des catégories, et recherche transversale.
 * L'état (requête, filtre) vit dans l'URL pour que la navigation arrière et
 * les liens partagés fonctionnent naturellement.
 */
export function ToolsPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const status = (params.get("status") as ToolStatus | null) ?? undefined;

  const update = (next: { q?: string; status?: ToolStatus | undefined }) => {
    const draft = new URLSearchParams(params);
    if (next.q !== undefined) {
      if (next.q) draft.set("q", next.q);
      else draft.delete("q");
    }
    if ("status" in next) {
      if (next.status) draft.set("status", next.status);
      else draft.delete("status");
    }
    setParams(draft, { replace: true });
  };

  const categories = useMemo(() => toolRegistry.categories(), []);
  const counts = useMemo(() => toolRegistry.countsByCategory(), []);

  const results = useMemo(
    () => searchTools(query, { limit: 200, status }),
    [query, status],
  );

  const isSearching = query.trim().length > 0 || status !== undefined;

  return (
    <Page>
      <PageHeader
        icon="LayoutGrid"
        title="Outils"
        description={`${toolRegistry.all().length} outils répartis en ${categories.length} catégories.`}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onChange={(value) => update({ q: value })}
          placeholder="Rechercher : « réduire taille pdf », « gif en vidéo »…"
          className="min-w-64 flex-1"
        />
        <StatusFilter value={status} onChange={(next) => update({ status: next })} />
      </div>

      {isSearching ? (
        results.length > 0 ? (
          <>
            <p className="mb-2 text-xs text-[var(--ft-text-muted)]">
              {results.length} résultat{results.length > 1 ? "s" : ""}
            </p>
            <ToolList tools={results.map((result) => result.tool)} showCategory />
          </>
        ) : (
          <EmptyState
            icon="Search"
            title="Aucun outil ne correspond"
            description={`FourTout n'a rien trouvé pour « ${query} ». Le catalogue ne contient peut-être pas encore cet outil — rien n'est inventé.`}
          />
        )
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {categories.map((category) => (
            <CategoryTile
              key={category.id}
              category={category}
              count={counts[category.id]}
              availableCount={
                toolRegistry
                  .byCategoryId(category.id)
                  .filter((tool) => tool.status === "available").length
              }
            />
          ))}
        </div>
      )}
    </Page>
  );
}
