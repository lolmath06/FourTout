import type { RouteObject } from "react-router-dom";
import { AppShell } from "@/layouts/AppShell";
import { HomePage } from "@/pages/HomePage";
import { ToolsPage } from "@/pages/ToolsPage";
import { CategoryPage } from "@/pages/CategoryPage";
import { ToolPage } from "@/pages/ToolPage";
import { FavoritesPage } from "@/pages/FavoritesPage";
import { RecentsPage } from "@/pages/RecentsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

/**
 * Arborescence de navigation.
 *
 * `/tools/t/:toolId` est volontairement distinct de `/tools/:categoryId` :
 * un outil peut appartenir à plusieurs catégories, sa route ne doit donc pas
 * dépendre d'une catégorie en particulier.
 */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "tools", element: <ToolsPage /> },
      { path: "tools/t/:toolId", element: <ToolPage /> },
      { path: "tools/:categoryId", element: <CategoryPage /> },
      { path: "favorites", element: <FavoritesPage /> },
      { path: "recents", element: <RecentsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
