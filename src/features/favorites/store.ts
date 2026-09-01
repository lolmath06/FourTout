import { create } from "zustand";
import { appStore, STORAGE_KEYS, type KeyValueStore } from "@/core/storage";
import { toolRegistry } from "@/core/tools/registry";
import type { ToolDefinition } from "@/core/tools/types";

/**
 * Favoris : liste d'identifiants d'outils, persistée localement.
 * On ne stocke que des ids — les métadonnées viennent toujours du registre,
 * de sorte qu'un outil renommé reste correctement affiché.
 */
interface FavoritesState {
  ids: string[];
  isFavorite: (toolId: string) => boolean;
  toggle: (toolId: string) => void;
  add: (toolId: string) => void;
  remove: (toolId: string) => void;
  clear: () => void;
  /** Outils favoris résolus via le registre (ids inconnus filtrés). */
  tools: () => ToolDefinition[];
}

function load(store: KeyValueStore): string[] {
  const raw = store.get<unknown>(STORAGE_KEYS.favorites, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && toolRegistry.has(id));
}

export function createFavoritesStore(store: KeyValueStore = appStore) {
  return create<FavoritesState>((set, get) => {
    const persist = (ids: string[]) => {
      store.set(STORAGE_KEYS.favorites, ids);
      set({ ids });
    };

    return {
      ids: load(store),
      isFavorite: (toolId) => get().ids.includes(toolId),
      add: (toolId) => {
        if (!toolRegistry.has(toolId) || get().ids.includes(toolId)) return;
        persist([...get().ids, toolId]);
      },
      remove: (toolId) => persist(get().ids.filter((id) => id !== toolId)),
      toggle: (toolId) => {
        const { ids } = get();
        if (ids.includes(toolId)) persist(ids.filter((id) => id !== toolId));
        else if (toolRegistry.has(toolId)) persist([...ids, toolId]);
      },
      clear: () => persist([]),
      tools: () => toolRegistry.resolveMany(get().ids),
    };
  });
}

export const useFavorites = createFavoritesStore();
