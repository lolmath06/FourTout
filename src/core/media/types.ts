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
  const streams: MediaStream[] = (data.streams ?? []).map((s) => ({
    index: Number(s.index ?? 0),
    codecType: String(s.codec_type ?? ""),
    codecName: s.codec_name ? String(s.codec_name) : undefined,
    channels: s.channels != null ? Number(s.channels) : undefined,
    sampleRate: s.sample_rate != null ? Number(s.sample_rate) : undefined,
    width: s.width != null ? Number(s.width) : undefined,
    height: s.height != null ? Number(s.height) : undefined,
    bitRate: s.bit_rate != null ? Number(s.bit_rate) : undefined,
  }));
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
