/**
 * Recette de « Retirer l'arrière-plan ».
 *
 * Une suppression d'arrière-plan ne se teste pas en vérifiant qu'une fonction
 * a été appelée : on exécute **le vrai modèle U²-Net** sur de vraies images, et
 * on regarde les pixels obtenus. Un masque inversé, un modèle mal normalisé ou
 * une sortie prise dans le mauvais ordre passeraient tous un test de fumée, et
 * aucun ne passe ceux-ci.
 *
 * Le modèle n'est pas versionné : il est installé par le gestionnaire de
 * modèles. Les tests qui en ont besoin s'ignorent proprement quand il est
 * absent, en disant comment l'obtenir — comme les tests FFmpeg et les fixtures.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { nodeRasterBackend } from "@/test/nodeRaster";
import { getRasterBackend, setRasterBackend, type RasterCanvas } from "@/core/pdf/raster/types";
import { JobCancelledError } from "@/core/jobs/types";
import {
  applyMask,
  buildInputTensor,
  featherMask,
  normalizeMask,
  removeBackground,
  resampleMask,
  SEGMENTATION_INPUT,
  type SegmentationSession,
  type SegmentationTensor,
} from "./background";
import { SEGMENTATION_MODELS, segmentationModel } from "./segmentation";

const FIXTURES = join(process.cwd(), "test-assets", "generated");

/**
 * Emplacements où le modèle peut se trouver : celui du gestionnaire de modèles
 * de l'application, et un cache de développement.
 */
function findModel(): string | undefined {
  const candidates = [
    process.env.FOURTOUT_SEG_MODEL,
    join(homedir(), ".local/share/app.fourtout.desktop/models/segmentation/u2netp.onnx"),
    join(homedir(), ".cache/ft-models/u2netp.onnx"),
  ].filter((path): path is string => Boolean(path));
  return candidates.find((path) => existsSync(path));
}

const MODEL = findModel();
if (!MODEL) {
  console.warn(
    "modèle de détourage absent : installez « Détourage — Rapide » dans Paramètres → Modèles, " +
      "ou placez u2netp.onnx dans ~/.cache/ft-models/ — tests d'inférence ignorés",
  );
}

async function loadFixture(name: string): Promise<RasterCanvas> {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES, name)));
  const mime = name.endsWith(".jpg") ? "image/jpeg" : "image/png";
  return getRasterBackend()!.decode(bytes, mime);
}

/** Statistiques d'alpha sur une image détourée. */
function alphaStats(canvas: RasterCanvas) {
  const { width, height, data } = canvas.getPixels();
  let opaque = 0;
  let transparent = 0;
  const at = (x: number, y: number) => data[(y * width + x) * 4 + 3];
  for (let i = 0; i < width * height; i += 1) {
    const alpha = data[i * 4 + 3];
    if (alpha > 200) opaque += 1;
    else if (alpha < 55) transparent += 1;
  }
  const total = width * height;
  return { width, height, at, opaque: opaque / total, transparent: transparent / total };
}

beforeAll(() => {
  setRasterBackend(nodeRasterBackend);
});

/* ------------------------------------------------------------ pièces pures */

describe("préparation et masque", () => {
  it("produit l'entrée que le modèle attend", () => {
    const canvas = getRasterBackend()!.createCanvas(120, 80);
    const tensor = buildInputTensor(canvas);
    // Trois plans de 320×320, pas un entrelacement RVBA de la taille d'origine.
    expect(tensor).toHaveLength(3 * SEGMENTATION_INPUT * SEGMENTATION_INPUT);
    expect(tensor.every((value) => Number.isFinite(value))).toBe(true);
  });

  it("ramène des scores sans échelle sur zéro-un", () => {
    // Le réseau ne rend pas des probabilités : sans min-max, un seuil ne
    // voudrait rien dire d'une image à l'autre.
    const mask = normalizeMask([-3, 0, 7]);
    expect(mask[0]).toBeCloseTo(0, 6);
    expect(mask[2]).toBeCloseTo(1, 6);
    expect(mask[1]).toBeGreaterThan(0);
    expect(mask[1]).toBeLessThan(1);
  });

  it("garde tout plutôt que d'effacer une image que le modèle n'a pas su lire", () => {
    // Carte uniforme : le réseau n'a rien distingué. Effacer l'image entière
    // serait le pire des comportements.
    expect(Array.from(normalizeMask([0.5, 0.5, 0.5, 0.5]))).toEqual([1, 1, 1, 1]);
  });

  it("déplace le point de bascule avec le seuil, dans les deux sens", () => {
    const raw = [0, 0.25, 0.5, 0.75, 1];
    const strict = normalizeMask(raw, 0.3);
    const lax = normalizeMask(raw, -0.3);
    for (let i = 0; i < raw.length; i += 1) {
      expect(strict[i]).toBeLessThanOrEqual(lax[i]);
    }
    // Et le réglage reste borné, même si on lui demande l'absurde.
    expect(normalizeMask(raw, 99)[4]).toBeCloseTo(0.6, 6);
  });

  it("adoucit la bordure sans déborder de l'image", () => {
    const size = 9;
    const mask = new Float32Array(size * size);
    mask[4 * size + 4] = 1;
    const soft = featherMask(mask, size, size, 2);
    expect(soft[4 * size + 4]).toBeLessThan(1);
    expect(soft[4 * size + 5]).toBeGreaterThan(0);
    // La moyenne totale se conserve : rien n'est créé ni perdu aux bords.
    const before = mask.reduce((a, b) => a + b, 0);
    const after = soft.reduce((a, b) => a + b, 0);
    expect(after).toBeGreaterThan(before * 0.8);
  });

  it("rééchantillonne le masque à la taille de l'image", () => {
    const mask = new Float32Array(SEGMENTATION_INPUT * SEGMENTATION_INPUT).fill(0.5);
    const full = resampleMask(mask, SEGMENTATION_INPUT, 640, 200);
    expect(full).toHaveLength(640 * 200);
    expect(full[0]).toBeCloseTo(0.5, 5);
  });

  it("n'écrit que l'alpha, jamais les couleurs", () => {
    const backend = getRasterBackend()!;
    const canvas = backend.createCanvas(3, 1);
    canvas.putPixels({
      width: 3,
      height: 1,
      data: new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255]),
    });
    const { canvas: masked, keptRatio } = applyMask(canvas, new Float32Array([1, 0.6, 0]));
    const { data } = masked.getPixels();

    // Pixel gardé : identique au bit près.
    expect(Array.from(data.slice(0, 4))).toEqual([10, 20, 30, 255]);
    // Pixel partiellement transparent : la couleur survit, seul l'alpha change.
    // (Un canvas stocke l'alpha prémultiplié, d'où la tolérance sur l'arrondi.)
    expect(data[4]).toBeGreaterThan(30);
    expect(data[6]).toBeGreaterThan(50);
    expect(data[7]).toBeGreaterThan(140);
    expect(data[7]).toBeLessThan(165);
    // Pixel effacé : totalement transparent.
    expect(data[11]).toBe(0);

    expect(keptRatio).toBeCloseTo(2 / 3, 6);
  });

  it("respecte une transparence déjà présente", () => {
    const backend = getRasterBackend()!;
    const canvas = backend.createCanvas(1, 1);
    canvas.putPixels({ width: 1, height: 1, data: new Uint8ClampedArray([9, 9, 9, 128]) });
    const { canvas: masked } = applyMask(canvas, new Float32Array([1]));
    // Un pixel à moitié transparent ne doit pas redevenir opaque.
    expect(masked.getPixels().data[3]).toBe(128);
  });
});

/* --------------------------------------------------- catalogue des modèles */

describe("catalogue des modèles de détourage", () => {
  it("déclare deux modèles, chacun avec son fichier", () => {
    expect(SEGMENTATION_MODELS).toHaveLength(2);
    for (const model of SEGMENTATION_MODELS) {
      expect(model.file.startsWith("segmentation/")).toBe(true);
      expect(model.file.endsWith(".onnx")).toBe(true);
      expect(segmentationModel(model.id)).toEqual(model);
    }
  });

  it("refuse un identifiant inconnu au lieu de charger n'importe quoi", () => {
    // @ts-expect-error identifiant volontairement hors du catalogue
    expect(() => segmentationModel("seg-inconnu")).toThrow(/Modèle inconnu/);
  });
});

/* ------------------------------------------------- inférence, vrai modèle */

describe.skipIf(!MODEL)("détourage avec le vrai modèle U²-Net", () => {
  let session: SegmentationSession;
  let tensor: (data: Float32Array, dims: number[]) => SegmentationTensor;

  beforeAll(async () => {
    const ort = await import("onnxruntime-web");
    ort.env.wasm.numThreads = 1;
    ort.env.logLevel = "error";
    session = (await ort.InferenceSession.create(MODEL!, {
      executionProviders: ["wasm"],
    })) as unknown as SegmentationSession;
    tensor = (data, dims) => new ort.Tensor("float32", data, dims);
  }, 120_000);

  it(
    "détoure une silhouette : le sujet reste, le fond disparaît",
    async () => {
      const source = await loadFixture("background-person.png");
      const { canvas, keptRatio } = await removeBackground(source, session, tensor);
      const stats = alphaStats(canvas);

      // La résolution d'origine est conservée : seule l'analyse travaille en 320².
      expect(stats.width).toBe(source.width);
      expect(stats.height).toBe(source.height);

      // Un alpha réellement présent : ni tout opaque, ni tout transparent.
      expect(stats.opaque).toBeGreaterThan(0.1);
      expect(stats.transparent).toBeGreaterThan(0.1);
      expect(keptRatio).toBeGreaterThan(0.1);
      expect(keptRatio).toBeLessThan(0.9);

      // Le sujet est au centre-bas, le fond dans les coins hauts.
      expect(stats.at(Math.round(stats.width / 2), Math.round(stats.height * 0.6))).toBeGreaterThan(200);
      expect(stats.at(6, 6)).toBeLessThan(60);
      expect(stats.at(stats.width - 7, 6)).toBeLessThan(60);
    },
    120_000,
  );

  it(
    "détoure un objet, y compris depuis un JPEG",
    async () => {
      const source = await loadFixture("background-object.jpg");
      const { canvas } = await removeBackground(source, session, tensor);
      const stats = alphaStats(canvas);
      expect(stats.width).toBe(source.width);
      expect(stats.at(Math.round(stats.width / 2), Math.round(stats.height / 2))).toBeGreaterThan(200);
      expect(stats.at(5, stats.height - 6)).toBeLessThan(60);
      expect(stats.transparent).toBeGreaterThan(0.2);
    },
    120_000,
  );

  it(
    "tient les bords durs sans manger le sujet",
    async () => {
      const source = await loadFixture("background-hard-edges.png");
      const { canvas } = await removeBackground(source, session, tensor);
      const stats = alphaStats(canvas);
      // Un point franchement dans le carré, loin du trou central.
      expect(stats.at(Math.round(stats.width * 0.28), Math.round(stats.height * 0.28))).toBeGreaterThan(200);
      expect(stats.at(4, 4)).toBeLessThan(60);
    },
    120_000,
  );

  it(
    "produit un PNG relisible qui porte réellement de la transparence",
    async () => {
      const source = await loadFixture("background-person.png");
      const { canvas } = await removeBackground(source, session, tensor);

      const png = await canvas.encode("png");
      expect(png.length).toBeGreaterThan(0);
      // Signature PNG : le fichier s'ouvre vraiment.
      expect(Array.from(png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);

      // Relu depuis les octets, l'alpha doit toujours être là — c'est le
      // point qu'un encodage en JPEG ferait silencieusement disparaître.
      const reread = await getRasterBackend()!.decode(png, "image/png");
      const stats = alphaStats(reread);
      expect(stats.width).toBe(source.width);
      expect(stats.transparent).toBeGreaterThan(0.1);
    },
    120_000,
  );

  it(
    "le seuil sévère garde moins que le seuil permissif",
    async () => {
      const source = await loadFixture("background-object.jpg");
      const strict = await removeBackground(source, session, tensor, { threshold: 0.25 });
      const lax = await removeBackground(source, session, tensor, { threshold: -0.25 });
      expect(strict.keptRatio).toBeLessThan(lax.keptRatio);
    },
    180_000,
  );

  it(
    "l'adoucissement crée de vrais pixels intermédiaires",
    async () => {
      const source = await loadFixture("background-hard-edges.png");
      const hard = await removeBackground(source, session, tensor, { featherPx: 0 });
      const soft = await removeBackground(source, session, tensor, { featherPx: 12 });

      const partial = (canvas: RasterCanvas) => {
        const { width, height, data } = canvas.getPixels();
        let count = 0;
        for (let i = 0; i < width * height; i += 1) {
          const alpha = data[i * 4 + 3];
          if (alpha > 40 && alpha < 215) count += 1;
        }
        return count;
      };
      expect(partial(soft.canvas)).toBeGreaterThan(partial(hard.canvas));
    },
    180_000,
  );

  it(
    "une annulation ne rend aucune image",
    async () => {
      const source = await loadFixture("background-object.jpg");
      const controller = new AbortController();
      controller.abort();
      await expect(
        removeBackground(source, session, tensor, {}, { signal: controller.signal }),
      ).rejects.toBeInstanceOf(JobCancelledError);
    },
    60_000,
  );

  it(
    "refuse une sortie de taille inattendue plutôt que d'inventer un masque",
    async () => {
      const menteur: SegmentationSession = {
        inputNames: ["input.1"],
        outputNames: ["out"],
        run: async () => ({ out: { data: new Float32Array(10), dims: [1, 1, 10, 1] } }),
      };
      const source = await loadFixture("background-object.jpg");
      await expect(removeBackground(source, menteur, tensor)).rejects.toThrow(/Sortie inattendue/);
    },
    60_000,
  );
});
