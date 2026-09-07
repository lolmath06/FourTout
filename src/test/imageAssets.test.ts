// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { HEAVY_TIMEOUT } from "./timeouts";

/**
 * Le générateur d'images est du code : on l'exécute réellement et on vérifie
 * que toutes les fixtures attendues par les essais manuels et automatiques sont
 * présentes et valides.
 */
describe("générateur d'images de test", () => {
  const dir = join(process.cwd(), "test-assets", "generated");
  const read = (name: string) => readFileSync(join(dir, name));

  beforeAll(() => {
    execFileSync(process.execPath, [join(process.cwd(), "scripts/generate-image-assets.mjs")], { stdio: "ignore" });
  }, HEAVY_TIMEOUT);

  it("produit toutes les fixtures images attendues", () => {
    const files = readdirSync(dir);
    for (const name of [
      "image-landscape.jpg", "image-portrait.jpg", "image-transparent.png",
      "image-large.jpg", "image-small.png", "image-colors.png",
      "image-text-fr.png", "image-text-en.png", "image-exif.jpg",
      "image-rotated-exif.jpg", "image-test.svg", "image-animated.gif",
      "image-sample.webp",
    ]) {
      expect(files, `fixture manquante : ${name}`).toContain(name);
    }
  });

  it("produit des en-têtes de fichiers valides", () => {
    expect([...read("image-landscape.jpg").subarray(0, 2)]).toEqual([0xff, 0xd8]);
    expect([...read("image-small.png").subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(read("image-sample.webp").subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(read("image-animated.gif").subarray(0, 6).toString("latin1")).toBe("GIF89a");
    expect(read("image-test.svg").toString("utf8")).toContain("<svg");
  });

  it("garde les fixtures images légères", () => {
    for (const name of readdirSync(dir).filter((n) => n.startsWith("image-"))) {
      expect(read(name).length, `${name} trop volumineux`).toBeLessThan(512 * 1024);
    }
  });
});
