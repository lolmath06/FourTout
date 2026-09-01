import { create } from "zustand";
import { appStore, STORAGE_KEYS, type KeyValueStore } from "@/core/storage";

export type ThemePreference = "system" | "light" | "dark";

export interface Settings {
  theme: ThemePreference;
  /** Affiche le rappel « traitement local » sur les pages d'outil. */
  showPrivacyNotes: boolean;
}

const DEFAULTS: Settings = {
  theme: "system",
  showPrivacyNotes: true,
};

interface SettingsState extends Settings {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
}

function load(store: KeyValueStore): Settings {
  const raw = store.get<Partial<Settings>>(STORAGE_KEYS.settings, {});
  return {
    theme: raw?.theme === "light" || raw?.theme === "dark" ? raw.theme : DEFAULTS.theme,
    showPrivacyNotes:
      typeof raw?.showPrivacyNotes === "boolean"
        ? raw.showPrivacyNotes
        : DEFAULTS.showPrivacyNotes,
  };
}

export function createSettingsStore(store: KeyValueStore = appStore) {
  return create<SettingsState>((set, get) => ({
    ...load(store),
    set: (key, value) => {
      set({ [key]: value } as Pick<Settings, typeof key>);
      const { theme, showPrivacyNotes } = get();
      store.set(STORAGE_KEYS.settings, { theme, showPrivacyNotes });
    },
    reset: () => {
      set(DEFAULTS);
      store.set(STORAGE_KEYS.settings, DEFAULTS);
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
