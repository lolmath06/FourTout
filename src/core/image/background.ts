/**
 * Suppression d'arrière-plan.
 *
 * L'outil « Rendre une couleur transparente » efface une couleur qu'on lui
 * désigne : il ne sait rien du contenu de l'image. Celui-ci **segmente le
 * sujet** — une personne devant un mur, un objet sur une table — et rend
 * transparent tout le reste, sans qu'on ait à décrire quoi que ce soit.
 *
 * # Le modèle, et pourquoi celui-là
 *
 * **U²-Net**, exécuté localement par ONNX Runtime dans la WebView. Aucune
 * image ne part sur le réseau : c'est la condition d'existence de cet outil
 * chez FourTout, alors que les services en ligne du même nom fonctionnent
 * tous par téléversement.
 *
 * U²-Net a été retenu pour sa **licence** autant que pour sa qualité : code et
 * poids sont sous Apache 2.0. Les modèles plus récents et souvent meilleurs
 * (RMBG de BRIA, MODNet) réservent leurs poids à un usage non commercial, ce
 * qui est incompatible avec la distribution de FourTout.
 *
 * # Ce que le modèle rend, et ce qu'on en fait
 *
 * U²-Net travaille sur une entrée fixe de 320×320 et rend une carte de
 * saillance de même taille — un flottant par pixel, sans échelle garantie.
 * On la normalise, on la ramène à la taille d'origine, et elle devient le
 * canal alpha. **La résolution de l'image n'est jamais réduite** : seule
 * l'analyse travaille en 320×320.
 */
import type { RasterCanvas } from "@/core/pdf/raster/types";
import { getRasterBackend } from "@/core/pdf/raster/types";
import { JobCancelledError } from "@/core/jobs/types";
import type { OperationContext } from "@/core/pdf/types";
import { ImageError } from "./errors";

/** Taille d'entrée du réseau. Fixée par le modèle, pas par nous. */
export const SEGMENTATION_INPUT = 320;

/** Normalisation ImageNet, celle avec laquelle U²-Net a été entraîné. */
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

/**
 * Une session d'inférence déjà ouverte, réduite à ce dont on se sert. Le
 * moteur ONNX n'est pas importé ici : le cœur reste testable sans lui, et
 * l'application charge le runtime seulement quand l'outil s'ouvre.
 */
export interface SegmentationSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, SegmentationTensor>): Promise<Record<string, SegmentationTensor>>;
}

export interface SegmentationTensor {
  readonly data: Float32Array | ArrayLike<number>;
  readonly dims: readonly number[];
}

/** Fabrique un tenseur d'entrée ; fournie par l'appelant (`ort.Tensor`). */
export type TensorFactory = (data: Float32Array, dims: number[]) => SegmentationTensor;

export interface RemoveBackgroundOptions {
  /**
   * Adoucit la bordure du masque. Un détourage brut laisse un liseré de la
   * couleur du fond ; une transition de quelques pixels l'atténue.
   */
  featherPx?: number;
  /**
   * Décale le seuil de décision, de −0,4 à +0,4. Positif : plus sévère, on
   * garde moins — utile quand du fond reste accroché au sujet. Négatif : plus
   * permissif, on garde plus — utile quand un bout du sujet disparaît.
   */
  threshold?: number;
}

export interface RemoveBackgroundResult {
  canvas: RasterCanvas;
  /** Part de l'image restée opaque, de 0 à 1. Sert à expliquer le résultat. */
  keptRatio: number;
  /** Durée de l'inférence seule, en millisecondes. */
  elapsedMs: number;
}

function throwIfCancelled(context?: OperationContext): void {
  if (context?.signal?.aborted) throw new JobCancelledError();
}

/**
 * Prépare l'entrée du réseau : redimensionnement en 320×320, passage en
 * flottants normalisés, et réorganisation en plans R, V, B séparés — c'est la
 * disposition qu'attend le modèle, pas l'entrelacement du canvas.
 */
export function buildInputTensor(source: RasterCanvas): Float32Array {
  const backend = getRasterBackend();
  if (!backend) throw new ImageError("render-unavailable");

  const resized = backend.resize(source, SEGMENTATION_INPUT, SEGMENTATION_INPUT);
  const { data } = resized.getPixels();
  const pixels = SEGMENTATION_INPUT * SEGMENTATION_INPUT;
  const tensor = new Float32Array(3 * pixels);

  for (let i = 0; i < pixels; i += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      tensor[channel * pixels + i] = (data[i * 4 + channel] / 255 - MEAN[channel]) / STD[channel];
    }
  }
  return tensor;
}

/**
 * Transforme la carte de saillance en masque exploitable.
 *
 * Le réseau ne rend pas des valeurs entre 0 et 1 : il rend des scores dont
 * seule la position relative a un sens. On les ramène donc sur [0, 1] par
 * min-max avant toute décision — sans quoi le seuil ne voudrait rien dire
 * d'une image à l'autre.
 */
export function normalizeMask(raw: ArrayLike<number>, threshold = 0): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < raw.length; i += 1) {
    const value = raw[i];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const span = max - min;
  const mask = new Float32Array(raw.length);

  // Image parfaitement uniforme : le réseau n'a rien distingué. Tout garder
  // est le seul choix honnête — on ne va pas effacer l'image entière.
  if (span <= 1e-6) {
    mask.fill(1);
    return mask;
  }

  // Le seuil déplace le point de bascule sans écraser le dégradé des bords :
  // on décale la valeur normalisée, puis on borne.
  const shift = Math.max(-0.4, Math.min(0.4, threshold));
  for (let i = 0; i < raw.length; i += 1) {
    const value = (raw[i] - min) / span - shift;
    mask[i] = value <= 0 ? 0 : value >= 1 ? 1 : value;
  }
  return mask;
}

/**
 * Adoucit le masque par une moyenne glissante séparable.
 *
 * Deux passes en une dimension coûtent `2n` au lieu de `n²` pour un noyau
 * carré, et le résultat est identique pour une moyenne.
 */
export function featherMask(
  mask: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  if (radius < 1) return mask;
  const horizontal = new Float32Array(mask.length);
  const output = new Float32Array(mask.length);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const xx = x + k;
        if (xx < 0 || xx >= width) continue;
        sum += mask[row + xx];
        count += 1;
      }
      horizontal[row + x] = sum / count;
    }
  }

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let sum = 0;
      let count = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const yy = y + k;
        if (yy < 0 || yy >= height) continue;
        sum += horizontal[yy * width + x];
        count += 1;
      }
      output[y * width + x] = sum / count;
    }
  }
  return output;
}

/**
 * Ramène le masque 320×320 à la taille de l'image, par interpolation
 * bilinéaire : au plus proche voisin, les bords seraient crénelés.
 */
export function resampleMask(
  mask: Float32Array,
  from: number,
  toWidth: number,
  toHeight: number,
): Float32Array {
  const output = new Float32Array(toWidth * toHeight);
  const scaleX = from / toWidth;
  const scaleY = from / toHeight;

  for (let y = 0; y < toHeight; y += 1) {
    const sy = Math.min(from - 1, Math.max(0, (y + 0.5) * scaleY - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(from - 1, y0 + 1);
    const fy = sy - y0;

    for (let x = 0; x < toWidth; x += 1) {
      const sx = Math.min(from - 1, Math.max(0, (x + 0.5) * scaleX - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(from - 1, x0 + 1);
      const fx = sx - x0;

      const top = mask[y0 * from + x0] * (1 - fx) + mask[y0 * from + x1] * fx;
      const bottom = mask[y1 * from + x0] * (1 - fx) + mask[y1 * from + x1] * fx;
      output[y * toWidth + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return output;
}

/**
 * Applique un masque comme canal alpha. Les couleurs d'origine ne sont pas
 * touchées : seul l'alpha change.
 */
export function applyMask(
  source: RasterCanvas,
  mask: Float32Array,
): { canvas: RasterCanvas; keptRatio: number } {
  const backend = getRasterBackend();
  if (!backend) throw new ImageError("render-unavailable");

  const { width, height, data } = source.getPixels();
  const out = new Uint8ClampedArray(data);
  let kept = 0;

  for (let i = 0; i < mask.length; i += 1) {
    const alpha = mask[i];
    // On combine avec l'alpha existant : une image déjà partiellement
    // transparente ne doit pas redevenir opaque.
    out[i * 4 + 3] = Math.round(data[i * 4 + 3] * alpha);
    if (alpha > 0.5) kept += 1;
  }

  const canvas = backend.createCanvas(width, height);
  canvas.putPixels({ width, height, data: out });
  return { canvas, keptRatio: mask.length > 0 ? kept / mask.length : 0 };
}

/**
 * Détoure le sujet d'une image.
 *
 * La session et la fabrique de tenseurs sont injectées : le cœur ne dépend pas
 * du moteur ONNX, ce qui permet de l'éprouver avec un vrai modèle en test
 * comme avec le modèle installé dans l'application.
 */
export async function removeBackground(
  source: RasterCanvas,
  session: SegmentationSession,
  tensor: TensorFactory,
  options: RemoveBackgroundOptions = {},
  context?: OperationContext,
): Promise<RemoveBackgroundResult> {
  throwIfCancelled(context);
  context?.report?.({ ratio: 0.05, label: "Préparation de l'image…" });

  const input = buildInputTensor(source);
  throwIfCancelled(context);
  context?.report?.({ ratio: 0.15, label: "Analyse du sujet…" });

  const started = Date.now();
  const outputs = await session.run({
    [session.inputNames[0]]: tensor(input, [1, 3, SEGMENTATION_INPUT, SEGMENTATION_INPUT]),
  });
  const elapsedMs = Date.now() - started;
  throwIfCancelled(context);

  // U²-Net rend sept cartes, de la plus fine à la plus grossière. La première
  // est celle que l'on utilise ; les six autres servent à l'entraînement.
  const raw = outputs[session.outputNames[0]];
  if (!raw) throw new ImageError("segmentation-failed", "Le modèle n'a produit aucun résultat.");

  const expected = SEGMENTATION_INPUT * SEGMENTATION_INPUT;
  if (raw.data.length !== expected) {
    throw new ImageError(
      "segmentation-failed",
      `Sortie inattendue du modèle : ${raw.data.length} valeurs au lieu de ${expected}.`,
    );
  }

  context?.report?.({ ratio: 0.75, label: "Découpe du sujet…" });
  let mask = normalizeMask(raw.data, options.threshold ?? 0);

  const feather = Math.round(options.featherPx ?? 0);
  if (feather > 0) {
    // Le lissage se fait à la résolution du masque : moins de calcul, et un
    // adoucissement identique quelle que soit la taille de l'image.
    const scaled = Math.max(
      1,
      Math.round((feather * SEGMENTATION_INPUT) / Math.max(source.width, source.height)),
    );
    mask = featherMask(mask, SEGMENTATION_INPUT, SEGMENTATION_INPUT, scaled);
  }

  throwIfCancelled(context);
  const full = resampleMask(mask, SEGMENTATION_INPUT, source.width, source.height);
  context?.report?.({ ratio: 0.9, label: "Application de la transparence…" });

  const { canvas, keptRatio } = applyMask(source, full);
  context?.report?.({ ratio: 1, label: "Terminé" });
  return { canvas, keptRatio, elapsedMs };
}
