import type { MediaInfo } from "@/core/media/types";

/** Description compacte d'une vidéo : `1280 × 720 · 30 img/s · h264`. */
export function describeVideo(info: MediaInfo | undefined): string {
  if (!info) return "";
  const parts: string[] = [];
  if (info.width && info.height) parts.push(`${info.width} × ${info.height}`);
  if (info.frameRate) parts.push(`${Math.round(info.frameRate * 100) / 100} img/s`);
  if (info.videoCodec) parts.push(info.videoCodec);
  if (info.audioCodec) parts.push(`audio ${info.audioCodec}`);
  else parts.push("sans audio");
  if (info.bitRate) parts.push(`${Math.round(info.bitRate / 1000)} kb/s`);
  return parts.join(" · ");
}
