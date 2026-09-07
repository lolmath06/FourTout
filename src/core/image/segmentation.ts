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
 *  1. le runtime est chargé **depuis `public/ort/`**, jamais depuis un CDN — la
 *     politique de sécurité de contenu l'interdirait, et une application
 *     locale n'a pas à dépendre d'un serveur tiers ;
 *  2. le nombre de fils est fixé à 1 : le multi-fil exige `SharedArrayBuffer`,
 *     donc des en-têtes d'isolation d'origine que FourTout ne sert pas ;
 *  3. le modèle est lu par la couche native, qui n'accepte qu'un identifiant du
 *     catalogue — pas un chemin quelconque du disque.
 *
 * # Le runtime tient en deux fichiers
 *
 * ONNX Runtime ne charge pas le `.wasm` directement : il importe d'abord une
 * **glu JavaScript**, `ort-wasm-simd-threaded.mjs`, qui instancie ensuite le
 * binaire. Les deux chemins sont donc donnés explicitement, en URL absolues et
 * issues du même build.
 *
 * Un préfixe (`wasmPaths = "/ort/"`) suffirait en théorie, mais laisse le
 * moteur deviner les noms. Nommer les deux fichiers rend la panne lisible : si
 * l'un manque, la requête tombe sur le repli SPA, qui répond `index.html` en
 * `text/html`, et le message devient « 'text/html' is not a valid JavaScript
 * MIME type » suivi de « no available backend found » — sans jamais nommer le
 * fichier absent. `assertRuntimeAvailable` transforme cette énigme en phrase
 * utile avant même que le moteur ne démarre.
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

/**
 * Les deux fichiers du runtime, tels qu'ONNX Runtime les nomme. Ils sont
 * copiés dans `public/ort/` par `scripts/sync-onnx-assets.mjs`, qui partage
 * cette liste — les deux ne peuvent donc pas diverger.
 */
export const ORT_RUNTIME_FILES = [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
] as const;

/** Dossier servi par l'application, quelle que soit l'origine. */
const ORT_DIRECTORY = "/ort/";

/**
 * URL absolue d'un fichier du runtime.
 *
 * ONNX Runtime exige des chemins absolus, et l'origine change selon le
 * contexte : `http://localhost:1420` en développement, `tauri://localhost` ou
 * `http://tauri.localhost` dans l'application installée. On la lit donc au
 * lieu de la coder en dur.
 */
function runtimeUrl(file: string): string {
  return new URL(`${ORT_DIRECTORY}${file}`, window.location.href).href;
}

/**
 * Traduit la panne connue en phrase utile, avant que le moteur ne démarre.
 *
 * Quand un fichier du runtime manque, la requête tombe sur le repli SPA, qui
 * répond `index.html` en `text/html`. ONNX Runtime dit alors « 'text/html' is
 * not a valid JavaScript MIME type » puis « no available backend found », sans
 * jamais nommer le fichier absent. Ce contrôle le nomme.
 *
 * Il n'échoue **que** sur ce cas précis. Toute autre difficulté — protocole
 * qui refuse `fetch`, réponse inattendue — laisse le moteur tenter sa chance :
 * un diagnostic ne doit pas bloquer un outil qui aurait fonctionné.
 */
async function assertRuntimeServed(): Promise<void> {
  for (const file of ORT_RUNTIME_FILES) {
    let response: Response;
    try {
      response = await fetch(runtimeUrl(file));
    } catch {
      // `fetch` indisponible ou refusé : on ne conclut rien, et on laisse ORT
      // produire sa propre erreur s'il y en a une.
      return;
    }
    const type = response.headers.get("content-type") ?? "";
    if (response.status === 404 || type.includes("text/html")) {
      throw new ImageError(
        "segmentation-unavailable",
        `le moteur d'inférence est incomplet (${file} est absent de cette ` +
          "installation).",
      );
    }
  }
}

let runtime: Promise<Runtime> | undefined;

async function loadRuntime(): Promise<Runtime> {
  if (!runtime) {
    runtime = (async () => {
      await assertRuntimeServed();
      // Sous-chemin `/wasm` et non le paquet complet : le point d'entrée par
      // défaut vise la variante **JSEP** du runtime — 27,8 Mo de WebAssembly
      // destinés à WebGPU et WebNN, que FourTout n'utilise pas, et qui
      // seraient embarqués dans le build pour rien. Celui-ci vise le runtime
      // simple, celui que copie `sync-onnx-assets.mjs`.
      const ort = await import("onnxruntime-web/wasm");
      ort.env.wasm.numThreads = 1;
      // Les deux fichiers sont nommés explicitement, et proviennent du même
      // build : un `.mjs` et un `.wasm` de versions différentes ne
      // s'instancient pas.
      ort.env.wasm.wasmPaths = {
        mjs: runtimeUrl(ORT_RUNTIME_FILES[0]),
        wasm: runtimeUrl(ORT_RUNTIME_FILES[1]),
      };
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
