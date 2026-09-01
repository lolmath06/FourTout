import clsx from "clsx";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { SearchInput } from "@/components/ui/SearchInput";
import { ToastViewport } from "@/components/ui/ToastViewport";
import { useFavorites } from "@/features/favorites/store";
import { useRecents } from "@/features/recents/store";
import { applyTheme, useSettings } from "@/features/settings/store";

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
          "flex shrink-0 flex-col border-r border-[var(--ft-border)] bg-[var(--ft-surface)] transition-[width]",
          collapsed ? "w-14" : "w-56",
        )}
      >
        <div className={clsx("flex h-14 items-center gap-2 px-3", collapsed && "justify-center")}>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--ft-accent)] text-white">
            <Icon name="Hammer" size={15} />
          </span>
          {!collapsed && (
            <span className="truncate text-[15px] font-semibold tracking-tight">FourTout</span>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-2" aria-label="Navigation principale">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                  collapsed && "justify-center px-0",
                  isActive
                    ? "bg-[var(--ft-accent-soft)] font-medium text-[var(--ft-accent-text)]"
                    : "text-[var(--ft-text-muted)] hover:bg-[var(--ft-surface-2)] hover:text-[var(--ft-text)]",
                )
              }
            >
              <Icon name={item.icon} size={16} />
              {!collapsed && (
                <>
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.count !== undefined && item.count > 0 && (
                    <span className="rounded bg-[var(--ft-surface-2)] px-1.5 text-[11px] tabular-nums text-[var(--ft-text-muted)]">
                      {item.count}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="p-2">
          {!collapsed && (
            <p className="flex items-center gap-1.5 rounded-md px-2.5 py-2 text-[11px] leading-4 text-[var(--ft-text-faint)]">
              <Icon name="ShieldCheck" size={13} />
              Traitement local
            </p>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--ft-border)] bg-[var(--ft-surface)] px-4">
          <SearchInput
            value={query}
            onChange={setQuery}
            onSubmit={submitSearch}
            placeholder="Rechercher un outil…"
            aria-label="Rechercher un outil"
            className="max-w-md flex-1"
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
