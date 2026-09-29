import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore, STORAGE_KEYS } from "@/core/storage";
import { createFavoritesStore } from "./store";

describe("favoris", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it("ajoute et retire un outil", () => {
    const useFavorites = createFavoritesStore(store);
    const { toggle } = useFavorites.getState();

    toggle("pdf-compress");
    expect(useFavorites.getState().ids).toEqual(["pdf-compress"]);
    expect(useFavorites.getState().isFavorite("pdf-compress")).toBe(true);

    toggle("pdf-compress");
    expect(useFavorites.getState().ids).toEqual([]);
  });

  it("persiste dans le stockage local", () => {
    const first = createFavoritesStore(store);
    first.getState().add("pdf-compress");
    first.getState().add("gif-to-video");

    // Simule un redémarrage de l'application : nouveau store, même stockage.
    const second = createFavoritesStore(store);
    expect(second.getState().ids).toEqual(["pdf-compress", "gif-to-video"]);
  });

  it("n'ajoute jamais deux fois le même outil", () => {
    const useFavorites = createFavoritesStore(store);
    useFavorites.getState().add("pdf-merge");
    useFavorites.getState().add("pdf-merge");
    expect(useFavorites.getState().ids).toEqual(["pdf-merge"]);
  });

  it("refuse un identifiant absent du registre", () => {
    const useFavorites = createFavoritesStore(store);
    useFavorites.getState().add("outil-inexistant");
    useFavorites.getState().toggle("outil-inexistant");
    expect(useFavorites.getState().ids).toEqual([]);
  });

  it("nettoie les identifiants obsolètes au chargement", () => {
    store.set(STORAGE_KEYS.favorites, ["pdf-merge", "outil-supprime", 42]);
    expect(createFavoritesStore(store).getState().ids).toEqual(["pdf-merge"]);
  });

  it("survit à un stockage corrompu", () => {
    store.set(STORAGE_KEYS.favorites, "pas-un-tableau");
    expect(createFavoritesStore(store).getState().ids).toEqual([]);
  });

  it("résout les favoris en outils du registre", () => {
    const useFavorites = createFavoritesStore(store);
    useFavorites.getState().add("pdf-compress");
    expect(useFavorites.getState().tools().map((tool) => tool.name)).toEqual([
      "Compresser un PDF",
    ]);
  });

  it("vide la liste", () => {
    const useFavorites = createFavoritesStore(store);
    useFavorites.getState().add("pdf-merge");
    useFavorites.getState().clear();
    expect(useFavorites.getState().ids).toEqual([]);
    expect(createFavoritesStore(store).getState().ids).toEqual([]);
  });
});
