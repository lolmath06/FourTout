import { describe, expect, it } from "vitest";
import {
  bandwidthFromTransfer,
  BandwidthError,
  formatDuration,
  splitDuration,
  toBits,
  transferTime,
} from "./bandwidth";
import type { RateView } from "./bandwidth";

const view = (views: RateView[], unitId: string) =>
  views.find((candidate) => candidate.unitId === unitId)!.value;

describe("bande passante — exactitude", () => {
  it("convertit les tailles sans confondre 1000 et 1024", () => {
    expect(toBits(1, "B")).toBe(8);
    expect(toBits(1, "kB")).toBe(8000);
    expect(toBits(1, "KiB")).toBe(8192);
    expect(toBits(1, "MB")).toBe(8_000_000);
    expect(toBits(1, "MiB")).toBe(8_388_608);
    expect(toBits(1, "GiB")).toBe(8_589_934_592);
    expect(toBits(1, "Gbit")).toBe(1_000_000_000);
    expect(toBits(1, "Gibit")).toBe(1_073_741_824);
  });

  it("donne 1 Gibit/s et 128 Mio/s pour 1 Gio en 8 secondes", () => {
    const result = bandwidthFromTransfer(1, "GiB", 8);
    expect(result.bits).toBe(8_589_934_592);
    expect(result.bitsPerSecond).toBe(1_073_741_824);
    expect(view(result.views, "Gibit/s")).toBe(1);
    expect(view(result.views, "MiB/s")).toBe(128);
    expect(view(result.views, "B/s")).toBe(134_217_728);
    // Et la même mesure en unités décimales, qui ne tombe pas ronde.
    expect(view(result.views, "Mbit/s")).toBeCloseTo(1073.741824, 6);
  });

  it("donne 12,5 Mo/s pour une ligne à 100 Mbit/s", () => {
    const result = bandwidthFromTransfer(100, "Mbit", 1);
    expect(result.bitsPerSecond).toBe(100_000_000);
    expect(view(result.views, "MB/s")).toBe(12.5);
    expect(view(result.views, "Mbit/s")).toBe(100);
    // 12,5 Mo/s ne font pas 12,5 Mio/s : l'écart est réel.
    expect(view(result.views, "MiB/s")).toBeCloseTo(11.920928955, 6);
  });

  it("choisit l'unité la plus lisible sans se tromper de famille", () => {
    const result = bandwidthFromTransfer(1, "GiB", 8);
    expect(result.bestBitRate.basis).toBe("bit");
    expect(result.bestByteRate.basis).toBe("byte");
    expect(result.bestByteRate.unitId).toBe("MiB/s");
  });

  it("refuse une durée nulle ou une taille négative", () => {
    expect(() => bandwidthFromTransfer(1, "GiB", 0)).toThrow(BandwidthError);
    expect(() => bandwidthFromTransfer(-1, "GiB", 8)).toThrow(/négatif/);
    expect(() => bandwidthFromTransfer(1, "GiB", -8)).toThrow(/négatif/);
    expect(() => bandwidthFromTransfer(0, "GiB", 8)).toThrow(/nul/);
  });

  it("refuse une unité inconnue", () => {
    expect(() => toBits(1, "Mo")).toThrow(/inconnue/);
  });
});

describe("temps de transfert — exactitude", () => {
  it("donne exactement 800 s pour 100 Gio à 1 Gibit/s", () => {
    const result = transferTime(100, "GiB", 1, "Gibit/s");
    expect(result.bits).toBe(858_993_459_200);
    expect(result.duration.totalSeconds).toBe(800);
    expect(result.readable).toBe("13 min 20 s");
  });

  it("distingue Gibit/s et Gbit/s sur le même transfert", () => {
    // Le même volume à un débit décimal prend plus longtemps : 1 Gbit/s est un
    // débit plus faible que 1 Gibit/s.
    const binaire = transferTime(100, "GiB", 1, "Gibit/s").duration.totalSeconds;
    const decimal = transferTime(100, "GiB", 1, "Gbit/s").duration.totalSeconds;
    expect(binaire).toBe(800);
    expect(decimal).toBeCloseTo(858.9934592, 6);
    expect(decimal).toBeGreaterThan(binaire);
  });

  it("distingue Mo/s et Mbit/s", () => {
    expect(transferTime(100, "MB", 100, "Mbit/s").duration.totalSeconds).toBe(8);
    expect(transferTime(100, "MB", 100, "MB/s").duration.totalSeconds).toBe(1);
  });

  it("découpe une durée en jours, heures, minutes et secondes", () => {
    expect(splitDuration(90)).toMatchObject({ days: 0, hours: 0, minutes: 1, seconds: 30 });
    expect(splitDuration(3661)).toMatchObject({ days: 0, hours: 1, minutes: 1, seconds: 1 });
    expect(splitDuration(90_061)).toMatchObject({ days: 1, hours: 1, minutes: 1, seconds: 1 });
  });

  it("écrit une durée lisible", () => {
    expect(formatDuration(splitDuration(800))).toBe("13 min 20 s");
    expect(formatDuration(splitDuration(3661))).toBe("1 h 1 min 1 s");
    expect(formatDuration(splitDuration(0.4))).toBe("0,4 s");
    expect(formatDuration(splitDuration(86_400))).toBe("1 j");
  });

  it("refuse un débit nul ou négatif", () => {
    expect(() => transferTime(1, "GiB", 0, "Mbit/s")).toThrow(/nul/);
    expect(() => transferTime(1, "GiB", -5, "Mbit/s")).toThrow(/négatif/);
  });

  it("rappelle le débit qui a servi au calcul", () => {
    const result = transferTime(1, "GiB", 50, "MiB/s");
    expect(result.rate.unitId).toBe("MiB/s");
    expect(result.rate.value).toBe(50);
    expect(result.duration.totalSeconds).toBeCloseTo(20.48, 6);
  });
});
