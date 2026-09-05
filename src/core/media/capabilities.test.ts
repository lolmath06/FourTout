import { describe, expect, it } from "vitest";
import {
  audioCodecsFor,
  buildCapabilities,
  canCopyVideo,
  containersAvailable,
  familyOfCodecName,
  isHardwareEncoder,
  mostCompatible,
  preferredVideoCodec,
  videoCodecsFor,
  videoEncoderCandidates,
} from "./capabilities";

/**
 * FourTout ne doit jamais proposer un encodeur qui ne démarre pas ici.
 *
 * Ces tests décrivent les environnements que l'on rencontre réellement : un
 * build complet, le FFmpeg de Fedora, et surtout le cas qui a cassé la phase 5
 * — un FFmpeg compilé avec NVENC sur une machine où NVENC ne peut pas s'ouvrir.
 */

/** Build complet, tout fonctionne. */
const FULL_ANNOUNCED = [
  "libx264", "libx265", "libvpx-vp9", "libsvtav1",
  "aac", "libopus", "libmp3lame", "libvorbis",
  "mov_text", "srt", "webvtt", "ass",
];

/**
 * Fedora : pas de `libx264`, pas de `libx265`, pas de `mov_text` — mais FFmpeg
 * **annonce** NVENC, VAAPI et QSV, qui n'ouvrent pas sur cette machine.
 */
const FEDORA_ANNOUNCED = [
  "libopenh264", "h264_nvenc", "h264_vaapi", "h264_qsv", "h264_v4l2m2m",
  "hevc_nvenc", "hevc_vaapi", "hevc_qsv",
  "libvpx-vp9", "vp9_vaapi", "libsvtav1", "libaom-av1", "av1_nvenc", "av1_vaapi",
  "aac", "libfdk_aac", "libopus", "libmp3lame", "libvorbis",
  "srt", "subrip", "webvtt", "ssa", "ass",
];

/** Ce qui, sur cette même machine, encode réellement une image. */
const FEDORA_USABLE = ["libopenh264", "libvpx-vp9", "libsvtav1", "libaom-av1"];

const full = () =>
  buildCapabilities({ announced: FULL_ANNOUNCED, usableVideo: FULL_ANNOUNCED });
const fedora = () =>
  buildCapabilities({ announced: FEDORA_ANNOUNCED, usableVideo: FEDORA_USABLE });

describe("capacités réelles du moteur", () => {
  it("ignore un encodeur annoncé qui n'a pas passé le test d'encodage", () => {
    // C'est LA régression de la phase 5 : `h264_nvenc` est annoncé, choisi,
    // puis échoue à l'ouverture une fois le traitement lancé.
    const caps = fedora();
    expect(caps.video.h264).toBe("libopenh264");
    expect(caps.video.h264).not.toBe("h264_nvenc");
    expect(caps.rejectedVideo).toContain("h264_nvenc");
    expect(caps.usableVideo).not.toContain("h264_nvenc");
  });

  it("« Compatibilité maximale » ne retient jamais un encodeur non testé", () => {
    const choice = mostCompatible(fedora());
    expect(choice).toEqual({ container: "mp4", video: "h264", audio: "aac" });
    expect(fedora().video[choice!.video]).toBe("libopenh264");
  });

  it("préfère le logiciel au matériel même quand les deux fonctionnent", () => {
    // Fiabilité avant vitesse : un encodeur matériel qui marche ne passe pas
    // devant un encodeur logiciel qui marche.
    const both = buildCapabilities({
      announced: ["libx264", "h264_nvenc", "aac"],
      usableVideo: ["libx264", "h264_nvenc"],
    });
    expect(both.video.h264).toBe("libx264");
    expect(both.videoAlternatives.h264).toEqual(["libx264", "h264_nvenc"]);

    // Sans encodeur logiciel, le matériel **testé** reste utilisable.
    const hardwareOnly = buildCapabilities({
      announced: ["h264_nvenc", "aac"],
      usableVideo: ["h264_nvenc"],
    });
    expect(hardwareOnly.video.h264).toBe("h264_nvenc");
  });

  it("retire une famille entière si aucun de ses encodeurs ne démarre", () => {
    const caps = fedora();
    // H.265 est annoncé (nvenc, vaapi, qsv) mais aucun ne fonctionne.
    expect(caps.video.h265).toBeUndefined();
    expect(videoCodecsFor("mov", caps)).toEqual(["h264"]);
    expect(videoCodecsFor("mkv", caps)).toEqual(["h264", "vp9", "av1"]);
  });

  it("reconnaît les encodeurs matériels par leur suffixe", () => {
    expect(isHardwareEncoder("h264_nvenc")).toBe(true);
    expect(isHardwareEncoder("hevc_vaapi")).toBe(true);
    expect(isHardwareEncoder("av1_qsv")).toBe(true);
    expect(isHardwareEncoder("libx264")).toBe(false);
    expect(isHardwareEncoder("libsvtav1")).toBe(false);
    // Tous les candidats matériels doivent être testables, jamais supposés.
    expect(videoEncoderCandidates()).toContain("h264_nvenc");
  });

  it("n'expose que les codecs acceptés par le conteneur ET utilisables", () => {
    const caps = fedora();
    expect(videoCodecsFor("mp4", caps)).toEqual(["h264", "av1"]);
    expect(videoCodecsFor("webm", caps)).toEqual(["vp9", "av1"]);
    // Le WebM n'accepte pas AAC, quel que soit le build.
    expect(audioCodecsFor("webm", caps)).toEqual(["opus", "vorbis"]);
    expect(audioCodecsFor("mp4", caps)).toEqual(["aac", "mp3"]);
  });

  it("choisit le codec le plus largement lisible du conteneur", () => {
    expect(preferredVideoCodec("mp4", fedora())).toBe("h264");
    expect(preferredVideoCodec("webm", fedora())).toBe("vp9");
    const noH264 = buildCapabilities({
      announced: ["libvpx-vp9", "libsvtav1", "libopus"],
      usableVideo: ["libvpx-vp9", "libsvtav1"],
    });
    expect(preferredVideoCodec("mp4", noH264)).toBe("av1");
  });

  it("ne déclare un conteneur utilisable que s'il a un codec qui fonctionne", () => {
    const audioOnly = buildCapabilities({ announced: ["aac", "libmp3lame"], usableVideo: [] });
    expect(containersAvailable(audioOnly)).toEqual([]);
    expect(mostCompatible(audioOnly)).toBeUndefined();

    // Tout annoncé, rien de fonctionnel : aucune sortie vidéo possible.
    const brokenGpu = buildCapabilities({ announced: FEDORA_ANNOUNCED, usableVideo: [] });
    expect(containersAvailable(brokenGpu)).toEqual([]);
    expect(mostCompatible(brokenGpu)).toBeUndefined();
    expect(brokenGpu.rejectedVideo).toContain("libopenh264");
  });

  it("retombe sur ce qui existe quand H.264 est totalement absent", () => {
    const vp9Only = buildCapabilities({
      announced: ["libvpx-vp9", "libopus"],
      usableVideo: ["libvpx-vp9"],
    });
    expect(mostCompatible(vp9Only)).toEqual({ container: "mkv", video: "vp9", audio: "opus" });
  });

  it("connaît les conteneurs capables de porter des sous-titres textuels", () => {
    expect(full().subtitleContainers).toEqual(["mp4", "mov", "mkv", "webm"]);
    // Sans `mov_text`, le MP4 ne peut pas recevoir de piste : l'interface doit le savoir.
    expect(fedora().subtitleContainers).toEqual(["mkv", "webm"]);
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
