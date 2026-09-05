import {
  JOB_CANCELLED,
  cancelBackgroundJob,
  clearBackgroundJob,
  jobForTool,
  jobResult,
  startBackgroundJob,
} from "./background";
import type { Job } from "./store";
import type { OperationOutcome } from "@/components/pdf/ResultPanel";

/**
 * Traitements vidéo au-dessus du contrôleur générique de jobs d'arrière-plan.
 *
 * Un réencodage se compte en minutes : il ne doit pas être lié au cycle de vie
 * du composant. On peut donc lancer une compression, aller consulter un autre
 * outil, et revenir sur l'avancement — ou sur le résultat.
 */

/** Message porté par un traitement arrêté par l'utilisateur. */
export const MEDIA_CANCELLED_JOB = JOB_CANCELLED;

export interface StartMediaJobOptions {
  toolId: string;
  /** Titre lisible : en général le nom du fichier source. */
  title: string;
  run: (context: {
    report: (progress: { ratio?: number; label?: string }) => void;
    signal: AbortSignal;
  }) => Promise<OperationOutcome>;
}

/** Le job vidéo le plus récent d'un outil (en cours ou terminé). */
export function mediaJob(toolId: string): Job | undefined {
  return jobForTool(toolId);
}

/** Résultat d'un job vidéo terminé (fichiers produits, résumé, avertissement). */
export function mediaJobResult(jobId: string | undefined): OperationOutcome | undefined {
  return jobResult<OperationOutcome>(jobId);
}

/** Demande l'arrêt d'un traitement vidéo ; FFmpeg est réellement tué. */
export function cancelMediaJob(jobId: string): void {
  cancelBackgroundJob(jobId);
}

/** Oublie un traitement terminé (et les octets produits). */
export function clearMediaJob(jobId: string): void {
  clearBackgroundJob(jobId);
}

/** Lance un traitement vidéo global. Un seul job à la fois par outil. */
export function startMediaJob(options: StartMediaJobOptions): Promise<string> {
  return startBackgroundJob<OperationOutcome>({
    toolId: options.toolId,
    kind: "video-processing",
    title: options.title,
    prefix: "video",
    run: options.run,
  });
}
