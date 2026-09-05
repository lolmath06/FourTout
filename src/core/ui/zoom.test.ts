import { beforeEach, describe, expect, it } from "vitest";
import { createSettingsStore } from "@/features/settings/store";
import { MemoryStore } from "@/core/storage";
import {
  applyZoom,
  clampZoom,
  formatZoom,
  stepZoom,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEPS,
} from "./zoom";

describe("échelle de l'interface", () => {
  it("propose une échelle finie de 80 % à 150 %", () => {
    expect(ZOOM_MIN).toBe(0.8);
    expect(ZOOM_MAX).toBe(1.5);
    expect(ZOOM_STEPS).toContain(1);
    // Aucun doublon, et une progression strictement croissante.
    expect([...ZOOM_STEPS].sort((a, b) => a - b)).toEqual([...ZOOM_STEPS]);
    expect(new Set(ZOOM_STEPS).size).toBe(ZOOM_STEPS.length);
  });

  it("ramène toute valeur sur un cran de l'échelle, bornes comprises", () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
    expect(clampZoom(9)).toBe(ZOOM_MAX);
    expect(clampZoom(1.07)).toBe(1.05);
    expect(clampZoom(1.13)).toBe(1.15);
    // Une valeur corrompue en stockage ne doit pas casser l'interface.
    expect(clampZoom(Number.NaN)).toBe(ZOOM_DEFAULT);
  });

  it("avance de deux crans au clavier et d'un cran à la molette", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(1, 1, 1)).toBe(1.05);
    expect(stepZoom(1, -1, 1)).toBe(0.95);
  });

  it("ne dépasse jamais les bornes, même en insistant", () => {
    let value = ZOOM_DEFAULT;
    for (let i = 0; i < 50; i += 1) value = stepZoom(value, 1);
    expect(value).toBe(ZOOM_MAX);
    for (let i = 0; i < 50; i += 1) value = stepZoom(value, -1);
    expect(value).toBe(ZOOM_MIN);
  });

  it("s'affiche en pourcentage entier", () => {
    expect(formatZoom(1)).toBe("100 %");
    expect(formatZoom(1.15)).toBe("115 %");
    expect(formatZoom(0.8)).toBe("80 %");
  });

  it("met à l'échelle par remise en page, jamais par transformation", async () => {
    await applyZoom(1.25);
    // `zoom` remet la page en page ; `transform` la déformerait et fausserait
    // les coordonnées de pointeur des outils de rognage.
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--ft-zoom")).toBe("1.25");
    expect(root.style.transform).toBe("");

    await applyZoom(1);
    expect(root.style.getPropertyValue("--ft-zoom")).toBe("");
  });
});

describe("persistance de l'échelle", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it("survit à un redémarrage de l'application", () => {
    const first = createSettingsStore(store);
    first.getState().set("zoom", 1.25);
    first.getState().set("density", "comfortable");
    first.getState().set("motion", "reduced");

    // Nouveau démarrage : le store est reconstruit depuis la persistance.
    const second = createSettingsStore(store);
    expect(second.getState().zoom).toBe(1.25);
    expect(second.getState().density).toBe("comfortable");
    expect(second.getState().motion).toBe("reduced");
  });

  it("n'accepte jamais une valeur hors échelle venue du stockage", () => {
    store.set("settings", { zoom: 42 });
    expect(createSettingsStore(store).getState().zoom).toBe(ZOOM_MAX);

    store.set("settings", { zoom: "grand" });
    expect(createSettingsStore(store).getState().zoom).toBe(ZOOM_DEFAULT);
  });

  it("réinitialise l'apparence sans toucher aux autres préférences", () => {
    const settings = createSettingsStore(store);
    settings.getState().set("zoom", 1.4);
    settings.getState().set("showPrivacyNotes", false);

    settings.getState().resetAppearance();

    expect(settings.getState().zoom).toBe(ZOOM_DEFAULT);
    expect(settings.getState().theme).toBe("system");
    // Le bouton ne touche qu'à l'apparence : ce réglage-ci doit survivre.
    expect(settings.getState().showPrivacyNotes).toBe(false);
  });
});
