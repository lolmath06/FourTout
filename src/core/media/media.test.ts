// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  atempoChain,
  codecArgs,
  convertAudio,
  extractAudio,
  mergeAudio,
  normalizeAudio,
  removeSilenceAudio,
  speedAudio,
  trimAudio,
  volumeAudio,
} from "./operations/audio";
import { extractFrame, gifToVideo, videoToGif } from "./operations/video";
import { parseProbe, parseTimecode, formatTimecode } from "./types";

/* ------------------------------------------------------- constructeurs purs */

describe("constructeurs d'arguments (purs)", () => {
  it("choisit le bon codec par format", () => {
    expect(codecArgs("mp3", { bitrateKbps: 192 })).toEqual(["-c:a", "libmp3lame", "-b:a", "192k"]);
    expect(codecArgs("wav")).toEqual(["-c:a", "pcm_s16le"]);
    expect(codecArgs("opus")).toContain("libopus");
  });

  it("place -ss avant -i et -t pour le découpage", () => {
    const args = trimAudio(5000, 12500, "wav").buildArgs(["in.wav"], "out.wav");
    expect(args.slice(0, 4)).toEqual(["-ss", "5.000", "-i", "in.wav"]);
    expect(args).toContain("-t");
    expect(args[args.indexOf("-t") + 1]).toBe("7.500");
  });

  it("chaîne atempo pour rester dans [0.5, 2]", () => {
    expect(atempoChain(2)).toBe("atempo=2");
    expect(atempoChain(4)).toBe("atempo=2,atempo=2");
    expect(atempoChain(0.25)).toBe("atempo=0.5,atempo=0.5");
    expect(atempoChain(1.5)).toBe("atempo=1.5");
  });

  it("construit un filtre concat pour la fusion", () => {
    const args = mergeAudio("mp3").buildArgs(["a.wav", "b.wav"], "out.mp3");
    expect(args.filter((a) => a === "-i")).toHaveLength(2);
    expect(args.join(" ")).toContain("concat=n=2:v=0:a=1");
  });

  it("normalise via loudnorm et gère le volume en dB", () => {
    expect(normalizeAudio("standard", "wav").buildArgs(["i"], "o").join(" ")).toContain("loudnorm=I=-16");
    expect(volumeAudio(-6, "wav").buildArgs(["i"], "o")).toContain("volume=-6dB");
  });

  it("convertit les timecodes", () => {
    expect(parseTimecode("00:00:05.000")).toBe(5000);
    expect(parseTimecode("1:30")).toBe(90000);
    expect(parseTimecode("abc")).toBeUndefined();
    expect(formatTimecode(90500)).toBe("00:01:30.500");
  });
});

/* ------------------------------------------------ intégration FFmpeg réelle */

function which(name: string): string | undefined {
  try {
    return execFileSync("sh", ["-c", `command -v ${name}`]).toString().trim() || undefined;
  } catch {
    return undefined;
  }
}
const FFMPEG = which("ffmpeg");
const FFPROBE = which("ffprobe");
const ff = (args: string[]) => execFileSync(FFMPEG!, ["-hide_banner", "-y", ...args], { stdio: "pipe" });
// Encodeur H.264 réellement présent dans le FFmpeg de test.
const hasEnc = (name: string) => { try { return execFileSync(FFMPEG!, ["-hide_banner", "-encoders"]).toString().includes(name); } catch { return false; } };
const VCODEC = FFMPEG && hasEnc("libx264") ? "libx264" : "libopenh264";
const probe = (path: string) => parseProbe(execFileSync(FFPROBE!, ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path]).toString());

describe.skipIf(!FFMPEG || !FFPROBE)("opérations exécutées avec le vrai FFmpeg", () => {
  let dir: string;
  let tone: string;
  let toneB: string;
  let silences: string;
  let video: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "ft-media-"));
    tone = join(dir, "tone.wav");
    toneB = join(dir, "toneb.wav");
    silences = join(dir, "sil.wav");
    video = join(dir, "clip.mp4");
    ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", tone]);
    ff(["-f", "lavfi", "-i", "sine=frequency=660:duration=1", toneB]);
    // 1 s son, 1,5 s silence, 1 s son.
    ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
        "-filter_complex", "[1]atrim=duration=1.5[s];[0][s][2]concat=n=3:v=0:a=1[a]", "-map", "[a]", silences]);
    // Vidéo courte avec audio (mire + tonalité).
    ff(["-f", "lavfi", "-i", "testsrc=duration=2:size=160x120:rate=15", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
        "-pix_fmt", "yuv420p", "-c:v", VCODEC, "-c:a", "aac", "-shortest", video]);
  });

  const run = (op: { buildArgs: (i: string[], o: string) => string[]; outputExt: string }, inputs: string[], name: string) => {
    const out = join(dir, `${name}.${op.outputExt}`);
    ff(op.buildArgs(inputs, out));
    expect(existsSync(out) && statSync(out).size > 0, `${name} produit un fichier`).toBe(true);
    return out;
  };

  it("convertit WAV → MP3/FLAC/OGG/Opus valides", () => {
    expect(probe(run(convertAudio("mp3", { bitrateKbps: 128 }), [tone], "c")).audioCodec).toBe("mp3");
    expect(probe(run(convertAudio("flac"), [tone], "cf")).audioCodec).toBe("flac");
    expect(probe(run(convertAudio("opus"), [tone], "co")).audioCodec).toBe("opus");
  });

  it("découpe une portion (durée réduite)", () => {
    const out = run(trimAudio(500, 1500, "wav"), [tone], "trim");
    expect(probe(out).durationMs).toBeGreaterThan(800);
    expect(probe(out).durationMs).toBeLessThan(1200);
  });

  it("fusionne deux audios (durées additionnées)", () => {
    const out = run(mergeAudio("wav"), [tone, toneB], "merge");
    expect(probe(out).durationMs).toBeGreaterThan(2800);
  });

  it("applique volume, vitesse et normalisation", () => {
    expect(probe(run(volumeAudio(-6, "wav"), [tone], "vol")).hasAudio).toBe(true);
    const sped = probe(run(speedAudio(2, "wav"), [tone], "spd"));
    expect(sped.durationMs).toBeLessThan(1300); // ~1 s pour 2 s à 2×
    expect(probe(run(normalizeAudio("standard", "wav"), [tone], "norm")).hasAudio).toBe(true);
  });

  it("supprime les silences (durée réduite)", () => {
    const out = run(removeSilenceAudio("wav", { thresholdDb: -30, minSilenceMs: 500 }), [silences], "nosil");
    expect(probe(out).durationMs).toBeLessThan(probe(silences).durationMs - 500);
  });

  it("extrait l'audio d'une vidéo", () => {
    const out = run(extractAudio("mp3"), [video], "extract");
    expect(probe(out).hasAudio).toBe(true);
    expect(probe(out).hasVideo).toBe(false);
  });

  it("vidéo → GIF, GIF → vidéo, extraction d'image", () => {
    const gif = run(videoToGif({ fps: 10, width: 120 }), [video], "gif");
    expect(probe(gif).hasVideo).toBe(true);
    const mp4 = run(gifToVideo("mp4", VCODEC as "libx264" | "libopenh264"), [gif], "fromgif");
    expect(probe(mp4).videoCodec).toBe("h264");
    const frame = run(extractFrame(1000, "png"), [video], "frame");
    expect(existsSync(frame)).toBe(true);
  });
});
