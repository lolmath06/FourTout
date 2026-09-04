/**
 * Découpage d'un texte en segments prononçables.
 *
 * La synthèse se fait segment par segment : c'est ce qui permet une
 * progression réelle, une annulation immédiate et une consommation mémoire
 * constante sur un livre entier. La coupure suit donc la langue — paragraphes,
 * puis phrases — et jamais un simple compteur de caractères qui trancherait au
 * milieu d'un mot. Fonction pure, sans dépendance : elle est testable seule.
 */

/** Abréviations après lesquelles un point ne termine pas la phrase. */
const ABBREVIATIONS = new Set([
  // Français
  "m", "mm", "mme", "mlle", "mgr", "dr", "pr", "me", "st", "ste", "av", "bd",
  "cf", "ex", "env", "art", "fig", "éd", "ed", "vol", "chap", "p", "pp", "n",
  "no", "réf", "ref", "etc", "ibid", "op", "trad", "adj", "adv",
  // Anglais
  "mr", "mrs", "ms", "jr", "sr", "prof", "inc", "ltd", "co", "vs", "approx",
  "dept", "est", "fig", "min", "max", "sec", "e.g", "i.e", "al",
]);

const SENTENCE_END = new Set([".", "!", "?", "…", ";"]);

/** Le point qui suit `word` termine-t-il vraiment une phrase ? */
function endsSentence(word: string): boolean {
  const cleaned = word.replace(/[^\p{L}\p{N}.]/gu, "").toLowerCase();
  if (cleaned.length === 0) return true;
  // Une initiale isolée (« J. » de « J. Dupont ») n'est pas une fin de phrase.
  if (cleaned.length === 1) return false;
  return !ABBREVIATIONS.has(cleaned.replace(/\.$/, ""));
}

/**
 * Découpe un paragraphe en phrases. Les ponctuations fortes ferment la phrase
 * quand elles sont suivies d'un blanc et d'un début plausible ; les nombres
 * décimaux et les abréviations courantes sont préservés.
 */
export function splitSentences(paragraph: string): string[] {
  const text = paragraph.trim();
  if (!text) return [];

  const sentences: string[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (!SENTENCE_END.has(char)) continue;

    // Points de suspension : on avance jusqu'au dernier point du groupe.
    let end = i;
    while (end + 1 < text.length && SENTENCE_END.has(text[end + 1])) end += 1;

    const next = text.slice(end + 1);
    // Fin du texte, ou blanc suivi d'autre chose qu'une minuscule collée.
    const followsBlank = next === "" || /^\s/.test(next);
    if (!followsBlank) continue;

    if (char === ".") {
      const before = text.slice(start, i).split(/\s/).pop() ?? "";
      // « 3.14 » : un chiffre de part et d'autre n'est pas une fin de phrase.
      const isDecimal = /\d$/.test(before) && /^\s*\d/.test(next);
      if (isDecimal || !endsSentence(before)) continue;
    }

    const sentence = text.slice(start, end + 1).trim();
    if (sentence) sentences.push(sentence);
    start = end + 1;
  }

  const rest = text.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

/** Découpe une phrase trop longue, en préférant une virgule, sinon un espace. */
function splitLongSentence(sentence: string, maxChars: number): string[] {
  const parts: string[] = [];
  let rest = sentence;

  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const comma = Math.max(window.lastIndexOf(", "), window.lastIndexOf(" — "));
    const space = window.lastIndexOf(" ");
    // Ne jamais couper au milieu d'un mot : à défaut de blanc, on cède.
    const cut = comma > maxChars * 0.4 ? comma + 1 : space > 0 ? space : maxChars;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) parts.push(rest);
  return parts;
}

/** Normalise un texte avant lecture : blancs, guillemets, coupures de ligne. */
export function normalizeForSpeech(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    // Mot coupé en fin de ligne : « exem-\nple » se relit « exemple ».
    .replace(/(\p{Ll})-\n(\p{Ll})/gu, "$1$2")
    // Espaces insécables et fines : à ramener à un espace ordinaire.
    .replace(/[\u00a0\u202f\u2009\u2007]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface SegmentOptions {
  /** Longueur visée d'un segment ; une phrase courte n'est jamais coupée. */
  maxChars?: number;
}

/**
 * Découpe un texte en segments de synthèse : paragraphes, puis phrases,
 * regroupées tant qu'elles tiennent dans `maxChars`.
 */
export function segmentText(text: string, options: SegmentOptions = {}): string[] {
  const maxChars = Math.max(20, options.maxChars ?? 480);
  const normalized = normalizeForSpeech(text);
  if (!normalized) return [];

  const segments: string[] = [];

  for (const paragraph of normalized.split(/\n{2,}/)) {
    // À l'intérieur d'un paragraphe, un retour simple est une continuation.
    const flat = paragraph.replace(/\n/g, " ").trim();
    if (!flat) continue;

    let current = "";
    const flush = () => {
      if (current.trim()) segments.push(current.trim());
      current = "";
    };

    for (const sentence of splitSentences(flat)) {
      if (sentence.length > maxChars) {
        flush();
        segments.push(...splitLongSentence(sentence, maxChars));
        continue;
      }
      if (!current) current = sentence;
      else if (current.length + 1 + sentence.length <= maxChars) current += ` ${sentence}`;
      else {
        flush();
        current = sentence;
      }
    }
    flush();
  }

  return segments;
}

/** Extrait un court aperçu : première phrase, sans dépasser `maxChars`. */
export function previewText(text: string, maxChars = 200): string {
  const paragraph = normalizeForSpeech(text).split(/\n{2,}/)[0]?.replace(/\n/g, " ").trim();
  if (!paragraph) return "";

  const first = splitSentences(paragraph)[0] ?? paragraph;
  if (first.length <= maxChars) return first;

  // Phrase plus longue que l'aperçu : on s'arrête au dernier mot entier.
  const window = first.slice(0, maxChars);
  const cut = window.lastIndexOf(" ");
  return (cut > 0 ? window.slice(0, cut) : window).trim();
}

/** Compteurs affichés sous la zone de saisie. */
export function countText(text: string): { characters: number; words: number } {
  const trimmed = text.trim();
  return {
    characters: text.length,
    words: trimmed ? trimmed.split(/\s+/).length : 0,
  };
}
