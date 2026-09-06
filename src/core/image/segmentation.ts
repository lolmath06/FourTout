/**
 * Chargement du moteur de segmentation, dans l'application.
 *
 * `background.ts` contient le traitement et ne connaît rien d'ONNX ; ce module
 * fournit la session qu'il attend. La séparation n'est pas décorative : elle
 * permet d'éprouver le traitement en Node avec un vrai modèle, sans embarquer
 * la mécanique Tauri dans les tests.
 *
 * Trois choses se passent ici, et une seule fois par session :
 *
 *  1. le moteur WebAssembly est chargé **depuis `public/ort/`**, jamais depuis
 *     un CDN — la politique de sécurité de contenu l'interdirait, et une
 *     application locale n'a pas à dépendre d'un serveur tiers ;
 *  2. le nombre de fils est fixé à 1 : le multi-fil exige `SharedArrayBuffer`,
 *     donc des en-têtes d'isolation d'origine que FourTout ne sert pas ;
 *  3. le modèle est lu par la couche native, qui n'accepte qu'un identifiant du
 *     catalogue — pas un chemin quelconque du disque.
 */
import { readAssetFile } from "@/core/speech/models";
import type { SegmentationSession, SegmentationTensor } from "./background";
import { ImageError } from "./errors";

/** Les deux modèles proposés, du plus rapide au plus fin. */
export const SEGMENTATION_MODELS = [
  {
    id: "seg-u2netp",
    file: "segmentation/u2netp.onnx",
    label: "Rapide",
    detail: "U²-Net allégé, 4,6 Mo. Quelques secondes par image.",
  },
  {
    id: "seg-u2net",
    file: "segmentation/u2net.onnx",
    label: "Précis",
    detail: "U²-Net complet, 176 Mo. Bords plus fins, nettement plus lent.",
  },
] as const;

export type SegmentationModelId = (typeof SEGMENTATION_MODELS)[number]["id"];

export function segmentationModel(id: SegmentationModelId) {
  const entry = SEGMENTATION_MODELS.find((model) => model.id === id);
  if (!entry) throw new ImageError("segmentation-unavailable", `Modèle inconnu : ${id}.`);
  return entry;
}

interface Runtime {
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => SegmentationTensor;
  InferenceSession: {
    create(model: Uint8Array, options?: unknown): Promise<SegmentationSession>;
  };
}

let runtime: Promise<Runtime> | undefined;

async function loadRuntime(): Promise<Runtime> {
  if (!runtime) {
    runtime = (async () => {
      const ort = await import("onnxruntime-web");
      ort.env.wasm.numThreads = 1;
      // Servi par FourTout lui-même : `public/ort/` est copié depuis
      // node_modules par `scripts/sync-onnx-assets.mjs`.
      ort.env.wasm.wasmPaths = "/ort/";
      ort.env.logLevel = "error";
      return ort as unknown as Runtime;
    })().catch((error) => {
      // Un échec ne doit pas figer la promesse : un second essai doit pouvoir
      // repartir de zéro.
      runtime = undefined;
      throw error;
    });
  }
  return runtime;
}

/** Une session ouverte, et de quoi fabriquer ses tenseurs d'entrée. */
export interface LoadedSegmentation {
  session: SegmentationSession;
  tensor: (data: Float32Array, dims: number[]) => SegmentationTensor;
  /** Libère la mémoire du modèle. À appeler quand l'écran se ferme. */
  release: () => void;
}

const sessions = new Map<SegmentationModelId, Promise<LoadedSegmentation>>();

/**
 * Ouvre (ou réutilise) la session du modèle demandé.
 *
 * La session est conservée : rouvrir un modèle de 176 Mo à chaque image serait
 * plus long que l'inférence elle-même.
 */
export function loadSegmentation(id: SegmentationModelId): Promise<LoadedSegmentation> {
  const existing = sessions.get(id);
  if (existing) return existing;

  const opening = (async (): Promise<LoadedSegmentation> => {
    const model = segmentationModel(id);
    const ort = await loadRuntime();
    const bytes = await readAssetFile(model.id, model.file);
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
    return {
      session,
      tensor: (data, dims) => new ort.Tensor("float32", data, dims),
      release: () => sessions.delete(id),
    };
  })().catch((error) => {
    sessions.delete(id);
    throw error;
  });

  sessions.set(id, opening);
  return opening;
}

/** Oublie toutes les sessions ouvertes (changement de modèle, fermeture). */
export function releaseSegmentation(): void {
  sessions.clear();
}
