/** Logique pure du compteur de mots, séparée de l'interface pour être testable. */
/** Mots par minute retenus pour l'estimation du temps de lecture. */
const WORDS_PER_MINUTE = 200;

export function computeTextStatistics(text: string) {
  const trimmed = text.trim();
  const words = trimmed.length === 0 ? [] : trimmed.split(/\s+/);
  const sentences =
    trimmed.length === 0 ? [] : trimmed.split(/[.!?…]+(?:\s|$)/).filter((s) => s.trim().length > 0);
  const paragraphs =
    trimmed.length === 0 ? [] : trimmed.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const readingMinutes = words.length === 0 ? 0 : words.length / WORDS_PER_MINUTE;

  return {
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, "").length,
    words: words.length,
    sentences: sentences.length,
    paragraphs: paragraphs.length,
    lines: text.length === 0 ? 0 : text.split("\n").length,
    readingTime: formatReadingTime(readingMinutes),
  };
}

function formatReadingTime(minutes: number): string {
  if (minutes === 0) return "—";
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} s`;
  return `${Math.round(minutes)} min`;
}
