import { describe, expect, it } from "vitest";
import { MemoryStore, STORAGE_KEYS } from "@/core/storage";
import { createRecentsStore } from "@/features/recents/store";
import { createFavoritesStore } from "@/features/favorites/store";
import { createSettingsStore } from "@/features/settings/store";

/**
 * Ce que FourTout garde d'une session à l'autre.
 *
 * Trois clés seulement, et leur contenu est volontairement pauvre. Ce test
 * verrouille cette pauvreté : le jour où un outil voudra « se souvenir du
 * dernier fichier », ou un écran réseau « se souvenir des machines trouvées »,
 * il faudra passer par ici — et donc y réfléchir.
 *
 * Les données explicitement bannies sont celles que les phases précédentes ont
 * manipulées : secrets JWT, mots de passe d'archives, chemins de documents,
 * adresses matérielles, numéros de série de disque, identifiants de volume.
 */
describe("ce qui est écrit sur le disque entre deux sessions", () => {
  it("ne connaît que trois clés", () => {
    expect(Object.values(STORAGE_KEYS).sort()).toEqual(["favorites", "recents", "settings"]);
  });

  it("ne retient d'un outil ouvert que son identifiant et sa date", () => {
    const store = new MemoryStore();
    const recents = createRecentsStore(store);
    recents.getState().record("jwt-decode", 1_700_000_000_000);
    recents.getState().record("network-lan", 1_700_000_001_000);

    const written = store.get<Record<string, unknown>[]>(STORAGE_KEYS.recents, []);
    expect(written).toHaveLength(2);
    for (const entry of written) {
      // Rien d'autre que ces trois champs ne doit jamais être écrit ici.
      expect(Object.keys(entry).sort()).toEqual(["count", "openedAt", "toolId"]);
    }
  });

  it("ne retient des favoris que des identifiants d'outil", () => {
    const store = new MemoryStore();
    const favorites = createFavoritesStore(store);
    favorites.getState().toggle("pdf-merge");

    const written = store.get<unknown[]>(STORAGE_KEYS.favorites, []);
    expect(written).toEqual(["pdf-merge"]);
    expect(written.every((entry) => typeof entry === "string")).toBe(true);
  });

  it("ne retient des réglages que des préférences d'affichage", () => {
    const store = new MemoryStore();
    const settings = createSettingsStore(store);
    settings.getState().set("theme", "dark");

    const written = store.get<Record<string, unknown>>(STORAGE_KEYS.settings, {});
    expect(Object.keys(written).sort()).toEqual([
      "density",
      "motion",
      "showPrivacyNotes",
      "theme",
      "zoom",
    ]);
  });

  it("ne laisse filtrer aucun secret ni identifiant matériel", () => {
    const store = new MemoryStore();
    createRecentsStore(store).getState().record("jwt-decode");
    createFavoritesStore(store).getState().toggle("disk-inspect");
    createSettingsStore(store).getState().set("zoom", 1.1);

    const everything = Object.values(STORAGE_KEYS)
      .map((key) => JSON.stringify(store.get<unknown>(key, null)))
      .join(" ")
      .toLowerCase();

    for (const forbidden of [
      "password",
      "secret",
      "passphrase",
      "mot de passe",
      "serial",
      "uuid",
      "macaddress",
      "/home/",
      "c:\\\\",
      ".pdf",
      ".zip",
    ]) {
      expect(everything.includes(forbidden), `« ${forbidden} » persisté`).toBe(false);
    }
  });
});
