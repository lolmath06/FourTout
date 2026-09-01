/**
 * Persistance locale.
 *
 * Abstraite derrière une interface pour deux raisons :
 *  - les tests n'ont pas à dépendre du navigateur ;
 *  - une phase ultérieure pourra basculer sur un store Tauri (fichier JSON
 *    dans le dossier de configuration de l'application) sans toucher aux
 *    fonctionnalités qui l'utilisent.
 *
 * Aucune donnée n'est envoyée ailleurs : tout reste sur la machine.
 */

export interface KeyValueStore {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
}

const PREFIX = "fourtout:";

/** Implémentation localStorage, disponible aussi bien en web qu'en WebView Tauri. */
export class LocalStorageStore implements KeyValueStore {
  constructor(private readonly storage: Storage | undefined = safeLocalStorage()) {}

  get<T>(key: string, fallback: T): T {
    if (!this.storage) return fallback;
    try {
      const raw = this.storage.getItem(PREFIX + key);
      if (raw === null) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      // Donnée corrompue ou accès refusé : on repart proprement du défaut.
      return fallback;
    }
  }

  set<T>(key: string, value: T): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // Quota ou mode privé : la fonctionnalité dégrade sans casser l'app.
    }
  }

  remove(key: string): void {
    if (!this.storage) return;
    try {
      this.storage.removeItem(PREFIX + key);
    } catch {
      /* ignoré volontairement */
    }
  }
}

/** Implémentation mémoire, utilisée par les tests et en cas d'indisponibilité. */
export class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, string>();

  get<T>(key: string, fallback: T): T {
    const raw = this.data.get(key);
    if (raw === undefined) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  set<T>(key: string, value: T): void {
    this.data.set(key, JSON.stringify(value));
  }

  remove(key: string): void {
    this.data.delete(key);
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    if (typeof window === "undefined" || !window.localStorage) return undefined;
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export const appStore: KeyValueStore = new LocalStorageStore();

export const STORAGE_KEYS = {
  favorites: "favorites",
  recents: "recents",
  settings: "settings",
} as const;
