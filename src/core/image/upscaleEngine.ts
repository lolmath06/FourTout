/**
 * Chargement du modèle d'agrandissement dans l'application.
 *
 * Même mécanique que la segmentation (`segmentation.ts`) : le runtime ONNX est
 * servi par l'application, jamais par un CDN ; les octets du modèle sont lus
 * par la couche native, qui n'accepte qu'un identifiant du catalogue.
 *
 * Particularité : le graphe (42 Ko) et ses poids (4,8 Mo) sont **deux
 * fichiers**. ONNX Runtime les relie par le nom `model.data`, écrit dans le
 * graphe, qu'on lui fournit donc en « données externes ».
 */
import { readAssetFile } from "@/core/speech/models";
import { loadRuntime } from "./segmentation";
import type { UpscaleSession, UpscaleTensorFactory } from "./upscale";

export const UPSCALE_MODEL = {
  id: "upscale-realesr-x4v3",
  graph: "upscale/realesr-general-x4v3/model.onnx",
  weights: "upscale/realesr-general-x4v3/model.data",
  /** Nom sous lequel le graphe référence ses poids. */
  weightsName: "model.data",
} as const;

export interface LoadedUpscaler {
  session: UpscaleSession;
  tensor: UpscaleTensorFactory;
}

let opening: Promise<LoadedUpscaler> | undefined;

/** Ouvre (ou réutilise) la session : 5 Mo, mais l'ouvrir prend un instant. */
export function loadUpscaler(): Promise<LoadedUpscaler> {
  opening ??= (async () => {
    const ort = await loadRuntime();
    const [graph, weights] = await Promise.all([
      readAssetFile(UPSCALE_MODEL.id, UPSCALE_MODEL.graph),
      readAssetFile(UPSCALE_MODEL.id, UPSCALE_MODEL.weights),
    ]);
    const session = await ort.InferenceSession.create(graph, {
      executionProviders: ["wasm"],
      externalData: [{ path: UPSCALE_MODEL.weightsName, data: weights }],
    });
    return {
      session: session as unknown as UpscaleSession,
      tensor: (data: Float32Array, dims: number[]) => new ort.Tensor("float32", data, dims),
    };
  })().catch((error) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

export function releaseUpscaler(): void {
  opening = undefined;
}
