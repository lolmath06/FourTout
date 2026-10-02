/**
 * Connaissances linguistiques de la recherche : mots vides et connecteurs de
 * conversion, pour chaque langue de FourTout.
 *
 * Elles sont **réunies** plutôt que choisies selon la langue affichée : une
 * requête anglaise tapée dans une interface en allemand doit être lue aussi
 * bien qu'une requête allemande. Les listes ne retiennent donc que des mots
 * qui ne portent aucune information de recherche dans aucune des langues —
 * articles, pronoms, prépositions, verbes de demande (« je veux », « how to »).
 *
 * Les valeurs sont écrites telles qu'on les tape ; elles sont normalisées
 * (minuscules, sans accents) au chargement.
 */

const STOP_WORDS_BY_LANGUAGE: Record<string, string[]> = {
  fr: [
    "je", "j", "tu", "il", "elle", "on", "nous", "vous", "ils", "veux", "voudrais",
    "aimerais", "souhaite", "besoin", "comment", "faire", "fait", "pour", "avec",
    "sur", "dans", "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses",
    "le", "la", "les", "un", "une", "des", "du", "de", "d", "l", "et", "ou", "au",
    "aux", "ce", "cet", "cette", "ces", "qui", "que", "quoi", "est", "sont", "se",
    "ne", "pas", "y", "en", "vers", "a",
  ],
  en: [
    "the", "my", "i", "want", "to", "into", "from", "of", "please", "s", "a", "an",
    "and", "or", "how", "do", "can", "need", "with", "for", "on", "in", "me", "it",
    "this", "that", "some", "your",
  ],
  es: [
    "el", "los", "las", "una", "unos", "unas", "del", "al", "mi", "mis", "tu", "su",
    "quiero", "necesito", "como", "cómo", "para", "con", "por", "en", "y", "o", "que",
    "qué", "hacer", "puedo", "un",
  ],
  pt: [
    "o", "os", "as", "um", "uma", "uns", "umas", "do", "da", "dos", "das", "no", "na",
    "meu", "minha", "quero", "preciso", "como", "para", "com", "por", "em", "e", "que",
    "fazer", "posso",
  ],
  de: [
    "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer",
    "ich", "mein", "meine", "meinen", "will", "möchte", "wie", "mit", "für", "von",
    "zu", "und", "oder", "kann", "machen", "bitte", "im", "am",
  ],
  it: [
    "il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "del", "della", "dei",
    "delle", "di", "da", "per", "con", "su", "voglio", "vorrei", "come", "fare", "mio",
    "mia", "miei", "e", "o", "che",
  ],
  nl: [
    "de", "het", "een", "ik", "wil", "mijn", "hoe", "met", "voor", "van", "en", "of",
    "naar", "kan", "maken", "graag",
  ],
  pl: [
    "chcę", "chce", "jak", "mój", "moja", "moje", "z", "ze", "do", "na", "w", "i",
    "lub", "dla", "się", "mogę", "zrobić",
  ],
  ru: [
    "я", "хочу", "мне", "нужно", "как", "мой", "моя", "мои", "с", "в", "во", "на",
    "из", "для", "и", "или", "это", "сделать",
  ],
  tr: ["bir", "ve", "veya", "için", "ile", "nasıl", "istiyorum", "benim", "bu", "şu"],
  id: [
    "saya", "ingin", "mau", "cara", "yang", "dan", "atau", "dari", "ke", "untuk",
    "dengan", "di", "sebuah", "bagaimana",
  ],
  hi: [
    "मैं", "मुझे", "को", "में", "से", "का", "की", "के", "है", "हैं", "करें", "करना",
    "कैसे", "एक", "और", "या", "चाहता", "चाहती",
  ],
  ja: [
    "を", "に", "へ", "の", "で", "と", "が", "は", "から", "まで", "する", "します",
    "したい", "して", "ください", "たい", "方法",
  ],
  ko: [
    "를", "을", "이", "가", "은", "는", "의", "에", "로", "으로", "에서", "하기", "하다",
    "하고", "싶어요", "방법",
  ],
  zh: ["把", "将", "的", "我", "要", "想", "如何", "怎么", "一个", "和", "或", "帮我"],
};

/**
 * Connecteurs d'une conversion dirigée (« gif en vidéo », « gif to video »,
 * « gif zu video », « gif 转 mp4 »).
 */
const DIRECTION_WORDS_BY_LANGUAGE: Record<string, string[]> = {
  fr: ["en", "vers"],
  en: ["to", "into"],
  es: ["a", "en"],
  pt: ["para", "em"],
  de: ["zu", "in", "nach"],
  it: ["in", "a"],
  nl: ["naar", "in"],
  pl: ["na", "do"],
  ru: ["в", "во"],
  tr: [],
  id: ["ke", "menjadi"],
  hi: ["में"],
  ja: ["に", "へ"],
  ko: ["로", "으로"],
  zh: ["转", "转为", "转换为", "到", "成", "为"],
  symbols: ["->", "→"],
};

/** Normalisation commune à la requête et à l'index. */
export function normalizeText(input: string): string {
  const cleaned = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Le coréen se décompose en jamo sous NFD : on recompose.
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ");
  return splitScripts(cleaned).replace(/\s+/g, " ").trim();
}

const SCRIPTS: [string, RegExp][] = [
  ["latin", /[\p{Script=Latin}\p{N}]/u],
  ["han", /\p{Script=Han}/u],
  ["hiragana", /\p{Script=Hiragana}/u],
  ["katakana", /[\p{Script=Katakana}ー]/u],
  ["hangul", /\p{Script=Hangul}/u],
  ["cyrillic", /\p{Script=Cyrillic}/u],
  ["devanagari", /[\p{Script=Devanagari}]/u],
];

function scriptOf(char: string): string | undefined {
  return SCRIPTS.find(([, pattern]) => pattern.test(char))?.[0];
}

/**
 * Les écritures sans espaces collent les mots d'écritures différentes :
 * « pdfを圧縮 » devient « pdf を 圧縮 ». Les marques combinantes (matras du
 * hindi) restent attachées à leur lettre.
 */
function splitScripts(input: string): string {
  let out = "";
  let previous: string | undefined;
  for (const char of input) {
    if (char === " ") {
      out += char;
      previous = undefined;
      continue;
    }
    const script = /\p{M}/u.test(char) ? previous : scriptOf(char);
    if (previous && script && script !== previous) out += " ";
    out += char;
    if (script) previous = script;
  }
  return out;
}

/** Vrai pour les écritures où un mot tient en deux caractères. */
export function isCompactScript(token: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(token);
}

function normalizeList(words: string[]): string[] {
  return words.flatMap((word) => normalizeText(word).split(" ")).filter(Boolean);
}

export const STOP_WORDS: ReadonlySet<string> = new Set(
  Object.values(STOP_WORDS_BY_LANGUAGE).flatMap(normalizeList),
);

export const DIRECTION_WORDS: ReadonlySet<string> = new Set([
  ...Object.values(DIRECTION_WORDS_BY_LANGUAGE)
    .flat()
    .filter((word) => /\p{L}/u.test(word))
    .flatMap((word) => normalizeList([word])),
  "->",
  "→",
]);
