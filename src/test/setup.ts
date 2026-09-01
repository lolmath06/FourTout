import "@testing-library/jest-dom/vitest";

// Certains tests s'exécutent en environnement Node (scripts, générateurs) :
// la configuration DOM ne s'applique qu'aux tests navigateur.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
