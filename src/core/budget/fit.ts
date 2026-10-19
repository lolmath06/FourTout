/**
 * Recherche d'un réglage d'image qui tienne sous une taille visée.
 *
 * Une taille de fichier ne se calcule pas : elle se constate après encodage.
 * Ce module cherche donc, par essais, le réglage **le plus fidèle** qui passe
 * sous la cible :
 *
 *  1. à pleine définition, la qualité la plus haute qui convient (JPEG, WebP
 *     avec perte) ;
 *  2. sinon, une définition réduite — jamais agrandie, ratio conservé —
 *     puis la meilleure qualité possible à cette définition.
 *
 * Un format sans perte (PNG, WebP sans perte) n'a pas de qualité à baisser : seule la
 * définition varie. Le nombre d'essais est borné, et l'on dit franchement
 * quand la cible n'a pas été atteinte plutôt que de rendre un fichier trop gros
 * en prétendant le contraire.
 */

export interface FitAttempt<T> {
  quality: number;
  /** Fraction des dimensions d'origine (1 = pleine définition). */
  scale: number;
  bytes: number;
  data: T;
}

export interface FitOptions {
  /** Le format a un réglage de qualité (JPEG) ; sinon la définition seule varie. */
  lossy: boolean;
  maxQuality?: number;
  minQuality?: number;
  /** Définition minimale, en fraction de l'original. */
  minScale?: number;
  maxAttempts?: number;
  signal?: AbortSignal;
  onAttempt?: (attempt: { quality: number; scale: number; bytes: number }) => void;
}

export interface FitResult<T> {
  /** La cible est respectée. */
  reached: boolean;
  best: FitAttempt<T>;
  attempts: number;
}

type Encoder<T> = (quality: number, scale: number) => Promise<{ data: T; bytes: number }>;

export async function fitToSize<T>(encode: Encoder<T>, target: number, options: FitOptions): Promise<FitResult<T>> {
  const maxQuality = options.maxQuality ?? 0.92;
  const minQuality = options.minQuality ?? 0.35;
  const minScale = options.minScale ?? 0.08;
  const maxAttempts = options.maxAttempts ?? 16;
  let attempts = 0;
  let smallest: FitAttempt<T> | undefined;

  const probe = async (quality: number, scale: number): Promise<FitAttempt<T>> => {
    if (options.signal?.aborted) throw new DOMException("annulé", "AbortError");
    attempts += 1;
    const { data, bytes } = await encode(quality, scale);
    options.onAttempt?.({ quality, scale, bytes });
    const attempt = { quality, scale, bytes, data };
    if (!smallest || bytes < smallest.bytes) smallest = attempt;
    return attempt;
  };
  const budgetLeft = () => attempts < maxAttempts;
  const done = (best: FitAttempt<T>, reached: boolean): FitResult<T> => ({ reached, best, attempts });

  // 1. Pleine définition, qualité maximale.
  const first = await probe(options.lossy ? maxQuality : 1, 1);
  if (first.bytes <= target) return done(first, true);

  let scale = 1;
  let working: FitAttempt<T> | undefined;

  if (options.lossy) {
    // 2. Pleine définition : la meilleure qualité qui convient, par dichotomie.
    let low = minQuality;
    let high = maxQuality;
    const floor = await probe(low, 1);
    if (floor.bytes <= target) {
      working = floor;
      for (let i = 0; i < 5 && budgetLeft(); i += 1) {
        const mid = (low + high) / 2;
        const attempt = await probe(mid, 1);
        if (attempt.bytes <= target) {
          working = attempt;
          low = mid;
        } else {
          high = mid;
        }
      }
      return done(working, true);
    }
    scale = Math.sqrt(target / floor.bytes) * 0.95;
  } else {
    scale = Math.sqrt(target / first.bytes) * 0.97;
  }

  // 3. Définition réduite : la taille varie à peu près comme le carré du facteur.
  const referenceQuality = options.lossy ? 0.7 : 1;
  while (budgetLeft()) {
    scale = Math.max(minScale, Math.min(0.99, scale));
    const attempt = await probe(referenceQuality, scale);
    if (attempt.bytes <= target) {
      working = attempt;
      break;
    }
    if (scale <= minScale) return done(smallest ?? attempt, false);
    scale = scale * Math.sqrt(target / attempt.bytes) * 0.95;
  }
  if (!working) return done(smallest as FitAttempt<T>, false);

  // 4. À cette définition, remonter la qualité tant que ça tient.
  if (options.lossy) {
    let low = working.quality;
    let high = maxQuality;
    for (let i = 0; i < 3 && budgetLeft(); i += 1) {
      const mid = (low + high) / 2;
      const attempt = await probe(mid, working.scale);
      if (attempt.bytes <= target) {
        working = attempt;
        low = mid;
      } else {
        high = mid;
      }
    }
  }
  return done(working, true);
}

/** Dimensions après réduction : ratio conservé, jamais d'agrandissement, au moins 1 px. */
export function scaledSize(width: number, height: number, scale: number): { width: number; height: number } {
  const s = Math.min(1, Math.max(0, scale));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}
