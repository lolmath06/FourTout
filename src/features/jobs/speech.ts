import {
  JOB_CANCELLED,
  cancelBackgroundJob,
  clearBackgroundJob,
  jobForTool,
  jobResult,
  startBackgroundJob,
} from "./background";
import type { Job, JobKind } from "./store";

/**
 * Traitements de parole (synthèse et transcription) au-dessus du contrôleur
 * générique de jobs d'arrière-plan (`background.ts`) : un long texte à lire ou
 * une transcription d'une heure ne meurt pas parce que l'utilisateur est allé
 * voir un autre outil.
 */

/** Message porté par un job arrêté par l'utilisateur (et non par une panne). */
export const SPEECH_CANCELLED = JOB_CANCELLED;

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
  return jobForTool(toolId);
}

/** Résultat conservé hors du store (non sérialisable). */
export function speechJobResult<TResult>(jobId: string | undefined): TResult | undefined {
  return jobResult<TResult>(jobId);
}

/** Demande l'arrêt d'un job de parole ; le moteur natif est réellement tué. */
export function cancelSpeechJob(jobId: string): void {
  cancelBackgroundJob(jobId);
}

/** Oublie un job terminé (et son résultat). */
export function clearSpeechJob(jobId: string): void {
  clearBackgroundJob(jobId);
}

/**
 * Lance un traitement de parole et crée son job global. Un seul job à la fois
 * par outil : le précédent, s'il est terminé, est oublié.
 */
export function startSpeechJob<TResult>(options: StartSpeechJobOptions<TResult>): Promise<string> {
  return startBackgroundJob<TResult>({ ...options, prefix: "speech" });
}
