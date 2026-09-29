import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore, STORAGE_KEYS } from "@/core/storage";
import { createRecentsStore, MAX_RECENTS } from "./store";
import { toolRegistry } from "@/core/tools/registry";

describe("outils récents", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it("enregistre une ouverture d'outil", () => {
    const useRecents = createRecentsStore(store);
    useRecents.getState().record("pdf-compress", 1000);
    expect(useRecents.getState().entries).toEqual([
      { toolId: "pdf-compress", openedAt: 1000, count: 1 },
    ]);
  });

  it("place le dernier outil ouvert en tête sans le dupliquer", () => {
    const useRecents = createRecentsStore(store);
    useRecents.getState().record("pdf-merge", 1000);
    useRecents.getState().record("gif-to-video", 2000);
    useRecents.getState().record("pdf-merge", 3000);

    const entries = useRecents.getState().entries;
    expect(entries.map((entry) => entry.toolId)).toEqual(["pdf-merge", "gif-to-video"]);
    expect(entries[0]).toMatchObject({ openedAt: 3000, count: 2 });
  });

  it("limite la liste à MAX_RECENTS entrées", () => {
    const useRecents = createRecentsStore(store);
    const ids = toolRegistry.all().slice(0, MAX_RECENTS + 5).map((tool) => tool.id);
    ids.forEach((id, index) => useRecents.getState().record(id, index));

    const entries = useRecents.getState().entries;
    expect(entries).toHaveLength(MAX_RECENTS);
    expect(entries[0].toolId).toBe(ids[ids.length - 1]);
  });

  it("persiste entre deux démarrages", () => {
    createRecentsStore(store).getState().record("pdf-compress", 1000);
    expect(createRecentsStore(store).getState().entries[0].toolId).toBe("pdf-compress");
  });

  it("ignore un outil absent du registre", () => {
    const useRecents = createRecentsStore(store);
    useRecents.getState().record("outil-inexistant");
    expect(useRecents.getState().entries).toEqual([]);
  });

  it("écarte les entrées obsolètes ou malformées au chargement", () => {
    store.set(STORAGE_KEYS.recents, [
      { toolId: "pdf-merge", openedAt: 1, count: 1 },
      { toolId: "outil-supprime", openedAt: 2, count: 1 },
      { toolId: "pdf-split" },
      "n'importe quoi",
    ]);
    expect(createRecentsStore(store).getState().entries.map((e) => e.toolId)).toEqual([
      "pdf-merge",
    ]);
  });

  it("permet d'effacer l'historique", () => {
    const useRecents = createRecentsStore(store);
    useRecents.getState().record("pdf-merge");
    useRecents.getState().clear();
    expect(useRecents.getState().entries).toEqual([]);
    expect(createRecentsStore(store).getState().entries).toEqual([]);
  });
});
