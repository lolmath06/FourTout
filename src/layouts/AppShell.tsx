import clsx from "clsx";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { SearchInput } from "@/components/ui/SearchInput";
import { ToastViewport } from "@/components/ui/ToastViewport";
import { useFavorites } from "@/features/favorites/store";
import { useRecents } from "@/features/recents/store";
import { applyTheme, useSettings } from "@/features/settings/store";
import { useActiveJobs } from "@/features/jobs/hooks";
import { toolRoute } from "@/core/tools/types";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  count?: number;
}

/**
 * Cadre de l'application : barre latérale de navigation, en-tête avec recherche
 * globale, zone de contenu et pile de notifications.
 */
export function AppShell() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const favorites = useFavorites((state) => state.ids);
  const recents = useRecents((state) => state.entries);
  const theme = useSettings((state) => state.theme);
  const activeJobs = useActiveJobs();

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyTheme("system");
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [theme]);

  // La fenêtre desktop peut être étroite : la barre latérale se replie.
  useEffect(() => {
    const onResize = () => setCollapsed(window.innerWidth < 900);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const items: NavItem[] = [
    { to: "/", label: "Accueil", icon: "Home" },
    { to: "/tools", label: "Outils", icon: "LayoutGrid" },
    { to: "/favorites", label: "Favoris", icon: "Star", count: favorites.length },
    { to: "/recents", label: "Récents", icon: "Clock3", count: recents.length },
    { to: "/settings", label: "Paramètres", icon: "Settings" },
  ];

  const submitSearch = () => {
    const trimmed = query.trim();
    navigate(trimmed ? `/tools?q=${encodeURIComponent(trimmed)}` : "/tools");
    setQuery("");
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-[var(--ft-bg)] text-[var(--ft-text)]">
      <aside
        className={clsx(
          "flex shrink-0 flex-col border-r border-[var(--ft-border)] bg-[var(--ft-chrome)] transition-[width]",
          collapsed ? "w-12" : "w-52",
        )}
      >
        <div
          className={clsx(
            "flex h-11 items-center gap-2 border-b border-[var(--ft-rule)] px-3",
            collapsed && "justify-center px-0",
          )}
        >
          <span className="shrink-0 text-[var(--ft-accent)]">
            <Icon name="Hammer" size={15} />
          </span>
          {!collapsed && (
            <span className="truncate text-[13px] font-semibold tracking-[-0.01em]">FourTout</span>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-px p-1.5" aria-label="Navigation principale">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                clsx(
                  "relative flex h-7 items-center gap-2.5 rounded-[var(--radius-sm)] px-2 text-[13px] transition-colors",
                  collapsed && "justify-center px-0",
                  isActive
                    // Sélection sobre : surface neutre + accent latéral de 2 px.
                    ? "bg-[var(--ft-surface-2)] font-medium text-[var(--ft-text)] before:absolute before:inset-y-1 before:left-0 before:w-[2px] before:rounded-full before:bg-[var(--ft-accent)]"
                    : "text-[var(--ft-text-muted)] hover:bg-[var(--ft-hover)] hover:text-[var(--ft-text)]",
                )
              }
            >
              <Icon name={item.icon} size={15} />
              {!collapsed && (
                <>
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.count !== undefined && item.count > 0 && (
                    <span className="ft-num shrink-0 text-[11px] text-[var(--ft-text-faint)]">
                      {item.count}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-px border-t border-[var(--ft-rule)] p-1.5">
          {activeJobs.length > 0 && (
            <button
              type="button"
              onClick={() => navigate(toolRoute(activeJobs[0].toolId))}
              title={
                collapsed
                  ? `${activeJobs.length} opération${activeJobs.length > 1 ? "s" : ""} en cours`
                  : undefined
              }
              className={clsx(
                "flex h-7 w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2 text-left text-xs text-[var(--ft-accent-text)] transition-colors hover:bg-[var(--ft-hover)]",
                collapsed && "justify-center px-0",
              )}
            >
              <Icon name="Loader" size={13} className="shrink-0 animate-spin" />
              {!collapsed && (
                <span className="flex-1 truncate">
                  {activeJobs.length} opération{activeJobs.length > 1 ? "s" : ""} en cours
                </span>
              )}
            </button>
          )}
          {!collapsed && (
            <p className="flex h-7 items-center gap-2.5 px-2 text-[11px] text-[var(--ft-text-faint)]">
              <Icon name="ShieldCheck" size={13} />
              Traitement local
            </p>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-3 border-b border-[var(--ft-border)] bg-[var(--ft-chrome)] px-3">
          <SearchInput
            value={query}
            onChange={setQuery}
            onSubmit={submitSearch}
            placeholder="Rechercher un outil…"
            aria-label="Rechercher un outil"
            className="max-w-sm flex-1"
          />
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <ToastViewport />
    </div>
  );
}
