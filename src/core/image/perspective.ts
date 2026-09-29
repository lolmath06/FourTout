import { getRasterBackend, type RasterCanvas, type RasterPixels } from "@/core/pdf/raster/types";
import { ImageError } from "./errors";

/**
 * Correction de perspective d'un document photographié.
 *
 * Une feuille prise en biais n'est pas un rectangle rogné : c'est un
 * **quadrilatère quelconque**. La ramener à un rectangle frontal demande une
 * transformation projective (homographie), pas un recadrage — sans quoi les
 * lignes de texte resteraient convergentes.
 *
 * Le calcul est écrit ici, en une centaine de lignes d'algèbre linéaire, plutôt
 * qu'obtenu en embarquant une bibliothèque de vision par ordinateur : ajouter
 * plusieurs mégaoctets de dépendance pour résoudre un système de huit équations
 * serait disproportionné, et la version courte est vérifiable par des tests.
 *
 * L'utilisateur place les quatre coins lui-même. C'est volontaire : une
 * détection automatique approximative ferait perdre plus de temps qu'elle n'en
 * fait gagner, et la saisie manuelle est toujours exacte.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Les quatre coins d'un document, **dans cet ordre** : haut-gauche,
 * haut-droite, bas-droite, bas-gauche. L'ordre porte l'orientation du
 * résultat ; c'est lui qui garantit l'absence d'effet miroir.
 */
export interface Quad {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

/**
 * Homographie, sous forme des huit coefficients libres (le neuvième vaut 1 par
 * convention) :
 *
 * ```
 * ⎡ a b c ⎤
 * ⎢ d e f ⎥
 * ⎣ g h 1 ⎦
 * ```
 */
export interface Homography {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g: number;
  h: number;
}

export const IDENTITY: Homography = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, g: 0, h: 0 };

/** Les coins d'un quadrilatère, dans l'ordre canonique. */
export function quadPoints(quad: Quad): [Point, Point, Point, Point] {
  return [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
}

/** Résout un système linéaire dense par élimination de Gauss à pivot partiel. */
function solveLinearSystem(matrix: number[][], vector: number[]): number[] | undefined {
  const size = vector.length;
  const rows = matrix.map((row, index) => [...row, vector[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    // Pivot nul : les quatre points sont alignés ou confondus, il n'existe
    // aucune homographie. On le signale plutôt que de renvoyer des infinis.
    if (Math.abs(rows[pivot][column]) < 1e-12) return undefined;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column] / rows[column][column];
      if (factor === 0) continue;
      for (let k = column; k <= size; k += 1) rows[row][k] -= factor * rows[column][k];
    }
  }

  return rows.map((row, index) => row[size] / row[index]);
}

/**
 * Homographie envoyant les quatre points `from` sur les quatre points `to`.
 *
 * Chaque correspondance donne deux équations ; quatre points en donnent huit,
 * exactement le nombre d'inconnues.
 */
export function computeHomography(
  from: readonly [Point, Point, Point, Point],
  to: readonly [Point, Point, Point, Point],
): Homography | undefined {
  const matrix: number[][] = [];
  const vector: number[] = [];

  for (let index = 0; index < 4; index += 1) {
    const { x, y } = from[index];
    const { x: u, y: v } = to[index];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    vector.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    vector.push(v);
  }

  const solution = solveLinearSystem(matrix, vector);
  if (!solution || solution.some((value) => !Number.isFinite(value))) return undefined;
  const [a, b, c, d, e, f, g, h] = solution;
  return { a, b, c, d, e, f, g, h };
}

/** Applique une homographie à un point. */
export function applyHomography(homography: Homography, point: Point): Point {
  const { a, b, c, d, e, f, g, h } = homography;
  const w = g * point.x + h * point.y + 1;
  if (w === 0) return { x: Number.NaN, y: Number.NaN };
  return {
    x: (a * point.x + b * point.y + c) / w,
    y: (d * point.x + e * point.y + f) / w,
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Dimensions naturelles du rectangle redressé : pour chaque paire de côtés
 * opposés, on retient le plus long. Le côté le plus proche de l'objectif est
 * celui qui a le moins souffert de la projection ; le prendre pour référence
 * évite de comprimer le document.
 */
export function suggestOutputSize(quad: Quad): { width: number; height: number } {
  const width = Math.max(
    distance(quad.topLeft, quad.topRight),
    distance(quad.bottomLeft, quad.bottomRight),
  );
  const height = Math.max(
    distance(quad.topLeft, quad.bottomLeft),
    distance(quad.topRight, quad.bottomRight),
  );
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

/**
 * Le quadrilatère est-il exploitable ? Un quadrilatère croisé ou dégénéré
 * produirait une image repliée sur elle-même.
 */
export function isUsableQuad(quad: Quad): boolean {
  const points = quadPoints(quad);
  // Convexité : les quatre produits vectoriels consécutifs doivent avoir le
  // même signe. Un « nœud papillon » les fait changer de signe.
  let positive = 0;
  let negative = 0;
  for (let index = 0; index < 4; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % 4];
    const c = points[(index + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross > 1e-9) positive += 1;
    else if (cross < -1e-9) negative += 1;
  }
  if (positive !== 4 && negative !== 4) return false;
  const { width, height } = suggestOutputSize(quad);
  return width >= 2 && height >= 2;
}

/* ------------------------------------------------------------- rendu */

/** Rendu du document redressé. */
export type PerspectiveRendering =
  /** Conserve les couleurs de la photo. */
  | "color"
  /** Niveaux de gris. */
  | "grayscale"
  /** Noir et blanc, seuil adaptatif : rend un document photographié lisible. */
  | "document";

/**
 * Proportions imposées au document redressé.
 *
 * Pourquoi ce réglage existe : les dimensions déduites d'un quadrilatère ne
 * restituent **pas** les proportions réelles de la feuille. Une photo est une
 * projection ; retrouver le rapport largeur/hauteur d'origine supposerait de
 * connaître la focale de l'appareil. La déduction géométrique donne un ordre de
 * grandeur — sur une prise de vue franchement inclinée, l'écart atteint
 * couramment 10 à 20 %.
 *
 * Plutôt que de faire semblant, on laisse dire ce qu'on photographie : la
 * quasi-totalité des documents sont au format A4 ou Lettre, et l'imposer donne
 * un résultat exact là où le calcul ne peut qu'approcher.
 */
export type PerspectiveAspect = "auto" | "a4-portrait" | "a4-landscape" | "letter-portrait" | "square";

export const ASPECT_RATIOS: Record<Exclude<PerspectiveAspect, "auto">, number> = {
  "a4-portrait": 210 / 297,
  "a4-landscape": 297 / 210,
  "letter-portrait": 8.5 / 11,
  square: 1,
};

export const ASPECT_LABELS: Record<PerspectiveAspect, string> = {
  auto: "Déduites des coins",
  "a4-portrait": "A4 portrait",
  "a4-landscape": "A4 paysage",
  "letter-portrait": "Lettre portrait",
  square: "Carré",
};

export interface PerspectiveOptions {
  /** Les quatre coins, en pixels de l'image source. */
  quad: Quad;
  /** Dimensions de sortie ; déduites du quadrilatère si absentes. */
  width?: number;
  height?: number;
  /** Proportions imposées. Prioritaires sur les dimensions déduites. */
  aspect?: PerspectiveAspect;
  rendering?: PerspectiveRendering;
}

export interface PerspectiveResult {
  canvas: RasterCanvas;
  width: number;
  height: number;
  /** L'homographie appliquée, pour les tests et le diagnostic. */
  homography: Homography;
}

/**
 * Dimensions finales : celles demandées, sinon celles qu'imposent les
 * proportions choisies, sinon celles déduites du quadrilatère.
 *
 * Quand un format est imposé, on conserve la plus grande des deux dimensions
 * déduites : le document redressé garde ainsi la définition de la photo, sans
 * agrandissement artificiel.
 */
export function resolveOutputSize(
  suggested: { width: number; height: number },
  options: { width?: number; height?: number; aspect?: PerspectiveAspect },
): { width: number; height: number } {
  if (options.width !== undefined && options.height !== undefined) {
    return {
      width: Math.max(1, Math.round(options.width)),
      height: Math.max(1, Math.round(options.height)),
    };
  }

  const aspect = options.aspect ?? "auto";
  if (aspect !== "auto") {
    const ratio = ASPECT_RATIOS[aspect];
    const width = options.width ?? (ratio >= 1 ? suggested.width : suggested.height * ratio);
    const height = options.height ?? width / ratio;
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }

  return {
    width: Math.max(1, Math.round(options.width ?? suggested.width)),
    height: Math.max(1, Math.round(options.height ?? suggested.height)),
  };
}

/** Échantillonnage bilinéaire, avec conservation de la transparence. */
function sampleBilinear(
  source: RasterPixels,
  x: number,
  y: number,
  target: Uint8ClampedArray,
  offset: number,
): void {
  if (x < -0.5 || y < -0.5 || x > source.width - 0.5 || y > source.height - 0.5) {
    // Hors de la photo : totalement transparent. Aucune couleur inventée.
    target[offset] = 0;
    target[offset + 1] = 0;
    target[offset + 2] = 0;
    target[offset + 3] = 0;
    return;
  }

  const x0 = Math.max(0, Math.min(source.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(source.height - 1, Math.floor(y)));
  const x1 = Math.min(source.width - 1, x0 + 1);
  const y1 = Math.min(source.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));

  const i00 = (y0 * source.width + x0) * 4;
  const i10 = (y0 * source.width + x1) * 4;
  const i01 = (y1 * source.width + x0) * 4;
  const i11 = (y1 * source.width + x1) * 4;

  for (let channel = 0; channel < 4; channel += 1) {
    const top =
      source.data[i00 + channel] * (1 - fx) + source.data[i10 + channel] * fx;
    const bottom =
      source.data[i01 + channel] * (1 - fx) + source.data[i11 + channel] * fx;
    target[offset + channel] = top * (1 - fy) + bottom * fy;
  }
}

/**
 * Redresse la zone délimitée par `quad` en un rectangle frontal.
 *
 * La transformation est calculée du **rectangle de sortie vers la photo** : on
 * balaie les pixels de destination et on va chercher leur couleur dans la
 * source. C'est ce sens qui garantit une image de sortie pleine, sans trous —
 * l'inverse laisserait des pixels non écrits.
 */
export function correctPerspective(
  source: RasterCanvas,
  options: PerspectiveOptions,
): PerspectiveResult {
  const backend = getRasterBackend();
  if (!backend) throw new ImageError("render-unavailable");
  if (!isUsableQuad(options.quad)) {
    throw new ImageError(
      "invalid-crop",
      "Les quatre coins doivent former un quadrilatère non croisé.",
    );
  }

  const suggested = suggestOutputSize(options.quad);
  const { width, height } = resolveOutputSize(suggested, options);

  const destination: [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const homography = computeHomography(destination, quadPoints(options.quad));
  if (!homography) {
    throw new ImageError("invalid-crop", "Les quatre coins sont alignés ou confondus.");
  }

  const pixels = source.getPixels();
  const out: RasterPixels = {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Centre du pixel de destination : sans le demi-pixel, l'image glisse.
      const mapped = applyHomography(homography, { x: x + 0.5, y: y + 0.5 });
      sampleBilinear(pixels, mapped.x - 0.5, mapped.y - 0.5, out.data, (y * width + x) * 4);
    }
  }

  const rendering = options.rendering ?? "color";
  if (rendering !== "color") applyRendering(out, rendering);

  const canvas = backend.createCanvas(width, height);
  canvas.putPixels(out);
  return { canvas, width, height, homography };
}

/**
 * Rendu documentaire appliqué au rectangle redressé.
 *
 * Le seuil du mode « document » est calculé **par zone** (fenêtres de 32 px)
 * plutôt que globalement : une photo de feuille est presque toujours éclairée
 * de façon inégale, et un seuil unique noircit un coin ou efface l'autre.
 */
function applyRendering(pixels: RasterPixels, rendering: Exclude<PerspectiveRendering, "color">): void {
  const { width, height, data } = pixels;
  const gray = new Float32Array(width * height);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    gray[index] = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
  }

  if (rendering === "grayscale") {
    for (let index = 0; index < gray.length; index += 1) {
      const offset = index * 4;
      const value = gray[index];
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    }
    return;
  }

  const BLOCK = 32;
  const blocksX = Math.max(1, Math.ceil(width / BLOCK));
  const blocksY = Math.max(1, Math.ceil(height / BLOCK));
  const thresholds = new Float32Array(blocksX * blocksY);

  for (let by = 0; by < blocksY; by += 1) {
    for (let bx = 0; bx < blocksX; bx += 1) {
      let sum = 0;
      let count = 0;
      for (let y = by * BLOCK; y < Math.min(height, (by + 1) * BLOCK); y += 1) {
        for (let x = bx * BLOCK; x < Math.min(width, (bx + 1) * BLOCK); x += 1) {
          sum += gray[y * width + x];
          count += 1;
        }
      }
      // Un peu en dessous de la moyenne locale : le fond, majoritaire, tire la
      // moyenne vers le clair ; abaisser le seuil préserve les traits fins.
      thresholds[by * blocksX + bx] = count > 0 ? (sum / count) * 0.88 : 128;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const threshold = thresholds[Math.floor(y / BLOCK) * blocksX + Math.floor(x / BLOCK)];
      const value = gray[index] < threshold ? 0 : 255;
      const offset = index * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    }
  }
}
