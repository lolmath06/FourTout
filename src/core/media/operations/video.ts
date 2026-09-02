/**
 * Constructeurs des petits ponts vidéo (FFmpeg).
 *
 * Uniquement ce dont cette phase a besoin — vidéo ↔ GIF et extraction d'image ;
 * la vraie catégorie Vidéo viendra plus tard. Fonctions pures et testables.
 */
export interface VideoOp {
  buildArgs: (inputs: string[], output: string) => string[];
  outputExt: string;
  mimeType: string;
}

const secs = (ms: number) => (ms / 1000).toFixed(3);

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
