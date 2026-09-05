/** Types du socle média (FFmpeg/ffprobe). */

export interface MediaStream {
  index: number;
  codecType: "audio" | "video" | "subtitle" | "data" | string;
  codecName?: string;
  channels?: number;
  sampleRate?: number;
  width?: number;
  height?: number;
  bitRate?: number;
  /** Images par seconde (flux vidéo), déduit de `avg_frame_rate`. */
  frameRate?: number;
  /** Format de pixels (`yuv420p`…), utile pour juger la compatibilité. */
  pixelFormat?: string;
  /** Code langue ISO du flux (`fra`, `eng`…), tel que déclaré. */
  language?: string;
  /** Titre du flux, tel que déclaré (« Commentaire », « Forced »…). */
  title?: string;
}

/** Une piste de sous-titres telle qu'exposée à l'utilisateur. */
export interface SubtitleTrack {
  /** Index **relatif** parmi les pistes de sous-titres (0 = la première). */
  order: number;
  /** Index absolu dans le fichier. */
  index: number;
  codecName?: string;
  language?: string;
  title?: string;
  /**
   * Piste textuelle (SubRip, ASS, WebVTT, mov_text) ? Les pistes graphiques
   * (PGS, DVD, DVB) sont des images : elles ne sont pas convertibles en texte
   * sans reconnaissance de caractères, ce que cet outil ne fait pas.
   */
  textBased: boolean;
}

/** Codecs de sous-titres réellement textuels (extractibles tels quels). */
const TEXT_SUBTITLE_CODECS = new Set([
  "subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text", "microdvd",
  "jacosub", "sami", "realtext", "stl", "subviewer", "subviewer1", "vplayer", "pjs", "mpl2",
]);

/** Une piste de sous-titres est-elle textuelle (par opposition à graphique) ? */
export function isTextSubtitle(codecName: string | undefined): boolean {
  return TEXT_SUBTITLE_CODECS.has((codecName ?? "").toLowerCase());
}

/** `30000/1001` → 29.97. Renvoie `undefined` si la fraction est vide ou nulle. */
export function parseFrameRate(value: unknown): number | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const [num, den] = value.split("/").map(Number);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  const divisor = Number.isFinite(den) && den !== 0 ? den : 1;
  return Math.round((num / divisor) * 1000) / 1000;
}

export interface MediaInfo {
  /** Durée en millisecondes (0 si inconnue). */
  durationMs: number;
  /** Nom court du conteneur (ffprobe `format_name`). */
  formatName: string;
  /** Débit global en bits/s, si connu. */
  bitRate?: number;
  streams: MediaStream[];
  hasAudio: boolean;
  hasVideo: boolean;
  audioCodec?: string;
  videoCodec?: string;
  channels?: number;
  sampleRate?: number;
  width?: number;
  height?: number;
  /** Images par seconde du flux vidéo principal. */
  frameRate?: number;
  /** Format de pixels du flux vidéo principal. */
  pixelFormat?: string;
  /** Débit du flux vidéo principal, si déclaré. */
  videoBitRate?: number;
  /** Toutes les pistes audio, dans l'ordre du fichier. */
  audioStreams: MediaStream[];
  /** Toutes les pistes de sous-titres, décrites pour l'interface. */
  subtitles: SubtitleTrack[];
}

/** Une opération FFmpeg prête à lancer : arguments entre l'entrée et la sortie. */
export interface MediaOperation {
  /** Arguments FFmpeg (codec, filtres…), sans `-i` ni chemin de sortie. */
  args: string[];
  /** Extension du fichier de sortie (sans point). */
  outputExt: string;
  /** Arguments placés avant `-i` (rare). */
  preInputArgs?: string[];
  /** Type MIME de la sortie, pour l'aperçu/enregistrement. */
  mimeType: string;
}

/** Analyse le JSON ffprobe en informations exploitables. */
export function parseProbe(json: string): MediaInfo {
  const data = JSON.parse(json) as {
    format?: { duration?: string; format_name?: string; bit_rate?: string };
    streams?: Array<Record<string, unknown>>;
  };
  const streams: MediaStream[] = (data.streams ?? []).map((s) => {
    const tags = (s.tags ?? {}) as Record<string, unknown>;
    return {
      index: Number(s.index ?? 0),
      codecType: String(s.codec_type ?? ""),
      codecName: s.codec_name ? String(s.codec_name) : undefined,
      channels: s.channels != null ? Number(s.channels) : undefined,
      sampleRate: s.sample_rate != null ? Number(s.sample_rate) : undefined,
      width: s.width != null ? Number(s.width) : undefined,
      height: s.height != null ? Number(s.height) : undefined,
      bitRate: s.bit_rate != null ? Number(s.bit_rate) : undefined,
      frameRate: parseFrameRate(s.avg_frame_rate) ?? parseFrameRate(s.r_frame_rate),
      pixelFormat: s.pix_fmt ? String(s.pix_fmt) : undefined,
      language: tags.language ? String(tags.language) : undefined,
      title: tags.title ? String(tags.title) : undefined,
    };
  });
  const audio = streams.find((s) => s.codecType === "audio");
  const video = streams.find((s) => s.codecType === "video");
  const durationSec = Number(data.format?.duration ?? 0);
  return {
    durationMs: Number.isFinite(durationSec) ? Math.round(durationSec * 1000) : 0,
    formatName: data.format?.format_name ?? "",
    bitRate: data.format?.bit_rate ? Number(data.format.bit_rate) : undefined,
    streams,
    hasAudio: Boolean(audio),
    hasVideo: Boolean(video),
    audioCodec: audio?.codecName,
    videoCodec: video?.codecName,
    channels: audio?.channels,
    sampleRate: audio?.sampleRate,
    width: video?.width,
    height: video?.height,
    frameRate: video?.frameRate,
    pixelFormat: video?.pixelFormat,
    videoBitRate: video?.bitRate,
    audioStreams: streams.filter((s) => s.codecType === "audio"),
    subtitles: streams
      .filter((s) => s.codecType === "subtitle")
      .map((s, order) => ({
        order,
        index: s.index,
        codecName: s.codecName,
        language: s.language,
        title: s.title,
        textBased: isTextSubtitle(s.codecName),
      })),
  };
}

/** Informations vides, utilisées quand ffprobe échoue sur un fichier. */
export function emptyMediaInfo(): MediaInfo {
  return {
    durationMs: 0,
    formatName: "",
    streams: [],
    hasAudio: false,
    hasVideo: false,
    audioStreams: [],
    subtitles: [],
  };
}

/** `hh:mm:ss.mmm` → millisecondes. Tolère `mm:ss`, `ss`, décimales. */
export function parseTimecode(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parts = trimmed.split(":").map((p) => p.trim());
  if (parts.some((p) => p === "" || Number.isNaN(Number(p)))) return undefined;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + Number(part);
  return Math.round(seconds * 1000);
}

/** millisecondes → `hh:mm:ss.mmm`. */
export function formatTimecode(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(millis, 3)}`;
}

/** Formats audio de sortie proposés. */
export const AUDIO_FORMATS = ["mp3", "wav", "flac", "ogg", "opus", "m4a", "aac"] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

export const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  opus: "audio/opus",
  m4a: "audio/mp4",
  aac: "audio/aac",
};
