import { availableEncoders, probeEncoders } from "./client";

/**
 * Capacités **réelles** du FFmpeg utilisé.
 *
 * Deux niveaux de vérité, et le premier ne suffit pas :
 *
 * 1. `ffmpeg -encoders` dit ce que le binaire sait faire **en théorie**. Un
 *    `h264_nvenc` y figure dès que FFmpeg a été compilé avec, indépendamment de
 *    la présence d'une carte NVIDIA, d'un pilote compatible ou d'un accès au
 *    périphérique dans la session courante.
 * 2. Un **test d'encodage réel** (commande native `media_probe_encoders` : une
 *    image 64×64 encodée vers `null`) dit ce qui marche **ici**.
 *
 * FourTout ne propose que ce qui a passé le second niveau. C'est la différence
 * entre une liste de codecs alléchante dont la moitié échoue une minute après
 * le clic, et une liste sur laquelle on peut compter.
 *
 * Les fonctions de ce module sont pures à partir des deux listes, donc
 * testables sans FFmpeg.
 */

/** Familles de codecs vidéo que FourTout sait piloter. */
export type VideoCodecId = "h264" | "h265" | "vp9" | "av1";
/** Familles de codecs audio que FourTout sait piloter. */
export type AudioCodecId = "aac" | "opus" | "mp3" | "vorbis";
/** Conteneurs de sortie proposés. */
export type VideoContainerId = "mp4" | "mkv" | "webm" | "mov";

/**
 * Encodeurs acceptés pour chaque famille vidéo, **par ordre de préférence**.
 *
 * Les encodeurs logiciels passent devant les encodeurs matériels : la fiabilité
 * prime sur la vitesse. Un encodeur matériel n'est retenu que s'il a réellement
 * passé son test — et il ne devance jamais un encodeur logiciel qui fonctionne.
 */
const VIDEO_ENCODERS: Record<VideoCodecId, string[]> = {
  h264: ["libx264", "libopenh264", "h264_nvenc", "h264_qsv", "h264_vaapi", "h264_v4l2m2m"],
  h265: ["libx265", "hevc_nvenc", "hevc_qsv", "hevc_vaapi", "hevc_v4l2m2m"],
  vp9: ["libvpx-vp9", "vp9_qsv", "vp9_vaapi"],
  av1: ["libsvtav1", "libaom-av1", "av1_nvenc", "av1_qsv", "av1_vaapi"],
};

/** Encodeurs matériels : dépendent du GPU, du pilote et de la session. */
const HARDWARE = /_(nvenc|qsv|vaapi|videotoolbox|amf|v4l2m2m|mf)$/;

/** L'encodeur s'appuie-t-il sur du matériel (donc testable, jamais supposé) ? */
export function isHardwareEncoder(encoder: string): boolean {
  return HARDWARE.test(encoder);
}

/** Tous les encodeurs vidéo que FourTout est susceptible d'utiliser. */
export function videoEncoderCandidates(): string[] {
  return [...new Set(Object.values(VIDEO_ENCODERS).flat())];
}

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
  /** Encodeur retenu par famille vidéo (absent = famille indisponible ici). */
  video: Partial<Record<VideoCodecId, string>>;
  /** Encodeurs de repli, du plus sûr au moins sûr, pour chaque famille. */
  videoAlternatives: Partial<Record<VideoCodecId, string[]>>;
  /** Encodeur retenu par famille audio. */
  audio: Partial<Record<AudioCodecId, string>>;
  /** Conteneurs dans lesquels une piste de sous-titres textuelle est écrivable. */
  subtitleContainers: VideoContainerId[];
  /** Liste brute annoncée par `ffmpeg -encoders`, pour le diagnostic. */
  encoders: string[];
  /** Encodeurs vidéo ayant réellement encodé une image ici. */
  usableVideo: string[];
  /** Encodeurs vidéo annoncés mais **refusés au test** (diagnostic). */
  rejectedVideo: string[];
}

export interface CapabilityInput {
  /** Ce que `ffmpeg -encoders` annonce. */
  announced: readonly string[];
  /**
   * Encodeurs vidéo ayant passé le test d'encodage réel. Les encodeurs vidéo
   * absents de cette liste ne sont **jamais** proposés.
   */
  usableVideo: readonly string[];
}

/** Familles réellement utilisables, à partir des deux niveaux de vérité. */
export function buildCapabilities({ announced, usableVideo }: CapabilityInput): MediaCapabilities {
  const present = new Set(announced);
  const usable = new Set(usableVideo);

  const video: Partial<Record<VideoCodecId, string>> = {};
  const videoAlternatives: Partial<Record<VideoCodecId, string[]>> = {};
  for (const family of Object.keys(VIDEO_ENCODERS) as VideoCodecId[]) {
    // Un encodeur vidéo doit être annoncé **et** avoir réellement encodé.
    const working = VIDEO_ENCODERS[family].filter((name) => present.has(name) && usable.has(name));
    if (working.length > 0) {
      video[family] = working[0];
      videoAlternatives[family] = working;
    }
  }

  const audio: Partial<Record<AudioCodecId, string>> = {};
  for (const family of Object.keys(AUDIO_ENCODERS) as AudioCodecId[]) {
    const found = AUDIO_ENCODERS[family].find((name) => present.has(name));
    if (found) audio[family] = found;
  }

  const containers = (["mp4", "mov", "mkv", "webm"] as VideoContainerId[]).filter((container) =>
    present.has(SUBTITLE_ENCODER[container]),
  );

  const candidates = videoEncoderCandidates();
  return {
    video,
    videoAlternatives,
    audio,
    subtitleContainers: containers,
    encoders: [...announced],
    usableVideo: candidates.filter((name) => present.has(name) && usable.has(name)),
    rejectedVideo: candidates.filter((name) => present.has(name) && !usable.has(name)),
  };
}

let cache: Promise<MediaCapabilities> | undefined;

/**
 * Capacités du FFmpeg courant. La détection — liste annoncée puis test réel de
 * chaque candidat — n'a lieu **qu'une fois par session** : chaque test lance un
 * vrai FFmpeg, on ne le refait pas à chaque clic.
 */
export function mediaCapabilities(): Promise<MediaCapabilities> {
  if (!cache) {
    cache = (async () => {
      const announced = await availableEncoders();
      const candidates = videoEncoderCandidates().filter((name) => announced.includes(name));
      const usableVideo = await probeEncoders(candidates);
      return buildCapabilities({ announced, usableVideo });
    })();
  }
  return cache;
}

/**
 * Lance la détection en tâche de fond, sans attendre le résultat.
 *
 * Essayer réellement une dizaine d'encodeurs coûte quelques secondes. Les
 * déclencher au démarrage plutôt qu'à l'ouverture du premier outil vidéo rend
 * ce coût invisible.
 */
export function warmMediaCapabilities(): void {
  void mediaCapabilities().catch(() => undefined);
}

/** Réinitialise le cache — tests, ou nouveau matériel branché. */
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

/** Codecs vidéo utilisables dans ce conteneur **et** utilisables ici. */
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
 * Codec vidéo à retenir pour un conteneur : le plus largement lisible d'abord,
 * parmi ceux qui fonctionnent réellement. **Unique** point de décision — tous
 * les outils passent par ici, sans quoi ils divergeraient.
 */
export function preferredVideoCodec(
  container: VideoContainerId,
  caps: MediaCapabilities,
): VideoCodecId | undefined {
  const available = videoCodecsFor(container, caps);
  return (["h264", "vp9", "h265", "av1"] as VideoCodecId[]).find((codec) =>
    available.includes(codec),
  );
}

/**
 * Combinaison la plus compatible possible avec cet environnement : H.264 + AAC
 * en MP4 quand c'est réellement encodable, sinon la meilleure solution de repli
 * qui fonctionne. Renvoie `undefined` si aucun encodage vidéo n'est possible.
 */
export function mostCompatible(
  caps: MediaCapabilities,
): { container: VideoContainerId; video: VideoCodecId; audio?: AudioCodecId } | undefined {
  for (const container of ["mp4", "mkv", "webm", "mov"] as VideoContainerId[]) {
    const video = preferredVideoCodec(container, caps);
    if (!video) continue;
    return { container, video, audio: audioCodecsFor(container, caps)[0] };
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
