import { describe, expect, it } from "vitest";
import {
  audioCodecsFor,
  canCopyVideo,
  capabilitiesFromEncoders,
  containersAvailable,
  familyOfCodecName,
  mostCompatible,
  videoCodecsFor,
} from "./capabilities";

/**
 * FourTout ne doit jamais proposer un codec que le FFmpeg installé ne sait pas
 * produire. Ces tests décrivent les deux builds que l'on rencontre réellement :
 * un build complet (libx264, libx265, mov_text) et le FFmpeg de Fedora, où
 * H.264 passe par `libopenh264` et où l'encodeur `mov_text` est absent.
 */
const FULL = [
  "libx264", "libx265", "libvpx-vp9", "libsvtav1",
  "aac", "libopus", "libmp3lame", "libvorbis",
  "mov_text", "srt", "webvtt", "ass",
];

const FEDORA = [
  "libopenh264", "libvpx-vp9", "libsvtav1", "libaom-av1",
  "aac", "libfdk_aac", "libopus", "libmp3lame", "libvorbis",
  "srt", "subrip", "webvtt", "ssa", "ass",
];

describe("capacités réelles du moteur", () => {
  it("retient le meilleur encodeur disponible par famille", () => {
    expect(capabilitiesFromEncoders(FULL).video.h264).toBe("libx264");
    expect(capabilitiesFromEncoders(FEDORA).video.h264).toBe("libopenh264");
    expect(capabilitiesFromEncoders(FEDORA).video.h265).toBeUndefined();
    expect(capabilitiesFromEncoders(FEDORA).video.av1).toBe("libsvtav1");
  });

  it("n'expose que les codecs acceptés par le conteneur ET présents", () => {
    const fedora = capabilitiesFromEncoders(FEDORA);
    expect(videoCodecsFor("mp4", fedora)).toEqual(["h264", "av1"]);
    expect(videoCodecsFor("webm", fedora)).toEqual(["vp9", "av1"]);
    // Le WebM n'accepte pas AAC, quel que soit le build.
    expect(audioCodecsFor("webm", fedora)).toEqual(["opus", "vorbis"]);
    expect(audioCodecsFor("mp4", fedora)).toEqual(["aac", "mp3"]);
  });

  it("ne déclare un conteneur utilisable que s'il a un codec vidéo", () => {
    const audioOnly = capabilitiesFromEncoders(["aac", "libmp3lame"]);
    expect(containersAvailable(audioOnly)).toEqual([]);
    expect(mostCompatible(audioOnly)).toBeUndefined();
    expect(containersAvailable(capabilitiesFromEncoders(FEDORA))).toContain("mp4");
  });

  it("choisit H.264 + AAC en MP4 comme combinaison la plus compatible", () => {
    expect(mostCompatible(capabilitiesFromEncoders(FULL))).toEqual({
      container: "mp4",
      video: "h264",
      audio: "aac",
    });
    // Sans H.264 du tout, on retombe sur ce qui existe plutôt que d'échouer.
    const vp9Only = capabilitiesFromEncoders(["libvpx-vp9", "libopus"]);
    expect(mostCompatible(vp9Only)).toEqual({ container: "mkv", video: "vp9", audio: "opus" });
  });

  it("connaît les conteneurs capables de porter des sous-titres textuels", () => {
    expect(capabilitiesFromEncoders(FULL).subtitleContainers).toEqual(["mp4", "mov", "mkv", "webm"]);
    // Sans `mov_text`, le MP4 ne peut pas recevoir de piste : l'interface doit le savoir.
    expect(capabilitiesFromEncoders(FEDORA).subtitleContainers).toEqual(["mkv", "webm"]);
  });

  it("reconnaît le codec d'une source pour décider d'une recopie", () => {
    expect(familyOfCodecName("h264")).toBe("h264");
    expect(familyOfCodecName("hevc")).toBe("h265");
    expect(familyOfCodecName("mpeg4")).toBeUndefined();
    expect(canCopyVideo("h264", "mp4")).toBe(true);
    expect(canCopyVideo("h264", "webm")).toBe(false);
    expect(canCopyVideo(undefined, "mkv")).toBe(false);
  });
});
