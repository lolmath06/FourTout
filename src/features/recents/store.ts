import { create } from "zustand";
import { appStore, STORAGE_KEYS, type KeyValueStore } from "@/core/storage";
import { toolRegistry } from "@/core/tools/registry";
import type { ToolDefinition } from "@/core/tools/types";

/** Nombre d'entrées conservées : au-delà, la liste cesse d'être utile. */
export const MAX_RECENTS = 12;

export interface RecentEntry {
  toolId: string;
  /** Horodatage de la dernière ouverture (ms). */
  openedAt: number;
  /** Nombre total d'ouvertures, utile pour de futures suggestions. */
  count: number;
}

interface RecentsState {
  entries: RecentEntry[];
  record: (toolId: string, at?: number) => void;
  remove: (toolId: string) => void;
  clear: () => void;
  /** Entrées résolues en outils, plus récent d'abord. */
  tools: () => ToolDefinition[];
}

function load(store: KeyValueStore): RecentEntry[] {
  const raw = store.get<unknown>(STORAGE_KEYS.recents, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is RecentEntry =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as RecentEntry).toolId === "string" &&
      typeof (entry as RecentEntry).openedAt === "number",
    )
    .filter((entry) => toolRegistry.has(entry.toolId))
    .slice(0, MAX_RECENTS);
}

export function createRecentsStore(store: KeyValueStore = appStore) {
  return create<RecentsState>((set, get) => {
    const persist = (entries: RecentEntry[]) => {
      store.set(STORAGE_KEYS.recents, entries);
      set({ entries });
    };

    return {
      entries: load(store),
      record: (toolId, at = Date.now()) => {
        if (!toolRegistry.has(toolId)) return;
        const existing = get().entries.find((entry) => entry.toolId === toolId);
        const others = get().entries.filter((entry) => entry.toolId !== toolId);
        const updated: RecentEntry = {
          toolId,
          openedAt: at,
          count: (existing?.count ?? 0) + 1,
        };
        persist([updated, ...others].slice(0, MAX_RECENTS));
      },
      remove: (toolId) => persist(get().entries.filter((entry) => entry.toolId !== toolId)),
      clear: () => persist([]),
      tools: () => toolRegistry.resolveMany(get().entries.map((entry) => entry.toolId)),
    };
  });
}

export const useRecents = createRecentsStore();
