import { JobCancelledError } from "@/core/jobs/types";

/**
 * Traduction des échecs FFmpeg en phrases exploitables.
 *
 * La sortie d'erreur de FFmpeg est écrite pour un développeur : « Invalid data
 * found when processing input », « Encoder (codec none) not found ». Elle ne
 * dit pas à l'utilisateur ce qu'il doit faire. On reconnaît donc les cas
 * fréquents et on les reformule, **sans jamais inventer** : quand le motif
 * n'est pas reconnu, le message technique est conservé — mieux vaut une phrase
 * obscure qu'une explication fausse.
 *
 * Le détail brut reste disponible : `describeMediaError` renvoie les deux.
 */

interface Rule {
  match: RegExp;
  message: string;
}

const RULES: Rule[] = [
  {
    match: /invalid data found|moov atom not found|could not find codec parameters|end of file/i,
    message:
      "Ce fichier n'a pas pu être lu : il est peut-être incomplet, endommagé, ou dans un format que le moteur ne reconnaît pas.",
  },
  {
    match: /(unknown encoder|encoder .* not found|unknown decoder|decoder .* not found)/i,
    message:
      "Le codec demandé n'est pas disponible dans le moteur installé. Choisissez un autre format de sortie.",
  },
  {
    match: /does not support|incompatible|could not write header|automatic encoder selection failed/i,
    message:
      "Ce conteneur n'accepte pas cette combinaison de codecs. Changez de format de sortie ou de codec.",
  },
  {
    match: /stream map .* matches no streams|does not contain any stream|matches no streams/i,
    message:
      "La piste demandée n'existe pas dans ce fichier. Vérifiez qu'il contient bien de l'audio ou des sous-titres.",
  },
  {
    match: /no space left on device|disk full/i,
    message: "Il n'y a plus assez d'espace disque pour écrire le résultat.",
  },
  {
    match: /permission denied|read-only file system/i,
    message: "L'accès au fichier a été refusé par le système.",
  },
  {
    match: /no such file or directory/i,
    message: "Un fichier nécessaire au traitement est introuvable.",
  },
  {
    match: /ffmpeg introuvable|ffprobe introuvable/i,
    message:
      "Le moteur média local (FFmpeg) est introuvable. Cet outil nécessite l'application FourTout installée.",
  },
  {
    match: /error (while )?(opening|initializing) (the )?(output|encoder|filter)/i,
    message: "Les paramètres demandés n'ont pas pu être appliqués à ce fichier.",
  },
  {
    match: /invalid argument|option .* not found|error parsing/i,
    message: "Les paramètres demandés sont incompatibles entre eux pour ce fichier.",
  },
];

/** Message affiché quand l'utilisateur a arrêté le traitement lui-même. */
export const MEDIA_CANCELLED = "Traitement annulé.";

export interface MediaErrorDescription {
  /** Phrase destinée à l'utilisateur. */
  message: string;
  /** Sortie brute de FFmpeg, conservée pour le diagnostic. */
  detail?: string;
  /** L'échec est-il en réalité une annulation demandée ? */
  cancelled: boolean;
}

/** Analyse une erreur de traitement média et la rend présentable. */
export function describeMediaError(error: unknown): MediaErrorDescription {
  if (error instanceof JobCancelledError) {
    return { message: MEDIA_CANCELLED, cancelled: true };
  }
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (raw.trim() === "cancelled") return { message: MEDIA_CANCELLED, cancelled: true };

  for (const rule of RULES) {
    if (rule.match.test(raw)) {
      return { message: rule.message, detail: raw, cancelled: false };
    }
  }
  return {
    message: raw.trim() === "" ? "Le traitement a échoué." : raw.trim(),
    detail: raw.trim() === "" ? undefined : raw,
    cancelled: false,
  };
}

/** Raccourci : la phrase seule. */
export function friendlyMediaError(error: unknown): string {
  return describeMediaError(error).message;
}
