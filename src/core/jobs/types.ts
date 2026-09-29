/**
 * Contrat des traitements longs (compression vidéo, OCR, transcription, TTS…).
 *
 * Aucun outil ne l'utilise encore : l'objectif est que les phases suivantes
 * n'aient pas à réinventer la progression, l'annulation et le rapport d'erreur
 * outil par outil.
 */

export type JobStatus = "idle" | "running" | "success" | "error" | "cancelled";

export interface JobProgress {
  /** Avancement de 0 à 1, ou `undefined` si l'opération est indéterminée. */
  ratio?: number;
  /** Étape en cours, affichable telle quelle (« Page 3 sur 12 »). */
  label?: string;
}

export interface JobError {
  message: string;
  /** Code technique, pour les journaux et les tests. */
  code?: string;
  cause?: unknown;
}

export interface JobState<TResult> {
  status: JobStatus;
  progress: JobProgress;
  result?: TResult;
  error?: JobError;
  startedAt?: number;
  endedAt?: number;
}

export interface JobContext {
  /** À appeler par le traitement pour publier son avancement. */
  report(progress: JobProgress): void;
  /** Signal d'annulation, à transmettre aux appels natifs et aux boucles. */
  signal: AbortSignal;
  /** Raccourci : lève une erreur d'annulation si l'utilisateur a annulé. */
  throwIfCancelled(): void;
}

/** Un traitement long est une simple fonction recevant son contexte. */
export type JobRunner<TResult> = (context: JobContext) => Promise<TResult>;

export class JobCancelledError extends Error {
  constructor() {
    super("Opération annulée");
    this.name = "JobCancelledError";
  }
}
