/**
 * Recette des gestes de taille d'interface.
 *
 * `zoom.test.ts` éprouve l'échelle et sa persistance ; ce fichier éprouve les
 * **gestes** — la partie que l'utilisateur touche — et les deux autres réglages
 * d'apparence livrés avec eux.
 *
 * Deux points valent d'être vérifiés automatiquement plutôt qu'à l'œil :
 *
 *  - chaque geste doit appeler `preventDefault`. Sans cela, WebKitGTK et
 *    WebView2 ajoutent leur propre zoom au nôtre : l'interface grossit deux
 *    fois et le pourcentage affiché dans Paramètres devient un mensonge ;
 *  - densité et animations doivent changer quelque chose immédiatement, et pas
 *    seulement être enregistrées.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { applyDensity, applyMotion, useSettings } from "./store";
import { useUiScale } from "./useUiScale";
import { ZOOM_DEFAULT } from "@/core/ui/zoom";

function Harness() {
  useUiScale();
  return null;
}

/** Envoie un raccourci comme le ferait le clavier, et dit s'il a été absorbé. */
function press(init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent("keydown", { ...init, cancelable: true, bubbles: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

function wheel(init: WheelEventInit): boolean {
  const event = new WheelEvent("wheel", { ...init, cancelable: true, bubbles: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

const zoomOf = () => useSettings.getState().zoom;

beforeEach(() => {
  useSettings.getState().set("zoom", ZOOM_DEFAULT);
  render(<Harness />);
});

afterEach(() => {
  cleanup();
  useSettings.getState().resetAppearance();
});

describe("raccourcis de taille d'interface", () => {
  it("agrandit de deux crans avec Ctrl +", () => {
    expect(press({ key: "+", ctrlKey: true })).toBe(true);
    expect(zoomOf()).toBe(1.1);
    expect(press({ key: "+", ctrlKey: true })).toBe(true);
    expect(zoomOf()).toBe(1.2);
  });

  it("réduit avec Ctrl - et revient à 100 % avec Ctrl 0", () => {
    expect(press({ key: "-", ctrlKey: true })).toBe(true);
    expect(zoomOf()).toBe(0.9);
    expect(press({ key: "0", ctrlKey: true, code: "Digit0" })).toBe(true);
    expect(zoomOf()).toBe(ZOOM_DEFAULT);
  });

  it("accepte le pavé numérique et le clavier AZERTY", () => {
    // Sur AZERTY, « = » et « + » partagent la même touche physique.
    press({ key: "=", ctrlKey: true, code: "Equal" });
    expect(zoomOf()).toBe(1.1);
    press({ key: "Subtract", ctrlKey: true, code: "NumpadSubtract" });
    expect(zoomOf()).toBe(1);
    press({ key: "Add", ctrlKey: true, code: "NumpadAdd" });
    expect(zoomOf()).toBe(1.1);
  });

  it("avance d'un seul cran à la molette", () => {
    expect(wheel({ deltaY: -100, ctrlKey: true })).toBe(true);
    expect(zoomOf()).toBe(1.05);
    expect(wheel({ deltaY: 100, ctrlKey: true })).toBe(true);
    expect(zoomOf()).toBe(1);
  });

  it("laisse passer les frappes et les molettes sans Ctrl", () => {
    expect(press({ key: "+" })).toBe(false);
    expect(press({ key: "0" })).toBe(false);
    expect(wheel({ deltaY: -100 })).toBe(false);
    expect(zoomOf()).toBe(ZOOM_DEFAULT);
    // Ctrl+Alt+ n'est pas un geste de zoom : il appartient au système.
    expect(press({ key: "+", ctrlKey: true, altKey: true })).toBe(false);
    expect(zoomOf()).toBe(ZOOM_DEFAULT);
  });

  it("ne dépasse jamais les bornes, même en insistant", () => {
    for (let i = 0; i < 30; i += 1) press({ key: "+", ctrlKey: true });
    expect(zoomOf()).toBe(1.5);
    for (let i = 0; i < 40; i += 1) press({ key: "-", ctrlKey: true });
    expect(zoomOf()).toBe(0.8);
  });

  it("synchronise le réglage des Paramètres avec le raccourci", () => {
    useSettings.getState().set("zoom", 1.25);
    expect(zoomOf()).toBe(1.25);
    press({ key: "+", ctrlKey: true });
    // Le raccourci repart de la valeur choisie dans Paramètres, pas de 100 %.
    expect(zoomOf()).toBe(1.35);
  });
});

describe("densité et animations", () => {
  it("bascule la densité sur la racine du document, immédiatement", () => {
    applyDensity("comfortable");
    expect(document.documentElement.dataset.density).toBe("comfortable");
    applyDensity("compact");
    expect(document.documentElement.dataset.density).toBe("compact");
  });

  it("bascule les animations sur la racine du document, immédiatement", () => {
    applyMotion("reduced");
    expect(document.documentElement.dataset.motion).toBe("reduced");
    applyMotion("normal");
    expect(document.documentElement.dataset.motion).toBe("normal");
  });

  it("applique le réglage enregistré dès le montage de l'ossature", () => {
    useSettings.getState().set("density", "comfortable");
    useSettings.getState().set("motion", "reduced");
    cleanup();
    render(<Harness />);
    expect(document.documentElement.dataset.density).toBe("comfortable");
    expect(document.documentElement.dataset.motion).toBe("reduced");
  });
});
