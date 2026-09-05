import { availableEncoders } from "./client";

/**
 * Capacités **réelles** du FFmpeg utilisé.
 *
 * FourTout ne suppose rien du build : selon la plateforme et le paquet, le même
 * binaire peut avoir `libx264` ou seulement `libopenh264`, connaître ou non
 * `libx265`, savoir ou non écrire des sous-titres `mov_text` dans un MP4. Rien
 * ne serait pire qu'une liste de codecs alléchante dont la moitié échouerait à
 * l'exécution : l'interface ne propose donc **que** ce qui est présent.
 *
 * Tout est déduit d'une seule source de vérité, `ffmpeg -encoders`, lue une fois
 * puis mise en cache (`availableEncoders`). Les fonctions de ce module sont
 * pures à partir de cette liste, donc testables sans FFmpeg.
 */

/** Familles de codecs vidéo que FourTout sait piloter. */
export type VideoCodecId = "h264" | "h265" | "vp9" | "av1";
/** Familles de codecs audio que FourTout sait piloter. */
export type AudioCodecId = "aac" | "opus" | "mp3" | "vorbis";
/** Conteneurs de sortie proposés. */
export type VideoContainerId = "mp4" | "mkv" | "webm" | "mov";

/** Encodeurs acceptés pour chaque famille, par ordre de préférence. */
const VIDEO_ENCODERS: Record<VideoCodecId, string[]> = {
  h264: ["libx264", "h264_nvenc", "libopenh264"],
  h265: ["libx265", "hevc_nvenc"],
  vp9: ["libvpx-vp9"],
  av1: ["libsvtav1", "libaom-av1"],
};

const AUDIO_ENCODERS: Record<AudioCodecId, string[]> = {
  aac: ["libfdk_aac", "aac"],
  opus: ["libopus"],
  mp3: ["libmp3lame"],
  vorbis: ["libvorbis"],
};

/** Encodeur de sous-titres textuels attendu par chaque conteneur. */
export const SUBTITLE_ENCODER: Record<VideoContainerId, string> = {
  mp4: "mov_text",
  mov: "mov_text",
  mkv: "srt",
  webm: "webvtt",
};

export interface MediaCapabilities {
  /** Encodeur retenu par famille vidéo (absent = famille indisponible). */
  video: Partial<Record<VideoCodecId, string>>;
  /** Encodeur retenu par famille audio. */
  audio: Partial<Record<AudioCodecId, string>>;
  /** Conteneurs dans lesquels une piste de sous-titres textuelle est écrivable. */
  subtitleContainers: VideoContainerId[];
  /** Liste brute, pour le diagnostic. */
  encoders: string[];
}

/** Familles réellement disponibles, déduites d'une liste d'encodeurs. */
export function capabilitiesFromEncoders(encoders: readonly string[]): MediaCapabilities {
  const present = new Set(encoders);
  const pick = <T extends string>(table: Record<T, string[]>): Partial<Record<T, string>> => {
    const result: Partial<Record<T, string>> = {};
    for (const key of Object.keys(table) as T[]) {
      const found = table[key].find((name) => present.has(name));
      if (found) result[key] = found;
    }
    return result;
  };

  const containers = (["mp4", "mov", "mkv", "webm"] as VideoContainerId[]).filter((container) =>
    present.has(SUBTITLE_ENCODER[container]),
  );

  return {
    video: pick(VIDEO_ENCODERS),
    audio: pick(AUDIO_ENCODERS),
    subtitleContainers: containers,
    encoders: [...encoders],
  };
}

let cache: Promise<MediaCapabilities> | undefined;

/** Capacités du FFmpeg courant (une seule interrogation par session). */
export function mediaCapabilities(): Promise<MediaCapabilities> {
  if (!cache) cache = availableEncoders().then(capabilitiesFromEncoders);
  return cache;
}

/** Réinitialise le cache — réservé aux tests. */
export function resetCapabilitiesCache(): void {
  cache = undefined;
}

/* -------------------------------------------------------------- conteneurs */

/** Codecs qu'un conteneur accepte, indépendamment du build FFmpeg. */
const CONTAINER_VIDEO: Record<VideoContainerId, VideoCodecId[]> = {
  mp4: ["h264", "h265", "av1"],
  mov: ["h264", "h265"],
  mkv: ["h264", "h265", "vp9", "av1"],
  webm: ["vp9", "av1"],
};

const CONTAINER_AUDIO: Record<VideoContainerId, AudioCodecId[]> = {
  mp4: ["aac", "mp3"],
  mov: ["aac"],
  mkv: ["aac", "opus", "mp3", "vorbis"],
  webm: ["opus", "vorbis"],
};

export const CONTAINER_LABEL: Record<VideoContainerId, string> = {
  mp4: "MP4",
  mkv: "MKV",
  webm: "WebM",
  mov: "MOV",
};

export const VIDEO_CODEC_LABEL: Record<VideoCodecId, string> = {
  h264: "H.264",
  h265: "H.265 / HEVC",
  vp9: "VP9",
  av1: "AV1",
};

export const AUDIO_CODEC_LABEL: Record<AudioCodecId, string> = {
  aac: "AAC",
  opus: "Opus",
  mp3: "MP3",
  vorbis: "Vorbis",
};

export const CONTAINER_MIME: Record<VideoContainerId, string> = {
  mp4: "video/mp4",
  mkv: "video/x-matroska",
  webm: "video/webm",
  mov: "video/quicktime",
};

/** Codecs vidéo utilisables dans ce conteneur **et** présents dans le build. */
export function videoCodecsFor(
  container: VideoContainerId,
  caps: MediaCapabilities,
): VideoCodecId[] {
  return CONTAINER_VIDEO[container].filter((codec) => caps.video[codec]);
}

/** Codecs audio utilisables dans ce conteneur **et** présents dans le build. */
export function audioCodecsFor(
  container: VideoContainerId,
  caps: MediaCapabilities,
): AudioCodecId[] {
  return CONTAINER_AUDIO[container].filter((codec) => caps.audio[codec]);
}

/** Conteneurs réellement utilisables (au moins un codec vidéo disponible). */
export function containersAvailable(caps: MediaCapabilities): VideoContainerId[] {
  return (["mp4", "mkv", "webm", "mov"] as VideoContainerId[]).filter(
    (container) => videoCodecsFor(container, caps).length > 0,
  );
}

/**
 * Combinaison la plus compatible possible avec ce build : H.264 + AAC en MP4
 * quand c'est disponible, sinon la meilleure solution de repli réellement
 * présente. Renvoie `undefined` si aucun encodage vidéo n'est possible.
 */
export function mostCompatible(
  caps: MediaCapabilities,
): { container: VideoContainerId; video: VideoCodecId; audio?: AudioCodecId } | undefined {
  for (const container of ["mp4", "mkv", "webm", "mov"] as VideoContainerId[]) {
    const video = videoCodecsFor(container, caps);
    if (video.length === 0) continue;
    const audio = audioCodecsFor(container, caps);
    return { container, video: video[0], audio: audio[0] };
  }
  return undefined;
}

/** Le codec vidéo d'une source est-il recopiable tel quel dans ce conteneur ? */
export function canCopyVideo(sourceCodec: string | undefined, container: VideoContainerId): boolean {
  const family = familyOfCodecName(sourceCodec);
  return family !== undefined && CONTAINER_VIDEO[container].includes(family);
}

/** `h264`, `hevc`, `vp9`… → famille FourTout. */
export function familyOfCodecName(name: string | undefined): VideoCodecId | undefined {
  switch ((name ?? "").toLowerCase()) {
    case "h264":
    case "avc":
      return "h264";
    case "hevc":
    case "h265":
      return "h265";
    case "vp9":
      return "vp9";
    case "av1":
      return "av1";
    default:
      return undefined;
  }
}
