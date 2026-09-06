/**
 * Mots de passe : génération et évaluation.
 *
 * Deux règles absolues, tenues par la construction du module :
 *
 *  1. **Le hasard vient de `crypto.getRandomValues`.** `Math.random()` est
 *     prévisible : un générateur de mots de passe qui s'en sert produit des
 *     secrets reconstituables. Si l'API cryptographique manque, on échoue au
 *     lieu de dégrader.
 *  2. **Rien n'est conservé.** Aucun mot de passe généré ou évalué n'est écrit
 *     dans le stockage local, dans les récents, dans un journal ou dans une
 *     notification. Ce module ne fait qu'appeler et rendre des valeurs.
 */

const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!#$%&()*+,-./:;<=>?@[]^_{|}~";
/** Caractères qu'on confond en les lisant ou en les dictant. */
const AMBIGUOUS = new Set("Il1O0o|`'\"{}[]()/\\;:,.<>~^");

export interface GeneratorOptions {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
  /** Écarte les caractères ambigus (I, l, 1, O, 0…). */
  excludeAmbiguous: boolean;
}

export const DEFAULT_OPTIONS: GeneratorOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
};

export const MIN_LENGTH = 6;
export const MAX_LENGTH = 128;
export const MAX_COUNT = 100;

export class PasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordError";
  }
}

function randomValues(count: number): Uint32Array {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new PasswordError(
      "Aucun générateur aléatoire cryptographique n'est disponible : FourTout refuse de " +
        "produire un mot de passe qui serait prévisible.",
    );
  }
  const buffer = new Uint32Array(count);
  cryptoApi.getRandomValues(buffer);
  return buffer;
}

/**
 * Tire un entier uniforme dans `[0, bound)`.
 *
 * Le rejet des valeurs au-delà du plus grand multiple de `bound` évite le biais
 * modulo : sans lui, les premiers caractères de l'alphabet sortiraient un peu
 * plus souvent que les derniers.
 */
function randomBelow(bound: number): number {
  const limit = Math.floor(0x1_0000_0000 / bound) * bound;
  for (;;) {
    const [value] = randomValues(1);
    if (value < limit) return value % bound;
  }
}

export function alphabetFor(options: GeneratorOptions): string {
  let alphabet = "";
  if (options.lowercase) alphabet += LOWERCASE;
  if (options.uppercase) alphabet += UPPERCASE;
  if (options.digits) alphabet += DIGITS;
  if (options.symbols) alphabet += SYMBOLS;
  if (options.excludeAmbiguous) {
    alphabet = [...alphabet].filter((char) => !AMBIGUOUS.has(char)).join("");
  }
  return alphabet;
}

/**
 * Entropie théorique, en bits : `longueur × log2(taille de l'alphabet)`.
 *
 * C'est la borne haute — celle d'un mot de passe réellement tiré au hasard.
 * Elle ne dit rien d'un mot de passe choisi par un humain, d'où l'existence de
 * l'outil d'évaluation à côté.
 */
export function entropyBits(alphabetSize: number, length: number): number {
  if (alphabetSize <= 1 || length <= 0) return 0;
  return Math.log2(alphabetSize) * length;
}

export function generatePassword(options: GeneratorOptions): string {
  const alphabet = alphabetFor(options);
  if (alphabet.length === 0) {
    throw new PasswordError("Aucun type de caractère sélectionné.");
  }
  const length = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.floor(options.length)));

  // Chaque famille cochée doit être présente : sans cela, « symboles activés »
  // ne garantit rien et l'utilisateur se fait refuser son mot de passe par le
  // service auquel il le destine.
  const required: string[] = [];
  const push = (enabled: boolean, source: string) => {
    if (!enabled) return;
    const pool = options.excludeAmbiguous
      ? [...source].filter((char) => !AMBIGUOUS.has(char)).join("")
      : source;
    if (pool.length > 0) required.push(pool[randomBelow(pool.length)]);
  };
  push(options.lowercase, LOWERCASE);
  push(options.uppercase, UPPERCASE);
  push(options.digits, DIGITS);
  push(options.symbols, SYMBOLS);

  const characters = [...required];
  while (characters.length < length) {
    characters.push(alphabet[randomBelow(alphabet.length)]);
  }
  characters.length = length;

  // Mélange de Fisher-Yates, avec la même source d'aléa : sans mélange, les
  // caractères imposés seraient toujours en tête.
  for (let i = characters.length - 1; i > 0; i -= 1) {
    const j = randomBelow(i + 1);
    [characters[i], characters[j]] = [characters[j], characters[i]];
  }
  return characters.join("");
}

export function generatePasswords(options: GeneratorOptions, count: number): string[] {
  const total = Math.min(MAX_COUNT, Math.max(1, Math.floor(count)));
  return Array.from({ length: total }, () => generatePassword(options));
}

/* ------------------------------------------------------------------------ */
/* Phrases secrètes                                                          */
/* ------------------------------------------------------------------------ */

/**
 * Liste de mots embarquée, en français, sans accent ni caractère ambigu.
 *
 * Elle est volontairement courte et lisible plutôt qu'exhaustive : l'entropie
 * annoncée est calculée sur **sa taille réelle**, jamais sur une taille rêvée.
 */
export const WORDLIST: readonly string[] = [
  "abricot", "acier", "agenda", "aigle", "album", "alpage", "ancre", "antenne", "araignee", "arbre",
  "archet", "argile", "armoire", "atelier", "avion", "azur", "balcon", "bambou", "banjo", "barque",
  "bassin", "bateau", "bergerie", "bison", "biscuit", "bocal", "bougie", "boussole", "branche", "brique",
  "brouette", "bruine", "buisson", "bureau", "cabane", "cactus", "cahier", "caillou", "calice", "camion",
  "canard", "canoe", "carafe", "carotte", "casque", "cerise", "chaise", "chalet", "chameau", "chapeau",
  "charbon", "chateau", "cheval", "cigogne", "citron", "clarinette", "clavier", "cloche", "colline", "colombe",
  "comete", "compas", "corail", "corbeau", "cornemuse", "coude", "coupole", "courgette", "crabe", "crayon",
  "cuivre", "cyclone", "dauphin", "diamant", "dinosaure", "dolmen", "domino", "dragon", "drapeau", "ecaille",
  "echelle", "eclair", "ecole", "ecran", "ecureuil", "elephant", "epaule", "epice", "erable", "escalier",
  "etable", "etoile", "falaise", "fanfare", "fauteuil", "fenetre", "fermier", "feuille", "figue", "filet",
  "flacon", "flamant", "flute", "foret", "fourmi", "fraise", "frelon", "fromage", "fusee", "galet",
  "garage", "gazelle", "gelee", "girafe", "glacier", "gobelet", "goeland", "grange", "grenier", "grillon",
  "guitare", "hameau", "harpe", "hibou", "horloge", "iceberg", "ile", "jardin", "jonquille", "jument",
  "kayak", "koala", "lagune", "lanterne", "lavande", "lezard", "lierre", "limace", "lion", "lucarne",
  "lumiere", "lutin", "machine", "magasin", "manteau", "marbre", "marmotte", "melodie", "menthe", "meteore",
  "miel", "mimosa", "moineau", "montagne", "moulin", "mouton", "muraille", "musee", "narval", "navire",
  "nectar", "neige", "nenuphar", "nuage", "ocean", "ombrelle", "orage", "orchidee", "ortie", "otarie",
  "oursin", "paille", "palmier", "panda", "panier", "papillon", "parfum", "passerelle", "pelican", "pendule",
  "phare", "piano", "pigeon", "pinceau", "pirogue", "plage", "planete", "plume", "poisson", "pommier",
  "portail", "poterie", "prairie", "prisme", "puits", "quartz", "radeau", "rafale", "raisin", "rameau",
  "renard", "requin", "riviere", "rocher", "roseau", "rosier", "ruche", "sablier", "safran", "salade",
  "sanglier", "sapin", "sardine", "saumon", "sculpture", "sentier", "serpent", "sirene", "soleil", "sommet",
  "sorbet", "source", "spirale", "squelette", "statue", "sucre", "tambour", "tapis", "taureau", "temple",
  "tempete", "tigre", "tilleul", "tissu", "toiture", "tomate", "torrent", "tortue", "toucan", "tournesol",
  "trefle", "tribune", "tunnel", "vague", "vallon", "vanille", "vautour", "velours", "verger", "vigne",
  "village", "violon", "vipere", "voilier", "volcan", "wagon", "xylophone", "yaourt", "zebre", "zenith",
];

export interface PassphraseOptions {
  words: number;
  separator: string;
  capitalize: boolean;
  /** Ajoute un chiffre à la fin : demandé par beaucoup de formulaires. */
  appendDigit: boolean;
}

export function generatePassphrase(options: PassphraseOptions): string {
  const count = Math.min(12, Math.max(3, Math.floor(options.words)));
  const words = Array.from({ length: count }, () => {
    const word = WORDLIST[randomBelow(WORDLIST.length)];
    return options.capitalize ? word[0].toUpperCase() + word.slice(1) : word;
  });
  const phrase = words.join(options.separator || "-");
  return options.appendDigit ? `${phrase}${randomBelow(10)}` : phrase;
}

/** Entropie d'une phrase : `mots × log2(taille de la liste)`. */
export function passphraseEntropy(words: number, appendDigit: boolean): number {
  return entropyBits(WORDLIST.length, words) + (appendDigit ? Math.log2(10) : 0);
}

/**
 * Traduction de l'entropie en durée d'attaque hors ligne.
 *
 * L'hypothèse est explicite et volontairement pessimiste : dix milliards
 * d'essais par seconde, ce qu'un attaquant motivé obtient sur du matériel
 * grand public contre un hachage rapide. Donner une durée sans dire l'hypothèse
 * qui la produit ne veut rien dire.
 */
export const GUESSES_PER_SECOND = 1e10;

export function crackTime(entropy: number): string {
  const seconds = 2 ** (entropy - 1) / GUESSES_PER_SECOND;
  return humanDuration(seconds);
}

export function humanDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "au-delà de toute échelle";
  if (seconds < 1) return "moins d'une seconde";
  const units: [number, string, string][] = [
    [60, "seconde", "secondes"],
    [60, "minute", "minutes"],
    [24, "heure", "heures"],
    [365.25, "jour", "jours"],
    [1000, "an", "ans"],
    [1000, "millénaire", "millénaires"],
  ];
  let value = seconds;
  for (const [step, singular, plural] of units) {
    if (value < step) {
      const rounded = Math.round(value);
      return `${rounded.toLocaleString("fr-FR")} ${rounded > 1 ? plural : singular}`;
    }
    value /= step;
  }
  return `${Math.round(value).toLocaleString("fr-FR")} millions de millénaires`;
}

/* ------------------------------------------------------------------------ */
/* Évaluation                                                                */
/* ------------------------------------------------------------------------ */

export interface StrengthResult {
  /** 0 (très faible) à 4 (très robuste), échelle de zxcvbn. */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** Estimation de l'attaquant hors ligne, en essais. */
  guesses: number;
  crackTime: string;
  /** Ce qui affaiblit ce mot de passe, en français. */
  warnings: string[];
  suggestions: string[];
  /** Motifs reconnus : mot du dictionnaire, date, suite de touches… */
  patterns: string[];
  length: number;
}

const SCORE_LABELS: Record<number, string> = {
  0: "Très faible",
  1: "Faible",
  2: "Moyen",
  3: "Robuste",
  4: "Très robuste",
};

let zxcvbnReady: Promise<(password: string) => unknown> | undefined;

/**
 * Charge zxcvbn à la demande, avec ses dictionnaires français **et** anglais :
 * un mot de passe français bâti sur un mot anglais courant est tout aussi
 * faible, et l'inverse est vrai.
 */
async function loadZxcvbn() {
  if (!zxcvbnReady) {
    zxcvbnReady = (async () => {
      const [core, common, french] = await Promise.all([
        import("@zxcvbn-ts/core"),
        import("@zxcvbn-ts/language-common"),
        import("@zxcvbn-ts/language-fr"),
      ]);
      const engine = new core.ZxcvbnFactory({
        dictionary: { ...common.dictionary, ...french.dictionary },
        graphs: common.adjacencyGraphs,
        translations: french.translations,
      });
      return (password: string) => engine.check(password);
    })();
  }
  return zxcvbnReady;
}

interface ZxcvbnLike {
  score: number;
  guesses: number;
  feedback: { warning?: string | null; suggestions?: string[] };
  sequence?: { pattern?: string; token?: string; dictionaryName?: string }[];
}

const PATTERN_LABELS: Record<string, string> = {
  dictionary: "mot d'un dictionnaire",
  spatial: "suite de touches du clavier",
  repeat: "répétition",
  sequence: "suite de caractères",
  regex: "motif reconnaissable",
  date: "date",
  bruteforce: "caractères sans motif",
};

/**
 * Évalue un mot de passe **entièrement en local**.
 *
 * Le mot de passe ne quitte jamais la machine, n'est pas haché contre une base
 * de fuites en ligne, et n'est écrit nulle part. Le score est une estimation :
 * il ne remplace pas une réflexion sur ce que le mot de passe protège.
 */
export async function evaluatePassword(password: string): Promise<StrengthResult> {
  if (password.length === 0) {
    throw new PasswordError("Aucun mot de passe à évaluer.");
  }
  const zxcvbn = await loadZxcvbn();
  const result = zxcvbn(password) as ZxcvbnLike;

  const warnings: string[] = [];
  if (result.feedback.warning) warnings.push(result.feedback.warning);
  if (password.length < 12) {
    warnings.push("Moins de 12 caractères : c'est court pour un mot de passe important.");
  }

  const patterns = (result.sequence ?? [])
    .filter((part) => part.pattern && part.pattern !== "bruteforce")
    .map((part) => {
      const label = PATTERN_LABELS[part.pattern ?? ""] ?? part.pattern ?? "";
      const source = part.dictionaryName ? ` (${part.dictionaryName})` : "";
      return `« ${part.token ?? ""} » — ${label}${source}`;
    });

  return {
    score: Math.min(4, Math.max(0, result.score)) as 0 | 1 | 2 | 3 | 4,
    label: SCORE_LABELS[result.score] ?? "Inconnu",
    guesses: result.guesses,
    crackTime: humanDuration(result.guesses / GUESSES_PER_SECOND),
    warnings,
    suggestions: result.feedback.suggestions ?? [],
    patterns,
    length: password.length,
  };
}

export const STRENGTH_NOTE =
  "L'évaluation se fait entièrement sur cet appareil : le mot de passe n'est ni envoyé, ni " +
  "haché contre une base en ligne, ni conservé. Un score élevé n'est pas une garantie : il dit " +
  "seulement qu'aucun motif courant n'a été reconnu.";
