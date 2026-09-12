// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HEAVY_TIMEOUT } from "@/test/timeouts";
import { realCapabilities, whichBinary } from "@/test/ffmpegProbe";
import {
  describeChannels,
  formatBitRate,
  formatSampleRate,
  inspectMedia,
  isRealVideo,
} from "./inspect";
import { channelCount, setChannels, writeTags } from "./operations/audio";
import { frameRateFilter, frameRateValue, parseFrameRateInput, FRAME_RATE_PRESETS } from "./operations/video";
import { frameRatePipeline } from "./video/pipelines";

const DIR = join(process.cwd(), "test-assets", "generated");
const CONTRACT = JSON.parse(readFileSync(join(DIR, "CONTRAT.json"), "utf8")) as {
  mediaPhase10: Record<
    string,
    | (Record<string, unknown> & {
        canaux?: number;
        dispositionCanaux?: string | null;
        frequenceHz?: number;
        dureeSecondes?: number;
        cadenceReelle?: string;
        cadenceMoyenne?: string;
        images?: number;
        etiquettes?: Record<string, string>;
      })
    | null
  >;
};

const FFMPEG = whichBinary("ffmpeg");
const FFPROBE = whichBinary("ffprobe");

const probeJson = (path: string) =>
  execFileSync(FFPROBE!, [
    "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path,
  ]).toString();

/* --------------------------------------------------------- lecture de fiche */

describe.skipIf(!FFPROBE)("fiche détaillée d'un média", () => {
  it("décrit un fichier audio étiqueté sans rien inventer", () => {
    const details = inspectMedia(probeJson(join(DIR, "audio-tagged.mp3")));
    const expected = CONTRACT.mediaPhase10["audio-tagged.mp3"]!;

    expect(details.formatName).toBe("mp3");
    expect(details.audio).toHaveLength(1);
    expect(details.audio[0].channels).toBe(expected.canaux);
    expect(details.audio[0].sampleRate).toBe(expected.frequenceHz);
    expect(details.audio[0].codecName).toBe("mp3");
    expect(details.video).toHaveLength(0);
    expect(isRealVideo(details)).toBe(false);

    // Les étiquettes remontent telles que ffprobe les donne.
    const tags = Object.fromEntries(details.tags.map((tag) => [tag.key, tag.value]));
    for (const [key, value] of Object.entries(expected.etiquettes!)) {
      expect(tags[key]).toBe(value);
    }
    // `encoder` est sorti des étiquettes visibles et exposé à part.
    expect(details.encoder).toBeDefined();
    expect(tags.encoder).toBeUndefined();
  });

  it("décrit une vidéo avec profil, aspect et cadence", () => {
    const details = inspectMedia(probeJson(join(DIR, "video-24fps.mp4")));
    const expected = CONTRACT.mediaPhase10["video-24fps.mp4"]!;

    expect(details.video).toHaveLength(1);
    const video = details.video[0];
    expect(video.width).toBe(320);
    expect(video.height).toBe(240);
    expect(video.pixelFormat).toBe("yuv420p");
    expect(video.profile).toBeDefined();
    expect(video.displayAspectRatio).toBe("4:3");
    expect(video.frameCount).toBe(expected.images);
    expect(video.frameRate.realFraction).toBe(expected.cadenceReelle);
    expect(video.frameRate.averageFraction).toBe(expected.cadenceMoyenne);
    expect(video.frameRate.real).toBeCloseTo(24, 3);
    expect(video.frameRate.diverging).toBe(false);
    expect(isRealVideo(details)).toBe(true);

    // Flux unique sans débit propre : le débit du conteneur est repris, mais
    // annoncé comme déduit — jamais présenté comme une mesure du flux.
    if (video.bitRateInferred) expect(video.bitRate).toBe(details.bitRate);
  });

  it("donne les canaux et la disposition d'un fichier multicanal", () => {
    const details = inspectMedia(probeJson(join(DIR, "audio-multichannel.wav")));
    const expected = CONTRACT.mediaPhase10["audio-multichannel.wav"]!;
    expect(details.audio[0].channels).toBe(expected.canaux);
    expect(details.audio[0].channelLayout).toBe(expected.dispositionCanaux);
    expect(details.audio[0].bitDepth).toBe(16);
  });

  it("ne remplit aucun champ absent", () => {
    const details = inspectMedia('{"format":{},"streams":[]}');
    expect(details.video).toHaveLength(0);
    expect(details.audio).toHaveLength(0);
    expect(details.tags).toHaveLength(0);
    expect(details.bitRate).toBeUndefined();
    expect(details.durationMs).toBe(0);
    expect(details.encoder).toBeUndefined();
  });

  it("repère une cadence divergente sans conclure au VFR", () => {
    const details = inspectMedia(
      JSON.stringify({
        format: { format_name: "matroska" },
        streams: [{ index: 0, codec_type: "video", r_frame_rate: "60/1", avg_frame_rate: "24000/1001" }],
      }),
    );
    expect(details.video[0].frameRate.diverging).toBe(true);
    expect(details.video[0].frameRate.real).toBeCloseTo(60, 3);
    expect(details.video[0].frameRate.average).toBeCloseTo(23.976, 3);
  });

  it("distingue une pochette d'album d'une vraie piste vidéo", () => {
    const details = inspectMedia(
      JSON.stringify({
        format: { format_name: "mp3" },
        streams: [
          { index: 0, codec_type: "audio", channels: 2 },
          { index: 1, codec_type: "video", codec_name: "mjpeg", disposition: { attached_pic: 1 } },
        ],
      }),
    );
    expect(details.hasCoverArt).toBe(true);
    expect(isRealVideo(details)).toBe(false);
  });

  it("met en forme les valeurs techniques lisiblement", () => {
    expect(formatBitRate(128_000)).toBe("128 kb/s");
    expect(formatBitRate(5_000_000)).toBe("5.00 Mb/s");
    expect(formatSampleRate(48_000)).toBe("48 kHz");
    expect(formatSampleRate(44_100)).toBe("44.1 kHz");
    expect(describeChannels(1, undefined)).toBe("mono (1)");
    expect(describeChannels(6, "5.1")).toBe("5.1 (6)");
    expect(describeChannels(undefined, undefined)).toBe("inconnu");
  });
});

/* ------------------------------------------------------------- cadences */

describe("fréquence d'images (pur)", () => {
  it("garde les fractions NTSC exactes", () => {
    expect(frameRateValue("30000/1001")).toBeCloseTo(29.97, 3);
    expect(frameRateValue("24/1")).toBe(24);
    expect(frameRateValue("0/0")).toBeUndefined();
    expect(frameRateValue("n'importe quoi")).toBeUndefined();
  });

  it("ramène une saisie décimale NTSC à sa fraction", () => {
    // Saisir « 29,97 » doit donner exactement la même vidéo que le préréglage.
    expect(parseFrameRateInput("29.97")).toBe("30000/1001");
    expect(parseFrameRateInput("29,97")).toBe("30000/1001");
    expect(parseFrameRateInput("23.976")).toBe("24000/1001");
    expect(parseFrameRateInput("25")).toBe("25/1");
    expect(parseFrameRateInput("12.5")).toBe("12500/1000");
    expect(parseFrameRateInput("0")).toBeUndefined();
    expect(parseFrameRateInput("1000")).toBeUndefined();
    expect(parseFrameRateInput("")).toBeUndefined();
  });

  it("propose des préréglages tous valides", () => {
    for (const preset of FRAME_RATE_PRESETS) {
      expect(frameRateValue(preset.value)).toBeGreaterThan(0);
    }
  });

  it("construit un filtre fps sans interpolation", () => {
    expect(frameRateFilter("30000/1001")).toBe("fps=30000/1001");
  });
});

/* ---------------------------------------------------------------- canaux */

describe("canaux audio (pur)", () => {
  it("traduit la cible en nombre de canaux", () => {
    expect(channelCount("mono")).toBe(1);
    expect(channelCount("stereo")).toBe(2);
    expect(channelCount("keep")).toBeUndefined();
  });

  it("n'ajoute -ac que si une cible est demandée", () => {
    expect(setChannels("mono", "wav").buildArgs(["in.wav"], "out.wav")).toContain("-ac");
    expect(setChannels("keep", "wav").buildArgs(["in.wav"], "out.wav")).not.toContain("-ac");
  });

  it("réécrit les étiquettes sans réencoder le son", () => {
    const args = writeTags({ title: "Nouveau" }, "mp3", "audio/mpeg").buildArgs(["in.mp3"], "out.mp3");
    expect(args).toContain("-c");
    expect(args[args.indexOf("-c") + 1]).toBe("copy");
    expect(args).toContain("-metadata");
    expect(args).toContain("title=Nouveau");
    // Aucun encodeur audio ne doit apparaître dans la commande.
    expect(args.join(" ")).not.toMatch(/libmp3lame|aac|libopus/);
  });

  it("efface une étiquette avec une valeur vide, ignore les champs absents", () => {
    const args = writeTags({ title: "", artist: undefined }, "mp3", "audio/mpeg").buildArgs(["i"], "o");
    expect(args).toContain("title=");
    expect(args.join(" ")).not.toContain("artist=");
  });
});

/* ------------------------------------------------- intégration FFmpeg réelle */

describe.skipIf(!FFMPEG || !FFPROBE)(
  "phase 10 exécutée avec le vrai FFmpeg",
  { timeout: HEAVY_TIMEOUT },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "ft-phase10-"));
    const run = (operationArgs: string[]) =>
      execFileSync(FFMPEG!, ["-hide_banner", "-nostdin", "-y", ...operationArgs], { stdio: "pipe" });

    it("passe du mono au stéréo et du stéréo au mono sans changer la durée", () => {
      const source = CONTRACT.mediaPhase10["audio-mono.wav"]!;
      const toStereo = join(dir, "to-stereo.wav");
      run(setChannels("stereo", "wav").buildArgs([join(DIR, "audio-mono.wav")], toStereo));
      const stereo = inspectMedia(probeJson(toStereo));
      expect(stereo.audio[0].channels).toBe(2);
      expect(stereo.audio[0].sampleRate).toBe(source.frequenceHz);
      expect(stereo.durationMs / 1000).toBeCloseTo(source.dureeSecondes!, 1);

      const toMono = join(dir, "to-mono.wav");
      run(setChannels("mono", "wav").buildArgs([join(DIR, "audio-stereo-distinct.wav")], toMono));
      const mono = inspectMedia(probeJson(toMono));
      expect(mono.audio[0].channels).toBe(1);
      expect(mono.durationMs / 1000).toBeCloseTo(source.dureeSecondes!, 1);
    });

    it("réduit un 5.1 seulement quand on le lui demande", () => {
      const downmixed = join(dir, "downmix.wav");
      run(setChannels("stereo", "wav").buildArgs([join(DIR, "audio-multichannel.wav")], downmixed));
      expect(inspectMedia(probeJson(downmixed)).audio[0].channels).toBe(2);

      // « Tel quel » ne doit toucher à rien, pas même à un fichier multicanal.
      const untouched = join(dir, "untouched.wav");
      run(setChannels("keep", "wav").buildArgs([join(DIR, "audio-multichannel.wav")], untouched));
      expect(inspectMedia(probeJson(untouched)).audio[0].channels).toBe(
        CONTRACT.mediaPhase10["audio-multichannel.wav"]!.canaux,
      );
    });

    it("réécrit les étiquettes et relit les nouvelles", () => {
      const source = join(DIR, "audio-tagged.mp3");
      const target = join(dir, "retagged.mp3");
      const before = inspectMedia(probeJson(source));

      run(
        writeTags(
          { title: "Titre corrigé", artist: "Nouvel artiste", date: "2026", track: "7" },
          "mp3",
          "audio/mpeg",
        ).buildArgs([source], target),
      );

      const after = inspectMedia(probeJson(target));
      const tags = Object.fromEntries(after.tags.map((tag) => [tag.key, tag.value]));
      expect(tags.title).toBe("Titre corrigé");
      expect(tags.artist).toBe("Nouvel artiste");
      expect(tags.date).toBe("2026");
      expect(tags.track).toBe("7");
      // L'album, non fourni, survit tel quel.
      expect(tags.album).toBe(CONTRACT.mediaPhase10["audio-tagged.mp3"]!.etiquettes!.album);
      // Le son n'a pas bougé : même codec, même durée, même débit.
      expect(after.audio[0].codecName).toBe(before.audio[0].codecName);
      expect(after.audio[0].bitRate).toBe(before.audio[0].bitRate);
      expect(after.durationMs / 1000).toBeCloseTo(before.durationMs / 1000, 1);
    });

    it("convertit 24 i/s en 30 i/s sans changer la durée", () => {
      const caps = realCapabilities(FFMPEG!);
      const source = join(DIR, "video-24fps.mp4");
      const before = inspectMedia(probeJson(source));
      const pipeline = frameRatePipeline(
        { caps, extension: "mp4", info: undefined },
        { fraction: "30/1" },
      );
      const target = join(dir, `fps30.${pipeline.operation.outputExt}`);
      run(pipeline.operation.buildArgs([source], target));

      const after = inspectMedia(probeJson(target));
      expect(after.video[0].frameRate.average).toBeCloseTo(30, 1);
      expect(after.durationMs / 1000).toBeCloseTo(before.durationMs / 1000, 1);
      // Une conversion sans interpolation garde exactement durée × cadence images.
      expect(after.video[0].frameCount).toBeCloseTo(
        Math.round((before.durationMs / 1000) * 30),
        -1,
      );
    });

    it("écrit une cadence NTSC comme une fraction, pas comme un décimal", () => {
      const caps = realCapabilities(FFMPEG!);
      const pipeline = frameRatePipeline(
        { caps, extension: "mp4", info: undefined },
        { fraction: "30000/1001" },
      );
      const target = join(dir, `ntsc.${pipeline.operation.outputExt}`);
      run(pipeline.operation.buildArgs([join(DIR, "video-24fps.mp4")], target));

      const after = inspectMedia(probeJson(target));
      // Ne pas comparer la chaîne « 29.97 » : ffprobe répond « 30000/1001 ».
      expect(after.video[0].frameRate.average).toBeCloseTo(29.97, 2);
      expect(frameRateValue(after.video[0].frameRate.averageFraction ?? "")).toBeCloseTo(29.97, 2);
    });
  },
);
