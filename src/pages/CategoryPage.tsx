import { useMemo } from "react";
import { categoryDescription, categoryName } from "@/core/tools/localized";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { getCategory, isCategoryId } from "@/core/tools/categories";
import { toolRegistry } from "@/core/tools/registry";
import { searchTools } from "@/core/tools/search";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { ToolList } from "@/components/tools/ToolRow";
import { t } from "@/i18n";

export function CategoryPage() {
  const { categoryId } = useParams();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";

  const category = categoryId && isCategoryId(categoryId) ? getCategory(categoryId) : undefined;

  const tools = useMemo(() => {
    if (!category) return [];
    if (query.trim()) {
      return searchTools(query, { category: category.id, limit: 200 }).map(
        (result) => result.tool,
      );
    }
    return toolRegistry.byCategoryId(category.id);
  }, [category, query]);

  if (!category) return <Navigate to="/tools" replace />;

  const update = (next: { q: string }) => {
    const draft = new URLSearchParams(params);
    if (next.q) draft.set("q", next.q);
    else draft.delete("q");
    setParams(draft, { replace: true });
  };

  return (
    <Page width="wide">
      <div data-accent={category.accent}>
        <Link
          to="/tools"
          className="ft-meta mb-1 inline-flex items-center gap-1 transition-colors hover:text-[var(--ft-text)]"
        >
          <Icon name="ArrowLeft" size={12} />
          {t("Toutes les catégories")}
        </Link>

        <PageHeader
          icon={category.icon}
          title={categoryName(category)}
          description={categoryDescription(category)}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onChange={(value) => update({ q: value })}
          placeholder={t("Rechercher dans {name}…", { name: categoryName(category) })}
          className="min-w-64 flex-1"
        />
      </div>

      <p className="ft-meta ft-num mb-1.5">
        {tools.length} outil{tools.length > 1 ? "s" : ""}
      </p>

      {tools.length > 0 ? (
        <ToolList tools={tools} />
      ) : (
        <EmptyState
          icon="Search"
          title={t("Aucun outil ne correspond")}
          description={t("Modifiez votre recherche : FourTout n'invente pas de résultat.")}
        />
      )}
    </Page>
  );
}
