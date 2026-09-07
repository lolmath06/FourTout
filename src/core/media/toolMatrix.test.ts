// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  announcedEncoders,
  encoderWorks,
  realCapabilities,
  whichBinary,
} from "@/test/ffmpegProbe";
import {
  isHardwareEncoder,
  mostCompatible,
  videoEncoderCandidates,
  type MediaCapabilities,
} from "./capabilities";
import type { MediaExecutable } from "./client";
import { parseProbe, type MediaInfo } from "./types";
import { DEFAULT_BURN_STYLE } from "./operations/video";
import { centeredRect } from "./video/dimensions";
import {
  batchPipeline,
  burnPipeline,
  compressPipeline,
  convertPipeline,
  cropPipeline,
  extractSubtitlePipeline,
  mergePipeline,
  removeAudioPipeline,
  replaceAudioPipeline,
  resizePipeline,
  softSubtitlePipeline,
  speedPipeline,
  transformPipeline,
  trimPipeline,
  volumePipeline,
} from "./video/pipelines";

/**
 * Matrice d'intégration de la suite Vidéo.
 *
 * Ce fichier existe à cause d'une régression précise : sur une machine où
 * FFmpeg **annonce** `h264_nvenc` sans pouvoir l'ouvrir, tous les outils qui
 * réencodent échouaient — conversion, compression, redimensionnement,
 * découpage précis, rognage, rotation, vitesse, incrustation, lots. Les tests
 * de l'époque ne l'ont pas vu parce qu'ils appelaient les constructeurs
 * d'arguments avec un encodeur écrit en dur : ils validaient la mécanique, pas
 * la **décision**.
 *
 * Ici, on part donc de la vraie détection (liste annoncée, puis encodage
 * d'essai), on laisse les pipelines choisir comme ils le feront dans
 * l'application, et on exécute réellement chaque opération sur les fixtures
 * avant de relire le résultat avec ffprobe.
 */

const FFMPEG = whichBinary("ffmpeg");
const FFPROBE = whichBinary("ffprobe");
const ASSETS = join(process.cwd(), "test-assets", "generated");
const fixture = (name: string) => join(ASSETS, name);
const hasFixtures = existsSync(fixture("video-short.mp4"));

const probe = (path: string): MediaInfo =>
  parseProbe(
    execFileSync(FFPROBE!, [
      "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path,
    ]).toString(),
  );

describe.skipIf(!FFMPEG || !FFPROBE)("détection des encodeurs sur cette machine", () => {
  // Chaque candidat déclenche un encodage d'essai réel : autant de processus
  // FFmpeg lancés à la suite. Le délai par défaut de cinq secondes suffit sur
  // une machine au repos, mais pas quand la suite complète tourne en parallèle.
  it("n'accepte jamais un encodeur annoncé mais incapable d'encoder", { timeout: 60_000 }, () => {
    const announced = announcedEncoders(FFMPEG!);
    const candidates = videoEncoderCandidates().filter((name) => announced.includes(name));
    const caps = realCapabilities(FFMPEG!);

    for (const name of candidates) {
      const works = encoderWorks(FFMPEG!, name);
      expect(caps.usableVideo.includes(name), `${name} : test ${works}, retenu ${!works}`).toBe(works);
      if (!works) expect(caps.rejectedVideo).toContain(name);
    }
    // Aucune famille ne peut pointer vers un encodeur écarté.
    for (const encoder of Object.values(caps.video)) {
      expect(caps.usableVideo).toContain(encoder);
    }
  });

  it("choisit pour « Compatibilité maximale » un encodeur qui démarre vraiment", { timeout: 60_000 }, () => {
    const caps = realCapabilities(FFMPEG!);
    const choice = mostCompatible(caps);
    expect(choice, "aucun encodage vidéo possible sur cette machine").toBeDefined();
    const encoder = caps.video[choice!.video]!;
    expect(encoderWorks(FFMPEG!, encoder), `${encoder} doit fonctionner`).toBe(true);
  });

  it("n'utilise un encodeur matériel que s'il a passé le test", () => {
    const caps = realCapabilities(FFMPEG!);
    for (const encoder of Object.values(caps.video)) {
      if (!isHardwareEncoder(encoder)) continue;
      expect(encoderWorks(FFMPEG!, encoder), `${encoder} matériel retenu sans test`).toBe(true);
    }
  });
});

describe.skipIf(!FFMPEG || !FFPROBE || !hasFixtures)(
  "matrice des outils vidéo, sur les vraies fixtures",
  () => {
    let dir: string;
    let caps: MediaCapabilities;

    /** Exécute un pipeline exactement comme `runMedia` le ferait. */
    const run = (
      pipeline: { operation: MediaExecutable; alternatives?: MediaExecutable[] },
      inputs: string[],
      name: string,
    ) => {
      const attempts = [pipeline.operation, ...(pipeline.alternatives ?? [])];
      let last: unknown;
      for (const operation of attempts) {
        const out = join(dir, `${name}.${operation.outputExt}`);
        const all = [...inputs];
        const text = operation.stageText?.(all);
        if (text) {
          const listPath = join(dir, `${name}-list.${text.ext}`);
          writeFileSync(listPath, text.content);
          all.push(listPath);
        }
        try {
          execFileSync(FFMPEG!, ["-hide_banner", "-nostdin", "-y", ...operation.buildArgs(all, out)], {
            stdio: "pipe",
          });
          expect(existsSync(out) && statSync(out).size > 0, `${name} : fichier vide`).toBe(true);
          return out;
        } catch (error) {
          last = error;
        }
      }
      throw new Error(`${name} a échoué sur toutes les variantes : ${String(last).slice(0, 400)}`);
    };

    const sourceOf = (path: string) => ({
      caps,
      info: probe(path),
      extension: path.slice(path.lastIndexOf(".") + 1),
    });

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "ft-matrix-"));
      caps = realCapabilities(FFMPEG!);
    });

    it("convertit en préréglage « Compatibilité maximale »", () => {
      const source = sourceOf(fixture("video-with-audio.mp4"));
      const choice = mostCompatible(caps)!;
      const pipeline = convertPipeline(source, {
        container: choice.container,
        video: choice.video,
        audio: choice.audio ?? null,
        level: "balanced",
      });
      const info = probe(run(pipeline, [fixture("video-with-audio.mp4")], "convert-compatible"));
      expect(info.hasVideo).toBe(true);
      expect(info.hasAudio).toBe(true);
      expect(info.durationMs).toBeGreaterThan(4000);
    });

    it("convertit en WebM VP9 + Opus", () => {
      if (!caps.video.vp9) return;
      const source = sourceOf(fixture("video-with-audio.mp4"));
      const pipeline = convertPipeline(source, {
        container: "webm",
        video: "vp9",
        audio: "opus",
        level: "small",
      });
      const info = probe(run(pipeline, [fixture("video-with-audio.mp4")], "convert-webm"));
      expect(info.videoCodec).toBe("vp9");
      expect(info.audioCodec).toBe("opus");
    });

    it("compresse aux trois niveaux, et le plus fort produit le plus petit fichier", () => {
      const path = fixture("video-large.mp4");
      const source = sourceOf(path);
      const sizes = (["high", "balanced", "small"] as const).map((level) => {
        const out = run(compressPipeline(source, { level }), [path], `compress-${level}`);
        expect(probe(out).hasVideo).toBe(true);
        return statSync(out).size;
      });
      // Une compression plus forte doit réellement peser moins lourd.
      expect(sizes[2]).toBeLessThan(sizes[0]);
      // Et sur une source à haut débit, elle doit gagner face à l'original.
      expect(sizes[2]).toBeLessThan(statSync(path).size);
    });

    it("compresse aussi une source déjà optimisée sans échouer", () => {
      const path = fixture("video-short.mp4");
      const out = run(compressPipeline(sourceOf(path), { level: "high" }), [path], "compress-small-source");
      expect(probe(out).hasVideo).toBe(true);
    });

    it("redimensionne aux dimensions exactes, réduction comme agrandissement", () => {
      const landscape = fixture("video-landscape.mp4");
      const down = probe(
        run(resizePipeline(sourceOf(landscape), { width: 852, height: 480 }), [landscape], "resize-480"),
      );
      expect([down.width, down.height]).toEqual([852, 480]);

      const up = probe(
        run(resizePipeline(sourceOf(landscape), { width: 3840, height: 2160 }), [landscape], "resize-2160"),
      );
      expect([up.width, up.height]).toEqual([3840, 2160]);

      const portrait = fixture("video-portrait.mp4");
      const kept = probe(
        run(resizePipeline(sourceOf(portrait), { width: 720, height: 1280 }), [portrait], "resize-portrait"),
      );
      expect(kept.height ?? 0).toBeGreaterThan(kept.width ?? 0);
    });

    it("découpe en mode rapide et en mode précis", () => {
      const path = fixture("video-with-audio.mp4");
      const source = sourceOf(path);
      const fast = probe(
        run(trimPipeline(source, { startMs: 1000, endMs: 3000, mode: "fast" }), [path], "trim-fast"),
      );
      // Recopie des flux : la coupe se cale sur l'image-clé précédente. On
      // garantit donc l'encadrement, pas la milliseconde — c'est exactement ce
      // que l'outil annonce à l'utilisateur.
      expect(fast.durationMs).toBeGreaterThanOrEqual(1900);
      expect(fast.durationMs).toBeLessThanOrEqual(source.info.durationMs ?? 0);

      const precise = probe(
        run(trimPipeline(source, { startMs: 1000, endMs: 3000, mode: "precise" }), [path], "trim-precise"),
      );
      expect(precise.durationMs).toBeGreaterThan(1900);
      expect(precise.durationMs).toBeLessThan(2150);
      expect(precise.hasAudio).toBe(true);
    });

    it("fusionne des sources compatibles sans réencodage", () => {
      const a = fixture("video-short.mp4");
      const b = fixture("video-short-2.mp4");
      const pipeline = mergePipeline(caps, { infos: [probe(a), probe(b)], extension: "mp4" });
      expect(pipeline.copied).toBe(true);
      const info = probe(run(pipeline, [a, b], "merge-copy"));
      expect(info.durationMs).toBeGreaterThan(8000);
    });

    it("fusionne des sources hétérogènes en les normalisant", () => {
      const a = fixture("video-short.mp4");
      const b = fixture("video-portrait.mp4");
      const pipeline = mergePipeline(caps, { infos: [probe(a), probe(b)], extension: "mp4" });
      expect(pipeline.copied).toBe(false);
      const info = probe(run(pipeline, [a, b], "merge-mixed"));
      expect([info.width, info.height]).toEqual([pipeline.target.width, pipeline.target.height]);
      expect(info.durationMs).toBeGreaterThan(7000);
    });

    it("fusionne en forçant le réencodage même quand la recopie suffirait", () => {
      const a = fixture("video-short.mp4");
      const b = fixture("video-short-2.mp4");
      const pipeline = mergePipeline(caps, {
        infos: [probe(a), probe(b)],
        extension: "mp4",
        forceReencode: true,
      });
      expect(pipeline.copied).toBe(false);
      expect(probe(run(pipeline, [a, b], "merge-forced")).durationMs).toBeGreaterThan(8000);
    });

    it("rogne en 1:1 et en 9:16 aux dimensions annoncées", () => {
      const path = fixture("video-landscape.mp4");
      const source = sourceOf(path);
      const size = { width: source.info.width!, height: source.info.height! };

      const square = cropPipeline(source, { rect: centeredRect(size, 1) });
      const squareInfo = probe(run(square, [path], "crop-1-1"));
      expect(squareInfo.width).toBe(square.rect.width);
      expect(squareInfo.height).toBe(square.rect.height);
      expect(squareInfo.width).toBe(squareInfo.height);

      const vertical = cropPipeline(source, { rect: centeredRect(size, 9 / 16) });
      const verticalInfo = probe(run(vertical, [path], "crop-9-16"));
      expect(verticalInfo.width).toBe(vertical.rect.width);
      expect(verticalInfo.height).toBe(vertical.rect.height);
      expect(verticalInfo.height ?? 0).toBeGreaterThan(verticalInfo.width ?? 0);
    });

    it("pivote de 90° et applique un miroir", () => {
      const path = fixture("video-short.mp4");
      const source = sourceOf(path);
      const rotated = probe(
        run(transformPipeline(source, { transform: "rotate-right" }), [path], "rotate-right"),
      );
      expect([rotated.width, rotated.height]).toEqual([source.info.height, source.info.width]);

      const mirrored = probe(run(transformPipeline(source, { transform: "flip-h" }), [path], "flip-h"));
      expect([mirrored.width, mirrored.height]).toEqual([source.info.width, source.info.height]);
    });

    it("accélère et ralentit en gardant la bande son", () => {
      const path = fixture("video-with-audio.mp4");
      const source = sourceOf(path);

      const fast = speedPipeline(source, { factor: 2 });
      const fastInfo = probe(run(fast, [path], "speed-2x"));
      expect(fastInfo.durationMs).toBeGreaterThan(2000);
      expect(fastInfo.durationMs).toBeLessThan(3200);
      expect(fastInfo.hasAudio).toBe(true);

      const slow = speedPipeline(source, { factor: 0.25 });
      const slowInfo = probe(run(slow, [path], "speed-025x"));
      expect(slowInfo.durationMs).toBeGreaterThan(15_000);
      expect(slowInfo.hasAudio).toBe(true);
    });

    it("supprime le son en recopiant l'image", () => {
      const path = fixture("video-with-audio.mp4");
      const info = probe(run(removeAudioPipeline(sourceOf(path)), [path], "mute"));
      expect(info.hasAudio).toBe(false);
      expect(info.videoCodec).toBe(probe(path).videoCodec);
    });

    it("règle le volume à 200 % sans toucher à l'image", () => {
      const path = fixture("video-with-audio.mp4");
      const info = probe(run(volumePipeline(sourceOf(path), 200), [path], "volume-200"));
      expect(info.hasAudio).toBe(true);
      expect(info.videoCodec).toBe(probe(path).videoCodec);
    });

    it("remplace la bande son en se calant sur la vidéo", () => {
      const path = fixture("video-with-audio.mp4");
      const audio = fixture("audio-for-video.wav");
      const source = sourceOf(path);
      const pipeline = replaceAudioPipeline(source, {
        mode: "video",
        videoDurationMs: source.info.durationMs,
      });
      const info = probe(run(pipeline, [path, audio], "replace-audio"));
      expect(info.hasAudio).toBe(true);
      // L'audio dure 8 s, la vidéo 5 s : la sortie suit la vidéo.
      expect(info.durationMs).toBeLessThan(6000);
    });

    it("incruste des sous-titres dans l'image", () => {
      const path = fixture("video-with-audio.mp4");
      const info = probe(
        run(
          burnPipeline(sourceOf(path), { style: DEFAULT_BURN_STYLE }),
          [path, fixture("sample.srt")],
          "burn",
        ),
      );
      expect(info.hasVideo).toBe(true);
      // Le texte fait partie des pixels : aucune piste de sous-titres.
      expect(info.subtitles).toHaveLength(0);
    });

    it("attache une piste de sous-titres puis la réextrait", () => {
      const path = fixture("video-with-audio.mp4");
      const attached = run(
        softSubtitlePipeline(sourceOf(path), { language: "fra" }),
        [path, fixture("sample.srt")],
        "softsub",
      );
      expect(probe(attached).subtitles).toHaveLength(1);

      const source = { caps, info: probe(fixture("video-subtitles.mkv")), extension: "mkv" };
      const extracted = run(
        extractSubtitlePipeline(source, { order: 0, format: "srt" }),
        [fixture("video-subtitles.mkv")],
        "extract-srt",
      );
      expect(readFileSync(extracted, "utf-8")).toContain("Première ligne de sous-titre.");
    });

    it("traite un lot en compression puis en redimensionnement", () => {
      const files = ["video-short.mp4", "video-short-2.mp4", "video-landscape.mp4"].map(fixture);

      for (const [index, path] of files.entries()) {
        const pipeline = batchPipeline(sourceOf(path), {
          operation: "compress",
          level: "balanced",
          height: 720,
          transform: "rotate-right",
          audioFormat: "mp3",
        });
        expect(probe(run(pipeline, [path], `batch-compress-${index}`)).hasVideo).toBe(true);
      }

      for (const [index, path] of files.entries()) {
        const pipeline = batchPipeline(sourceOf(path), {
          operation: "resize",
          level: "balanced",
          height: 480,
          transform: "rotate-right",
          audioFormat: "mp3",
        });
        const info = probe(run(pipeline, [path], `batch-resize-${index}`));
        // La hauteur demandée porte sur le petit côté d'une source verticale.
        expect(Math.min(info.width ?? 0, info.height ?? 0)).toBe(480);
      }
    });

    it("extrait l'audio d'un lot", () => {
      const path = fixture("video-with-audio.mp4");
      const pipeline = batchPipeline(sourceOf(path), {
        operation: "extract-audio",
        level: "balanced",
        height: 720,
        transform: "rotate-right",
        audioFormat: "mp3",
      });
      const info = probe(run(pipeline, [path], "batch-audio"));
      expect(info.hasAudio).toBe(true);
      expect(info.hasVideo).toBe(false);
    });

    it("sous-titre automatiquement puis incruste (vidéo parlée)", () => {
      // La fixture n'existe que si les moteurs de parole sont installés.
      const path = fixture("video-speech-fr.mp4");
      if (!existsSync(path)) return;
      const info = probe(
        run(
          burnPipeline(sourceOf(path), { style: DEFAULT_BURN_STYLE }),
          [path, fixture("sample.srt")],
          "speech-burn",
        ),
      );
      expect(info.hasVideo).toBe(true);
      expect(info.hasAudio).toBe(true);
    });
  },
);
