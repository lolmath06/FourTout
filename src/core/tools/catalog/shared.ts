import type { ToolDefinition, ToolInput, ToolOutput } from "../types";

/**
 * Raccourcis d'entrées/sorties partagés par le catalogue.
 * Ils évitent de répéter les listes d'extensions dans chaque définition.
 */
export const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tiff", "avif"];
export const AUDIO_EXT = ["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus"];
export const VIDEO_EXT = ["mp4", "mkv", "webm", "mov", "avi", "gif"];
export const ARCHIVE_EXT = ["zip", "7z", "tar", "gz", "tgz", "bz2", "xz", "rar"];
export const TEXT_EXT = ["txt", "md", "csv", "json", "xml", "yaml", "yml", "html"];

export const IN = {
  pdf: (multiple = false): ToolInput => ({ kind: "pdf", extensions: ["pdf"], multiple }),
  image: (multiple = false): ToolInput => ({ kind: "image", extensions: IMAGE_EXT, multiple }),
  audio: (multiple = false): ToolInput => ({ kind: "audio", extensions: AUDIO_EXT, multiple }),
  video: (multiple = false): ToolInput => ({ kind: "video", extensions: VIDEO_EXT, multiple }),
  archive: (multiple = false): ToolInput => ({ kind: "archive", extensions: ARCHIVE_EXT, multiple }),
  text: (multiple = false): ToolInput => ({ kind: "text", extensions: TEXT_EXT, multiple }),
  anyFile: (multiple = true): ToolInput => ({ kind: "data", extensions: ["*"], multiple }),
  folder: (): ToolInput => ({ kind: "folder", extensions: ["*"], multiple: false }),
  /** Outil purement interactif : saisie directe dans l'interface. */
  none: (): ToolInput => ({ kind: "none", extensions: [] }),
};

export const OUT = {
  pdf: (): ToolOutput => ({ kind: "pdf", extensions: ["pdf"] }),
  image: (extensions: string[] = IMAGE_EXT): ToolOutput => ({ kind: "image", extensions }),
  audio: (extensions: string[] = AUDIO_EXT): ToolOutput => ({ kind: "audio", extensions }),
  video: (extensions: string[] = VIDEO_EXT): ToolOutput => ({ kind: "video", extensions }),
  archive: (extensions: string[] = ARCHIVE_EXT): ToolOutput => ({ kind: "archive", extensions }),
  text: (extensions: string[] = ["txt"]): ToolOutput => ({ kind: "text", extensions }),
  data: (extensions: string[] = ["*"]): ToolOutput => ({ kind: "data", extensions }),
  none: (): ToolOutput => ({ kind: "none", extensions: [] }),
};

/**
 * Identité typée : permet d'écrire les fichiers de catalogue sans annotation
 * tout en gardant l'inférence et la vérification de `ToolDefinition`.
 */
export function defineTools(tools: ToolDefinition[]): ToolDefinition[] {
  return tools;
}
