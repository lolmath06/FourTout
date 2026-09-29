import { convertLineEndings, detectLineEndings, type Eol, type LineEndingReport } from "./lines";
import { TextError } from "./errors";

/**
 * Détection et conversion d'encodage de fichiers texte.
 *
 * Deux partis pris structurent ce module.
 *
 * **L'honnêteté d'abord.** Sauf marque d'ordre des octets (BOM), aucun fichier
 * ne dit son encodage : il n'y a que des indices. La détection renvoie donc
 * toujours une certitude — et l'interface affiche cette certitude, plutôt que
 * d'annoncer « Windows-1252 » d'un ton assuré sur un fichier qui pourrait tout
 * aussi bien être du Latin-1.
 *
 * **Aucune perte silencieuse.** Convertir vers un encodage plus étroit peut
 * rendre certains caractères impossibles à écrire. Ils sont alors listés,
 * position par position, et la conversion échoue par défaut : c'est à
 * l'utilisateur de décider s'il accepte de les remplacer.
 *
 * Les tables Latin-1 et Windows-1252 sont écrites ici plutôt que déléguées à
 * `TextDecoder` : la norme du Web fait de `iso-8859-1` un simple alias de
 * `windows-1252`, si bien qu'un décodeur du système ne saurait pas distinguer
 * les deux — exactement ce que cet outil doit savoir faire.
 */

/* --------------------------------------------------------------- encodages */

export type TextEncodingId =
  | "utf-8"
  | "utf-8-bom"
  | "utf-16le"
  | "utf-16be"
  | "windows-1252"
  | "iso-8859-1";

export const ENCODING_LABELS: Record<TextEncodingId, string> = {
  "utf-8": "UTF-8",
  "utf-8-bom": "UTF-8 avec BOM",
  "utf-16le": "UTF-16 LE",
  "utf-16be": "UTF-16 BE",
  "windows-1252": "Windows-1252",
  "iso-8859-1": "ISO-8859-1 (Latin-1)",
};

/** Encodages proposés en entrée comme en sortie. */
export const ENCODINGS: TextEncodingId[] = [
  "utf-8",
  "utf-8-bom",
  "utf-16le",
  "utf-16be",
  "windows-1252",
  "iso-8859-1",
];

export type BomKind = "none" | "utf-8" | "utf-16le" | "utf-16be";

/* ------------------------------------------------------------------ tables */

/**
 * Windows-1252 ne diffère de Latin-1 que sur la plage 0x80–0x9F, où Latin-1
 * place des codes de contrôle et Windows-1252 des signes typographiques. C'est
 * la seule zone qui permet de départager les deux — et la seule qui provoque
 * des « caractères bizarres » quand on se trompe.
 */
const CP1252_HIGH: (number | undefined)[] = [
  0x20ac, undefined, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, undefined, 0x017d, undefined,
  undefined, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, undefined, 0x017e, 0x0178,
];

/** Table octet → point de code, pour un encodage sur un seul octet. */
function singleByteTable(id: "windows-1252" | "iso-8859-1"): (number | undefined)[] {
  const table: (number | undefined)[] = [];
  for (let byte = 0; byte < 256; byte += 1) {
    if (id === "windows-1252" && byte >= 0x80 && byte <= 0x9f) {
      table.push(CP1252_HIGH[byte - 0x80]);
    } else {
      table.push(byte);
    }
  }
  return table;
}

const DECODE_TABLES: Record<"windows-1252" | "iso-8859-1", (number | undefined)[]> = {
  "windows-1252": singleByteTable("windows-1252"),
  "iso-8859-1": singleByteTable("iso-8859-1"),
};

const ENCODE_TABLES: Record<"windows-1252" | "iso-8859-1", Map<number, number>> = {
  "windows-1252": reverseTable(DECODE_TABLES["windows-1252"]),
  "iso-8859-1": reverseTable(DECODE_TABLES["iso-8859-1"]),
};

function reverseTable(table: (number | undefined)[]): Map<number, number> {
  const map = new Map<number, number>();
  table.forEach((codePoint, byte) => {
    if (codePoint !== undefined) map.set(codePoint, byte);
  });
  return map;
}

/* ------------------------------------------------------------------ décodage */

/** BOM présent en tête, le cas échéant. */
export function detectBom(bytes: Uint8Array): BomKind {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return "utf-8";
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return "none";
}

const BOM_LENGTH: Record<BomKind, number> = {
  none: 0,
  "utf-8": 3,
  "utf-16le": 2,
  "utf-16be": 2,
};

/**
 * Le contenu est-il de l'UTF-8 valide ? Renvoie aussi le nombre de séquences
 * multi-octets rencontrées : un fichier purement ASCII est trivialement de
 * l'UTF-8 valide, mais ne prouve rien.
 */
export function inspectUtf8(bytes: Uint8Array): { valid: boolean; multiByte: number } {
  let multiByte = 0;
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index];
    if (byte < 0x80) {
      index += 1;
      continue;
    }
    let extra: number;
    let codePoint: number;
    if (byte >= 0xc2 && byte <= 0xdf) {
      extra = 1;
      codePoint = byte & 0x1f;
    } else if (byte >= 0xe0 && byte <= 0xef) {
      extra = 2;
      codePoint = byte & 0x0f;
    } else if (byte >= 0xf0 && byte <= 0xf4) {
      extra = 3;
      codePoint = byte & 0x07;
    } else {
      return { valid: false, multiByte };
    }
    if (index + extra >= bytes.length) return { valid: false, multiByte };
    for (let step = 1; step <= extra; step += 1) {
      const continuation = bytes[index + step];
      if ((continuation & 0xc0) !== 0x80) return { valid: false, multiByte };
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }
    // Surrogates et surlongueurs : de l'UTF-8 mal formé, pas de l'UTF-8.
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return { valid: false, multiByte };
    if (codePoint > 0x10ffff) return { valid: false, multiByte };
    if (extra === 2 && codePoint < 0x800) return { valid: false, multiByte };
    if (extra === 3 && codePoint < 0x10000) return { valid: false, multiByte };
    multiByte += 1;
    index += extra + 1;
  }
  return { valid: true, multiByte };
}

function decodeSingleByte(bytes: Uint8Array, id: "windows-1252" | "iso-8859-1"): string {
  const table = DECODE_TABLES[id];
  let out = "";
  for (let index = 0; index < bytes.length; index += 1) {
    const codePoint = table[bytes[index]];
    // Un octet non affecté (Windows-1252 en compte cinq) devient le caractère
    // de remplacement : le fichier reste lisible, la perte reste visible.
    out += String.fromCodePoint(codePoint ?? 0xfffd);
  }
  return out;
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  // Un octet orphelin en fin de fichier ne peut former aucune unité : on le
  // laisse de côté plutôt que de fabriquer un caractère.
  const units = Math.floor(bytes.length / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, units * 2);
  let out = "";
  // Par morceaux : `String.fromCharCode(...tableau)` sature la pile d'appels
  // au-delà de quelques dizaines de milliers d'unités.
  const CHUNK = 8192;
  for (let start = 0; start < units; start += CHUNK) {
    const codes: number[] = [];
    for (let index = start; index < Math.min(start + CHUNK, units); index += 1) {
      codes.push(view.getUint16(index * 2, littleEndian));
    }
    out += String.fromCharCode(...codes);
  }
  return out;
}

/**
 * Décode des octets dans l'encodage demandé. Le BOM éventuel est retiré : il
 * décrit le fichier, il ne fait pas partie de son texte.
 */
export function decodeText(bytes: Uint8Array, encoding: TextEncodingId): string {
  switch (encoding) {
    case "utf-8":
    case "utf-8-bom": {
      const start = detectBom(bytes) === "utf-8" ? 3 : 0;
      return new TextDecoder("utf-8").decode(bytes.subarray(start));
    }
    case "utf-16le":
      return decodeUtf16(bytes.subarray(detectBom(bytes) === "utf-16le" ? 2 : 0), true);
    case "utf-16be":
      return decodeUtf16(bytes.subarray(detectBom(bytes) === "utf-16be" ? 2 : 0), false);
    case "windows-1252":
    case "iso-8859-1":
      return decodeSingleByte(bytes, encoding);
  }
}

/* ------------------------------------------------------------------ détection */

export interface EncodingCandidate {
  encoding: TextEncodingId;
  /** Vraisemblance de 0 à 1. */
  confidence: number;
}

export interface EncodingDetection {
  encoding: TextEncodingId;
  /** Vraisemblance de 0 à 1 du choix retenu. */
  confidence: number;
  /**
   * Vrai uniquement lorsque le fichier **dit** son encodage (BOM). Partout
   * ailleurs, la détection reste une hypothèse, et l'interface doit le montrer.
   */
  certain: boolean;
  bom: BomKind;
  /** Convention de fin de ligne du texte décodé. */
  newline: LineEndingReport;
  /** Explication en français de ce qui a emporté la décision. */
  reason: string;
  /** Autres hypothèses plausibles, de la plus à la moins probable. */
  alternatives: EncodingCandidate[];
  /** Le contenu ressemble-t-il à un fichier binaire plutôt qu'à du texte ? */
  binary: boolean;
  /** Le texte tel que décodé avec l'encodage retenu. */
  text: string;
  byteLength: number;
}

/**
 * Part d'octets de contrôle — hors tabulation, saut de ligne, retour chariot et
 * saut de page, les seuls qu'un fichier texte emploie légitimement.
 *
 * C'est le test qui sépare réellement un fichier texte d'un fichier binaire :
 * un exécutable, une image ou une archive en sont truffés, un texte n'en
 * contient aucun. Compter les seuls octets nuls ne suffirait pas — un PNG, dont
 * les données sont compressées, en contient très peu.
 */
function controlByteRatio(bytes: Uint8Array): number {
  const limit = Math.min(bytes.length, 65536);
  if (limit === 0) return 0;
  let control = 0;
  for (let index = 0; index < limit; index += 1) {
    const byte = bytes[index];
    const printable =
      byte >= 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x0c;
    if (!printable || byte === 0x7f) control += 1;
  }
  return control / limit;
}

/** Part d'octets nuls, indice principal d'un UTF-16 sans BOM ou d'un binaire. */
function nulStatistics(bytes: Uint8Array): { evenNuls: number; oddNuls: number; total: number } {
  const limit = Math.min(bytes.length, 65536);
  let evenNuls = 0;
  let oddNuls = 0;
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0) {
      if (index % 2 === 0) evenNuls += 1;
      else oddNuls += 1;
    }
  }
  return { evenNuls, oddNuls, total: limit };
}

/**
 * Détecte l'encodage d'un fichier texte.
 *
 * L'ordre des tests suit la force des indices : ce que le fichier déclare, puis
 * ce que sa structure impose, puis seulement ce que son contenu suggère.
 */
export function detectEncoding(bytes: Uint8Array): EncodingDetection {
  const byteLength = bytes.length;
  const finish = (
    encoding: TextEncodingId,
    confidence: number,
    certain: boolean,
    reason: string,
    alternatives: EncodingCandidate[] = [],
    binary = false,
  ): EncodingDetection => {
    const text = decodeText(bytes, encoding);
    return {
      encoding,
      confidence,
      certain,
      bom: detectBom(bytes),
      newline: detectLineEndings(text),
      reason,
      alternatives,
      binary,
      text,
      byteLength,
    };
  };

  if (byteLength === 0) {
    return finish("utf-8", 1, false, "Le fichier est vide : tout encodage convient.");
  }

  const bom = detectBom(bytes);
  if (bom === "utf-8") {
    return finish("utf-8-bom", 1, true, "Le fichier commence par un BOM UTF-8 (EF BB BF).");
  }
  if (bom === "utf-16le") {
    return finish("utf-16le", 1, true, "Le fichier commence par un BOM UTF-16 petit-boutien (FF FE).");
  }
  if (bom === "utf-16be") {
    return finish("utf-16be", 1, true, "Le fichier commence par un BOM UTF-16 grand-boutien (FE FF).");
  }

  const body = bytes.subarray(BOM_LENGTH[bom]);
  const { evenNuls, oddNuls, total } = nulStatistics(body);
  const nulRatio = (evenNuls + oddNuls) / Math.max(1, total);

  // Du texte latin en UTF-16 sans BOM : un octet sur deux est nul, toujours du
  // même côté. C'est un motif trop régulier pour être fortuit.
  if (total >= 4 && nulRatio > 0.2) {
    if (oddNuls > evenNuls * 4) {
      return finish(
        "utf-16le",
        0.85,
        false,
        "Un octet sur deux est nul, en position impaire : motif caractéristique de l'UTF-16 petit-boutien sans BOM.",
        [{ encoding: "utf-16be", confidence: 0.1 }],
      );
    }
    if (evenNuls > oddNuls * 4) {
      return finish(
        "utf-16be",
        0.85,
        false,
        "Un octet sur deux est nul, en position paire : motif caractéristique de l'UTF-16 grand-boutien sans BOM.",
        [{ encoding: "utf-16le", confidence: 0.1 }],
      );
    }
    // Des octets nuls sans régularité : ce n'est pas du texte.
    return finish(
      "utf-8",
      0.1,
      false,
      "Le fichier contient des octets nuls dispersés : il ne ressemble pas à un fichier texte.",
      [],
      true,
    );
  }

  // Au-delà de 5 % d'octets de contrôle, aucun encodage de texte ne rendra ce
  // fichier lisible : mieux vaut le dire que d'en proposer une conversion.
  if (controlByteRatio(body) > 0.05) {
    return finish(
      "utf-8",
      0.1,
      false,
      "Le fichier contient une forte proportion d'octets de contrôle : il ne ressemble pas à un fichier texte.",
      [],
      true,
    );
  }

  const utf8 = inspectUtf8(body);
  if (utf8.valid && utf8.multiByte > 0) {
    return finish(
      "utf-8",
      0.95,
      false,
      `Le fichier contient ${utf8.multiByte} séquence(s) UTF-8 multi-octets, toutes valides.`,
      [],
    );
  }
  if (utf8.valid) {
    // Pur ASCII : compatible avec absolument tous les encodages de la liste.
    return finish(
      "utf-8",
      0.6,
      false,
      "Le fichier ne contient que des caractères ASCII : UTF-8, Windows-1252 et Latin-1 donneraient le même texte.",
      [
        { encoding: "windows-1252", confidence: 0.6 },
        { encoding: "iso-8859-1", confidence: 0.6 },
      ],
    );
  }

  // Reste un encodage sur un octet. Seule la plage 0x80–0x9F les distingue.
  let cp1252Only = 0;
  for (const byte of body) {
    if (byte >= 0x80 && byte <= 0x9f) cp1252Only += 1;
  }
  if (cp1252Only > 0) {
    return finish(
      "windows-1252",
      0.75,
      false,
      `Le fichier n'est pas de l'UTF-8 valide et emploie ${cp1252Only} octet(s) de la plage 0x80–0x9F, où Latin-1 ne place que des codes de contrôle.`,
      [{ encoding: "iso-8859-1", confidence: 0.25 }],
    );
  }
  return finish(
    "windows-1252",
    0.55,
    false,
    "Le fichier n'est pas de l'UTF-8 valide. Aucun octet de la plage 0x80–0x9F : Windows-1252 et Latin-1 produisent ici exactement le même texte.",
    [{ encoding: "iso-8859-1", confidence: 0.55 }],
  );
}

/* ----------------------------------------------------------------- encodage */

/** Un caractère que l'encodage de destination ne sait pas écrire. */
export interface UnrepresentableCharacter {
  character: string;
  codePoint: number;
  /** Indice du caractère dans le texte. */
  index: number;
  /** Numéro de ligne, base 1, pour retrouver l'endroit dans le fichier. */
  line: number;
  count: number;
}

export interface EncodeTextResult {
  bytes: Uint8Array;
  /** Caractères impossibles à écrire, regroupés par caractère. */
  unrepresentable: UnrepresentableCharacter[];
}

export interface EncodeTextOptions {
  /**
   * Caractère de remplacement pour ce que la destination ne sait pas écrire.
   * Sans lui, la présence d'un seul caractère impossible fait échouer
   * l'encodage : rien n'est remplacé dans le dos de l'utilisateur.
   */
  replacement?: string;
}

function encodeUtf16(text: string, littleEndian: boolean, bom: boolean): Uint8Array {
  const units: number[] = [];
  for (let index = 0; index < text.length; index += 1) units.push(text.charCodeAt(index));
  const bytes = new Uint8Array((units.length + (bom ? 1 : 0)) * 2);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  if (bom) {
    view.setUint16(0, 0xfeff, littleEndian);
    offset = 2;
  }
  units.forEach((unit, index) => view.setUint16(offset + index * 2, unit, littleEndian));
  return bytes;
}

/**
 * Encode un texte, en signalant tout ce qui ne peut pas l'être.
 *
 * Ne lève jamais : c'est l'appelant qui décide quoi faire des caractères
 * impossibles. `writeText` applique la règle du produit — refuser par défaut.
 */
export function encodeText(
  text: string,
  encoding: TextEncodingId,
  options: EncodeTextOptions = {},
): EncodeTextResult {
  if (encoding === "utf-8" || encoding === "utf-8-bom") {
    // L'UTF-8 sait tout écrire : aucun caractère ne peut être perdu.
    const body = new TextEncoder().encode(text);
    if (encoding === "utf-8") return { bytes: body, unrepresentable: [] };
    const bytes = new Uint8Array(body.length + 3);
    bytes.set([0xef, 0xbb, 0xbf], 0);
    bytes.set(body, 3);
    return { bytes, unrepresentable: [] };
  }

  if (encoding === "utf-16le" || encoding === "utf-16be") {
    // L'UTF-16 aussi : les caractères hors du plan de base sont écrits en
    // paires de substitution, ce que fait déjà la représentation JavaScript.
    return {
      bytes: encodeUtf16(text, encoding === "utf-16le", true),
      unrepresentable: [],
    };
  }

  const table = ENCODE_TABLES[encoding];
  const out: number[] = [];
  const problems = new Map<string, UnrepresentableCharacter>();
  let line = 1;
  let index = 0;

  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    const byte = table.get(codePoint);
    if (byte !== undefined) {
      out.push(byte);
    } else {
      const existing = problems.get(character);
      if (existing) existing.count += 1;
      else problems.set(character, { character, codePoint, index, line, count: 1 });
      if (options.replacement !== undefined) {
        for (const replacementChar of options.replacement) {
          out.push(table.get(replacementChar.codePointAt(0) ?? 0x3f) ?? 0x3f);
        }
      }
    }
    if (character === "\n") line += 1;
    index += character.length;
  }

  return { bytes: new Uint8Array(out), unrepresentable: [...problems.values()] };
}

/* -------------------------------------------------------------- conversion */

export interface EncodingConversionOptions {
  /** Encodage source, ou `"auto"` pour laisser la détection décider. */
  from: TextEncodingId | "auto";
  to: TextEncodingId;
  /** Réécrit les fins de ligne ; celles du fichier sont conservées sinon. */
  newline?: Eol | "keep";
  /**
   * Autorise explicitement le remplacement des caractères que la destination ne
   * sait pas écrire. Faux par défaut : la conversion échoue alors, ce qui est
   * le comportement sûr.
   */
  replaceUnrepresentable?: boolean;
  /** Caractère de remplacement, si celui-ci est autorisé. */
  replacement?: string;
}

export interface EncodingConversionResult {
  bytes: Uint8Array;
  /** Encodage réellement lu (utile lorsque la source était « auto »). */
  from: TextEncodingId;
  to: TextEncodingId;
  detection: EncodingDetection;
  /** Caractères remplacés, si le remplacement a été autorisé. */
  replaced: UnrepresentableCharacter[];
  characters: number;
}

/**
 * Convertit le contenu d'un fichier texte d'un encodage vers un autre.
 *
 * Lève une `TextError` `encoding-unrepresentable` si la destination ne peut pas
 * écrire certains caractères et que le remplacement n'a pas été explicitement
 * demandé.
 */
export function convertEncoding(
  bytes: Uint8Array,
  options: EncodingConversionOptions,
): EncodingConversionResult {
  const detection = detectEncoding(bytes);
  const from = options.from === "auto" ? detection.encoding : options.from;

  if (options.from === "auto" && detection.binary) {
    throw new TextError(
      "encoding-unreadable",
      "Ce fichier contient des octets nuls dispersés : ce n'est pas un fichier texte.",
    );
  }

  const decoded = decodeText(bytes, from);
  const text =
    options.newline && options.newline !== "keep"
      ? // Réutilise le moteur de fins de ligne de l'application : il n'y en a
        // qu'un, et c'est celui de l'outil « Convertir les fins de ligne ».
        convertLineEndings(decoded, options.newline)
      : decoded;

  const probe = encodeText(text, options.to);
  if (probe.unrepresentable.length > 0 && !options.replaceUnrepresentable) {
    const preview = probe.unrepresentable
      .slice(0, 5)
      .map((item) => `« ${item.character} » (U+${item.codePoint.toString(16).toUpperCase().padStart(4, "0")}, ligne ${item.line})`)
      .join(", ");
    throw new TextError(
      "encoding-unrepresentable",
      `${probe.unrepresentable.length} caractère(s) ne peuvent pas être écrits en ${ENCODING_LABELS[options.to]} : ${preview}.`,
    );
  }

  const final = probe.unrepresentable.length
    ? encodeText(text, options.to, { replacement: options.replacement ?? "?" })
    : probe;

  return {
    bytes: final.bytes,
    from,
    to: options.to,
    detection,
    replaced: final.unrepresentable,
    characters: [...text].length,
  };
}
