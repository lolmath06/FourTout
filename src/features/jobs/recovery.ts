import {
  startRecovery as defaultStartRecovery,
  type RecoverySession,
  type RecoveryTier,
} from "@/core/recovery/client";
import type { EncryptionParamsDto } from "@/core/pdf/encryptionInfo";
import type { PdfSource } from "@/core/pdf/types";
import { latestJobForTool, useJobStore, type Job } from "./store";

/**
 * Contrôleur global de la récupération de mot de passe.
 *
 * Il possède la session native (abonnement aux événements Tauri) **hors** de
 * tout composant : c'est ce qui permet à la recherche de continuer, et de
 * rester visible, quand l'utilisateur quitte la page puis y revient. Le store
 * (`store.ts`) ne garde que l'état affichable ; ce module conserve à côté ce
 * qui ne doit pas y figurer (octets du document, session).
 *
 * Une seule récupération à la fois : le moteur natif l'impose (un seul fil de
 * recherche), l'interface s'appuie donc sur `activeRecoveryJob()`.
 */

export const RECOVERY_TOOL_ID = "pdf-recover-password";

interface RecoveryContext {
  session: RecoverySession | null;
  /** Conservé pour « enregistrer une copie déverrouillée » après coup. */
  source: PdfSource;
  tier: RecoveryTier;
}

/** Données non sérialisables, gardées hors du store, indexées par id de job. */
const contexts = new Map<string, RecoveryContext>();

/** Injectable pour les tests ; vaut le vrai client natif en production. */
let starter = defaultStartRecovery;

/** Remplace le lanceur (tests uniquement). Renvoie une fonction de restauration. */
export function __setRecoveryStarter(next: typeof defaultStartRecovery): () => void {
  const previous = starter;
  starter = next;
  return () => {
    starter = previous;
  };
}

/** Le job de récupération courant (le plus récent rattaché à l'outil). */
export function activeRecoveryJob(): Job | undefined {
  return latestJobForTool(useJobStore.getState(), RECOVERY_TOOL_ID);
}

/** Le document source d'un job, pour agir sur son résultat après navigation. */
export function recoverySource(jobId: string): PdfSource | undefined {
  return contexts.get(jobId)?.source;
}

export interface StartRecoveryOptions {
  source: PdfSource;
  params: EncryptionParamsDto;
  tier: RecoveryTier;
}

/**
 * Démarre une recherche et crée son job global. Renvoie l'identifiant du job.
 * Refuse si une recherche est déjà active (limite du moteur natif).
 */
export async function startRecoveryJob(options: StartRecoveryOptions): Promise<string> {
  const store = useJobStore.getState();
  const existing = activeRecoveryJob();
  if (existing) {
    if (existing.status === "running" || existing.status === "cancelling") {
      throw new Error("Une recherche est déjà en cours.");
    }
    // Un job terminé pour cet outil : on l'oublie pour n'en garder qu'un seul.
    clearRecoveryJob(existing.id);
  }

  const id = `recovery-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  store.create({
    id,
    toolId: RECOVERY_TOOL_ID,
    kind: "pdf-recover-password",
    title: options.source.name,
    status: "running",
    startedAt: Date.now(),
    cancellable: true,
    total: 0,
  });
  contexts.set(id, { session: null, source: options.source, tier: options.tier });

  try {
    const session = await starter(options.params, options.tier, {
      onProgress: (progress) => {
        useJobStore.getState().update(id, {
          progress,
          total: progress.total || useJobStore.getState().jobs[id]?.total || 0,
        });
      },
      onDone: (done) => {
        useJobStore.getState().update(id, {
          status: done.status === "error" ? "error" : "done",
          result: done,
          error: done.status === "error" ? done.message : undefined,
          endedAt: Date.now(),
          cancellable: false,
        });
        const context = contexts.get(id);
        context?.session?.dispose();
        if (context) context.session = null;
      },
    });

    const context = contexts.get(id);
    if (context) context.session = session;
    // Le job a pu se terminer très vite (déjà `done`) : ne rétrograde pas.
    const current = useJobStore.getState().jobs[id];
    if (current && current.status === "running") {
      useJobStore.getState().update(id, { total: session.total });
    }
    return id;
  } catch (error) {
    useJobStore.getState().update(id, {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      endedAt: Date.now(),
      cancellable: false,
    });
    contexts.delete(id);
    throw error;
  }
}

/** Demande l'arrêt d'un job de récupération. */
export async function cancelRecoveryJob(id: string): Promise<void> {
  const job = useJobStore.getState().jobs[id];
  if (!job || (job.status !== "running" && job.status !== "cancelling")) return;
  useJobStore.getState().update(id, { status: "cancelling" });
  await contexts.get(id)?.session?.cancel();
}

/** Oublie un job terminé (et libère son contexte). Sans effet s'il tourne. */
export function clearRecoveryJob(id: string): void {
  const job = useJobStore.getState().jobs[id];
  if (job && (job.status === "running" || job.status === "cancelling")) return;
  contexts.get(id)?.session?.dispose();
  contexts.delete(id);
  useJobStore.getState().remove(id);
}

/**
 * Arrête les recherches natives encore vivantes lors d'un **vrai** rechargement
 * ou de la fermeture de la fenêtre (jamais lors d'une navigation interne, qui
 * ne déclenche pas `beforeunload`). On évite ainsi un gros calcul Rust invisible
 * dont le frontend aurait perdu la trace. La navigation SPA, elle, laisse le job
 * vivre : c'est tout l'intérêt du contrôleur.
 */
export function installRecoveryShutdownGuard(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeunload", () => {
    for (const [id, context] of contexts) {
      const job = useJobStore.getState().jobs[id];
      if (job && (job.status === "running" || job.status === "cancelling")) {
        void context.session?.cancel();
      }
    }
  });
}
