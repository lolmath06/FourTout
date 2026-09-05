import {
  CONTAINER_MIME,
  SUBTITLE_ENCODER,
  type VideoContainerId,
} from "../capabilities";
import type { PixelRect } from "../video/dimensions";
import { atempoChain } from "./audio";

/**
 * Constructeurs d'arguments FFmpeg pour la suite vidéo.
 *
 * Ce sont des **fonctions pures** : elles reçoivent des chemins d'entrée et de
 * sortie, renvoient une liste d'arguments, et ne touchent ni au disque ni à
 * Tauri. C'est ce qui permet de les tester deux fois — une fois sur la chaîne
 * produite, une fois en exécutant réellement FFmpeg sur une petite vidéo.
 *
 * Aucun argument n'est jamais concaténé dans une ligne de commande : le socle
 * natif passe le tableau tel quel à `std::process::Command`.
 */
export interface VideoOp {
  buildArgs: (inputs: string[], output: string) => string[];
  outputExt: string;
  mimeType: string;
  /**
   * Contenu texte à préparer avant l'exécution (liste de concaténation…). Le
   * chemin du fichier produit est ajouté à la fin de `inputs`.
   */
  stageText?: (inputs: string[]) => { content: string; ext: string };
}

const secs = (ms: number) => (ms / 1000).toFixed(3);

/* ------------------------------------------------------ ponts historiques */

/** Vidéo → GIF avec palette optimisée (une seule commande). */
export function videoToGif(options: {
  startMs?: number;
  durationMs?: number;
  fps?: number;
  width?: number;
}): VideoOp {
  const fps = options.fps ?? 12;
  const width = options.width ?? 480;
  const filter =
    `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];` +
    `[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer`;
  return {
    outputExt: "gif",
    mimeType: "image/gif",
    buildArgs: (inputs, output) => {
      const args: string[] = [];
      if (options.startMs) args.push("-ss", secs(options.startMs));
      args.push("-i", inputs[0]);
      if (options.durationMs) args.push("-t", secs(options.durationMs));
      args.push("-filter_complex", filter, output);
      return args;
    },
  };
}

export type VideoContainer = "mp4" | "webm";

/** Encodeur H.264 logiciel : `libx264` (builds complets) ou `libopenh264`
 * (présent sur Fedora par défaut). Résolu à l'exécution selon la disponibilité. */
export type H264Encoder = "libx264" | "libopenh264";

/**
 * GIF → vidéo largement compatible (H.264 yuv420p, dimensions paires).
 * Le WebM utilise VP9. `codec` fixe l'encodeur H.264 selon ce qui est
 * réellement disponible dans le FFmpeg utilisé.
 */
export function gifToVideo(container: VideoContainer, codec: H264Encoder = "libx264"): VideoOp {
  const even = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
  const args =
    container === "mp4"
      ? ["-movflags", "+faststart", "-pix_fmt", "yuv420p", "-vf", even, "-c:v", codec]
      : ["-pix_fmt", "yuv420p", "-vf", even, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32"];
  return {
    outputExt: container,
    mimeType: container === "mp4" ? "video/mp4" : "video/webm",
    buildArgs: (inputs, output) => ["-i", inputs[0], ...args, output],
  };
}

/** Extrait une image à un instant donné. */
export function extractFrame(timeMs: number, format: "png" | "jpg"): VideoOp {
  return {
    outputExt: format,
    mimeType: format === "png" ? "image/png" : "image/jpeg",
    buildArgs: (inputs, output) => [
      "-ss", secs(timeMs), "-i", inputs[0], "-frames:v", "1", ...(format === "jpg" ? ["-q:v", "2"] : []), output,
    ],
  };
}

/* --------------------------------------------------------- encodage commun */

export interface EncodeOptions {
  container: VideoContainerId;
  /** Arguments de l'encodeur vidéo (voir `video/presets.ts`). */
  videoArgs: string[];
  /** Arguments de l'encodeur audio, ou `["-an"]` pour une sortie muette. */
  audioArgs: string[];
  /** Filtres vidéo, appliqués dans l'ordre (`-vf`). */
  videoFilters?: string[];
  /** Filtres audio, appliqués dans l'ordre (`-af`). */
  audioFilters?: string[];
  /** Arguments placés avant `-i` (recherche rapide, bouclage…). */
  preInputArgs?: string[];
  /** Arguments supplémentaires placés juste avant la sortie. */
  extraArgs?: string[];
}

/** `-movflags +faststart` rend un MP4 lisible avant téléchargement complet. */
function containerArgs(container: VideoContainerId): string[] {
  return container === "mp4" || container === "mov" ? ["-movflags", "+faststart"] : [];
}

/** Opération d'encodage générique : la brique de conversion, compression,
 * redimensionnement, rotation, rognage et vitesse. */
export function encodeVideo(options: EncodeOptions): VideoOp {
  const { container, videoArgs, audioArgs, videoFilters = [], audioFilters = [] } = options;
  return {
    outputExt: container,
    mimeType: CONTAINER_MIME[container],
    buildArgs: (inputs, output) => [
      ...(options.preInputArgs ?? []),
      "-i", inputs[0],
      ...(videoFilters.length > 0 ? ["-vf", videoFilters.join(",")] : []),
      ...(audioFilters.length > 0 ? ["-af", audioFilters.join(",")] : []),
      ...videoArgs,
      ...audioArgs,
      ...containerArgs(container),
      ...(options.extraArgs ?? []),
      output,
    ],
  };
}

/* ---------------------------------------------------------- redimensionner */

/** Filtre de mise à l'échelle vers des dimensions exactes (déjà paires). */
export function scaleFilter(width: number, height: number): string {
  return `scale=${width}:${height}:flags=lanczos`;
}

/* -------------------------------------------------------------- découpage */

export type TrimMode = "fast" | "precise";

/**
 * Découpe un extrait.
 *
 * - `fast` recopie les flux tels quels : instantané, mais la coupe se cale sur
 *   l'image-clé précédente, donc le début peut être légèrement décalé.
 * - `precise` réencode : la coupe tombe exactement à l'instant demandé.
 *
 * Dans les deux cas `-ss` est placé **avant** `-i` : FFmpeg saute directement
 * au bon endroit au lieu de décoder tout le début du fichier.
 */
export function trimVideo(options: {
  startMs: number;
  endMs: number;
  mode: TrimMode;
  container: VideoContainerId;
  /** Requis en mode `precise`. */
  videoArgs?: string[];
  audioArgs?: string[];
}): VideoOp {
  const duration = Math.max(1, options.endMs - options.startMs);
  const { container, mode } = options;
  return {
    outputExt: container,
    mimeType: CONTAINER_MIME[container],
    buildArgs: (inputs, output) =>
      mode === "fast"
        ? [
            "-ss", secs(options.startMs), "-i", inputs[0], "-t", secs(duration),
            "-map", "0:v:0", "-map", "0:a?", "-c", "copy", "-avoid_negative_ts", "make_zero",
            ...containerArgs(container), output,
          ]
        : [
            "-ss", secs(options.startMs), "-i", inputs[0], "-t", secs(duration),
            ...(options.videoArgs ?? []), ...(options.audioArgs ?? []),
            ...containerArgs(container), output,
          ],
  };
}

/* -------------------------------------------------------------- fusionner */

/** Échappe un chemin pour la liste du démultiplexeur `concat`. */
export function escapeConcatPath(path: string): string {
  return path.replace(/'/g, "'\\''");
}

/**
 * Concaténation **sans réencodage**, par le démultiplexeur `concat`. N'est
 * valable que si tous les fichiers partagent codecs, dimensions et cadence :
 * `concatCompatible` en décide.
 */
export function concatVideoCopy(container: VideoContainerId): VideoOp {
  return {
    outputExt: container,
    mimeType: CONTAINER_MIME[container],
    stageText: (inputs) => ({
      content: inputs.map((path) => `file '${escapeConcatPath(path)}'`).join("\n") + "\n",
      ext: "txt",
    }),
    buildArgs: (inputs, output) => {
      // Le dernier chemin est la liste préparée par `stageText`.
      const list = inputs[inputs.length - 1];
      return ["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", ...containerArgs(container), output];
    },
  };
}

export interface ConcatSource {
  width?: number;
  height?: number;
  frameRate?: number;
  hasAudio: boolean;
  durationMs: number;
  videoCodec?: string;
  audioCodec?: string;
  sampleRate?: number;
  channels?: number;
}

/** Les sources peuvent-elles être concaténées sans réencodage ? */
export function concatCompatible(sources: readonly ConcatSource[]): boolean {
  if (sources.length < 2) return sources.length === 1;
  const [first, ...rest] = sources;
  if (!first.width || !first.height) return false;
  return rest.every(
    (s) =>
      s.width === first.width &&
      s.height === first.height &&
      s.videoCodec === first.videoCodec &&
      s.hasAudio === first.hasAudio &&
      s.audioCodec === first.audioCodec &&
      s.sampleRate === first.sampleRate &&
      s.channels === first.channels &&
      Math.abs((s.frameRate ?? 0) - (first.frameRate ?? 0)) < 0.01,
  );
}

/** Dimensions et cadence retenues pour normaliser un lot hétérogène. */
export function concatTarget(sources: readonly ConcatSource[]): {
  width: number;
  height: number;
  frameRate: number;
} {
  const width = Math.max(...sources.map((s) => s.width ?? 0), 2);
  const height = Math.max(...sources.map((s) => s.height ?? 0), 2);
  const frameRate = Math.max(...sources.map((s) => s.frameRate ?? 0), 1);
  const even = (v: number) => Math.max(2, Math.round(v) - (Math.round(v) % 2));
  return { width: even(width), height: even(height), frameRate: Math.round(frameRate * 1000) / 1000 };
}

/**
 * Graphe de filtres normalisant chaque source avant concaténation : mise à
 * l'échelle sans déformation (bandes noires si les proportions diffèrent),
 * cadence et format de pixels communs, audio rééchantillonné. Une source
 * muette reçoit un silence de sa durée, sinon la piste audio se décalerait.
 */
export function buildConcatFilter(
  sources: readonly ConcatSource[],
  target: { width: number; height: number; frameRate: number },
  withAudio: boolean,
): string {
  const { width, height, frameRate } = target;
  const parts: string[] = [];
  // Les entrées silencieuses (`anullsrc`) sont ajoutées après les vidéos.
  let silentIndex = sources.length;
  const audioLabels: string[] = [];

  sources.forEach((source, i) => {
    parts.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${frameRate},format=yuv420p[v${i}]`,
    );
    if (!withAudio) return;
    const input = source.hasAudio ? `${i}:a` : `${silentIndex++}:a`;
    parts.push(`[${input}]aresample=async=1:osr=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    audioLabels.push(`[a${i}]`);
  });

  const chain = sources
    .map((_, i) => (withAudio ? `[v${i}]${audioLabels[i]}` : `[v${i}]`))
    .join("");
  parts.push(
    `${chain}concat=n=${sources.length}:v=1:a=${withAudio ? 1 : 0}` +
      (withAudio ? "[outv][outa]" : "[outv]"),
  );
  return parts.join(";");
}

/** Concaténation avec normalisation : accepte des sources hétérogènes. */
export function concatVideoReencode(options: {
  sources: readonly ConcatSource[];
  container: VideoContainerId;
  videoArgs: string[];
  audioArgs: string[];
  target?: { width: number; height: number; frameRate: number };
}): VideoOp {
  const { sources, container } = options;
  const target = options.target ?? concatTarget(sources);
  const withAudio = sources.some((s) => s.hasAudio) && !options.audioArgs.includes("-an");
  const filter = buildConcatFilter(sources, target, withAudio);

  return {
    outputExt: container,
    mimeType: CONTAINER_MIME[container],
    buildArgs: (inputs, output) => {
      const args: string[] = [];
      for (const path of inputs) args.push("-i", path);
      // Un silence de la bonne durée pour chaque source muette.
      if (withAudio) {
        for (const source of sources) {
          if (source.hasAudio) continue;
          args.push(
            "-f", "lavfi",
            "-t", secs(Math.max(100, source.durationMs)),
            "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
          );
        }
      }
      args.push("-filter_complex", filter, "-map", "[outv]");
      if (withAudio) args.push("-map", "[outa]");
      args.push(...options.videoArgs);
      args.push(...(withAudio ? options.audioArgs : ["-an"]));
      args.push(...containerArgs(container), output);
      return args;
    },
  };
}

/* ---------------------------------------------------- rotation et miroir */

export type VideoTransform = "rotate-left" | "rotate-right" | "rotate-180" | "flip-h" | "flip-v";

export const VIDEO_TRANSFORMS: { value: VideoTransform; label: string; icon: string }[] = [
  { value: "rotate-left", label: "90° à gauche", icon: "RotateCw" },
  { value: "rotate-right", label: "90° à droite", icon: "RotateCw" },
  { value: "rotate-180", label: "180°", icon: "RotateCw" },
  { value: "flip-h", label: "Miroir horizontal", icon: "FlipHorizontal2" },
  { value: "flip-v", label: "Miroir vertical", icon: "FlipHorizontal2" },
];

/** Filtre correspondant à une transformation. */
export function transformFilter(transform: VideoTransform): string {
  switch (transform) {
    case "rotate-right":
      return "transpose=1";
    case "rotate-left":
      return "transpose=2";
    case "rotate-180":
      return "transpose=1,transpose=1";
    case "flip-h":
      return "hflip";
    case "flip-v":
      return "vflip";
  }
}

/** La transformation échange-t-elle largeur et hauteur ? */
export function swapsDimensions(transform: VideoTransform): boolean {
  return transform === "rotate-left" || transform === "rotate-right";
}

/* ------------------------------------------------------------- vitesse */

/** Facteurs de vitesse proposés. */
export const SPEED_FACTORS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4] as const;

/** Durée finale attendue pour un facteur de vitesse donné. */
export function speedDurationMs(durationMs: number, factor: number): number {
  return factor > 0 ? Math.round(durationMs / factor) : durationMs;
}

/** Filtre vidéo de changement de vitesse (`setpts`). */
export function speedVideoFilter(factor: number): string {
  return `setpts=${(1 / factor).toFixed(6)}*PTS`;
}

/**
 * Filtre audio de changement de vitesse. `atempo` n'accepte qu'un facteur
 * compris entre 0,5 et 2 : au-delà, on enchaîne plusieurs étages (logique
 * partagée avec les outils audio).
 */
export function speedAudioFilter(factor: number): string {
  return atempoChain(factor);
}

/* --------------------------------------------------------------- audio */

/** Supprime la piste audio en recopiant la vidéo telle quelle. */
export function removeAudio(container: VideoContainerId): VideoOp {
  return {
    outputExt: container,
    mimeType: CONTAINER_MIME[container],
    buildArgs: (inputs, output) => [
      "-i", inputs[0], "-map", "0:v", "-c:v", "copy", "-an", ...containerArgs(container), output,
    ],
  };
}

/** Que faire quand la vidéo et l'audio n'ont pas la même durée. */
export type AudioFitMode = "video" | "audio" | "loop";

export const AUDIO_FIT_MODES: { value: AudioFitMode; label: string; hint: string }[] = [
  { value: "video", label: "Caler sur la vidéo", hint: "L'audio est coupé, ou complété par du silence." },
  { value: "audio", label: "Caler sur l'audio", hint: "La sortie dure aussi longtemps que la bande son." },
  { value: "loop", label: "Boucler l'audio", hint: "La bande son est répétée jusqu'à la fin de la vidéo." },
];

/**
 * Remplace la bande son (entrée 0 = vidéo, entrée 1 = audio). La vidéo est
 * recopiée sans réencodage : seule la piste audio est produite.
 */
export function replaceAudio(options: {
  container: VideoContainerId;
  audioArgs: string[];
  mode: AudioFitMode;
  videoDurationMs: number;
}): VideoOp {
  const { container, mode } = options;
  return {
    outputExt: container,
    mimeType: CONTAINER_MIME[container],
    buildArgs: (inputs, output) => {
      const args: string[] = ["-i", inputs[0]];
      if (mode === "loop") args.push("-stream_loop", "-1");
      args.push("-i", inputs[1], "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy");
      if (mode === "video") args.push("-af", "apad");
      args.push(...options.audioArgs);
      if (mode === "video" || mode === "loop") args.push("-shortest");
      args.push(...containerArgs(container), output);
      return args;
    },
  };
}

/**
 * Ajoute une piste audio **sans supprimer** les pistes existantes. Réservé aux
 * conteneurs multi-pistes (MKV) : MP4 accepte plusieurs pistes mais peu de
 * lecteurs permettent d'en changer.
 */
export function addAudioTrack(options: {
  container: VideoContainerId;
  /** Encodeur de la piste ajoutée (`aac`, `libopus`…). */
  audioEncoder: string;
  bitrateKbps?: number;
  language?: string;
  /** Index de la nouvelle piste audio dans la sortie. */
  trackIndex: number;
}): VideoOp {
  const { container, trackIndex } = options;
  return {
    outputExt: container,
    mimeType: CONTAINER_MIME[container],
    buildArgs: (inputs, output) => {
      const args = [
        "-i", inputs[0], "-i", inputs[1],
        "-map", "0", "-map", "1:a:0",
        "-c", "copy",
        `-c:a:${trackIndex}`, options.audioEncoder,
        `-b:a:${trackIndex}`, `${options.bitrateKbps ?? 128}k`,
      ];
      if (options.language) args.push(`-metadata:s:a:${trackIndex}`, `language=${options.language}`);
      args.push(...containerArgs(container), output);
      return args;
    },
  };
}

/** Réglages de volume proposés, en pourcentage du niveau d'origine. */
export const VOLUME_PRESETS = [0, 25, 50, 100, 150, 200] as const;

/**
 * Modifie le volume de la piste audio, vidéo recopiée telle quelle. Au-delà de
 * 100 %, un limiteur évite l'écrêtage brutal des crêtes ; s'il n'est pas
 * disponible dans le build, `limiter: false` produit un simple gain.
 */
export function adjustVolume(options: {
  container: VideoContainerId;
  percent: number;
  audioArgs: string[];
  limiter?: boolean;
}): VideoOp {
  const { container, percent } = options;
  const gain = Math.max(0, percent) / 100;
  const filters = [`volume=${gain.toFixed(3)}`];
  if (gain > 1 && options.limiter !== false) filters.push("alimiter=limit=0.97");
  return {
    outputExt: container,
    mimeType: CONTAINER_MIME[container],
    buildArgs: (inputs, output) =>
      percent === 0
        ? ["-i", inputs[0], "-map", "0:v", "-c:v", "copy", "-an", ...containerArgs(container), output]
        : [
            "-i", inputs[0], "-map", "0:v:0", "-map", "0:a:0",
            "-c:v", "copy", "-af", filters.join(","), ...options.audioArgs,
            ...containerArgs(container), output,
          ],
  };
}

/* ---------------------------------------------------------- sous-titres */

/**
 * Échappe un chemin pour l'intérieur d'un graphe de filtres.
 *
 * Le lexer de FFmpeg découpe les options sur `:` et `,`. On repasse le chemin
 * en séparateurs `/` (acceptés partout, Windows compris), on échappe le
 * deux-points de la lettre de lecteur, puis on entoure le tout de guillemets
 * simples — sans quoi `C:\Films\a,b.srt` casserait le graphe.
 */
export function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export type SubtitlePosition = "bottom" | "center" | "top";

export interface BurnStyle {
  /** Taille de police, en points ASS (24 ≈ lisible sur 1080p). */
  fontSize: number;
  /** Couleur du texte, au format `#rrggbb`. */
  color: string;
  position: SubtitlePosition;
  /** Contour noir (lisible sur fond clair) ou bandeau opaque. */
  outline: "outline" | "box" | "none";
  /** Marge verticale, en pixels. */
  marginV: number;
}

export const DEFAULT_BURN_STYLE: BurnStyle = {
  fontSize: 24,
  color: "#ffffff",
  position: "bottom",
  outline: "outline",
  marginV: 30,
};

/** `#rrggbb` → couleur ASS `&H00BBGGRR`. */
export function assColor(hex: string): string {
  const value = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  const r = value.slice(0, 2);
  const g = value.slice(2, 4);
  const b = value.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

/** Construit la chaîne `force_style` du filtre `subtitles`. */
export function burnStyleString(style: BurnStyle): string {
  const alignment = { bottom: 2, center: 5, top: 8 }[style.position];
  const parts = [
    `FontSize=${Math.round(style.fontSize)}`,
    `PrimaryColour=${assColor(style.color)}`,
    `Alignment=${alignment}`,
    `MarginV=${Math.round(style.marginV)}`,
  ];
  if (style.outline === "outline") parts.push("BorderStyle=1", "Outline=2", "Shadow=0", "OutlineColour=&H00000000");
  else if (style.outline === "box") parts.push("BorderStyle=3", "Outline=1", "Shadow=0", "BackColour=&H80000000");
  else parts.push("BorderStyle=1", "Outline=0", "Shadow=0");
  return parts.join(",");
}

/**
 * Incruste des sous-titres dans l'image (« hardsub »). L'entrée 1 est le
 * fichier SRT/VTT/ASS ; la vidéo est nécessairement réencodée puisque les
 * pixels changent, l'audio est recopié.
 */
export function burnSubtitles(options: {
  container: VideoContainerId;
  videoArgs: string[];
  style: BurnStyle;
  /** Filtres appliqués avant l'incrustation (mise à l'échelle…). */
  preFilters?: string[];
}): VideoOp {
  const { container } = options;
  return {
    outputExt: container,
    mimeType: CONTAINER_MIME[container],
    buildArgs: (inputs, output) => {
      const filter =
        `subtitles='${escapeFilterPath(inputs[1])}':force_style='${burnStyleString(options.style)}'`;
      const filters = [...(options.preFilters ?? []), filter];
      return [
        "-i", inputs[0],
        "-vf", filters.join(","),
        ...options.videoArgs,
        "-c:a", "copy",
        ...containerArgs(container), output,
      ];
    },
  };
}

/**
 * Attache un fichier de sous-titres comme **piste** (« softsub ») : la vidéo et
 * l'audio sont recopiés tels quels, seul le texte est ajouté. L'encodeur de
 * sous-titres dépend du conteneur (`srt` en MKV, `webvtt` en WebM,
 * `mov_text` en MP4) — d'où la vérification préalable des capacités.
 */
export function addSubtitleTrack(options: {
  container: VideoContainerId;
  language?: string;
  title?: string;
}): VideoOp {
  const { container } = options;
  return {
    outputExt: container,
    mimeType: CONTAINER_MIME[container],
    buildArgs: (inputs, output) => {
      const args = [
        "-i", inputs[0], "-i", inputs[1],
        "-map", "0", "-map", "1:0",
        "-c", "copy", "-c:s", SUBTITLE_ENCODER[container],
      ];
      if (options.language) args.push("-metadata:s:s:0", `language=${options.language}`);
      if (options.title) args.push("-metadata:s:s:0", `title=${options.title}`);
      args.push(...containerArgs(container), output);
      return args;
    },
  };
}

/** Extrait une piste de sous-titres textuelle vers un fichier SRT ou VTT. */
export function extractSubtitleTrack(order: number, format: "srt" | "vtt"): VideoOp {
  return {
    outputExt: format,
    mimeType: format === "srt" ? "application/x-subrip" : "text/vtt",
    buildArgs: (inputs, output) => [
      "-i", inputs[0],
      "-map", `0:s:${order}`,
      "-c:s", format === "srt" ? "srt" : "webvtt",
      output,
    ],
  };
}

/* ------------------------------------------------------------- rognage */

/** Filtre de rognage à partir d'un rectangle en pixels. */
export function cropFilter(rect: PixelRect): string {
  return `crop=${rect.width}:${rect.height}:${rect.x}:${rect.y}`;
}
