import { create } from "zustand";
import type { RecoveryDone, RecoveryProgress } from "@/core/recovery/client";

/**
 * Source de vérité **globale** des traitements longs.
 *
 * Un traitement long (récupération de mot de passe aujourd'hui, transcodage
 * vidéo ou OCR demain) ne doit **pas** appartenir au cycle de vie du composant
 * React qui l'a lancé : quitter la page de l'outil ne doit ni l'arrêter ni en
 * perdre la trace. Ce store vit donc hors de React (module singleton), reçoit
 * les mises à jour du contrôleur natif, et l'interface s'y **reconnecte** quand
 * on revient sur l'outil.
 *
 * Les données trop lourdes ou non sérialisables (octets du PDF, session Tauri)
 * ne transitent pas par ici : elles sont conservées à part par le contrôleur
 * (`recovery.ts`). Ce store ne garde que l'état affichable.
 */

/** État grossier d'un job, suffisant pour l'indicateur global et le panneau. */
export type JobStatus = "running" | "cancelling" | "done" | "error";

/** Nature du traitement — permet d'associer un job à son outil et son rendu. */
export type JobKind =
  | "pdf-recover-password"
  /** Synthèse vocale (texte, TXT ou PDF vers audio). */
  | "speech-synthesis"
  /** Transcription vocale (texte, sous-titres). */
  | "speech-transcription";

export interface Job {
  id: string;
  /** Outil auquel ce job est rattaché (pour y revenir). */
  toolId: string;
  kind: JobKind;
  /** Titre lisible, en général le nom du fichier. */
  title: string;
  status: JobStatus;
  startedAt: number;
  endedAt?: number;
  /** Le job peut-il être arrêté par l'utilisateur ? */
  cancellable: boolean;
  /** Total prévisionnel de candidats/étapes, connu au démarrage. */
  total: number;
  /** Avancement courant (récupération : testés/total/débit/temps). */
  progress?: RecoveryProgress;
  /** Avancement de 0 à 1 des traitements à progression simple (parole). */
  ratio?: number;
  /** Étape en cours, affichable telle quelle (« Segment 3 sur 12 »). */
  step?: string;
  /** Résultat détaillé une fois le job terminé (found/exhausted/cancelled…). */
  result?: RecoveryDone;
  /** Message d'erreur si le lancement ou l'exécution a échoué. */
  error?: string;
}

interface JobsState {
  /** Jobs indexés par id. */
  jobs: Record<string, Job>;
  /** Ordre d'insertion, pour un affichage stable. */
  order: string[];

  create(job: Job): void;
  update(id: string, patch: Partial<Job>): void;
  remove(id: string): void;
}

export const useJobStore = create<JobsState>((set) => ({
  jobs: {},
  order: [],

  create: (job) =>
    set((state) => {
      if (state.jobs[job.id]) return state;
      return {
        jobs: { ...state.jobs, [job.id]: job },
        order: [...state.order, job.id],
      };
    }),

  update: (id, patch) =>
    set((state) => {
      const current = state.jobs[id];
      if (!current) return state;
      return { jobs: { ...state.jobs, [id]: { ...current, ...patch } } };
    }),

  remove: (id) =>
    set((state) => {
      if (!state.jobs[id]) return state;
      const jobs = { ...state.jobs };
      delete jobs[id];
      return { jobs, order: state.order.filter((entry) => entry !== id) };
    }),
}));

/** Vue en lecture seule suffisante aux sélecteurs (store réel ou snapshot). */
export type JobsSnapshot = Pick<JobsState, "jobs" | "order">;

/** Un job est-il en cours (ou en train de s'arrêter) ? */
export function isJobActive(job: Job): boolean {
  return job.status === "running" || job.status === "cancelling";
}

/** Tous les jobs, dans l'ordre d'insertion. */
export function listJobs(state: JobsSnapshot): Job[] {
  return state.order.map((id) => state.jobs[id]).filter((job): job is Job => job !== undefined);
}

/** Les jobs en cours (ou en cours d'arrêt). */
export function activeJobs(state: JobsSnapshot): Job[] {
  return listJobs(state).filter(isJobActive);
}

/** Le job le plus récent rattaché à un outil, s'il existe. */
export function latestJobForTool(state: JobsSnapshot, toolId: string): Job | undefined {
  for (let i = state.order.length - 1; i >= 0; i -= 1) {
    const job = state.jobs[state.order[i]];
    if (job?.toolId === toolId) return job;
  }
  return undefined;
}
