import { useEffect, useState, type RefObject } from "react";

/**
 * Mesure la taille réellement affichée d'un élément (via `ResizeObserver`).
 *
 * Utilisé pour dimensionner un texte superposé à un aperçu en pixels réels,
 * plutôt que via `container-type`/unités de conteneur : sous WebKitGTK,
 * `container-type: size` applique un confinement de taille qui fait s'effondrer
 * à 0×0 un conteneur `inline-block` dimensionné par son contenu — l'aperçu
 * disparaissait alors entièrement.
 */
export function useRenderedSize<T extends HTMLElement>(ref: RefObject<T | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
