import { useEffect, useRef } from "react";
import { applyZoom, formatZoom, stepZoom, ZOOM_DEFAULT } from "@/core/ui/zoom";
import { useNotifications } from "@/features/notifications/store";
import { applyDensity, applyMotion, applyTheme, useSettings } from "./store";

/**
 * Raccourcis de taille d'interface, montés une seule fois par l'ossature.
 *
 * Les gestes sont ceux d'un logiciel desktop : `Ctrl +`, `Ctrl -`, `Ctrl 0`,
 * `Ctrl + molette`. Chaque geste est **intercepté** (`preventDefault`) avant
 * que la WebView n'applique son propre zoom : sans cela, WebKitGTK et WebView2
 * ajouteraient le leur au nôtre et l'échelle affichée dans Paramètres
 * mentirait.
 *
 * Sur macOS, la touche Commande déclenche les mêmes gestes.
 */
export function useUiScale(): void {
  const zoom = useSettings((state) => state.zoom);
  const density = useSettings((state) => state.density);
  const motion = useSettings((state) => state.motion);
  const theme = useSettings((state) => state.theme);
  const set = useSettings((state) => state.set);

  // Le raccourci lit la valeur courante sans réabonner les écouteurs à chaque
  // changement d'échelle.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => {
    void applyZoom(zoom);
  }, [zoom]);

  useEffect(() => applyDensity(density), [density]);
  useEffect(() => applyMotion(motion), [motion]);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyTheme("system");
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [theme]);

  useEffect(() => {
    /**
     * Toast volontairement bref, et remplacé à chaque cran : un geste répété
     * ne doit pas empiler quinze notifications.
     */
    let lastNotice: string | undefined;
    const announce = (value: number) => {
      const store = useNotifications.getState();
      if (lastNotice) store.dismiss(lastNotice);
      lastNotice = store.push({
        kind: "info",
        title: `Interface : ${formatZoom(value)}`,
        duration: 1200,
      });
    };

    const change = (next: number) => {
      if (next === zoomRef.current) {
        announce(next);
        return;
      }
      set("zoom", next);
      announce(next);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      // `code` plutôt que `key` : sur AZERTY, « + » et « - » du pavé principal
      // ne produisent pas les mêmes caractères qu'en QWERTY.
      const key = event.key;
      const code = event.code;
      if (key === "+" || key === "=" || code === "NumpadAdd" || code === "Equal") {
        event.preventDefault();
        change(stepZoom(zoomRef.current, 1));
      } else if (key === "-" || key === "_" || code === "NumpadSubtract" || code === "Minus") {
        event.preventDefault();
        change(stepZoom(zoomRef.current, -1));
      } else if (key === "0" || code === "Numpad0" || code === "Digit0") {
        event.preventDefault();
        change(ZOOM_DEFAULT);
      }
    };

    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.deltaY === 0) return;
      event.preventDefault();
      // Un cran (5 %) : la molette est un geste plus fin que le clavier.
      change(stepZoom(zoomRef.current, event.deltaY < 0 ? 1 : -1, 1));
    };

    window.addEventListener("keydown", onKeyDown);
    // `passive: false` est indispensable : sans cela `preventDefault` est
    // ignoré et la WebView zoome par-dessus notre échelle.
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", onWheel);
    };
  }, [set]);
}
