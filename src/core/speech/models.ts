import { isTauri } from "@/core/platform";

/**
 * Gestionnaire des moteurs et modèles de parole.
 *
 * Rien n'est téléchargé sans une action explicite de l'utilisateur : ce module
 * ne fait que lister l'état réel du disque, lancer une installation qu'on lui
 * demande, en publier la progression et permettre de l'annuler ou de la
 * défaire. Une fois installés, les moteurs fonctionnent entièrement hors ligne.
 */

export type SpeechAssetKind = "engine" | "voice" | "stt-model" | "segmentation";

export interface SpeechAsset {
  id: string;
  kind: SpeechAssetKind;
  /** Nom lisible (« Voix française — Siwis »), jamais un identifiant. */
  label: string;
  detail: string;
  language?: string;
  /** Octets à télécharger. */
  size: number;
  installed: boolean;
  /** Disponible pour cette plateforme. */
  available: boolean;
  license: string;
  source: string;
}

export interface InstallProgress {
  received: number;
  total: number;
}

/** Le socle parole nécessite l'application installée (moteurs natifs). */
export function isSpeechAvailable(): boolean {
  return isTauri();
}

/** Catalogue et état d'installation réels. */
export async function listAssets(): Promise<SpeechAsset[]> {
  if (!isTauri()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SpeechAsset[]>("models_list");
}

/**
 * Lit un fichier appartenant à un élément installé.
 *
 * Les moteurs de parole lisent leurs modèles eux-mêmes, côté natif. La
 * suppression d'arrière-plan fait tourner le sien dans la WebView : il lui faut
 * les octets. La commande native n'accepte pas un chemin libre, mais un
 * identifiant du catalogue et un fichier que cet élément déclare — elle ne peut
 * donc lire que ce que FourTout a installé.
 */
export async function readAssetFile(id: string, relative: string): Promise<Uint8Array> {
  if (!isTauri()) throw new Error("Les modèles ne sont disponibles que dans l'application installée.");
  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = await invoke<number[]>("models_read_file", { id, relative });
  return new Uint8Array(bytes);
}

/** Emplacement de stockage, montré à l'utilisateur. */
export async function modelsDirectory(): Promise<string> {
  if (!isTauri()) return "";
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("models_dir");
}

export interface InstallOptions {
  onProgress?: (progress: InstallProgress) => void;
  signal?: AbortSignal;
}

/**
 * Installe un élément : téléchargement vérifié par empreinte puis mise en
 * place. Une annulation ou une erreur ne laisse aucun fichier partiel installé.
 */
export async function installAsset(id: string, options: InstallOptions = {}): Promise<void> {
  if (!isTauri()) throw new Error("L'installation nécessite l'application FourTout.");
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");

  const jobId = `models-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const unlisten = await listen<{ jobId: string; received: number; total: number }>(
    "models://progress",
    (event) => {
      if (event.payload.jobId === jobId) {
        options.onProgress?.({ received: event.payload.received, total: event.payload.total });
      }
    },
  );

  const onAbort = () => {
    void invoke("models_cancel", { jobId });
  };
  options.signal?.addEventListener("abort", onAbort);

  try {
    await invoke("models_install", { id, jobId });
  } finally {
    unlisten();
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** Désinstalle un élément et libère la place disque. */
export async function removeAsset(id: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("models_remove", { id });
}

/** Taille lisible d'un téléchargement. */
export function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} Go`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} Mo`;
  if (bytes >= 1000) return `${Math.round(bytes / 1000)} ko`;
  return `${bytes} o`;
}

/** Les éléments manquants parmi ceux requis, dans l'ordre du catalogue. */
export function missingAssets(assets: readonly SpeechAsset[], required: readonly string[]): SpeechAsset[] {
  return assets.filter((asset) => required.includes(asset.id) && !asset.installed);
}
