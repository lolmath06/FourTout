import { execFileSync, spawnSync } from "node:child_process";
import {
  buildCapabilities,
  videoEncoderCandidates,
  type MediaCapabilities,
} from "@/core/media/capabilities";

/**
 * Détection des capacités FFmpeg **pour les tests**, strictement calquée sur ce
 * que fait l'application.
 *
 * Le socle natif (`media_encoders` + `media_probe_encoders`) n'existe pas dans
 * Vitest : ces fonctions rejouent exactement les deux mêmes étapes avec le
 * FFmpeg du système — liste annoncée, puis **encodage réel** d'une image.
 *
 * C'est volontairement une reproduction et non un raccourci : un test qui
 * fabriquerait sa liste d'encodeurs à la main testerait sa propre fiction. La
 * régression de la phase 5 (un `h264_nvenc` annoncé, choisi, et incapable de
 * démarrer) est précisément passée par ce trou.
 */

export function whichBinary(name: string): string | undefined {
  try {
    return execFileSync("sh", ["-c", `command -v ${name}`]).toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Encodeurs annoncés par `ffmpeg -encoders`, comme la commande native. */
export function announcedEncoders(ffmpeg: string): string[] {
  const text = execFileSync(ffmpeg, ["-hide_banner", "-encoders"]).toString();
  return text
    .split("\n")
    .map((line) => {
      const parts = line.trimStart().split(/\s+/);
      const flags = parts[0];
      if (flags?.length === 6 && [...flags].every((c) => "AVSFXBDL.".includes(c))) return parts[1];
      return undefined;
    })
    .filter((name): name is string => Boolean(name));
}

/**
 * L'encodeur sait-il réellement encoder une image ici ? Même commande que
 * `encoder_works` côté Rust.
 */
export function encoderWorks(ffmpeg: string, name: string): boolean {
  const result = spawnSync(
    ffmpeg,
    [
      "-hide_banner", "-nostdin", "-y",
      "-f", "lavfi", "-i", "color=c=black:s=64x64:r=5:d=1",
      "-frames:v", "1", "-pix_fmt", "yuv420p",
      "-c:v", name,
      "-f", "null", "-",
    ],
    { stdio: "ignore", timeout: 20_000 },
  );
  return result.status === 0;
}

/** Capacités réelles de cette machine, détectées comme l'application le fait. */
export function realCapabilities(ffmpeg: string): MediaCapabilities {
  const announced = announcedEncoders(ffmpeg);
  const candidates = videoEncoderCandidates().filter((name) => announced.includes(name));
  const usableVideo = candidates.filter((name) => encoderWorks(ffmpeg, name));
  return buildCapabilities({ announced, usableVideo });
}
