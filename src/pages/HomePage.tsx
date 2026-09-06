import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { resolveToolIntentSync } from "@/core/intent";
import type { IntentResult } from "@/core/intent";
import { toolRegistry } from "@/core/tools/registry";
import { toolRoute } from "@/core/tools/types";
import { Icon } from "@/components/ui/Icon";
import { Page } from "@/components/ui/PageHeader";
import { ToolRow } from "@/components/tools/ToolRow";
import { useFavorites } from "@/features/favorites/store";
import { useRecents } from "@/features/recents/store";

const EXAMPLES = [
  "réduire la taille d'un PDF",
  "gif en vidéo",
  "image en webp",
  "extraire le son d'une vidéo",
];

/**
 * Accueil : la zone « Que voulez-vous faire ? » est branchée sur
 * `resolveToolIntent`. Aujourd'hui la résolution est déterministe ; quand
 * l'assistant local arrivera, seul le résolveur changera, pas cette page.
 */
export function HomePage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const favoriteIds = useFavorites((state) => state.ids);
  const recentEntries = useRecents((state) => state.entries);

  const intent: IntentResult | null = useMemo(
    () => (query.trim().length === 0 ? null : resolveToolIntentSync(query)),
    [query],
  );

  const favorites = useMemo(
    () => toolRegistry.resolveMany(favoriteIds).slice(0, 4),
    [favoriteIds],
  );
  const recents = useMemo(
    () => toolRegistry.resolveMany(recentEntries.map((entry) => entry.toolId)).slice(0, 4),
    [recentEntries],
  );
  const categories = useMemo(() => toolRegistry.categories(), []);
  const counts = useMemo(() => toolRegistry.countsByCategory(), []);

  const openFirst = () => {
    const first = intent?.candidates[0];
    if (first) navigate(toolRoute(first.tool.id));
  };

  return (
    <Page>
      <section className="pb-1">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="ft-page-title">Que voulez-vous faire ?</h1>
          <p className="ft-meta hidden truncate sm:block">
            Décrivez votre besoin en langage courant.
          </p>
        </div>

        <div className="mt-2 flex h-[var(--ft-control-lg)] items-center gap-2 rounded-[var(--radius-md)] border border-[var(--ft-border-strong)] bg-[var(--ft-bg)] px-2.5 focus-within:border-[var(--ft-accent)]">
          <Icon name="Search" size={15} className="shrink-0 text-[var(--ft-text-faint)]" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") openFirst();
              if (event.key === "Escape") setQuery("");
            }}
            placeholder="Réduire la taille d'un PDF, extraire le son d'une vidéo…"
            aria-label="Décrivez ce que vous voulez faire"
            data-testid="home-intent-input"
            className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--ft-text-faint)]"
          />
          {query && (
            <button
              type="button"
              aria-label="Effacer"
              onClick={() => setQuery("")}
              className="shrink-0 rounded-[var(--radius-sm)] p-0.5 text-[var(--ft-text-faint)] hover:text-[var(--ft-text)]"
            >
              <Icon name="X" size={13} />
            </button>
          )}
        </div>

        {!intent && (
          <div className="ft-meta mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="text-[var(--ft-text-faint)]">Exemples :</span>
            {EXAMPLES.map((example, index) => (
              <span key={example} className="flex items-center gap-1.5">
                {index > 0 && <span className="text-[var(--ft-text-faint)]">·</span>}
                <button
                  type="button"
                  onClick={() => setQuery(example)}
                  className="rounded-[var(--radius-sm)] text-[var(--ft-text-muted)] underline decoration-[var(--ft-border-strong)] underline-offset-2 transition-colors hover:text-[var(--ft-accent-text)]"
                >
                  {example}
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {intent && (
        <section className="mt-4" data-testid="intent-results">
          {intent.outcome === "no-match" ? (
            <div className="flex items-start gap-2.5 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3 text-left">
              <Icon name="CircleAlert" size={16} className="mt-0.5 shrink-0 text-[var(--ft-warn)]" />
              <div>
                <p className="text-sm font-medium">Aucun outil ne correspond</p>
                <p className="mt-0.5 text-xs text-[var(--ft-text-muted)]">
                  {intent.message} FourTout ne propose que des outils réellement présents au
                  catalogue. Essayez d'autres mots, ou{" "}
                  <Link to="/tools" className="text-[var(--ft-accent-text)] underline">
                    parcourez les catégories
                  </Link>
                  .
                </p>
              </div>
            </div>
          ) : (
            <>
              <h2 className="ft-section mb-1.5">
                {intent.outcome === "match" ? "Outil correspondant" : "Plusieurs outils peuvent convenir"}
              </h2>
              <div className="divide-y divide-[var(--ft-rule)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
                {intent.candidates.map((candidate) => (
                  <ToolRow
                    key={candidate.tool.id}
                    tool={candidate.tool}
                    showCategory
                    trailing={
                      <span className="hidden shrink-0 text-[11px] text-[var(--ft-text-faint)] sm:block">
                        {candidate.reason}
                      </span>
                    }
                  />
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {!intent && (
        <>
          {(favorites.length > 0 || recents.length > 0) && (
            <section className="mt-6 grid gap-5 md:grid-cols-2">
              {favorites.length > 0 && (
                <div>
                  <SectionTitle icon="Star" title="Favoris" to="/favorites" />
                  <div className="divide-y divide-[var(--ft-rule)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
                    {favorites.map((tool) => (
                      <ToolRow key={tool.id} tool={tool} showCategory />
                    ))}
                  </div>
                </div>
              )}
              {recents.length > 0 && (
                <div>
                  <SectionTitle icon="Clock3" title="Récemment utilisés" to="/recents" />
                  <div className="divide-y divide-[var(--ft-rule)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
                    {recents.map((tool) => (
                      <ToolRow key={tool.id} tool={tool} showCategory />
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="mt-6">
            <SectionTitle icon="LayoutGrid" title="Catégories" to="/tools" />
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {categories.map((category) => (
                <Link
                  key={category.id}
                  to={`/tools/${category.id}`}
                  data-accent={category.accent}
                  className="relative flex items-center gap-2.5 overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] py-2 pl-3 pr-2.5 transition-colors hover:bg-[var(--ft-hover)]"
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-[2px] bg-[var(--ft-cat)] opacity-70"
                  />
                  <span className="shrink-0 text-[var(--ft-cat)]">
                    <Icon name={category.icon} size={15} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {category.name}
                  </span>
                  <span className="ft-num shrink-0 text-[11px] text-[var(--ft-text-faint)]">
                    {counts[category.id]}
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <p className="mt-6 flex items-center gap-1.5 border-t border-[var(--ft-rule)] pt-3 text-[11.5px] text-[var(--ft-text-faint)]">
            <Icon name="ShieldCheck" size={13} />
            {toolRegistry.all().length} outils, tous utilisables — traitement local, vos fichiers
            restent sur votre appareil.
          </p>
        </>
      )}
    </Page>
  );
}

function SectionTitle({ icon, title, to }: { icon: string; title: string; to: string }) {
  return (
    <div className="mb-1.5 flex items-center justify-between border-b border-[var(--ft-rule)] pb-1.5">
      <h2 className="ft-section flex items-center gap-1.5">
        <Icon name={icon} size={12} />
        {title}
      </h2>
      <Link
        to={to}
        className="text-xs text-[var(--ft-text-faint)] transition-colors hover:text-[var(--ft-accent-text)]"
      >
        Tout voir
      </Link>
    </div>
  );
}
