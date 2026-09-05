import type { AudioCodecId, MediaCapabilities, VideoCodecId } from "../capabilities";

/**
 * Traduction d'une intention (« qualité élevée », « fichier plus léger ») en
 * arguments d'encodage réellement adaptés à l'encodeur présent.
 *
 * Le point délicat : **tous les encodeurs ne comprennent pas `-crf`.** `libx264`,
 * `libx265`, `libvpx-vp9`, `libsvtav1` et `libaom-av1` acceptent un facteur de
 * qualité constante, mais leurs échelles sont différentes ; `libopenh264` — le
 * seul H.264 disponible sur un Fedora par défaut — ne connaît que le débit
 * cible. Recopier une valeur de CRF « standard » d'un encodeur à l'autre
 * produirait donc soit un fichier énorme, soit une bouillie, soit une erreur.
 * Chaque encodeur a par conséquent sa propre table.
 */

/** Intention de qualité, commune à tous les outils. */
export type QualityLevel = "high" | "balanced" | "small";

export const QUALITY_LABEL: Record<QualityLevel, string> = {
  high: "Qualité élevée",
  balanced: "Équilibrée",
  small: "Fichier plus léger",
};

/** Modes de compression (mêmes moteurs, vocabulaire de l'outil « Compresser »). */
export const COMPRESSION_LABEL: Record<QualityLevel, string> = {
  high: "Légère",
  balanced: "Équilibrée",
  small: "Forte",
};

/** Facteur de qualité constante par encodeur, du plus fin au plus léger. */
const CRF_TABLE: Record<string, Record<QualityLevel, number>> = {
  libx264: { high: 20, balanced: 25, small: 30 },
  libx265: { high: 23, balanced: 28, small: 33 },
  "libvpx-vp9": { high: 28, balanced: 33, small: 40 },
  libsvtav1: { high: 28, balanced: 35, small: 45 },
  "libaom-av1": { high: 28, balanced: 35, small: 45 },
};

/** Plage de CRF acceptée par un encodeur (pour le mode personnalisé). */
export function crfRange(encoder: string): { min: number; max: number } | undefined {
  if (!CRF_TABLE[encoder]) return undefined;
  return encoder.includes("av1") || encoder.includes("vp9") ? { min: 0, max: 63 } : { min: 0, max: 51 };
}

/** L'encodeur accepte-t-il un facteur de qualité constante ? */
export function supportsCrf(encoder: string): boolean {
  return CRF_TABLE[encoder] !== undefined;
}

/** Valeur de CRF par défaut d'un encodeur pour un niveau de qualité. */
export function defaultCrf(encoder: string, level: QualityLevel): number | undefined {
  return CRF_TABLE[encoder]?.[level];
}

/**
 * Débit vidéo cible en kb/s, utilisé par les encodeurs sans qualité constante.
 * On part du débit réel de la source quand il est connu (le seul repère
 * honnête), avec un repli sur une estimation par pixel et par image.
 */
export function targetBitrateKbps(
  level: QualityLevel,
  source: { width?: number; height?: number; frameRate?: number; videoBitRate?: number; bitRate?: number },
): number {
  const factor = { high: 0.7, balanced: 0.45, small: 0.25 }[level];
  const known = source.videoBitRate ?? source.bitRate;
  if (known && Number.isFinite(known) && known > 0) {
    return Math.max(120, Math.round((known / 1000) * factor));
  }
  const width = source.width ?? 1280;
  const height = source.height ?? 720;
  const fps = source.frameRate && source.frameRate > 0 ? Math.min(60, source.frameRate) : 30;
  const bitsPerPixel = { high: 0.1, balanced: 0.06, small: 0.035 }[level];
  return Math.max(120, Math.round((width * height * fps * bitsPerPixel) / 1000));
}

export interface EncodeRequest {
  /** Encodeur vidéo réel (`libx264`, `libopenh264`…). */
  encoder: string;
  level: QualityLevel;
  /** CRF imposé par l'utilisateur (mode personnalisé). */
  crf?: number;
  /** Caractéristiques de la source, pour estimer un débit cible. */
  source?: Parameters<typeof targetBitrateKbps>[1];
}

/**
 * Arguments d'encodage vidéo pour un encodeur donné : qualité constante quand
 * il la comprend, débit cible sinon. `-pix_fmt yuv420p` est systématique :
 * c'est ce qui rend le fichier lisible partout.
 */
export function videoEncodeArgs(request: EncodeRequest): string[] {
  const { encoder, level, crf, source } = request;
  const value = crf ?? defaultCrf(encoder, level);

  if (supportsCrf(encoder) && value !== undefined) {
    switch (encoder) {
      case "libx264":
      case "libx265":
        return ["-c:v", encoder, "-crf", String(value), "-preset", "medium", "-pix_fmt", "yuv420p"];
      case "libvpx-vp9":
        return ["-c:v", encoder, "-crf", String(value), "-b:v", "0", "-row-mt", "1", "-pix_fmt", "yuv420p"];
      case "libsvtav1":
        return ["-c:v", encoder, "-crf", String(value), "-preset", "8", "-pix_fmt", "yuv420p"];
      case "libaom-av1":
        return ["-c:v", encoder, "-crf", String(value), "-b:v", "0", "-cpu-used", "6", "-pix_fmt", "yuv420p"];
    }
  }

  // Encodeur à débit (libopenh264, encodeurs matériels…).
  const kbps = targetBitrateKbps(level, source ?? {});
  return ["-c:v", encoder, "-b:v", `${kbps}k`, "-pix_fmt", "yuv420p"];
}

/** Débit audio proposé par niveau de qualité. */
export function audioBitrateKbps(level: QualityLevel): number {
  return { high: 192, balanced: 128, small: 96 }[level];
}

/** Arguments d'encodage audio, ou `-an` si la sortie doit être muette. */
export function audioEncodeArgs(
  codec: AudioCodecId | undefined,
  caps: MediaCapabilities,
  level: QualityLevel = "balanced",
): string[] {
  if (!codec) return ["-an"];
  const encoder = caps.audio[codec];
  if (!encoder) return ["-an"];
  return ["-c:a", encoder, "-b:a", `${audioBitrateKbps(level)}k`];
}

/** Préréglages proposés dans « Convertir une vidéo ». */
export type ConversionPreset = "compatible" | "high" | "small" | "custom";

export const CONVERSION_PRESETS: { value: ConversionPreset; label: string; hint: string }[] = [
  {
    value: "compatible",
    label: "Compatibilité maximale",
    hint: "Le format qui se lit partout, selon ce que sait faire le moteur installé.",
  },
  { value: "high", label: "Qualité élevée", hint: "Fidèle à la source, fichier plus lourd." },
  { value: "small", label: "Fichier plus léger", hint: "Compression marquée, qualité en retrait." },
  { value: "custom", label: "Personnalisé", hint: "Conteneur, codecs et qualité au choix." },
];

/** Niveau de qualité associé à un préréglage de conversion. */
export function levelOfPreset(preset: ConversionPreset): QualityLevel {
  return preset === "high" ? "high" : preset === "small" ? "small" : "balanced";
}

/** Le gain de compression, en pourcentage (négatif si le fichier a grossi). */
export function compressionGain(beforeBytes: number, afterBytes: number): number {
  if (beforeBytes <= 0) return 0;
  return Math.round(((beforeBytes - afterBytes) / beforeBytes) * 1000) / 10;
}

/** Codec vidéo par défaut pour un conteneur, parmi ceux disponibles. */
export function defaultCodecFor(
  codecs: readonly VideoCodecId[],
  preferred: readonly VideoCodecId[] = ["h264", "vp9", "h265", "av1"],
): VideoCodecId | undefined {
  return preferred.find((codec) => codecs.includes(codec)) ?? codecs[0];
}
