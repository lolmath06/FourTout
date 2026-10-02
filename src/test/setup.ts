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

// jsdom n'implémente pas les URL objets : sans ce complément, tout composant
// qui affiche une image ou un média produit — et ils sont nombreux — échoue
// ici pour une raison sans rapport avec ce que le test observe. Le stub rend
// une URL inerte, jamais chargée par jsdom, ce qui suffit à ces tests.
if (typeof window !== "undefined" && typeof URL.createObjectURL !== "function") {
  let counter = 0;
  URL.createObjectURL = () => `blob:fourtout-test/${++counter}`;
  URL.revokeObjectURL = () => {};
}

// Les tests sont écrits contre le texte source de l'interface, en français :
// le système de test « parle » donc français, et la préférence « Système »
// s'y résout comme sur un poste francophone. Les tests d'internationalisation
// choisissent explicitement leurs langues.
if (typeof navigator !== "undefined") {
  Object.defineProperty(navigator, "languages", { value: ["fr-FR", "fr"], configurable: true });
  Object.defineProperty(navigator, "language", { value: "fr-FR", configurable: true });
}
