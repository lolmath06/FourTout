import { create } from "zustand";
import { appStore, STORAGE_KEYS, type KeyValueStore } from "@/core/storage";
import { clampZoom, ZOOM_DEFAULT } from "@/core/ui/zoom";

export type ThemePreference = "system" | "light" | "dark";
/** Densité : la passe visuelle « utilitaire desktop » définit `compact`. */
export type DensityPreference = "compact" | "comfortable";
export type MotionPreference = "normal" | "reduced";

export interface Settings {
  theme: ThemePreference;
  /**
   * Échelle de l'interface, de 0,8 à 1,5. Une seule préférence globale : le
   * zoom n'est jamais mémorisé par page, comme dans n'importe quel logiciel.
   */
  zoom: number;
  density: DensityPreference;
  motion: MotionPreference;
  /** Affiche le rappel « traitement local » sur les pages d'outil. */
  showPrivacyNotes: boolean;
}

const DEFAULTS: Settings = {
  theme: "system",
  zoom: ZOOM_DEFAULT,
  density: "compact",
  motion: "normal",
  showPrivacyNotes: true,
};

/** Préférences remises à zéro par « Réinitialiser les préférences d'interface ». */
export const APPEARANCE_DEFAULTS = {
  theme: DEFAULTS.theme,
  zoom: DEFAULTS.zoom,
  density: DEFAULTS.density,
  motion: DEFAULTS.motion,
} as const;

interface SettingsState extends Settings {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  /** Remet l'apparence par défaut sans toucher aux favoris, récents ni modèles. */
  resetAppearance: () => void;
  reset: () => void;
}

function load(store: KeyValueStore): Settings {
  const raw = store.get<Partial<Settings>>(STORAGE_KEYS.settings, {});
  return {
    theme: raw?.theme === "light" || raw?.theme === "dark" ? raw.theme : DEFAULTS.theme,
    zoom: typeof raw?.zoom === "number" ? clampZoom(raw.zoom) : DEFAULTS.zoom,
    density: raw?.density === "comfortable" ? "comfortable" : DEFAULTS.density,
    motion: raw?.motion === "reduced" ? "reduced" : DEFAULTS.motion,
    showPrivacyNotes:
      typeof raw?.showPrivacyNotes === "boolean"
        ? raw.showPrivacyNotes
        : DEFAULTS.showPrivacyNotes,
  };
}

function persist(store: KeyValueStore, state: Settings): void {
  const { theme, zoom, density, motion, showPrivacyNotes } = state;
  store.set(STORAGE_KEYS.settings, { theme, zoom, density, motion, showPrivacyNotes });
}

export function createSettingsStore(store: KeyValueStore = appStore) {
  return create<SettingsState>((set, get) => ({
    ...load(store),
    set: (key, value) => {
      const next = key === "zoom" ? (clampZoom(value as number) as Settings[typeof key]) : value;
      set({ [key]: next } as Pick<Settings, typeof key>);
      persist(store, get());
    },
    resetAppearance: () => {
      set(APPEARANCE_DEFAULTS);
      persist(store, get());
    },
    reset: () => {
      set(DEFAULTS);
      persist(store, get());
    },
  }));
}

export const useSettings = createSettingsStore();

/** Applique la préférence de thème au document. */
export function applyTheme(preference: ThemePreference): void {
  if (typeof document === "undefined") return;
  const prefersDark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = preference === "dark" || (preference === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
}

/**
 * Densité et animations passent par des attributs sur la racine : les jetons
 * CSS s'y accrochent, aucun composant n'a besoin de connaître le réglage.
 */
export function applyDensity(preference: DensityPreference): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.density = preference;
}

export function applyMotion(preference: MotionPreference): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.motion = preference;
}
