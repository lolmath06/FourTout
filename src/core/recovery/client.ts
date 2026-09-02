import { isTauri } from "@/core/platform";
import type { EncryptionParamsDto } from "@/core/pdf/encryptionInfo";

/**
 * Client de la récupération de mot de passe.
 *
 * La recherche s'exécute dans le moteur natif (voir `src-tauri/src/recovery/`),
 * seul capable des millions de vérifications nécessaires. Ce module se contente
 * de la lancer, de relayer l'avancement et de permettre l'annulation. Tout
 * reste local : rien n'est envoyé sur le réseau.
 */

export type RecoveryTier = "quick" | "extended" | "full";

export interface RecoveryProgress {
  tested: number;
  total: number;
  rate: number;
  elapsedMs: number;
}

export type RecoveryStatus = "found" | "exhausted" | "cancelled" | "error";

export interface RecoveryDone {
  status: RecoveryStatus;
  password?: string;
  tested: number;
  elapsedMs: number;
  message?: string;
}

export interface RecoveryHandlers {
  onProgress: (progress: RecoveryProgress) => void;
  onDone: (done: RecoveryDone) => void;
}

export interface RecoverySession {
  /** Total prévisionnel de candidats annoncé par le moteur. */
  total: number;
  /** Demande l'arrêt de la recherche. */
  cancel: () => Promise<void>;
  /** Se désabonne des événements (à appeler au démontage). */
  dispose: () => void;
}

/** La récupération est-elle disponible ? (moteur natif requis) */
export function isRecoveryAvailable(): boolean {
  return isTauri();
}

/**
 * Lance une recherche et s'abonne à ses événements.
 * Rejette immédiatement si le moteur natif n'est pas disponible.
 */
export async function startRecovery(
  params: EncryptionParamsDto,
  tier: RecoveryTier,
  handlers: RecoveryHandlers,
): Promise<RecoverySession> {
  if (!isTauri()) {
    throw new Error(
      "La récupération de mot de passe nécessite l'application FourTout installée.",
    );
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");

  // On s'abonne avant de lancer pour ne manquer aucun événement.
  const unlistenProgress = await listen<RecoveryProgress>("recovery://progress", (event) => {
    handlers.onProgress(event.payload);
  });
  const unlistenDone = await listen<RecoveryDone>("recovery://done", (event) => {
    handlers.onDone(event.payload);
  });

  const dispose = () => {
    unlistenProgress();
    unlistenDone();
  };

  try {
    const total = await invoke<number>("recover_password", { params, tier });
    return {
      total,
      cancel: () => invoke<void>("recover_cancel"),
      dispose,
    };
  } catch (error) {
    dispose();
    throw error instanceof Error ? error : new Error(String(error));
  }
}
