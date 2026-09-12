import {
  audioCodecsFor,
  preferredVideoCodec,
  isHardwareEncoder,
  SUBTITLE_ENCODER,
  type AudioCodecId,
  type MediaCapabilities,
  type VideoCodecId,
  type VideoContainerId,
} from "../capabilities";
import type { MediaExecutable } from "../client";
import type { MediaInfo } from "../types";
import {
  addAudioTrack,
  addSubtitleTrack,
  adjustVolume,
  burnSubtitles,
  concatCompatible,
  concatTarget,
  concatVideoCopy,
  concatVideoReencode,
  cropFilter,
  encodeVideo,
  extractSubtitleTrack,
  frameRateFilter,
  removeAudio,
  replaceAudio,
  scaleFilter,
  speedAudioFilter,
  speedDurationMs,
  speedVideoFilter,
  transformFilter,
  trimVideo,
  type AudioFitMode,
  type BurnStyle,
  type ConcatSource,
  type TrimMode,
  type VideoTransform,
} from "../operations/video";
import { extractAudio } from "../operations/audio";
import { audioBitrateKbps, audioEncodeArgs, videoEncodeArgs, type QualityLevel } from "./presets";
import { cropRectFor, sizeForHeight, type NormalizedRect } from "./dimensions";
import { AUDIO_MIME, type AudioFormat } from "../types";

/**
 * Pipelines des outils vidéo.
 *
 * Chaque outil de la suite se réduit à un appel de ce module : c'est **ici**
 * qu'est décidé le conteneur, l'encodeur, la qualité et la chaîne de filtres.
 *
 * Cette centralisation n'est pas cosmétique. Tant que chaque écran choisissait
 * son encodeur dans son coin, une erreur de sélection pouvait casser dix outils
 * sans qu'aucun test ne la voie — les tests appelaient les constructeurs
 * d'arguments avec un encodeur écrit en dur, jamais la vraie décision. Un seul
 * point de décision signifie un seul point à tester, et la matrice
 * d'intégration exerce exactement ce que l'interface exécute.
 */

export interface VideoPipeline {
  /** Opération à exécuter en premier. */
  operation: MediaExecutable;
  /** Replis, tentés seulement si l'encodeur retenu ne démarre pas. */
  alternatives: MediaExecutable[];
  container: VideoContainerId;
  /** Encodeur vidéo retenu, `undefined` si rien n'est réencodé. */
  encoder?: string;
  /** L'encodeur retenu s'appuie-t-il sur du matériel ? */
  hardware: boolean;
}

/** Contexte commun : ce que le moteur sait faire, et ce qu'on lui donne. */
export interface PipelineSource {
  caps: MediaCapabilities;
  /** Informations ffprobe de la vidéo d'entrée. */
  info?: MediaInfo;
  /** Extension du fichier d'entrée (décide du conteneur par défaut). */
  extension: string;
}

/* ------------------------------------------------------------- conteneurs */

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
 * Conteneur de sortie par défaut : celui de la source quand il est réellement
 * utilisable, sinon le premier qui fonctionne. Un `.avi` ressort donc en MP4
 * plutôt que d'échouer.
 */
export function defaultContainer(
  extension: string | undefined,
  caps: MediaCapabilities,
): VideoContainerId {
  const source = extension ? containerOfExtension(extension) : undefined;
  if (source && preferredVideoCodec(source, caps)) return source;
  return (["mp4", "mkv", "webm", "mov"] as VideoContainerId[]).find((container) =>
    preferredVideoCodec(container, caps),
  ) ?? "mp4";
}

/* ------------------------------------------------------------- encodage */

export interface EncodeIntent {
  container: VideoContainerId;
  /** Famille vidéo ; déduite du conteneur si absente. */
  video?: VideoCodecId;
  /** Famille audio ; première disponible du conteneur si absente. */
  audio?: AudioCodecId | null;
  level: QualityLevel;
  crf?: number;
}

/** Erreur unique et explicite quand aucun encodeur ne fonctionne ici. */
function noEncoder(container: VideoContainerId): Error {
  return new Error(
    `Aucun encodeur vidéo utilisable pour le format ${container.toUpperCase()} sur cette machine. ` +
      "Le moteur média installé n'en propose aucun qui démarre réellement ici.",
  );
}

/**
 * Variantes d'encodage vidéo, de la plus souhaitable à la plus sûre.
 *
 * La liste vient de `caps.videoAlternatives`, déjà filtrée par le test réel
 * d'encodage : tous les éléments ont encodé une image dans cet environnement.
 * Les replis servent au cas résiduel où un encodeur s'ouvre sur une image de
 * test mais pas sur le fichier de l'utilisateur.
 */
export function encodeVariants(
  intent: EncodeIntent,
  source: PipelineSource,
): { encoder: string; videoArgs: string[]; audioArgs: string[]; hardware: boolean }[] {
  const { caps } = source;
  const family = intent.video ?? preferredVideoCodec(intent.container, caps);
  if (!family) throw noEncoder(intent.container);

  const encoders = caps.videoAlternatives[family] ?? [];
  if (encoders.length === 0) throw noEncoder(intent.container);

  const audioFamily =
    intent.audio === null
      ? undefined
      : (intent.audio ?? audioCodecsFor(intent.container, caps)[0]);
  const audioArgs =
    intent.audio === null || source.info?.hasAudio === false
      ? ["-an"]
      : audioEncodeArgs(audioFamily, caps, intent.level);

  return encoders.map((encoder) => ({
    encoder,
    hardware: isHardwareEncoder(encoder),
    videoArgs: videoEncodeArgs({
      encoder,
      level: intent.level,
      crf: intent.crf,
      source: source.info,
    }),
    audioArgs,
  }));
}

/**
 * Construit un pipeline à partir d'une fabrique d'opération : la même chaîne de
 * filtres est déclinée pour chaque encodeur utilisable, ce qui rend le repli
 * strictement équivalent à la tentative initiale.
 */
export function pipelineFor(
  intent: EncodeIntent,
  source: PipelineSource,
  make: (variant: { videoArgs: string[]; audioArgs: string[] }) => MediaExecutable,
): VideoPipeline {
  const variants = encodeVariants(intent, source);
  const operations = variants.map((variant) => make(variant));
  return {
    operation: operations[0],
    alternatives: operations.slice(1),
    container: intent.container,
    encoder: variants[0].encoder,
    hardware: variants[0].hardware,
  };
}

/** Pipeline sans réencodage vidéo (recopie de flux). */
function copyPipeline(operation: MediaExecutable, container: VideoContainerId): VideoPipeline {
  return { operation, alternatives: [], container, hardware: false };
}

/**
 * Arguments audio d'une opération qui ne touche qu'à l'image : la piste est
 * recopiée telle quelle quand le conteneur ne change pas — plus rapide et sans
 * perte — et réencodée sinon.
 */
export function passthroughAudioArgs(
  source: PipelineSource,
  container: VideoContainerId,
): string[] {
  if (!source.info?.hasAudio) return ["-an"];
  if (containerOfExtension(source.extension) === container) return ["-c:a", "copy"];
  return audioEncodeArgs(audioCodecsFor(container, source.caps)[0], source.caps, "balanced");
}

/* --------------------------------------------------------------- outils */

/** « Convertir une vidéo ». */
export function convertPipeline(
  source: PipelineSource,
  options: { container: VideoContainerId; video?: VideoCodecId; audio?: AudioCodecId | null; level: QualityLevel; crf?: number },
): VideoPipeline {
  return pipelineFor(options, source, ({ videoArgs, audioArgs }) =>
    encodeVideo({ container: options.container, videoArgs, audioArgs }),
  );
}

/** « Compresser une vidéo ». */
export function compressPipeline(
  source: PipelineSource,
  options: { level: QualityLevel; container?: VideoContainerId },
): VideoPipeline {
  const container = options.container ?? defaultContainer(source.extension, source.caps);
  return pipelineFor({ container, level: options.level }, source, ({ videoArgs, audioArgs }) =>
    encodeVideo({ container, videoArgs, audioArgs }),
  );
}

/** « Changer la résolution ». */
export function resizePipeline(
  source: PipelineSource,
  options: { width: number; height: number; container?: VideoContainerId },
): VideoPipeline {
  const container = options.container ?? defaultContainer(source.extension, source.caps);
  const audioArgs = passthroughAudioArgs(source, container);
  return pipelineFor({ container, level: "balanced" }, source, ({ videoArgs }) =>
    encodeVideo({
      container,
      videoArgs,
      audioArgs,
      videoFilters: [scaleFilter(options.width, options.height)],
    }),
  );
}

/** « Pivoter une vidéo » (rotation et miroir). */
export function transformPipeline(
  source: PipelineSource,
  options: { transform: VideoTransform; container?: VideoContainerId },
): VideoPipeline {
  const container = options.container ?? defaultContainer(source.extension, source.caps);
  const audioArgs = passthroughAudioArgs(source, container);
  return pipelineFor({ container, level: "high" }, source, ({ videoArgs }) =>
    encodeVideo({
      container,
      videoArgs,
      audioArgs,
      videoFilters: [transformFilter(options.transform)],
    }),
  );
}

/** « Rogner une vidéo ». Le rectangle est converti en pixels pairs contenus. */
export function cropPipeline(
  source: PipelineSource,
  options: { rect: NormalizedRect; container?: VideoContainerId },
): VideoPipeline & { rect: ReturnType<typeof cropRectFor> } {
  const width = source.info?.width ?? 0;
  const height = source.info?.height ?? 0;
  if (!width || !height) throw new Error("Ce fichier ne contient pas de piste vidéo lisible.");
  const rect = cropRectFor({ width, height }, options.rect);
  const container = options.container ?? defaultContainer(source.extension, source.caps);
  const audioArgs = passthroughAudioArgs(source, container);
  const pipeline = pipelineFor({ container, level: "high" }, source, ({ videoArgs }) =>
    encodeVideo({ container, videoArgs, audioArgs, videoFilters: [cropFilter(rect)] }),
  );
  return { ...pipeline, rect };
}

/** « Changer la vitesse d'une vidéo ». */
export function speedPipeline(
  source: PipelineSource,
  options: { factor: number; container?: VideoContainerId },
): VideoPipeline & { durationMs: number } {
  const container = options.container ?? defaultContainer(source.extension, source.caps);
  const hasAudio = Boolean(source.info?.hasAudio);
  const pipeline = pipelineFor({ container, level: "balanced" }, source, ({ videoArgs, audioArgs }) =>
    encodeVideo({
      container,
      videoArgs,
      audioArgs,
      videoFilters: [speedVideoFilter(options.factor)],
      audioFilters: hasAudio ? [speedAudioFilter(options.factor)] : [],
    }),
  );
  return { ...pipeline, durationMs: speedDurationMs(source.info?.durationMs ?? 0, options.factor) };
}

/**
 * « Changer la fréquence d'images ».
 *
 * La sortie est **à cadence constante** : `fps` régularise l'échantillonnage et
 * `-r` fixe la cadence du conteneur. Une source à cadence variable en ressort
 * donc constante — c'est le comportement réel, et l'outil le dit plutôt que de
 * laisser croire que la variabilité est préservée.
 *
 * La piste audio est recopiée sans y toucher quand le conteneur ne change pas :
 * la durée du son ne peut donc pas dériver de celle de l'image.
 */
export function frameRatePipeline(
  source: PipelineSource,
  options: { fraction: string; container?: VideoContainerId },
): VideoPipeline {
  const container = options.container ?? defaultContainer(source.extension, source.caps);
  const audioArgs = passthroughAudioArgs(source, container);
  return pipelineFor({ container, level: "balanced" }, source, ({ videoArgs }) =>
    encodeVideo({
      container,
      videoArgs,
      audioArgs,
      videoFilters: [frameRateFilter(options.fraction)],
      extraArgs: ["-r", options.fraction],
    }),
  );
}

/** « Découper une vidéo », en mode rapide (recopie) ou précis (réencodage). */
export function trimPipeline(
  source: PipelineSource,
  options: { startMs: number; endMs: number; mode: TrimMode; container?: VideoContainerId },
): VideoPipeline {
  const container = options.container ?? defaultContainer(source.extension, source.caps);
  if (options.mode === "fast") {
    return copyPipeline(
      trimVideo({ startMs: options.startMs, endMs: options.endMs, mode: "fast", container }),
      container,
    );
  }
  return pipelineFor({ container, level: "high" }, source, ({ videoArgs, audioArgs }) =>
    trimVideo({
      startMs: options.startMs,
      endMs: options.endMs,
      mode: "precise",
      container,
      videoArgs,
      audioArgs,
    }),
  );
}

/** « Fusionner des vidéos » : recopie si tout concorde, normalisation sinon. */
export function mergePipeline(
  caps: MediaCapabilities,
  options: { infos: readonly MediaInfo[]; extension: string; container?: VideoContainerId; forceReencode?: boolean },
): VideoPipeline & { copied: boolean; target: ReturnType<typeof concatTarget> } {
  const sources: ConcatSource[] = options.infos.map((info) => ({
    width: info.width,
    height: info.height,
    frameRate: info.frameRate,
    hasAudio: info.hasAudio,
    durationMs: info.durationMs,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
    sampleRate: info.sampleRate,
    channels: info.channels,
  }));
  const container = options.container ?? defaultContainer(options.extension, caps);
  const target = concatTarget(sources);

  if (!options.forceReencode && concatCompatible(sources)) {
    return { ...copyPipeline(concatVideoCopy(container), container), copied: true, target };
  }

  const source: PipelineSource = { caps, extension: options.extension };
  const pipeline = pipelineFor({ container, level: "balanced" }, source, ({ videoArgs, audioArgs }) =>
    concatVideoReencode({ sources, container, videoArgs, audioArgs, target }),
  );
  return { ...pipeline, copied: false, target };
}

/** « Supprimer le son d'une vidéo » : l'image est recopiée telle quelle. */
export function removeAudioPipeline(source: PipelineSource): VideoPipeline {
  if (!source.info?.hasAudio) throw new Error("Cette vidéo ne contient aucune piste audio.");
  const container = containerOfExtension(source.extension) ?? defaultContainer(source.extension, source.caps);
  return copyPipeline(removeAudio(container), container);
}

/** « Remplacer la piste audio » : seule la bande son est produite. */
export function replaceAudioPipeline(
  source: PipelineSource,
  options: { mode: AudioFitMode; videoDurationMs: number },
): VideoPipeline {
  const container = containerOfExtension(source.extension) ?? defaultContainer(source.extension, source.caps);
  const encoder = audioEncoderFor(container, source.caps);
  return copyPipeline(
    replaceAudio({
      container,
      audioArgs: ["-c:a", encoder, "-b:a", `${audioBitrateKbps("high")}k`],
      mode: options.mode,
      videoDurationMs: options.videoDurationMs,
    }),
    container,
  );
}

/** « Ajouter une piste audio » sans supprimer l'existante (conteneur MKV). */
export function addAudioTrackPipeline(
  source: PipelineSource,
  options: { language?: string },
): VideoPipeline {
  const container: VideoContainerId = "mkv";
  return copyPipeline(
    addAudioTrack({
      container,
      audioEncoder: audioEncoderFor(container, source.caps),
      bitrateKbps: audioBitrateKbps("high"),
      trackIndex: source.info?.audioStreams.length ?? 1,
      language: options.language,
    }),
    container,
  );
}

/** « Régler le volume d'une vidéo » : image recopiée, audio réencodé. */
export function volumePipeline(source: PipelineSource, percent: number): VideoPipeline {
  if (!source.info?.hasAudio && percent > 0) {
    throw new Error("Cette vidéo ne contient aucune piste audio à régler.");
  }
  const container = containerOfExtension(source.extension) ?? defaultContainer(source.extension, source.caps);
  const codec = audioCodecsFor(container, source.caps)[0];
  return copyPipeline(
    adjustVolume({ container, percent, audioArgs: audioEncodeArgs(codec, source.caps, "high") }),
    container,
  );
}

/** « Incruster des sous-titres » : l'image est réencodée, l'audio recopié. */
export function burnPipeline(
  source: PipelineSource,
  options: { style: BurnStyle; container?: VideoContainerId },
): VideoPipeline {
  const container = options.container ?? defaultContainer(source.extension, source.caps);
  return pipelineFor({ container, level: "balanced" }, source, ({ videoArgs }) =>
    burnSubtitles({ container, videoArgs, style: options.style }),
  );
}

/**
 * Conteneur retenu pour une piste de sous-titres : celui de la source s'il sait
 * en porter avec ce moteur, sinon MKV — le seul dont l'encodeur (`srt`) est
 * présent dans tous les builds courants.
 */
export function subtitleContainerFor(
  extension: string | undefined,
  caps: MediaCapabilities,
): VideoContainerId | undefined {
  const supported = caps.subtitleContainers;
  if (supported.length === 0) return undefined;
  const preferred = extension ? containerOfExtension(extension) : undefined;
  if (preferred && supported.includes(preferred)) return preferred;
  return supported.find((container) => container === "mkv") ?? supported[0];
}

/** « Ajouter une piste de sous-titres » : rien n'est réencodé. */
export function softSubtitlePipeline(
  source: PipelineSource,
  options: { container?: VideoContainerId; language?: string },
): VideoPipeline {
  const supported = source.caps.subtitleContainers;
  const container = options.container ?? subtitleContainerFor(source.extension, source.caps);
  if (!container) {
    throw new Error(
      "Le moteur installé ne sait écrire aucune piste de sous-titres. Utilisez plutôt « Incruster des sous-titres ».",
    );
  }
  if (!supported.includes(container)) {
    throw new Error(
      `Le moteur installé ne sait pas écrire de sous-titres dans un ${container.toUpperCase()} ` +
        `(encodeur ${SUBTITLE_ENCODER[container]} absent).`,
    );
  }
  return copyPipeline(addSubtitleTrack({ container, language: options.language }), container);
}

/** « Extraire les sous-titres » d'une piste textuelle existante. */
export function extractSubtitlePipeline(
  source: PipelineSource,
  options: { order: number; format: "srt" | "vtt" },
): { operation: MediaExecutable; alternatives: MediaExecutable[]; track: NonNullable<MediaInfo["subtitles"]>[number] } {
  const tracks = source.info?.subtitles ?? [];
  if (tracks.length === 0) throw new Error("Ce fichier ne contient aucune piste de sous-titres.");
  const track = tracks.find((entry) => entry.order === options.order) ?? tracks[0];
  if (!track.textBased) {
    throw new Error(
      `La piste sélectionnée est au format image (${track.codecName ?? "inconnu"}) : elle ne peut pas être convertie en texte.`,
    );
  }
  return { operation: extractSubtitleTrack(track.order, options.format), alternatives: [], track };
}

/** « Extraire l'audio » (également proposé dans le traitement par lots). */
export function extractAudioPipeline(format: AudioFormat): {
  operation: MediaExecutable;
  alternatives: MediaExecutable[];
  mimeType: string;
} {
  return { operation: extractAudio(format), alternatives: [], mimeType: AUDIO_MIME[format] };
}

/* ---------------------------------------------------------------- lots */

/** Opérations réellement indépendantes d'un fichier à l'autre. */
export type BatchOperation = "convert" | "compress" | "resize" | "rotate" | "extract-audio";

export interface BatchOptions {
  operation: BatchOperation;
  container?: VideoContainerId;
  level: QualityLevel;
  height: number;
  transform: VideoTransform;
  audioFormat: AudioFormat;
}

/** Pipeline d'un fichier du lot, avec le suffixe de nom qui va avec. */
export function batchPipeline(
  source: PipelineSource,
  options: BatchOptions,
): { operation: MediaExecutable; alternatives: MediaExecutable[]; outputExt: string; suffix: string } {
  if (options.operation === "extract-audio") {
    const audio = extractAudioPipeline(options.audioFormat);
    return { ...audio, outputExt: options.audioFormat, suffix: "audio" };
  }

  const container = options.container ?? defaultContainer(source.extension, source.caps);
  switch (options.operation) {
    case "resize": {
      const size = sizeForHeight(
        { width: source.info?.width ?? 1280, height: source.info?.height ?? 720 },
        options.height,
      );
      const pipeline = resizePipeline(source, { ...size, container });
      return { ...pipeline, outputExt: container, suffix: `${size.height}p` };
    }
    case "rotate": {
      const pipeline = transformPipeline(source, { transform: options.transform, container });
      return { ...pipeline, outputExt: container, suffix: "pivotee" };
    }
    case "compress": {
      const pipeline = compressPipeline(source, { level: options.level, container });
      return { ...pipeline, outputExt: container, suffix: "compressee" };
    }
    default: {
      const pipeline = convertPipeline(source, { container, level: options.level });
      return { ...pipeline, outputExt: container, suffix: container };
    }
  }
}

/** Encodeur audio du conteneur, ou une erreur claire s'il n'y en a aucun. */
function audioEncoderFor(container: VideoContainerId, caps: MediaCapabilities): string {
  const codec = audioCodecsFor(container, caps)[0];
  const encoder = codec ? caps.audio[codec] : undefined;
  if (!encoder) throw new Error("Aucun encodeur audio n'est disponible dans le moteur installé.");
  return encoder;
}
