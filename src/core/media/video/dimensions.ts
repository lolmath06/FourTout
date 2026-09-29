/**
 * Calculs de dimensions vidéo.
 *
 * Deux règles gouvernent tout ce fichier :
 *
 * 1. **Les dimensions sont paires.** Les formats de pixels `yuv420p` — donc la
 *    quasi-totalité des vidéos lisibles partout — sous-échantillonnent la
 *    chrominance d'un facteur deux : une largeur impaire fait échouer
 *    l'encodage. On arrondit donc systématiquement.
 * 2. **On n'agrandit jamais en silence.** Repasser une source 720p en 1080p
 *    n'ajoute aucun détail et alourdit le fichier ; l'agrandissement est
 *    possible, mais l'appelant doit l'avoir explicitement demandé.
 *
 * Fonctions pures : aucune dépendance à FFmpeg ni au DOM.
 */

export interface Size {
  width: number;
  height: number;
}

/** Arrondit au nombre pair le plus proche, avec un minimum de 2. */
export function even(value: number): number {
  const rounded = Math.round(value);
  return Math.max(2, rounded - (rounded % 2));
}

/** Hauteurs proposées comme préréglages, de la plus grande à la plus petite. */
export const RESOLUTION_PRESETS = [2160, 1440, 1080, 720, 480, 360] as const;
export type ResolutionPreset = (typeof RESOLUTION_PRESETS)[number];

/**
 * Dimensions cibles pour une hauteur demandée, en conservant les proportions
 * de la source. Une vidéo verticale garde son orientation : c'est bien la
 * **plus petite** dimension qui porte la définition annoncée (« 1080p » d'une
 * vidéo 9:16 donne 1080 × 1920).
 */
export function sizeForHeight(source: Size, height: number): Size {
  const portrait = source.height > source.width;
  if (portrait) {
    const width = even(height);
    return { width, height: even((width * source.height) / source.width) };
  }
  const target = even(height);
  return { width: even((target * source.width) / source.height), height: target };
}

/**
 * Dimensions finales pour une demande libre. Une seule dimension fournie suffit
 * : l'autre est déduite des proportions de la source.
 */
export function resolveSize(
  source: Size,
  request: { width?: number; height?: number; keepRatio: boolean },
): Size {
  const { width, height, keepRatio } = request;
  if (width && height && !keepRatio) return { width: even(width), height: even(height) };
  if (width && height) {
    // Proportions conservées : on tient dans la boîte demandée.
    const scale = Math.min(width / source.width, height / source.height);
    return { width: even(source.width * scale), height: even(source.height * scale) };
  }
  if (width) return { width: even(width), height: even((width * source.height) / source.width) };
  if (height) return { width: even((height * source.width) / source.height), height: even(height) };
  return { width: even(source.width), height: even(source.height) };
}

/** La cible agrandit-elle la source (sur au moins une dimension) ? */
export function isUpscale(source: Size, target: Size): boolean {
  return target.width > source.width || target.height > source.height;
}

/** Proportions d'un rectangle, arrondies à trois décimales. */
export function aspectRatio(size: Size): number {
  return size.height === 0 ? 0 : Math.round((size.width / size.height) * 1000) / 1000;
}

/** Rectangle de rognage exprimé en fractions (0 à 1) de l'image source. */
export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PixelRect extends Size {
  x: number;
  y: number;
}

/**
 * Convertit une sélection affichée (fractions) en rectangle de pixels valide :
 * dimensions paires, entièrement contenu dans l'image. C'est ce rectangle qui
 * est passé au filtre `crop`, donc ce que l'utilisateur voit est exactement ce
 * qu'il obtient.
 */
export function cropRectFor(source: Size, rect: NormalizedRect): PixelRect {
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const x0 = clamp01(rect.x);
  const y0 = clamp01(rect.y);
  const w0 = clamp01(Math.min(rect.w, 1 - x0));
  const h0 = clamp01(Math.min(rect.h, 1 - y0));

  let width = even(w0 * source.width);
  let height = even(h0 * source.height);
  // Une sélection minuscule reste exploitable plutôt que de produire 0 × 0.
  width = Math.min(even(source.width), Math.max(2, width));
  height = Math.min(even(source.height), Math.max(2, height));

  const x = Math.min(even(x0 * source.width), even(source.width) - width);
  const y = Math.min(even(y0 * source.height), even(source.height) - height);
  return { x: Math.max(0, x), y: Math.max(0, y), width, height };
}

/**
 * Ajuste un rectangle normalisé pour respecter un rapport largeur/hauteur
 * **en pixels**. Le rectangle reste dans l'image ; s'il déborde, il est réduit.
 * `ratio` vaut 0 pour « libre » (le rectangle est renvoyé tel quel).
 */
export function fitAspect(rect: NormalizedRect, source: Size, ratio: number): NormalizedRect {
  if (ratio <= 0 || source.width === 0 || source.height === 0) return rect;
  const sourceRatio = source.width / source.height;
  // En fractions, un rapport pixel `ratio` correspond à w/h = ratio / sourceRatio.
  const fractionRatio = ratio / sourceRatio;

  let w = rect.w;
  let h = w / fractionRatio;
  if (h > 1) {
    h = 1;
    w = h * fractionRatio;
  }
  if (w > 1) {
    w = 1;
    h = w / fractionRatio;
  }
  const x = Math.min(Math.max(0, rect.x), 1 - w);
  const y = Math.min(Math.max(0, rect.y), 1 - h);
  return { x, y, w, h };
}

/** Rectangle centré au rapport demandé, occupant toute la place possible. */
export function centeredRect(source: Size, ratio: number): NormalizedRect {
  if (ratio <= 0) return { x: 0, y: 0, w: 1, h: 1 };
  const fitted = fitAspect({ x: 0, y: 0, w: 1, h: 1 }, source, ratio);
  return { ...fitted, x: (1 - fitted.w) / 2, y: (1 - fitted.h) / 2 };
}

/** Rapports proposés dans les outils de rognage. */
export const CROP_RATIOS = [
  { value: "free", label: "Libre", ratio: 0 },
  { value: "1:1", label: "1:1", ratio: 1 },
  { value: "4:3", label: "4:3", ratio: 4 / 3 },
  { value: "16:9", label: "16:9", ratio: 16 / 9 },
  { value: "9:16", label: "9:16 — Vertical", ratio: 9 / 16 },
] as const;

export type CropRatioKey = (typeof CROP_RATIOS)[number]["value"];
