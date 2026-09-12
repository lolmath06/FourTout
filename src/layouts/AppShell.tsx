import clsx from "clsx";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { ToastViewport } from "@/components/ui/ToastViewport";
import { useFavorites } from "@/features/favorites/store";
import { useRecents } from "@/features/recents/store";
import { useUiScale } from "@/features/settings/useUiScale";
import { useActiveJobs } from "@/features/jobs/hooks";
import { toolRoute } from "@/core/tools/types";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  count?: number;
}

/**
 * Cadre de l'application : barre latérale de navigation, zone de contenu et
 * pile de notifications.
 *
 * Pas de barre de recherche en en-tête. Elle doublait celle de la page Outils
 * sans rien ajouter — la même requête, sur le même catalogue — tout en prenant
 * le focus sur chaque écran, y compris ceux où il n'y a rien à chercher. La
 * recherche vit là où sont les outils ; la ligne d'en-tête disparaît avec elle
 * plutôt que de laisser une bande vide.
 */
export function AppShell() {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const favorites = useFavorites((state) => state.ids);
  const recents = useRecents((state) => state.entries);
  const activeJobs = useActiveJobs();

  // Thème, échelle, densité, animations et raccourcis de zoom : un seul point
  // de montage pour toute l'application.
  useUiScale();

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
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <ToastViewport />
    </div>
  );
}
