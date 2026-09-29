import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { toolRegistry } from "@/core/tools/registry";
import { searchTools } from "@/core/tools/search";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { EmptyState } from "@/components/ui/EmptyState";
import { CategoryTile } from "@/components/tools/CategoryTile";
import { ToolList } from "@/components/tools/ToolRow";

/**
 * Page Outils : vue d'ensemble des catégories, et recherche transversale.
 * L'état (requête, filtre) vit dans l'URL pour que la navigation arrière et
 * les liens partagés fonctionnent naturellement.
 */
export function ToolsPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";

  const update = (next: { q: string }) => {
    const draft = new URLSearchParams(params);
    if (next.q) draft.set("q", next.q);
    else draft.delete("q");
    setParams(draft, { replace: true });
  };

  const categories = useMemo(() => toolRegistry.categories(), []);
  const counts = useMemo(() => toolRegistry.countsByCategory(), []);

  const results = useMemo(() => searchTools(query, { limit: 200 }), [query]);

  const isSearching = query.trim().length > 0;

  return (
    <Page width="wide">
      <PageHeader
        icon="LayoutGrid"
        title="Outils"
        description={`${toolRegistry.all().length} outils répartis en ${categories.length} catégories.`}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onChange={(value) => update({ q: value })}
          placeholder="Rechercher : « réduire taille pdf », « gif en vidéo »…"
          className="min-w-64 flex-1"
        />
      </div>

      {isSearching ? (
        results.length > 0 ? (
          <>
            <p className="ft-meta ft-num mb-1.5">
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
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {categories.map((category) => (
            <CategoryTile
              key={category.id}
              category={category}
              count={counts[category.id]}
            />
          ))}
        </div>
      )}
    </Page>
  );
}
