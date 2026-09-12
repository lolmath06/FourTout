import { AUDIO_MIME, type AudioFormat } from "../types";

/**
 * Constructeurs d'opérations audio FFmpeg.
 *
 * Chaque fonction renvoie la liste d'arguments FFmpeg complète, à partir des
 * chemins d'entrée et de sortie (fournis par le socle natif). Ce sont des
 * fonctions pures : elles ne touchent ni au disque ni à Tauri, et sont donc
 * testables directement. Les arguments sont toujours séparés — jamais de shell.
 */

export interface AudioOp {
  buildArgs: (inputs: string[], output: string) => string[];
  outputExt: string;
  mimeType: string;
}

/** Arguments de codec pour un format de sortie donné. */
export function codecArgs(
  format: AudioFormat,
  options: { bitrateKbps?: number; quality?: number; sampleRate?: number; channels?: number } = {},
): string[] {
  const args: string[] = [];
  switch (format) {
    case "mp3":
      args.push("-c:a", "libmp3lame");
      if (options.bitrateKbps) args.push("-b:a", `${options.bitrateKbps}k`);
      else args.push("-q:a", String(options.quality ?? 2));
      break;
    case "wav":
      args.push("-c:a", "pcm_s16le");
      break;
    case "flac":
      args.push("-c:a", "flac");
      break;
    case "ogg":
      args.push("-c:a", "libvorbis", "-q:a", String(options.quality ?? 5));
      break;
    case "opus":
      args.push("-c:a", "libopus", "-b:a", `${options.bitrateKbps ?? 96}k`);
      break;
    case "m4a":
    case "aac":
      args.push("-c:a", "aac", "-b:a", `${options.bitrateKbps ?? 192}k`);
      break;
  }
  if (options.sampleRate) args.push("-ar", String(options.sampleRate));
  if (options.channels) args.push("-ac", String(options.channels));
  return args;
}

const ms = (v: number) => (v / 1000).toFixed(3);

export function convertAudio(
  format: AudioFormat,
  options: { bitrateKbps?: number; quality?: number; sampleRate?: number; channels?: number } = {},
): AudioOp {
  return {
    outputExt: format,
    mimeType: AUDIO_MIME[format],
    buildArgs: (inputs, output) => ["-i", inputs[0], ...codecArgs(format, options), output],
  };
}

export function compressAudio(format: AudioFormat, bitrateKbps: number): AudioOp {
  return {
    outputExt: format,
    mimeType: AUDIO_MIME[format],
    buildArgs: (inputs, output) => ["-i", inputs[0], ...codecArgs(format, { bitrateKbps }), output],
  };
}

export function trimAudio(startMs: number, endMs: number, format: AudioFormat): AudioOp {
  const duration = Math.max(0, endMs - startMs);
  return {
    outputExt: format,
    mimeType: AUDIO_MIME[format],
    // `-ss` avant `-i` : recherche rapide et précise ; `-t` = durée du segment.
    buildArgs: (inputs, output) => [
      "-ss", ms(startMs), "-i", inputs[0], "-t", ms(duration), ...codecArgs(format), output,
    ],
  };
}

export function mergeAudio(format: AudioFormat): AudioOp {
  return {
    outputExt: format,
    mimeType: AUDIO_MIME[format],
    buildArgs: (inputs, output) => {
      const ins = inputs.flatMap((path) => ["-i", path]);
      const filter = `${inputs.map((_, i) => `[${i}:a]`).join("")}concat=n=${inputs.length}:v=0:a=1[out]`;
      return [...ins, "-filter_complex", filter, "-map", "[out]", ...codecArgs(format), output];
    },
  };
}

/** Volume en décibels (peut être négatif). */
export function volumeAudio(db: number, format: AudioFormat): AudioOp {
  return {
    outputExt: format,
    mimeType: AUDIO_MIME[format],
    buildArgs: (inputs, output) => ["-i", inputs[0], "-filter:a", `volume=${db}dB`, ...codecArgs(format), output],
  };
}

export type NormalizePreset = "standard" | "podcast" | "music";

/** Normalisation EBU R128 (loudnorm) selon un préréglage. */
export function normalizeAudio(preset: NormalizePreset, format: AudioFormat): AudioOp {
  const targets: Record<NormalizePreset, { i: number; tp: number; lra: number }> = {
    standard: { i: -16, tp: -1.5, lra: 11 },
    podcast: { i: -16, tp: -1.5, lra: 11 },
    music: { i: -14, tp: -1, lra: 11 },
  };
  const t = targets[preset];
  return {
    outputExt: format,
    mimeType: AUDIO_MIME[format],
    buildArgs: (inputs, output) => [
      "-i", inputs[0], "-filter:a", `loudnorm=I=${t.i}:TP=${t.tp}:LRA=${t.lra}`, ...codecArgs(format), output,
    ],
  };
}

/** Chaîne de filtres `atempo` (borné à [0.5,2] par étape) pour un facteur donné. */
export function atempoChain(factor: number): string {
  const steps: number[] = [];
  let remaining = factor;
  while (remaining > 2) {
    steps.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    steps.push(0.5);
    remaining /= 0.5;
  }
  steps.push(Number(remaining.toFixed(4)));
  return steps.map((s) => `atempo=${s}`).join(",");
}

/** Vitesse en conservant la hauteur (atempo ne change pas le pitch). */
export function speedAudio(factor: number, format: AudioFormat): AudioOp {
  return {
    outputExt: format,
    mimeType: AUDIO_MIME[format],
    buildArgs: (inputs, output) => ["-i", inputs[0], "-filter:a", atempoChain(factor), ...codecArgs(format), output],
  };
}

export function removeSilenceAudio(
  format: AudioFormat,
  options: { thresholdDb?: number; minSilenceMs?: number } = {},
): AudioOp {
  const threshold = options.thresholdDb ?? -35;
  const minSilence = (options.minSilenceMs ?? 1000) / 1000;
  // Retire les silences en début, entre segments et en fin.
  const filter =
    `silenceremove=start_periods=1:start_duration=${minSilence}:start_threshold=${threshold}dB:` +
    `stop_periods=-1:stop_duration=${minSilence}:stop_threshold=${threshold}dB`;
  return {
    outputExt: format,
    mimeType: AUDIO_MIME[format],
    buildArgs: (inputs, output) => ["-i", inputs[0], "-filter:a", filter, ...codecArgs(format), output],
  };
}

/** Extrait la piste audio d'une vidéo (copie sans réencodage si demandé). */
export function extractAudio(format: AudioFormat, options: { copy?: boolean } = {}): AudioOp {
  return {
    outputExt: format,
    mimeType: AUDIO_MIME[format],
    buildArgs: (inputs, output) =>
      options.copy
        ? ["-i", inputs[0], "-vn", "-c:a", "copy", output]
        : ["-i", inputs[0], "-vn", ...codecArgs(format), output],
  };
}

/* ------------------------------------------------------------------ canaux */

/** Nombre de canaux demandé en sortie. `keep` laisse la source intacte. */
export type ChannelTarget = "keep" | "mono" | "stereo";

export const CHANNEL_TARGETS: { value: ChannelTarget; label: string; hint: string }[] = [
  { value: "keep", label: "Tel quel", hint: "Les canaux de la source sont conservés." },
  {
    value: "mono",
    label: "Mono (1 canal)",
    hint: "Les canaux sont mélangés en un seul par le mixage de FFmpeg, à volume corrigé.",
  },
  {
    value: "stereo",
    label: "Stéréo (2 canaux)",
    hint: "Depuis du mono, les deux voies portent le même signal : c'est une duplication, pas une spatialisation.",
  },
];

/** Nombre de canaux correspondant à une cible, ou `undefined` pour « tel quel ». */
export function channelCount(target: ChannelTarget): number | undefined {
  if (target === "mono") return 1;
  if (target === "stereo") return 2;
  return undefined;
}

/**
 * Change le nombre de canaux d'un fichier audio.
 *
 * Le mixage est celui de FFmpeg (`-ac`), qui applique les coefficients de
 * mixage standard et une correction de volume : c'est un vrai mélange, pas la
 * somme brute de deux voies qui saturerait. Dans l'autre sens, passer du mono au
 * stéréo **duplique** le canal — les deux voies sont identiques. FourTout ne
 * prétend pas fabriquer une image stéréo qui n'a jamais été enregistrée.
 */
export function setChannels(
  target: ChannelTarget,
  format: AudioFormat,
  options: { bitrateKbps?: number; sampleRate?: number } = {},
): AudioOp {
  const channels = channelCount(target);
  return {
    outputExt: format,
    mimeType: AUDIO_MIME[format],
    buildArgs: (inputs, output) => [
      "-i", inputs[0],
      ...codecArgs(format, { ...options, channels }),
      output,
    ],
  };
}

/* ------------------------------------------------------------- métadonnées */

/** Étiquettes modifiables sans toucher au son. */
export interface AudioTags {
  title?: string;
  artist?: string;
  album?: string;
  date?: string;
  genre?: string;
  comment?: string;
  track?: string;
}

/** Clés FFmpeg correspondantes, dans l'ordre d'affichage de l'outil. */
export const TAG_FIELDS: { key: keyof AudioTags; label: string; placeholder?: string }[] = [
  { key: "title", label: "Titre" },
  { key: "artist", label: "Artiste" },
  { key: "album", label: "Album" },
  { key: "date", label: "Année", placeholder: "2024" },
  { key: "genre", label: "Genre" },
  { key: "track", label: "Piste", placeholder: "3" },
  { key: "comment", label: "Commentaire" },
];

/**
 * Réécrit les étiquettes d'un fichier audio **sans réencoder**.
 *
 * `-c copy` recopie le flux tel quel : le son produit est identique au bit
 * près, et l'opération prend une fraction de seconde quelle que soit la durée.
 * Réencoder pour corriger un titre mal orthographié dégraderait le fichier à
 * chaque passage — un prix absurde pour une chaîne de caractères.
 *
 * Une valeur vide **efface** l'étiquette (`-metadata clé=`), ce qui est la
 * seule façon de retirer un champ ; les clés absentes de l'objet ne sont pas
 * touchées.
 */
export function writeTags(tags: AudioTags, extension: string, mimeType: string): AudioOp {
  const args: string[] = [];
  for (const { key } of TAG_FIELDS) {
    const value = tags[key];
    if (value === undefined) continue;
    args.push("-metadata", `${key}=${value}`);
  }
  return {
    outputExt: extension,
    mimeType,
    buildArgs: (inputs, output) => ["-i", inputs[0], "-map", "0", "-c", "copy", ...args, output],
  };
}
