import { useMemo } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { getCategory, isCategoryId } from "@/core/tools/categories";
import { toolRegistry } from "@/core/tools/registry";
import { searchTools } from "@/core/tools/search";
import type { ToolStatus } from "@/core/tools/types";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { ToolList } from "@/components/tools/ToolRow";
import { StatusFilter } from "@/components/tools/StatusFilter";

export function CategoryPage() {
  const { categoryId } = useParams();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const status = (params.get("status") as ToolStatus | null) ?? undefined;

  const category = categoryId && isCategoryId(categoryId) ? getCategory(categoryId) : undefined;

  const tools = useMemo(() => {
    if (!category) return [];
    if (query.trim() || status) {
      return searchTools(query, { category: category.id, status, limit: 200 }).map(
        (result) => result.tool,
      );
    }
    return toolRegistry.byCategoryId(category.id);
  }, [category, query, status]);

  if (!category) return <Navigate to="/tools" replace />;

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

  const availableCount = tools.filter((tool) => tool.status === "available").length;

  return (
    <Page width="wide">
      <div data-accent={category.accent}>
        <Link
          to="/tools"
          className="ft-meta mb-1 inline-flex items-center gap-1 transition-colors hover:text-[var(--ft-text)]"
        >
          <Icon name="ArrowLeft" size={12} />
          Toutes les catégories
        </Link>

        <PageHeader
          icon={category.icon}
          title={category.name}
          description={category.description}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onChange={(value) => update({ q: value })}
          placeholder={`Rechercher dans ${category.name}…`}
          className="min-w-64 flex-1"
        />
        <StatusFilter value={status} onChange={(next) => update({ status: next })} />
      </div>

      <p className="ft-meta ft-num mb-1.5">
        {tools.length} outil{tools.length > 1 ? "s" : ""}
        {availableCount > 0 && ` · ${availableCount} disponible${availableCount > 1 ? "s" : ""}`}
      </p>

      {tools.length > 0 ? (
        <ToolList tools={tools} />
      ) : (
        <EmptyState
          icon="Search"
          title="Aucun outil dans cette sélection"
          description="Modifiez votre recherche ou retirez le filtre de disponibilité."
        />
      )}
    </Page>
  );
}
