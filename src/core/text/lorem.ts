/**
 * Générateur de faux texte.
 *
 * Le tirage est injectable : les tests obtiennent une sortie reproductible
 * sans que l'outil perde son côté aléatoire à l'usage.
 */

const WORDS = [
  "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit",
  "sed", "do", "eiusmod", "tempor", "incididunt", "ut", "labore", "et", "dolore",
  "magna", "aliqua", "enim", "ad", "minim", "veniam", "quis", "nostrud",
  "exercitation", "ullamco", "laboris", "nisi", "aliquip", "ex", "ea", "commodo",
  "consequat", "duis", "aute", "irure", "in", "reprehenderit", "voluptate",
  "velit", "esse", "cillum", "eu", "fugiat", "nulla", "pariatur", "excepteur",
  "sint", "occaecat", "cupidatat", "non", "proident", "sunt", "culpa", "qui",
  "officia", "deserunt", "mollit", "anim", "id", "est", "laborum",
];

const OPENING = "Lorem ipsum dolor sit amet, consectetur adipiscing elit";

export type LoremUnit = "paragraphs" | "sentences" | "words";

export interface LoremOptions {
  unit: LoremUnit;
  count: number;
  /** Commencer par la phrase canonique « Lorem ipsum dolor sit amet… ». */
  startWithLorem: boolean;
}

export const DEFAULT_LOREM_OPTIONS: LoremOptions = {
  unit: "paragraphs",
  count: 3,
  startWithLorem: true,
};

/** Générateur pseudo-aléatoire déterministe (xorshift32) pour les tests. */
export function seededRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
}

export function generateLorem(options: LoremOptions, random: () => number = Math.random): string {
  const pick = () => WORDS[Math.floor(random() * WORDS.length)];
  const count = Math.max(1, Math.min(options.count, 500));

  if (options.unit === "words") {
    const words: string[] = [];
    if (options.startWithLorem) words.push(...OPENING.toLowerCase().replace(",", "").split(" "));
    while (words.length < count) words.push(pick());
    words.length = count;
    return capitalize(words.join(" ")) + ".";
  }

  const sentence = (first: boolean): string => {
    if (first && options.startWithLorem) return `${OPENING}.`;
    const length = 8 + Math.floor(random() * 10);
    const words = Array.from({ length }, pick);
    if (length > 10) words.splice(Math.floor(length / 2), 0, words[2] + ",");
    return capitalize(words.join(" ")) + ".";
  };

  if (options.unit === "sentences") {
    return Array.from({ length: count }, (_, index) => sentence(index === 0)).join(" ");
  }

  let sentenceIndex = 0;
  return Array.from({ length: count }, () => {
    const length = 3 + Math.floor(random() * 3);
    return Array.from({ length }, () => sentence(sentenceIndex++ === 0)).join(" ");
  }).join("\n\n");
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase("fr") + text.slice(1);
}
