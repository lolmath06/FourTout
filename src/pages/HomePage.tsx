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
  "Je veux réduire la taille d'un PDF",
  "Transformer un GIF en vidéo",
  "Convertir cette image en WebP",
  "Extraire le son d'une vidéo",
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
  const availableCount = useMemo(() => toolRegistry.withStatus("available").length, []);

  const openFirst = () => {
    const first = intent?.candidates[0];
    if (first) navigate(toolRoute(first.tool.id));
  };

  return (
    <Page>
      <section className="mx-auto max-w-3xl pb-2 pt-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Que voulez-vous faire ?</h1>
        <p className="mt-1.5 text-sm text-[var(--ft-text-muted)]">
          Décrivez votre besoin en langage courant : FourTout vous propose l'outil correspondant.
        </p>

        <div className="mt-5 flex items-center gap-2 rounded-xl border border-[var(--ft-border)] bg-[var(--ft-surface)] px-4 py-3 shadow-[var(--ft-shadow)] focus-within:border-[var(--ft-accent)]">
          <Icon name="Sparkles" size={18} className="shrink-0 text-[var(--ft-accent)]" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") openFirst();
              if (event.key === "Escape") setQuery("");
            }}
            placeholder="Je veux réduire la taille d'un PDF…"
            aria-label="Décrivez ce que vous voulez faire"
            data-testid="home-intent-input"
            className="w-full bg-transparent text-base outline-none placeholder:text-[var(--ft-text-faint)]"
          />
          {query && (
            <button
              type="button"
              aria-label="Effacer"
              onClick={() => setQuery("")}
              className="shrink-0 rounded p-1 text-[var(--ft-text-faint)] hover:text-[var(--ft-text)]"
            >
              <Icon name="X" size={15} />
            </button>
          )}
        </div>

        {!intent && (
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setQuery(example)}
                className="rounded-full border border-[var(--ft-border)] px-3 py-1 text-xs text-[var(--ft-text-muted)] transition-colors hover:border-[var(--ft-accent)] hover:text-[var(--ft-text)]"
              >
                {example}
              </button>
            ))}
          </div>
        )}
      </section>

      {intent && (
        <section className="mx-auto mt-4 max-w-3xl" data-testid="intent-results">
          {intent.outcome === "no-match" ? (
            <div className="flex items-start gap-2.5 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-4 text-left">
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
              <p className="mb-2 text-left text-xs text-[var(--ft-text-muted)]">
                {intent.outcome === "match"
                  ? "Outil correspondant :"
                  : "Plusieurs outils peuvent convenir :"}
              </p>
              <div className="flex flex-col gap-1.5">
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
            <section className="mt-8 grid gap-6 md:grid-cols-2">
              {favorites.length > 0 && (
                <div>
                  <SectionTitle icon="Star" title="Favoris" to="/favorites" />
                  <div className="flex flex-col gap-1.5">
                    {favorites.map((tool) => (
                      <ToolRow key={tool.id} tool={tool} showCategory />
                    ))}
                  </div>
                </div>
              )}
              {recents.length > 0 && (
                <div>
                  <SectionTitle icon="Clock3" title="Récemment utilisés" to="/recents" />
                  <div className="flex flex-col gap-1.5">
                    {recents.map((tool) => (
                      <ToolRow key={tool.id} tool={tool} showCategory />
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="mt-8">
            <SectionTitle icon="LayoutGrid" title="Catégories" to="/tools" />
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {categories.map((category) => (
                <Link
                  key={category.id}
                  to={`/tools/${category.id}`}
                  data-accent={category.accent}
                  className="flex items-center gap-2.5 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] px-3 py-2.5 transition-colors hover:border-[var(--ft-cat)]"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--ft-cat-soft)] text-[var(--ft-cat)]">
                    <Icon name={category.icon} size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{category.name}</span>
                    <span className="block text-[11px] text-[var(--ft-text-faint)]">
                      {counts[category.id]} outils
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <p className="mt-8 flex items-center justify-center gap-1.5 text-xs text-[var(--ft-text-faint)]">
            <Icon name="ShieldCheck" size={13} />
            {toolRegistry.all().length} outils au catalogue, dont {availableCount} déjà utilisables —
            traitement local, vos fichiers restent sur votre appareil.
          </p>
        </>
      )}
    </Page>
  );
}

function SectionTitle({ icon, title, to }: { icon: string; title: string; to: string }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ft-text-muted)]">
        <Icon name={icon} size={13} />
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
