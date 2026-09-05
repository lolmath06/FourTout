import { describe, expect, it } from "vitest";
import {
  audioEncodeArgs,
  compressionGain,
  crfRange,
  defaultCrf,
  levelOfPreset,
  supportsCrf,
  targetBitrateKbps,
  videoEncodeArgs,
} from "./presets";
import { buildCapabilities } from "../capabilities";

/**
 * Le point critique de ce module : un même « niveau de qualité » doit se
 * traduire différemment selon l'encodeur. Recopier un CRF de `libx264` vers
 * `libopenh264` — qui ne connaît pas l'option — produirait un échec à
 * l'exécution ; c'est exactement ce que ces tests interdisent.
 */
describe("préréglages d'encodage", () => {
  it("utilise une qualité constante quand l'encodeur la comprend", () => {
    const args = videoEncodeArgs({ encoder: "libx264", level: "balanced" });
    expect(args).toContain("-crf");
    expect(args[args.indexOf("-crf") + 1]).toBe("25");
    expect(args).toContain("-pix_fmt");
    expect(args[args.indexOf("-pix_fmt") + 1]).toBe("yuv420p");
  });

  it("bascule sur un débit cible pour un encodeur sans CRF", () => {
    const args = videoEncodeArgs({
      encoder: "libopenh264",
      level: "small",
      source: { videoBitRate: 8_000_000 },
    });
    expect(args).not.toContain("-crf");
    expect(args).toContain("-b:v");
    // 25 % de 8000 kb/s pour le mode le plus agressif.
    expect(args[args.indexOf("-b:v") + 1]).toBe("2000k");
  });

  it("échelonne les CRF selon l'encodeur, jamais une valeur unique", () => {
    expect(defaultCrf("libx264", "small")).toBe(30);
    expect(defaultCrf("libvpx-vp9", "small")).toBe(40);
    expect(defaultCrf("libsvtav1", "small")).toBe(45);
    expect(defaultCrf("libopenh264", "small")).toBeUndefined();
    expect(supportsCrf("libopenh264")).toBe(false);
    expect(crfRange("libvpx-vp9")).toEqual({ min: 0, max: 63 });
    expect(crfRange("libx264")).toEqual({ min: 0, max: 51 });
    expect(crfRange("libopenh264")).toBeUndefined();
  });

  it("estime un débit plausible quand la source ne le déclare pas", () => {
    const kbps = targetBitrateKbps("balanced", { width: 1280, height: 720, frameRate: 30 });
    expect(kbps).toBeGreaterThan(500);
    expect(kbps).toBeLessThan(4000);
    // Un débit minimal reste garanti même sur une source minuscule.
    expect(targetBitrateKbps("small", { width: 16, height: 16, frameRate: 1 })).toBe(120);
  });

  it("choisit l'encodeur audio disponible, ou coupe le son", () => {
    const caps = buildCapabilities({ announced: ["aac", "libopus"], usableVideo: [] });
    expect(audioEncodeArgs("aac", caps)).toEqual(["-c:a", "aac", "-b:a", "128k"]);
    expect(audioEncodeArgs("opus", caps, "high")).toEqual(["-c:a", "libopus", "-b:a", "192k"]);
    expect(audioEncodeArgs(undefined, caps)).toEqual(["-an"]);
    // Codec demandé mais absent du build : on ne produit pas une commande vouée à l'échec.
    expect(audioEncodeArgs("vorbis", caps)).toEqual(["-an"]);
  });

  it("associe chaque préréglage à un niveau de qualité", () => {
    expect(levelOfPreset("compatible")).toBe("balanced");
    expect(levelOfPreset("high")).toBe("high");
    expect(levelOfPreset("small")).toBe("small");
    expect(levelOfPreset("custom")).toBe("balanced");
  });

  it("mesure le gain de compression, y compris négatif", () => {
    expect(compressionGain(1000, 400)).toBe(60);
    expect(compressionGain(1000, 1000)).toBe(0);
    // Un fichier plus gros donne un gain négatif : il ne sera pas présenté comme un succès.
    expect(compressionGain(1000, 1500)).toBe(-50);
    expect(compressionGain(0, 100)).toBe(0);
  });
});
