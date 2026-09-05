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
  type AudioCodecId,
  type MediaCapabilities,
  type VideoCodecId,
  type VideoContainerId,
} from "@/core/media/capabilities";
import {
  audioEncodeArgs,
  compressionGain,
  videoEncodeArgs,
  type QualityLevel,
} from "@/core/media/video/presets";
import type { MediaInfo } from "@/core/media/types";

/**
 * Petites décisions partagées par les outils vidéo.
 *
 * Trois questions reviennent partout : quel conteneur écrire, faut-il réencoder
 * l'audio ou peut-on le recopier, et le résultat est-il réellement meilleur que
 * la source. Les réponses vivent ici pour rester cohérentes d'un outil à
 * l'autre — et testables sans interface.
 */

/** Conteneur FourTout correspondant à l'extension d'un fichier, si connu. */
export function containerOfExtension(extension: string): VideoContainerId | undefined {
  switch (extension.toLowerCase()) {
    case "mp4":
    case "m4v":
      return "mp4";
    case "mkv":
      return "mkv";
    case "webm":
      return "webm";
    case "mov":
      return "mov";
    default:
      return undefined;
  }
}

/**
 * Conteneur de sortie par défaut : celui de la source quand il est utilisable,
 * sinon le premier conteneur réellement disponible. Un `.avi` ressort donc en
 * MP4 plutôt que d'échouer.
 */
export function defaultContainer(
  extension: string | undefined,
  caps: MediaCapabilities,
): VideoContainerId {
  const available = containersAvailable(caps);
  const source = extension ? containerOfExtension(extension) : undefined;
  if (source && available.includes(source)) return source;
  return available[0] ?? "mp4";
}

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

export interface EncodeChoice {
  container: VideoContainerId;
  video: VideoCodecId;
  audio?: AudioCodecId;
  level: QualityLevel;
  crf?: number;
}

/** Arguments FFmpeg complets pour un choix d'encodage et une source donnée. */
export function encodeArgsFor(
  choice: EncodeChoice,
  caps: MediaCapabilities,
  source?: MediaInfo,
): { videoArgs: string[]; audioArgs: string[]; encoder: string } {
  const encoder = caps.video[choice.video];
  if (!encoder) throw new Error("Le codec vidéo demandé n'est pas disponible dans le moteur installé.");
  return {
    encoder,
    videoArgs: videoEncodeArgs({ encoder, level: choice.level, crf: choice.crf, source }),
    audioArgs: source?.hasAudio === false ? ["-an"] : audioEncodeArgs(choice.audio, caps, choice.level),
  };
}

/**
 * Arguments audio d'une opération qui ne touche qu'à l'image : la piste est
 * recopiée telle quelle quand le conteneur ne change pas — c'est plus rapide et
 * strictement sans perte — et réencodée sinon.
 */
export function passthroughAudioArgs(
  extension: string,
  info: MediaInfo | undefined,
  container: VideoContainerId,
  caps: MediaCapabilities,
  fallback?: AudioCodecId,
): string[] {
  if (!info?.hasAudio) return ["-an"];
  if (containerOfExtension(extension) === container) return ["-c:a", "copy"];
  const codec = fallback ?? audioCodecsFor(container, caps)[0];
  return audioEncodeArgs(codec, caps, "balanced");
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
): OperationOutcome {
  const gain = compressionGain(beforeBytes, file.bytes.length);
  const delta = beforeBytes - file.bytes.length;
  const sizes = `${formatFileSize(beforeBytes)} → ${formatFileSize(file.bytes.length)}`;

  if (gain <= 0) {
    return {
      files: [file],
      summary: `${prefix} ${sizes} (aucun gain).`,
      warning:
        "Ce fichier était déjà suffisamment optimisé : le résultat est plus volumineux que l'original " +
        `(+${formatFileSize(Math.abs(delta))}). Conservez plutôt la vidéo de départ, ou choisissez une compression plus forte.`,
    };
  }
  return {
    files: [file],
    summary: `${prefix} ${sizes} — ${gain} % de gain (${formatFileSize(delta)} économisés).`,
  };
}

/** Durée totale d'un lot, pour la barre de progression. */
export function totalDuration(infos: readonly MediaInfo[]): number {
  return infos.reduce((sum, info) => sum + info.durationMs, 0);
}
