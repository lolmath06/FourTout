import { JobCancelledError } from "@/core/jobs/types";
import { latestJobForTool, useJobStore, type Job, type JobKind } from "./store";

/**
 * Contrôleur global des traitements de parole (synthèse et transcription).
 *
 * Comme la récupération de mot de passe, un long texte à lire ou une
 * transcription d'une heure ne doit pas appartenir au composant qui l'a lancé :
 * quitter la page de l'outil ne l'arrête pas et n'en perd pas la trace. Le
 * store ne garde que l'état affichable ; le résultat (octets audio, segments)
 * vit ici, à côté, indexé par identifiant de job.
 */

/** Message porté par un job arrêté par l'utilisateur (et non par une panne). */
export const SPEECH_CANCELLED = "Traitement annulé.";

interface SpeechContext {
  controller: AbortController;
  result?: unknown;
}

const contexts = new Map<string, SpeechContext>();

export interface StartSpeechJobOptions<TResult> {
  toolId: string;
  kind: Extract<JobKind, "speech-synthesis" | "speech-transcription">;
  /** Titre lisible : nom du fichier, ou nature du texte. */
  title: string;
  run: (context: {
    report: (progress: { ratio?: number; label?: string }) => void;
    signal: AbortSignal;
  }) => Promise<TResult>;
}

/** Le job de parole le plus récent d'un outil (en cours ou terminé). */
export function speechJob(toolId: string): Job | undefined {
  return latestJobForTool(useJobStore.getState(), toolId);
}

/** Résultat conservé hors du store (non sérialisable). */
export function speechJobResult<TResult>(jobId: string | undefined): TResult | undefined {
  return jobId ? (contexts.get(jobId)?.result as TResult | undefined) : undefined;
}

/** Demande l'arrêt d'un job de parole ; le moteur natif est réellement tué. */
export function cancelSpeechJob(jobId: string): void {
  const context = contexts.get(jobId);
  if (!context) return;
  useJobStore.getState().update(jobId, { status: "cancelling" });
  context.controller.abort();
}

/** Oublie un job terminé (et son résultat). */
export function clearSpeechJob(jobId: string): void {
  contexts.delete(jobId);
  useJobStore.getState().remove(jobId);
}

/**
 * Lance un traitement de parole et crée son job global. Un seul job à la fois
 * par outil : le précédent, s'il est terminé, est oublié.
 */
export async function startSpeechJob<TResult>(
  options: StartSpeechJobOptions<TResult>,
): Promise<string> {
  const store = useJobStore.getState();
  const existing = speechJob(options.toolId);
  if (existing) {
    if (existing.status === "running" || existing.status === "cancelling") {
      throw new Error("Un traitement est déjà en cours pour cet outil.");
    }
    clearSpeechJob(existing.id);
  }

  const id = `speech-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
        useJobStore.getState().update(id, { status: "error", error: SPEECH_CANCELLED, endedAt: Date.now() });
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
          ? SPEECH_CANCELLED
          : error instanceof Error
            ? error.message
            : "Erreur inattendue.",
        endedAt: Date.now(),
      });
    }
  })();

  return id;
}
