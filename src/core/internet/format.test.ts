import { describe, expect, it } from "vitest";
import { formatTimecode, looksLikeWebUrl, parseTimecode, suggestStem, targetBytes } from "./format";

describe("instants saisis", () => {
  it("lit secondes, minutes et heures", () => {
    expect(parseTimecode("90")).toBe(90);
    expect(parseTimecode("1:30")).toBe(90);
    expect(parseTimecode("01:02:03")).toBe(3723);
    expect(parseTimecode("1:30.5")).toBe(90.5);
    expect(parseTimecode("0,5")).toBe(0.5);
    expect(parseTimecode(" 12 ")).toBe(12);
  });

  it("refuse ce qui n'est pas un instant", () => {
    for (const bad of ["", "abc", "1:75", "1:2:3:4", "-5", "1::2", "12:", ":30", "1e3"]) {
      expect(parseTimecode(bad), bad).toBeNull();
    }
  });

  it("revient à ce qui a été saisi", () => {
    for (const seconds of [0, 59, 60, 3599, 3723, 90.5]) {
      expect(parseTimecode(formatTimecode(seconds))).toBeCloseTo(seconds, 1);
    }
    expect(formatTimecode(-4)).toBe("0:00");
  });
});

describe("tailles visées", () => {
  it("compte en unités décimales", () => {
    expect(targetBytes(25, "mb")).toBe(25_000_000);
    expect(targetBytes(500, "kb")).toBe(500_000);
    expect(targetBytes(1.5, "gb")).toBe(1_500_000_000);
  });

  it("refuse les valeurs absurdes", () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.0001]) {
      expect(targetBytes(value, "kb"), String(value)).toBeNull();
    }
  });
});

describe("autres aides", () => {
  it("assainit un titre en nom proposé", () => {
    expect(suggestStem('Mon: "super" film/../x')).toBe("Mon super film .. x");
    expect(suggestStem("   ")).toBe("media");
    expect(suggestStem("...cache")).toBe("cache");
    expect(suggestStem("é".repeat(300)).length).toBeLessThanOrEqual(120);
  });

  it("reconnaît une URL web", () => {
    expect(looksLikeWebUrl("https://exemple.org/a?b=1")).toBe(true);
    expect(looksLikeWebUrl("ftp://exemple.org")).toBe(false);
    expect(looksLikeWebUrl("exemple.org")).toBe(false);
    expect(looksLikeWebUrl("javascript:alert(1)")).toBe(false);
  });
});
