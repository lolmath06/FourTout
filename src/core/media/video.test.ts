// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addAudioTrack,
  addSubtitleTrack,
  adjustVolume,
  assColor,
  buildConcatFilter,
  burnStyleString,
  burnSubtitles,
  concatCompatible,
  concatTarget,
  concatVideoCopy,
  concatVideoReencode,
  cropFilter,
  DEFAULT_BURN_STYLE,
  encodeVideo,
  escapeConcatPath,
  escapeFilterPath,
  extractSubtitleTrack,
  removeAudio,
  replaceAudio,
  scaleFilter,
  speedAudioFilter,
  speedDurationMs,
  speedVideoFilter,
  swapsDimensions,
  transformFilter,
  trimVideo,
  type ConcatSource,
} from "./operations/video";
import { capabilitiesFromEncoders } from "./capabilities";
import { videoEncodeArgs, audioEncodeArgs } from "./video/presets";
import { cropRectFor } from "./video/dimensions";
import { parseProbe, parseFrameRate, isTextSubtitle } from "./types";

/* ------------------------------------------------------- constructeurs purs */

describe("constructeurs d'arguments vidéo (purs)", () => {
  const base = { container: "mp4" as const, videoArgs: ["-c:v", "libx264"], audioArgs: ["-c:a", "aac"] };

  it("place les filtres puis les codecs, et termine par la sortie", () => {
    const args = encodeVideo({ ...base, videoFilters: [scaleFilter(640, 360)] }).buildArgs(["in.mp4"], "out.mp4");
    expect(args.slice(0, 2)).toEqual(["-i", "in.mp4"]);
    expect(args[args.indexOf("-vf") + 1]).toBe("scale=640:360:flags=lanczos");
    expect(args).toContain("-movflags"); // faststart en MP4
    expect(args[args.length - 1]).toBe("out.mp4");
  });

  it("n'ajoute `+faststart` que pour les conteneurs QuickTime", () => {
    expect(encodeVideo({ ...base, container: "mkv" }).buildArgs(["i"], "o")).not.toContain("-movflags");
    expect(encodeVideo({ ...base, container: "webm" }).buildArgs(["i"], "o")).not.toContain("-movflags");
  });

  it("place `-ss` avant `-i` et recopie les flux en mode rapide", () => {
    const fast = trimVideo({ startMs: 1500, endMs: 4000, mode: "fast", container: "mp4" }).buildArgs(["in"], "out");
    expect(fast.slice(0, 4)).toEqual(["-ss", "1.500", "-i", "in"]);
    expect(fast[fast.indexOf("-t") + 1]).toBe("2.500");
    expect(fast).toContain("-c");
    expect(fast).toContain("copy");

    const precise = trimVideo({
      startMs: 1500, endMs: 4000, mode: "precise", container: "mp4",
      videoArgs: ["-c:v", "libx264"], audioArgs: ["-c:a", "aac"],
    }).buildArgs(["in"], "out");
    expect(precise).not.toContain("copy");
    expect(precise).toContain("libx264");
  });

  it("traduit chaque transformation en filtre, et sait laquelle échange les côtés", () => {
    expect(transformFilter("rotate-right")).toBe("transpose=1");
    expect(transformFilter("rotate-left")).toBe("transpose=2");
    expect(transformFilter("rotate-180")).toBe("transpose=1,transpose=1");
    expect(transformFilter("flip-h")).toBe("hflip");
    expect(transformFilter("flip-v")).toBe("vflip");
    expect(swapsDimensions("rotate-left")).toBe(true);
    expect(swapsDimensions("rotate-180")).toBe(false);
    expect(swapsDimensions("flip-h")).toBe(false);
  });

  it("calcule la vitesse en cohérence sur l'image et sur le son", () => {
    expect(speedVideoFilter(2)).toBe("setpts=0.500000*PTS");
    expect(speedVideoFilter(0.5)).toBe("setpts=2.000000*PTS");
    // `atempo` est borné à [0,5 ; 2] : les facteurs extrêmes s'enchaînent.
    expect(speedAudioFilter(4)).toBe("atempo=2,atempo=2");
    expect(speedAudioFilter(0.25)).toBe("atempo=0.5,atempo=0.5");
    expect(speedDurationMs(10_000, 2)).toBe(5000);
    expect(speedDurationMs(10_000, 0.5)).toBe(20_000);
  });

  it("décrit correctement le rognage", () => {
    expect(cropFilter({ x: 10, y: 20, width: 640, height: 360 })).toBe("crop=640:360:10:20");
  });

  it("ne recopie les flux à la fusion que si tout concorde", () => {
    const a: ConcatSource = {
      width: 640, height: 360, frameRate: 25, hasAudio: true, durationMs: 1000,
      videoCodec: "h264", audioCodec: "aac", sampleRate: 44100, channels: 2,
    };
    expect(concatCompatible([a, { ...a }])).toBe(true);
    expect(concatCompatible([a, { ...a, width: 1280 }])).toBe(false);
    expect(concatCompatible([a, { ...a, frameRate: 30 }])).toBe(false);
    expect(concatCompatible([a, { ...a, hasAudio: false }])).toBe(false);
    expect(concatCompatible([a, { ...a, videoCodec: "vp9" }])).toBe(false);
  });

  it("normalise vers la plus grande définition et la cadence la plus élevée", () => {
    const target = concatTarget([
      { width: 640, height: 360, frameRate: 25, hasAudio: true, durationMs: 1000 },
      { width: 1280, height: 720, frameRate: 30, hasAudio: false, durationMs: 1000 },
    ]);
    expect(target).toEqual({ width: 1280, height: 720, frameRate: 30 });
  });

  it("insère un silence pour une source muette au moment de la fusion", () => {
    const sources: ConcatSource[] = [
      { width: 640, height: 360, frameRate: 25, hasAudio: true, durationMs: 1000 },
      { width: 640, height: 360, frameRate: 25, hasAudio: false, durationMs: 2000 },
    ];
    const filter = buildConcatFilter(sources, { width: 640, height: 360, frameRate: 25 }, true);
    // La seconde source prend son audio de l'entrée 2 (l'`anullsrc` ajoutée).
    expect(filter).toContain("[2:a]");
    expect(filter).toContain("concat=n=2:v=1:a=1[outv][outa]");

    const args = concatVideoReencode({
      sources, container: "mp4", videoArgs: ["-c:v", "libx264"], audioArgs: ["-c:a", "aac"],
    }).buildArgs(["a.mp4", "b.mp4"], "out.mp4");
    expect(args).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    expect(args[args.indexOf("anullsrc=channel_layout=stereo:sample_rate=48000") - 3]).toBe("-t");
  });

  it("écrit une liste de concaténation citable", () => {
    const op = concatVideoCopy("mp4");
    expect(op.stageText?.(["/tmp/a.mp4", "/tmp/b.mp4"]).content).toBe(
      "file '/tmp/a.mp4'\nfile '/tmp/b.mp4'\n",
    );
    expect(escapeConcatPath("/tmp/l'été.mp4")).toBe("/tmp/l'\\''été.mp4");
    const args = op.buildArgs(["/tmp/a.mp4", "/tmp/b.mp4", "/tmp/list.txt"], "out.mp4");
    expect(args.slice(0, 6)).toEqual(["-f", "concat", "-safe", "0", "-i", "/tmp/list.txt"]);
  });

  it("échappe les chemins pour un graphe de filtres, Windows compris", () => {
    expect(escapeFilterPath("/tmp/fourtout/a.srt")).toBe("/tmp/fourtout/a.srt");
    expect(escapeFilterPath("C:\\Films\\a.srt")).toBe("C\\:/Films/a.srt");
  });

  it("traduit les styles d'incrustation en ASS", () => {
    // ASS écrit les couleurs en &HAABBGGRR : le rouge devient &H000000FF.
    expect(assColor("#ff0000")).toBe("&H000000FF");
    expect(assColor("#ffffff")).toBe("&H00FFFFFF");
    const style = burnStyleString({ ...DEFAULT_BURN_STYLE, position: "top", fontSize: 30 });
    expect(style).toContain("FontSize=30");
    expect(style).toContain("Alignment=8");
    expect(style).toContain("Outline=2");
  });

  it("supprime le son sans réencoder l'image", () => {
    const args = removeAudio("mp4").buildArgs(["in.mp4"], "out.mp4");
    expect(args).toContain("-an");
    expect(args.join(" ")).toContain("-c:v copy");
  });

  it("choisit le bon calage quand les durées diffèrent", () => {
    const video = replaceAudio({ container: "mp4", audioArgs: ["-c:a", "aac"], mode: "video", videoDurationMs: 5000 });
    expect(video.buildArgs(["v", "a"], "o")).toContain("apad");
    expect(video.buildArgs(["v", "a"], "o")).toContain("-shortest");

    const audio = replaceAudio({ container: "mp4", audioArgs: ["-c:a", "aac"], mode: "audio", videoDurationMs: 5000 });
    expect(audio.buildArgs(["v", "a"], "o")).not.toContain("-shortest");

    const loop = replaceAudio({ container: "mp4", audioArgs: ["-c:a", "aac"], mode: "loop", videoDurationMs: 5000 });
    const args = loop.buildArgs(["v", "a"], "o");
    // `-stream_loop` s'applique à l'entrée qui suit : l'audio, pas la vidéo.
    expect(args[args.indexOf("-stream_loop") + 2]).toBe("-i");
    expect(args[args.indexOf("-stream_loop") + 3]).toBe("a");
  });

  it("coupe la piste audio pour un volume nul", () => {
    const args = adjustVolume({ container: "mp4", percent: 0, audioArgs: ["-c:a", "aac"] }).buildArgs(["i"], "o");
    expect(args).toContain("-an");
    const loud = adjustVolume({ container: "mp4", percent: 200, audioArgs: ["-c:a", "aac"] }).buildArgs(["i"], "o");
    expect(loud.join(" ")).toContain("volume=2.000,alimiter=limit=0.97");
    const quiet = adjustVolume({ container: "mp4", percent: 50, audioArgs: ["-c:a", "aac"] }).buildArgs(["i"], "o");
    expect(quiet.join(" ")).toContain("volume=0.500");
    expect(quiet.join(" ")).not.toContain("alimiter");
  });

  it("utilise l'encodeur de sous-titres du conteneur", () => {
    expect(addSubtitleTrack({ container: "mkv" }).buildArgs(["v", "s"], "o").join(" ")).toContain("-c:s srt");
    expect(addSubtitleTrack({ container: "webm" }).buildArgs(["v", "s"], "o").join(" ")).toContain("-c:s webvtt");
    expect(addSubtitleTrack({ container: "mp4" }).buildArgs(["v", "s"], "o").join(" ")).toContain("-c:s mov_text");
    expect(extractSubtitleTrack(2, "srt").buildArgs(["v"], "o").join(" ")).toContain("-map 0:s:2");
  });

  it("distingue une piste de sous-titres textuelle d'une piste graphique", () => {
    expect(isTextSubtitle("subrip")).toBe(true);
    expect(isTextSubtitle("mov_text")).toBe(true);
    expect(isTextSubtitle("hdmv_pgs_subtitle")).toBe(false);
    expect(isTextSubtitle(undefined)).toBe(false);
  });

  it("lit une cadence exprimée en fraction", () => {
    expect(parseFrameRate("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseFrameRate("25/1")).toBe(25);
    expect(parseFrameRate("0/0")).toBeUndefined();
    expect(parseFrameRate("")).toBeUndefined();
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
const encoders = () => {
  try {
    return execFileSync(FFMPEG!, ["-hide_banner", "-encoders"]).toString();
  } catch {
    return "";
  }
};
const probe = (path: string) =>
  parseProbe(
    execFileSync(FFPROBE!, [
      "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path,
    ]).toString(),
  );

/**
 * Les constructeurs ci-dessus produisent des chaînes ; seule une exécution
 * réelle prouve qu'elles produisent des **fichiers valides**. Chaque opération
 * de la suite vidéo est donc lancée sur une petite mire, puis le résultat est
 * relu par ffprobe — dimensions, durée, pistes.
 */
describe.skipIf(!FFMPEG || !FFPROBE)("opérations vidéo exécutées avec le vrai FFmpeg", () => {
  let dir: string;
  let clip: string;
  let clipSilent: string;
  let clipPortrait: string;
  let music: string;
  let subs: string;
  let caps: ReturnType<typeof capabilitiesFromEncoders>;
  let vcodec: string;
  let acodec: string[];

  const run = (
    op: { buildArgs: (i: string[], o: string) => string[]; outputExt: string; stageText?: (i: string[]) => { content: string; ext: string } },
    inputs: string[],
    name: string,
  ) => {
    const out = join(dir, `${name}.${op.outputExt}`);
    const all = [...inputs];
    const text = op.stageText?.(all);
    if (text) {
      const listPath = join(dir, `${name}-list.${text.ext}`);
      writeFileSync(listPath, text.content);
      all.push(listPath);
    }
    ff(op.buildArgs(all, out));
    expect(existsSync(out) && statSync(out).size > 0, `${name} produit un fichier`).toBe(true);
    return out;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "ft-video-"));
    // La liste d'encodeurs de CE FFmpeg : les tests suivent le build réel.
    const list = encoders();
    caps = capabilitiesFromEncoders(
      ["libx264", "libopenh264", "libx265", "libvpx-vp9", "libsvtav1", "libaom-av1",
       "aac", "libopus", "libmp3lame", "libvorbis", "mov_text", "srt", "webvtt", "ass"]
        .filter((name) => new RegExp(`\\b${name.replace("+", "\\+")}\\b`).test(list)),
    );
    vcodec = caps.video.h264 ?? caps.video.vp9 ?? "mpeg4";
    acodec = audioEncodeArgs("aac", caps);

    clip = join(dir, "clip.mp4");
    clipSilent = join(dir, "silent.mp4");
    clipPortrait = join(dir, "portrait.mp4");
    music = join(dir, "music.wav");
    subs = join(dir, "subs.srt");

    const mire = (colors: string) =>
      `drawbox=x=0:y=0:w=160:h=120:color=${colors}@1:t=fill,drawbox=x=160:y=0:w=160:h=120:color=green@1:t=fill`;

    ff(["-f", "lavfi", "-i", "color=c=black:s=320x240:r=25:d=2",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
        "-vf", mire("red"), "-pix_fmt", "yuv420p", "-c:v", vcodec, ...acodec, "-shortest", clip]);
    ff(["-f", "lavfi", "-i", "color=c=black:s=320x240:r=25:d=2",
        "-vf", mire("blue"), "-pix_fmt", "yuv420p", "-c:v", vcodec, clipSilent]);
    ff(["-f", "lavfi", "-i", "color=c=black:s=180x320:r=30:d=2",
        "-vf", "drawbox=x=0:y=0:w=180:h=160:color=yellow@1:t=fill",
        "-pix_fmt", "yuv420p", "-c:v", vcodec, clipPortrait]);
    ff(["-f", "lavfi", "-i", "sine=frequency=330:duration=4", music]);
    writeFileSync(
      subs,
      "1\n00:00:00,200 --> 00:00:01,000\nBonjour FourTout.\n\n2\n00:00:01,200 --> 00:00:01,900\nDeuxième ligne.\n",
    );
  });

  it("réencode vers un autre conteneur avec les codecs disponibles", () => {
    const target = caps.video.vp9 ? "webm" : "mkv";
    const codec = caps.video.vp9 ?? caps.video.h264!;
    const out = run(
      encodeVideo({
        container: target,
        videoArgs: videoEncodeArgs({ encoder: codec, level: "small", source: { videoBitRate: 500_000 } }),
        audioArgs: audioEncodeArgs(target === "webm" ? "opus" : "aac", caps),
      }),
      [clip],
      "convert",
    );
    const info = probe(out);
    expect(info.hasVideo).toBe(true);
    expect(info.hasAudio).toBe(true);
    expect(info.durationMs).toBeGreaterThan(1500);
  });

  it("redimensionne exactement aux dimensions demandées", () => {
    const out = run(
      encodeVideo({
        container: "mp4",
        videoArgs: videoEncodeArgs({ encoder: vcodec, level: "balanced", source: { videoBitRate: 400_000 } }),
        audioArgs: ["-c:a", "copy"],
        videoFilters: [scaleFilter(160, 120)],
      }),
      [clip],
      "resize",
    );
    expect(probe(out).width).toBe(160);
    expect(probe(out).height).toBe(120);
  });

  it("rogne exactement la zone sélectionnée", () => {
    const source = { width: 320, height: 240 };
    const rect = cropRectFor(source, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    const out = run(
      encodeVideo({
        container: "mp4",
        videoArgs: videoEncodeArgs({ encoder: vcodec, level: "balanced", source: { videoBitRate: 400_000 } }),
        audioArgs: ["-an"],
        videoFilters: [cropFilter(rect)],
      }),
      [clip],
      "crop",
    );
    const info = probe(out);
    expect(info.width).toBe(rect.width);
    expect(info.height).toBe(rect.height);
    expect(info.hasAudio).toBe(false);
  });

  it("pivote de 90° en échangeant largeur et hauteur", () => {
    const out = run(
      encodeVideo({
        container: "mp4",
        videoArgs: videoEncodeArgs({ encoder: vcodec, level: "balanced", source: { videoBitRate: 400_000 } }),
        audioArgs: ["-an"],
        videoFilters: [transformFilter("rotate-right")],
      }),
      [clip],
      "rotate",
    );
    expect(probe(out).width).toBe(240);
    expect(probe(out).height).toBe(320);
  });

  it("accélère l'image et le son de façon cohérente", () => {
    const out = run(
      encodeVideo({
        container: "mp4",
        videoArgs: videoEncodeArgs({ encoder: vcodec, level: "balanced", source: { videoBitRate: 400_000 } }),
        audioArgs: acodec,
        videoFilters: [speedVideoFilter(2)],
        audioFilters: [speedAudioFilter(2)],
      }),
      [clip],
      "speed",
    );
    const info = probe(out);
    expect(info.durationMs).toBeGreaterThan(700);
    expect(info.durationMs).toBeLessThan(1400); // ~1 s pour 2 s à 2×
    expect(info.hasAudio).toBe(true);
  });

  it("découpe un extrait, en mode rapide comme en mode précis", () => {
    const fast = probe(run(trimVideo({ startMs: 500, endMs: 1500, mode: "fast", container: "mp4" }), [clip], "trim-fast"));
    expect(fast.durationMs).toBeGreaterThan(400);
    expect(fast.durationMs).toBeLessThan(2100);

    const precise = probe(
      run(
        trimVideo({
          startMs: 500, endMs: 1500, mode: "precise", container: "mp4",
          videoArgs: videoEncodeArgs({ encoder: vcodec, level: "balanced", source: { videoBitRate: 400_000 } }),
          audioArgs: acodec,
        }),
        [clip],
        "trim-precise",
      ),
    );
    expect(precise.durationMs).toBeGreaterThan(900);
    expect(precise.durationMs).toBeLessThan(1150);
  });

  it("assemble sans réencodage deux fichiers identiques", () => {
    const copy = join(dir, "clip-copy.mp4");
    ff(["-i", clip, "-c", "copy", copy]);
    const out = run(concatVideoCopy("mp4"), [clip, copy], "concat-copy");
    expect(probe(out).durationMs).toBeGreaterThan(3500);
  });

  it("normalise puis assemble des sources de tailles, cadences et pistes différentes", () => {
    const sources: ConcatSource[] = [probe(clip), probe(clipPortrait)].map((info) => ({
      width: info.width, height: info.height, frameRate: info.frameRate,
      hasAudio: info.hasAudio, durationMs: info.durationMs,
      videoCodec: info.videoCodec, audioCodec: info.audioCodec,
      sampleRate: info.sampleRate, channels: info.channels,
    }));
    expect(concatCompatible(sources)).toBe(false);

    const target = concatTarget(sources);
    const out = run(
      concatVideoReencode({
        sources, container: "mp4",
        videoArgs: videoEncodeArgs({ encoder: vcodec, level: "balanced", source: { videoBitRate: 500_000 } }),
        audioArgs: acodec,
      }),
      [clip, clipPortrait],
      "concat-mix",
    );
    const info = probe(out);
    expect(info.width).toBe(target.width);
    expect(info.height).toBe(target.height);
    expect(info.durationMs).toBeGreaterThan(3500);
    // La source muette a reçu un silence : la piste audio reste continue.
    expect(info.hasAudio).toBe(true);
  });

  it("supprime la piste audio en recopiant l'image", () => {
    const out = run(removeAudio("mp4"), [clip], "mute");
    const info = probe(out);
    expect(info.hasAudio).toBe(false);
    expect(info.videoCodec).toBe(probe(clip).videoCodec);
  });

  it("remplace la bande son en se calant sur la vidéo", () => {
    const out = run(
      replaceAudio({ container: "mp4", audioArgs: acodec, mode: "video", videoDurationMs: 2000 }),
      [clip, music],
      "replace-audio",
    );
    const info = probe(out);
    expect(info.hasAudio).toBe(true);
    // La musique dure 4 s, la vidéo 2 s : la sortie suit la vidéo.
    expect(info.durationMs).toBeLessThan(2600);
  });

  it("ajoute une seconde piste audio sans supprimer la première", () => {
    const encoder = caps.audio.aac ?? caps.audio.opus!;
    const out = run(
      addAudioTrack({ container: "mkv", audioEncoder: encoder, trackIndex: 1, language: "fra" }),
      [clip, music],
      "add-track",
    );
    expect(probe(out).audioStreams).toHaveLength(2);
  });

  it("règle le volume sans toucher à l'image", () => {
    const out = run(
      adjustVolume({ container: "mp4", percent: 200, audioArgs: acodec }),
      [clip],
      "volume",
    );
    expect(probe(out).hasAudio).toBe(true);
    expect(probe(out).videoCodec).toBe(probe(clip).videoCodec);
  });

  it("incruste des sous-titres dans l'image", () => {
    const out = run(
      burnSubtitles({
        container: "mp4",
        videoArgs: videoEncodeArgs({ encoder: vcodec, level: "balanced", source: { videoBitRate: 400_000 } }),
        style: DEFAULT_BURN_STYLE,
      }),
      [clip, subs],
      "burn",
    );
    const info = probe(out);
    expect(info.hasVideo).toBe(true);
    // Aucune piste de sous-titres : le texte fait désormais partie des pixels.
    expect(info.subtitles).toHaveLength(0);
  });

  it("attache des sous-titres WebVTT à un WebM sans réencoder", () => {
    if (!caps.video.vp9) return; // build sans VP9 : rien à vérifier
    const webm = join(dir, "clip.webm");
    ff(["-f", "lavfi", "-i", "color=c=red:s=96x64:r=10:d=1",
        "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "40", "-pix_fmt", "yuv420p", webm]);
    const out = run(addSubtitleTrack({ container: "webm", language: "fra" }), [webm, subs], "webm-softsub");
    const info = probe(out);
    expect(info.videoCodec).toBe("vp9");
    expect(info.subtitles).toHaveLength(1);
    expect(info.subtitles[0].codecName).toBe("webvtt");
  });

  it("boucle une bande son plus courte que la vidéo", () => {
    const shortMusic = join(dir, "short.wav");
    ff(["-f", "lavfi", "-i", "sine=frequency=550:duration=0.5", shortMusic]);
    const out = run(
      replaceAudio({ container: "mp4", audioArgs: acodec, mode: "loop", videoDurationMs: 2000 }),
      [clip, shortMusic],
      "loop-audio",
    );
    const info = probe(out);
    expect(info.hasAudio).toBe(true);
    // La boucle couvre toute la vidéo : la sortie garde sa durée de 2 s.
    expect(info.durationMs).toBeGreaterThan(1700);
    expect(info.durationMs).toBeLessThan(2600);
  });

  it("attache puis réextrait une piste de sous-titres", () => {
    const withTrack = run(addSubtitleTrack({ container: "mkv", language: "fra" }), [clip, subs], "softsub");
    const info = probe(withTrack);
    expect(info.subtitles).toHaveLength(1);
    expect(info.subtitles[0].textBased).toBe(true);
    expect(info.subtitles[0].language).toBe("fra");

    const extracted = run(extractSubtitleTrack(0, "srt"), [withTrack], "extracted");
    const text = readFileSync(extracted, "utf-8");
    expect(text).toContain("Bonjour FourTout.");
    expect(text).toContain("-->");

    const vtt = readFileSync(run(extractSubtitleTrack(0, "vtt"), [withTrack], "extracted-vtt"), "utf-8");
    expect(vtt.startsWith("WEBVTT")).toBe(true);
  });
});
