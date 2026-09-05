import { isTauri } from "@/core/platform";

/**
 * Taille de l'interface.
 *
 * Deux implémentations, et une seule règle : **ne jamais utiliser
 * `transform: scale()`**. Une mise à l'échelle par transformation floute le
 * texte, décale les coordonnées de pointeur (rognage, caviardage, overlays
 * vidéo en dépendent) et laisse le viewport à sa taille d'origine, ce qui
 * fabrique des barres de défilement absurdes.
 *
 * En application, on demande donc à la WebView elle-même de zoomer :
 * `webkit_web_view_set_zoom_level` sur Fedora/WebKitGTK, `ZoomFactor` sur
 * WebView2. C'est le zoom d'un navigateur : la page est **remise en page** à
 * la nouvelle échelle, le texte reste net, les coordonnées restent justes.
 *
 * Hors application (aperçu navigateur, tests), on retombe sur la propriété CSS
 * `zoom` de l'élément racine, qui produit exactement le même effet de
 * remise en page — contrairement à `transform`.
 */

/** Échelles proposées, de 80 % à 150 %. Pas de zoom arbitraire. */
export const ZOOM_STEPS: readonly number[] = [
  0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5,
];

export const ZOOM_MIN = ZOOM_STEPS[0];
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];
export const ZOOM_DEFAULT = 1;

/** Les valeurs sont manipulées en centièmes pour éviter les dérives flottantes. */
const round = (value: number) => Math.round(value * 100) / 100;

/** Ramène une valeur quelconque sur l'échelle, en restant dans les bornes. */
export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return ZOOM_DEFAULT;
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
  let best = ZOOM_STEPS[0];
  for (const step of ZOOM_STEPS) {
    if (Math.abs(step - clamped) < Math.abs(best - clamped)) best = step;
  }
  return best;
}

/**
 * Échelle suivante ou précédente.
 *
 * `direction` vaut +1 ou -1 ; `stride` dit de combien de crans on avance —
 * 2 crans (10 %) pour les raccourcis clavier, 1 cran (5 %) pour la molette,
 * où l'utilisateur a naturellement un geste plus fin.
 */
export function stepZoom(current: number, direction: 1 | -1, stride: 1 | 2 = 2): number {
  const index = ZOOM_STEPS.indexOf(clampZoom(current));
  const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + direction * stride));
  return ZOOM_STEPS[next];
}

/** « 110 % ». Un entier : l'échelle n'a pas de décimale. */
export function formatZoom(value: number): string {
  return `${Math.round(round(value) * 100)} %`;
}

/**
 * Applique l'échelle à la fenêtre.
 *
 * En Tauri, l'appel natif est asynchrone ; s'il échoue (permission absente,
 * plateforme sans support), on retombe sur `zoom` CSS plutôt que de laisser
 * l'utilisateur avec un réglage sans effet.
 */
export async function applyZoom(value: number): Promise<void> {
  const factor = clampZoom(value);
  if (isTauri()) {
    try {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      await getCurrentWebviewWindow().setZoom(factor);
      applyCssZoom(1);
      return;
    } catch {
      // Repli silencieux : l'échelle doit s'appliquer quoi qu'il arrive.
    }
  }
  applyCssZoom(factor);
}

/**
 * Repli CSS.
 *
 * On passe par la variable `--ft-zoom`, consommée par une règle `zoom` sur
 * `:root` dans la feuille de styles, plutôt que par un style inline `zoom`.
 * L'effet rendu est identique, mais la valeur reste une propriété
 * personnalisée : lisible, testable, et jamais silencieusement écartée par un
 * moteur qui ne connaîtrait pas la propriété.
 */
function applyCssZoom(factor: number): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (factor === 1) root.style.removeProperty("--ft-zoom");
  else root.style.setProperty("--ft-zoom", String(factor));
}
