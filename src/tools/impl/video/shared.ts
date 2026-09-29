import { formatFileSize } from "@/core/files";
import type { OutputFile } from "@/core/pdf/types";
import type { OperationOutcome } from "@/components/pdf/ResultPanel";
import {
  AUDIO_CODEC_LABEL,
  CONTAINER_LABEL,
  VIDEO_CODEC_LABEL,
  audioCodecsFor,
  containersAvailable,
  videoCodecsFor,
  type MediaCapabilities,
  type VideoContainerId,
} from "@/core/media/capabilities";
import { compressionGain } from "@/core/media/video/presets";
import type { VideoPipeline } from "@/core/media/video/pipelines";
import type { MediaInfo } from "@/core/media/types";

/**
 * Présentation partagée par les outils vidéo.
 *
 * Les **décisions** (conteneur, encodeur, filtres) vivent dans
 * `@/core/media/video/pipelines` : ce module ne s'occupe que de ce qui est
 * affiché — listes d'options, bilan de taille, message de repli.
 */

export { containerOfExtension, defaultContainer } from "@/core/media/video/pipelines";

/** Options prêtes pour un `Select` de conteneur. */
export function containerOptions(caps: MediaCapabilities) {
  return containersAvailable(caps).map((value) => ({ value, label: CONTAINER_LABEL[value] }));
}

/** Options prêtes pour un `Select` de codec vidéo dans un conteneur. */
export function videoCodecOptions(container: VideoContainerId, caps: MediaCapabilities) {
  return videoCodecsFor(container, caps).map((value) => ({
    value,
    label: VIDEO_CODEC_LABEL[value],
  }));
}

/** Options prêtes pour un `Select` de codec audio dans un conteneur. */
export function audioCodecOptions(container: VideoContainerId, caps: MediaCapabilities) {
  return audioCodecsFor(container, caps).map((value) => ({
    value,
    label: AUDIO_CODEC_LABEL[value],
  }));
}

/**
 * Compare la taille produite à la taille d'origine et rédige le résumé.
 *
 * Règle non négociable : on ne présente jamais un fichier plus gros comme un
 * succès de compression. Le gain est affiché tel quel, et l'avertissement dit
 * explicitement que la source était déjà optimisée.
 */
export function sizeOutcome(
  beforeBytes: number,
  file: OutputFile,
  prefix: string,
  extraWarning?: string,
): OperationOutcome {
  const gain = compressionGain(beforeBytes, file.bytes.length);
  const delta = beforeBytes - file.bytes.length;
  const sizes = `${formatFileSize(beforeBytes)} → ${formatFileSize(file.bytes.length)}`;
  const join = (a: string | undefined, b: string | undefined) =>
    [a, b].filter(Boolean).join(" ") || undefined;

  if (gain <= 0) {
    return {
      files: [file],
      summary: `${prefix} ${sizes} (aucun gain).`,
      warning: join(
        "Ce fichier était déjà suffisamment optimisé : le résultat est plus volumineux que l'original " +
          `(+${formatFileSize(Math.abs(delta))}). Conservez plutôt la vidéo de départ, ou choisissez une compression plus forte.`,
        extraWarning,
      ),
    };
  }
  return {
    files: [file],
    summary: `${prefix} ${sizes} — ${gain} % de gain (${formatFileSize(delta)} économisés).`,
    warning: extraWarning,
  };
}

/** Durée totale d'un lot, pour la barre de progression. */
export function totalDuration(infos: readonly MediaInfo[]): number {
  return infos.reduce((sum, info) => sum + info.durationMs, 0);
}

/**
 * Suit un éventuel repli d'encodeur pour le signaler à l'utilisateur.
 *
 * La détection au démarrage écarte déjà les encodeurs qui ne démarrent pas ;
 * si un repli survient quand même, il ne doit pas rester silencieux.
 */
export function fallbackTracker(pipeline: VideoPipeline) {
  let used: number | undefined;
  return {
    onFallback: ({ attempt }: { attempt: number }) => {
      used = attempt;
    },
    /** Message à joindre au résultat, ou `undefined` si tout s'est bien passé. */
    warning: () =>
      used === undefined
        ? undefined
        : pipeline.hardware
          ? "L'accélération matérielle n'était pas disponible ; l'encodage a été refait en logiciel."
          : "L'encodeur initial n'a pas pu démarrer ; un encodeur de repli a été utilisé.",
  };
}
