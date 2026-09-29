import { JobCancelledError } from "@/core/jobs/types";
import { latestJobForTool, useJobStore, type Job, type JobKind } from "./store";

/**
 * Contrôleur générique des traitements longs qui **survivent à la navigation**.
 *
 * Une heure de transcription ou un réencodage vidéo ne doit pas appartenir au
 * composant React qui l'a lancé : quitter la page de l'outil ne l'arrête pas et
 * n'en perd pas la trace. Le store ne garde que l'état affichable ; le résultat
 * (octets produits, segments, avertissements) vit ici, à côté, indexé par
 * identifiant de job — il n'a pas à être sérialisable.
 *
 * La parole (`speech.ts`) et la vidéo (`media.ts`) partagent exactement ce
 * mécanisme ; elles n'en exposent que leur vocabulaire.
 */

/** Message porté par un job arrêté par l'utilisateur (et non par une panne). */
export const JOB_CANCELLED = "Traitement annulé.";

interface BackgroundContext {
  controller: AbortController;
  result?: unknown;
}

const contexts = new Map<string, BackgroundContext>();

export interface StartJobOptions<TResult> {
  toolId: string;
  kind: JobKind;
  /** Titre lisible : nom du fichier, ou nature du traitement. */
  title: string;
  /** Préfixe de l'identifiant, pour lire les journaux plus facilement. */
  prefix?: string;
  run: (context: {
    report: (progress: { ratio?: number; label?: string }) => void;
    signal: AbortSignal;
  }) => Promise<TResult>;
}

/** Le job le plus récent d'un outil (en cours ou terminé). */
export function jobForTool(toolId: string): Job | undefined {
  return latestJobForTool(useJobStore.getState(), toolId);
}

/** Résultat conservé hors du store (non sérialisable). */
export function jobResult<TResult>(jobId: string | undefined): TResult | undefined {
  return jobId ? (contexts.get(jobId)?.result as TResult | undefined) : undefined;
}

/** Demande l'arrêt d'un job ; le processus natif est réellement tué. */
export function cancelBackgroundJob(jobId: string): void {
  const context = contexts.get(jobId);
  if (!context) return;
  useJobStore.getState().update(jobId, { status: "cancelling" });
  context.controller.abort();
}

/** Oublie un job terminé (et son résultat). */
export function clearBackgroundJob(jobId: string): void {
  contexts.delete(jobId);
  useJobStore.getState().remove(jobId);
}

/**
 * Lance un traitement et crée son job global. Un seul job à la fois par outil :
 * le précédent, s'il est terminé, est oublié.
 */
export async function startBackgroundJob<TResult>(
  options: StartJobOptions<TResult>,
): Promise<string> {
  const store = useJobStore.getState();
  const existing = jobForTool(options.toolId);
  if (existing) {
    if (existing.status === "running" || existing.status === "cancelling") {
      throw new Error("Un traitement est déjà en cours pour cet outil.");
    }
    clearBackgroundJob(existing.id);
  }

  const id = `${options.prefix ?? "job"}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const controller = new AbortController();
  contexts.set(id, { controller });

  store.create({
    id,
    toolId: options.toolId,
    kind: options.kind,
    title: options.title,
    status: "running",
    startedAt: Date.now(),
    cancellable: true,
    total: 0,
    ratio: 0,
  });

  // Volontairement non attendu : l'appelant récupère l'état par le store.
  void (async () => {
    try {
      const result = await options.run({
        report: ({ ratio, label }) => {
          if (controller.signal.aborted) return;
          useJobStore.getState().update(id, { ratio, step: label });
        },
        signal: controller.signal,
      });
      const context = contexts.get(id);
      if (!context) return;
      if (controller.signal.aborted) {
        useJobStore.getState().update(id, { status: "error", error: JOB_CANCELLED, endedAt: Date.now() });
        return;
      }
      context.result = result;
      useJobStore.getState().update(id, { status: "done", ratio: 1, endedAt: Date.now() });
    } catch (error) {
      if (!contexts.has(id)) return;
      const cancelled = error instanceof JobCancelledError || controller.signal.aborted;
      useJobStore.getState().update(id, {
        status: "error",
        error: cancelled
          ? JOB_CANCELLED
          : error instanceof Error
            ? error.message
            : "Erreur inattendue.",
        endedAt: Date.now(),
      });
    }
  })();

  return id;
}
