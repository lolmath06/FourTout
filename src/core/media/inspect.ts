import { parseFrameRate } from "./types";

/**
 * Fiche d'identité détaillée d'un fichier média.
 *
 * Tout vient de la **même** commande ffprobe que le reste du socle
 * (`-show_format -show_streams`) : rien n'est recalculé ici de ce que ffprobe
 * sait déjà, et rien n'est deviné de ce qu'il ne dit pas. Un champ absent reste
 * absent — c'est une information en soi, et la remplacer par une estimation
 * ferait passer une déduction pour une mesure.
 *
 * Le seul écart assumé : quand un flux ne déclare pas son débit mais que le
 * conteneur, lui, donne le débit global, le rapport le signale comme
 * « déduit » plutôt que de laisser la case vide.
 */

export interface MediaTag {
  key: string;
  value: string;
}

/** Cadence d'un flux vidéo, telle que ffprobe la décrit — sans arbitrage. */
export interface FrameRateInfo {
  /** `r_frame_rate` : la plus petite cadence dont toutes les images sont multiples. */
  realFraction?: string;
  real?: number;
  /** `avg_frame_rate` : nombre d'images divisé par la durée. */
  averageFraction?: string;
  average?: number;
  /**
   * Les deux valeurs divergent-elles ? C'est l'indice — pas la preuve — d'une
   * cadence variable. FourTout le signale et s'arrête là : affirmer « cette
   * vidéo est en VFR » demanderait de parcourir tous les horodatages.
   */
  diverging: boolean;
}

export interface VideoStreamDetails {
  index: number;
  codecName?: string;
  codecLongName?: string;
  profile?: string;
  level?: number;
  width?: number;
  height?: number;
  /** Rapport d'aspect des échantillons (`1:1`…). */
  sampleAspectRatio?: string;
  /** Rapport d'aspect d'affichage (`16:9`…). */
  displayAspectRatio?: string;
  pixelFormat?: string;
  colorSpace?: string;
  colorTransfer?: string;
  colorPrimaries?: string;
  colorRange?: string;
  fieldOrder?: string;
  frameRate: FrameRateInfo;
  /** Nombre d'images, uniquement si le conteneur le déclare. */
  frameCount?: number;
  bitRate?: number;
  /** Le débit affiché vient-il du conteneur faute d'être déclaré par le flux ? */
  bitRateInferred: boolean;
  language?: string;
  title?: string;
  /** Image de couverture embarquée (pochette d'album) plutôt qu'une vraie vidéo. */
  attachedPicture: boolean;
}

export interface AudioStreamDetails {
  index: number;
  codecName?: string;
  codecLongName?: string;
  profile?: string;
  sampleRate?: number;
  channels?: number;
  /** `stereo`, `5.1`… tel que déclaré. */
  channelLayout?: string;
  /** Profondeur en bits, quand le codec en a une (PCM, FLAC). */
  bitDepth?: number;
  sampleFormat?: string;
  bitRate?: number;
  bitRateInferred: boolean;
  language?: string;
  title?: string;
  default: boolean;
}

export interface SubtitleStreamDetails {
  index: number;
  codecName?: string;
  language?: string;
  title?: string;
  forced: boolean;
  default: boolean;
}

export interface MediaDetails {
  /** Nom du conteneur, forme courte puis longue. */
  formatName: string;
  formatLongName?: string;
  durationMs: number;
  /** Taille déclarée par ffprobe, en octets. */
  sizeBytes?: number;
  /** Débit global, en bits/s. */
  bitRate?: number;
  video: VideoStreamDetails[];
  audio: AudioStreamDetails[];
  subtitles: SubtitleStreamDetails[];
  /** Étiquettes du conteneur (titre, artiste, album…), dans l'ordre reçu. */
  tags: MediaTag[];
  /** Le fichier porte-t-il une image de couverture ? */
  hasCoverArt: boolean;
  /** Gain de lecture normalisé, si le fichier en déclare un. */
  replayGain: MediaTag[];
  /** Logiciel d'encodage déclaré, conteneur ou flux. */
  encoder?: string;
  /** Nombre de flux qui ne sont ni vidéo, ni audio, ni sous-titres. */
  otherStreams: number;
}

type Raw = Record<string, unknown>;

const str = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
};

const num = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

function tagsOf(source: Raw | undefined): MediaTag[] {
  if (!source) return [];
  return Object.entries(source)
    .map(([key, value]) => ({ key: key.toLowerCase(), value: str(value) ?? "" }))
    .filter((tag) => tag.value !== "");
}

function tagValue(tags: MediaTag[], key: string): string | undefined {
  return tags.find((tag) => tag.key === key)?.value;
}

/** Étiquettes techniques, sans intérêt sur une fiche destinée à un humain. */
const HIDDEN_TAGS = new Set([
  "handler_name",
  "vendor_id",
  "major_brand",
  "minor_version",
  "compatible_brands",
  "language",
]);

function frameRateOf(stream: Raw): FrameRateInfo {
  const realFraction = str(stream.r_frame_rate);
  const averageFraction = str(stream.avg_frame_rate);
  const real = parseFrameRate(realFraction);
  const average = parseFrameRate(averageFraction);
  return {
    realFraction: real === undefined ? undefined : realFraction,
    real,
    averageFraction: average === undefined ? undefined : averageFraction,
    average,
    diverging: real !== undefined && average !== undefined && Math.abs(real - average) > 0.01,
  };
}

/** Analyse le JSON ffprobe complet en une fiche détaillée. */
export function inspectMedia(json: string): MediaDetails {
  const data = JSON.parse(json) as { format?: Raw; streams?: Raw[] };
  const format = data.format ?? {};
  const streams = data.streams ?? [];

  const containerBitRate = num(format.bit_rate);
  const durationSec = num(format.duration) ?? 0;

  const video: VideoStreamDetails[] = [];
  const audio: AudioStreamDetails[] = [];
  const subtitles: SubtitleStreamDetails[] = [];
  let otherStreams = 0;
  let streamEncoder: string | undefined;

  for (const stream of streams) {
    const streamTags = tagsOf(stream.tags as Raw | undefined);
    const disposition = (stream.disposition ?? {}) as Record<string, number>;
    const language = tagValue(streamTags, "language");
    const title = tagValue(streamTags, "title");
    streamEncoder ??= tagValue(streamTags, "encoder");
    const bitRate = num(stream.bit_rate);

    switch (String(stream.codec_type)) {
      case "video":
        video.push({
          index: Number(stream.index ?? 0),
          codecName: str(stream.codec_name),
          codecLongName: str(stream.codec_long_name),
          profile: str(stream.profile),
          level: num(stream.level),
          width: num(stream.width),
          height: num(stream.height),
          sampleAspectRatio: str(stream.sample_aspect_ratio),
          displayAspectRatio: str(stream.display_aspect_ratio),
          pixelFormat: str(stream.pix_fmt),
          colorSpace: str(stream.color_space),
          colorTransfer: str(stream.color_transfer),
          colorPrimaries: str(stream.color_primaries),
          colorRange: str(stream.color_range),
          fieldOrder: str(stream.field_order),
          frameRate: frameRateOf(stream),
          frameCount: num(stream.nb_frames),
          // Sur un fichier à flux vidéo unique, le débit du conteneur est une
          // approximation acceptable — mais elle est annoncée comme telle.
          bitRate: bitRate ?? (streams.length === 1 ? containerBitRate : undefined),
          bitRateInferred: bitRate === undefined && streams.length === 1 && containerBitRate !== undefined,
          language: language === "und" ? undefined : language,
          title,
          attachedPicture: disposition.attached_pic === 1,
        });
        break;
      case "audio": {
        const bitsPerRaw = num(stream.bits_per_raw_sample);
        const bitsPerSample = num(stream.bits_per_sample);
        audio.push({
          index: Number(stream.index ?? 0),
          codecName: str(stream.codec_name),
          codecLongName: str(stream.codec_long_name),
          profile: str(stream.profile),
          sampleRate: num(stream.sample_rate),
          channels: num(stream.channels),
          channelLayout: str(stream.channel_layout),
          // `bits_per_sample` vaut 0 pour les codecs compressés : c'est « sans
          // objet », pas « zéro bit ».
          bitDepth: bitsPerRaw || (bitsPerSample ? bitsPerSample : undefined),
          sampleFormat: str(stream.sample_fmt),
          bitRate: bitRate ?? (streams.length === 1 ? containerBitRate : undefined),
          bitRateInferred: bitRate === undefined && streams.length === 1 && containerBitRate !== undefined,
          language: language === "und" ? undefined : language,
          title,
          default: disposition.default === 1,
        });
        break;
      }
      case "subtitle":
        subtitles.push({
          index: Number(stream.index ?? 0),
          codecName: str(stream.codec_name),
          language: language === "und" ? undefined : language,
          title,
          forced: disposition.forced === 1,
          default: disposition.default === 1,
        });
        break;
      default:
        otherStreams += 1;
    }
  }

  const formatTags = tagsOf(format.tags as Raw | undefined);
  const replayGain = formatTags.filter((tag) => tag.key.includes("replaygain") || tag.key.startsWith("r128_"));
  const visible = formatTags.filter(
    (tag) => !HIDDEN_TAGS.has(tag.key) && !replayGain.includes(tag) && tag.key !== "encoder",
  );

  return {
    formatName: str(format.format_name) ?? "",
    formatLongName: str(format.format_long_name),
    durationMs: Math.round(durationSec * 1000),
    sizeBytes: num(format.size),
    bitRate: containerBitRate,
    video,
    audio,
    subtitles,
    tags: visible,
    hasCoverArt: video.some((stream) => stream.attachedPicture),
    replayGain,
    encoder: tagValue(formatTags, "encoder") ?? streamEncoder,
    otherStreams,
  };
}

/* ------------------------------------------------------------- présentation */

/** `1 411 kb/s` — débit lisible, arrondi au kilobit. */
export function formatBitRate(bitsPerSecond: number): string {
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(2)} Mb/s`;
  return `${Math.round(bitsPerSecond / 1000)} kb/s`;
}

/** `48 kHz` — fréquence d'échantillonnage lisible. */
export function formatSampleRate(hz: number): string {
  return hz % 1000 === 0 ? `${hz / 1000} kHz` : `${(hz / 1000).toFixed(1)} kHz`;
}

/** Nom courant d'une disposition de canaux, avec repli sur le compte. */
export function describeChannels(channels: number | undefined, layout: string | undefined): string {
  if (layout) return channels ? `${layout} (${channels})` : layout;
  if (channels === undefined) return "inconnu";
  if (channels === 1) return "mono (1)";
  if (channels === 2) return "stéréo (2)";
  return `${channels} canaux`;
}

/** Le fichier est-il une vidéo, ou seulement de l'audio avec une pochette ? */
export function isRealVideo(details: MediaDetails): boolean {
  return details.video.some((stream) => !stream.attachedPicture);
}
