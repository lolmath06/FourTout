/**
 * Le vrai réseau Real-ESRGAN sur une image de référence.
 *
 * Même convention que le détourage : le modèle n'est pas versionné (5 Mo,
 * installé par le gestionnaire de modèles), et le test s'exécute quand il est
 * présent — dans le dossier du gestionnaire, dans `~/.cache/ft-models/upscale/`
 * ou via `FOURTOUT_UPSCALE_DIR`. Sans lui, le découpage et le recollage restent
 * éprouvés par `upscale.test.ts` avec un faux réseau.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ENGINE_TIMEOUT } from "@/test/timeouts";
import { nodeRasterBackend } from "@/test/nodeRaster";
import { getRasterBackend, setRasterBackend } from "@/core/pdf/raster/types";
import { upscaleCanvas, type UpscaleSession } from "./upscale";

function findModelDir(): string | undefined {
  return [
    process.env.FOURTOUT_UPSCALE_DIR,
    join(homedir(), ".local/share/app.fourtout.desktop/models/upscale/realesr-general-x4v3"),
    join(homedir(), ".cache/ft-models/upscale"),
  ]
    .filter((path): path is string => Boolean(path))
    .find((dir) => existsSync(join(dir, "model.onnx")) && existsSync(join(dir, "model.data")));
}

const DIR = findModelDir();
if (!DIR) {
  console.warn("Modèle d'agrandissement absent (~/.cache/ft-models/upscale/) — inférence réelle ignorée");
}

/** Quatre quadrants francs, comme la fixture de référence des conversions. */
function quadrants(size: number) {
  const data = new Uint8ClampedArray(size * size * 4);
  const colors = [[220, 30, 30], [30, 160, 60], [30, 60, 220], [240, 200, 20]];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const color = colors[(y >= size / 2 ? 2 : 0) + (x >= size / 2 ? 1 : 0)];
      data.set([...color, 255], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, data };
}

describe.skipIf(!DIR)("agrandissement avec le vrai modèle", { timeout: ENGINE_TIMEOUT }, () => {
  let session: UpscaleSession;
  let tensor: (data: Float32Array, dims: number[]) => { data: Float32Array; dims: number[] };

  beforeAll(async () => {
    setRasterBackend(nodeRasterBackend);
    const ort = await import("onnxruntime-web/wasm");
    ort.env.wasm.numThreads = 1;
    ort.env.logLevel = "error";
    session = (await ort.InferenceSession.create(new Uint8Array(readFileSync(join(DIR!, "model.onnx"))), {
      executionProviders: ["wasm"],
      externalData: [{ path: "model.data", data: new Uint8Array(readFileSync(join(DIR!, "model.data"))) }],
    })) as unknown as UpscaleSession;
    tensor = (data, dims) => new ort.Tensor("float32", data, dims) as unknown as { data: Float32Array; dims: number[] };
  }, ENGINE_TIMEOUT);

  it("quadruple la définition en gardant les couleurs et les contours", async () => {
    const source = getRasterBackend()!.createCanvas(64, 64);
    source.putPixels(quadrants(64));
    const result = await upscaleCanvas(source, 4, session, tensor);
    expect([result.canvas.width, result.canvas.height]).toEqual([256, 256]);
    const out = result.canvas.getPixels();
    const near = (x: number, y: number, expected: number[]) => {
      const i = (y * 256 + x) * 4;
      return [0, 1, 2].every((c) => Math.abs(out.data[i + c] - expected[c]) <= 14);
    };
    expect(near(40, 40, [220, 30, 30])).toBe(true);
    expect(near(216, 40, [30, 160, 60])).toBe(true);
    expect(near(40, 216, [30, 60, 220])).toBe(true);
    expect(near(216, 216, [240, 200, 20])).toBe(true);
  });

  it("×2 produit la moitié des dimensions de ×4", async () => {
    const source = getRasterBackend()!.createCanvas(40, 24);
    source.putPixels(quadrants(40).width === 40 ? { width: 40, height: 24, data: quadrants(40).data.slice(0, 40 * 24 * 4) } : quadrants(40));
    const result = await upscaleCanvas(source, 2, session, tensor);
    expect([result.canvas.width, result.canvas.height]).toEqual([80, 48]);
  });
});
