import type { SelectedFile } from "@/core/files";
import { AUDIO_FORMATS, type AudioFormat } from "@/core/media/types";

/** Format audio de sortie = celui de l'entrée s'il est pris en charge, sinon MP3. */
export function sameFormatOf(file: SelectedFile): AudioFormat {
  const ext = (file.extension || "").toLowerCase();
  return (AUDIO_FORMATS as readonly string[]).includes(ext) ? (ext as AudioFormat) : "mp3";
}
