import { detectLineEndings } from "./lines";

/**
 * Statistiques de texte.
 *
 * Les temps de lecture et de parole, ainsi que les indices de lisibilité, sont
 * des **estimations** : elles dépendent du lecteur, de la langue et du sujet.
 * L'interface doit le dire ; ce module ne prétend rien de plus.
 */

/** Mots par minute retenus pour la lecture silencieuse. */
export const READING_WPM = 200;
/** Mots par minute retenus pour la lecture à voix haute. */
export const SPEAKING_WPM = 130;

export interface TextStatistics {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  sentences: number;
  paragraphs: number;
  lines: number;
  /** Durée de lecture silencieuse estimée, en secondes. */
  readingSeconds: number;
  /** Durée de lecture à voix haute estimée, en secondes. */
  speakingSeconds: number;
  /** Longueur moyenne des mots, en caractères. */
  averageWordLength: number;
  /** Nombre moyen de mots par phrase. */
  averageSentenceLength: number;
  /** Nombre moyen de syllabes par mot (approximation par les voyelles). */
  averageSyllables: number;
  /** Score de lisibilité Flesch adapté au français (Kandel & Moles). */
  readabilityFr: number;
  /** Score de lisibilité Flesch Reading Ease (anglais). */
  readabilityEn: number;
}

/** Compte approximatif des syllabes : groupes de voyelles. */
export function countSyllables(word: string): number {
  const groups = word.toLocaleLowerCase("fr").match(/[aeiouyàâäéèêëîïôöùûüÿ]+/g);
  return Math.max(1, groups?.length ?? 1);
}

export function computeStatistics(text: string): TextStatistics {
  const trimmed = text.trim();
  const words = trimmed.length === 0 ? [] : trimmed.split(/\s+/);
  const sentences =
    trimmed.length === 0
      ? []
      : trimmed.split(/[.!?…]+(?:\s|$)/).filter((sentence) => sentence.trim().length > 0);
  const paragraphs =
    trimmed.length === 0 ? [] : trimmed.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

  const letters = words.reduce((total, word) => total + word.replace(/[^\p{L}\p{N}]/gu, "").length, 0);
  const syllables = words.reduce((total, word) => total + countSyllables(word), 0);

  const wordCount = words.length;
  const sentenceCount = Math.max(1, sentences.length);
  const wordsPerSentence = wordCount / sentenceCount;
  const syllablesPerWord = wordCount === 0 ? 0 : syllables / wordCount;

  return {
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, "").length,
    words: wordCount,
    sentences: sentences.length,
    paragraphs: paragraphs.length,
    lines: detectLineEndings(text).lines,
    readingSeconds: wordCount === 0 ? 0 : (wordCount / READING_WPM) * 60,
    speakingSeconds: wordCount === 0 ? 0 : (wordCount / SPEAKING_WPM) * 60,
    averageWordLength: wordCount === 0 ? 0 : letters / wordCount,
    averageSentenceLength: wordCount === 0 ? 0 : wordsPerSentence,
    averageSyllables: syllablesPerWord,
    // Kandel & Moles : adaptation française de la formule de Flesch.
    readabilityFr:
      wordCount === 0 ? 0 : clamp(207 - 1.015 * wordsPerSentence - 73.6 * syllablesPerWord),
    readabilityEn:
      wordCount === 0 ? 0 : clamp(206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord),
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

/** Interprétation grand public d'un score de lisibilité. */
export function describeReadability(score: number): string {
  if (score >= 80) return "Très facile à lire";
  if (score >= 60) return "Facile à lire";
  if (score >= 40) return "Assez difficile";
  if (score >= 20) return "Difficile";
  return "Très difficile";
}

/** « 1 min 20 s », « 45 s », « — » pour un texte vide. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}
