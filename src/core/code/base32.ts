/**
 * Base32, RFC 4648.
 *
 * Base32 existe pour les endroits où le Base64 ne passe pas : un alphabet de
 * 32 caractères sans minuscules, sans `+` ni `/`, qui survit à une URL, à un
 * nom de fichier, à une dictée au téléphone et à un lecteur de code-barres.
 * C'est l'encodage des secrets TOTP et des adresses onion.
 *
 * Le prix à payer est un rendement moindre : 8 caractères pour 5 octets, donc
 * un texte 60 % plus long, là où le Base64 n'ajoute que 33 %.
 *
 * Deux alphabets seulement, ceux que la RFC 4648 définit — le standard et sa
 * variante hexadécimale étendue, qui a la propriété de trier dans le même ordre
 * que les octets qu'elle encode. Les dialectes maison (Crockford, z-base-32)
 * ne sont pas des variantes : ce sont d'autres encodages, et les proposer ici
 * ferait croire qu'un décodeur RFC 4648 saura les lire.
 */

export type Base32Alphabet = "rfc4648" | "rfc4648-hex";

const ALPHABETS: Record<Base32Alphabet, string> = {
  rfc4648: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
  "rfc4648-hex": "0123456789ABCDEFGHIJKLMNOPQRSTUV",
};

export const BASE32_ALPHABET_LABELS: Record<Base32Alphabet, string> = {
  rfc4648: "Standard (A–Z, 2–7)",
  "rfc4648-hex": "Hexadécimal étendu (0–9, A–V)",
};

export class Base32Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Base32Error";
  }
}

export interface Base32EncodeOptions {
  alphabet?: Base32Alphabet;
  /**
   * Complète le dernier bloc avec des `=` jusqu'à un multiple de 8 caractères.
   * Actif par défaut : c'est ce que la RFC impose et ce qu'attendent la
   * plupart des décodeurs.
   */
  padding?: boolean;
}

export interface Base32DecodeOptions {
  alphabet?: Base32Alphabet;
  /**
   * Ignore espaces, tabulations et retours à la ligne. Actif par défaut : un
   * Base32 recopié depuis un terminal ou un courriel arrive presque toujours
   * coupé en lignes.
   */
  ignoreWhitespace?: boolean;
}

/** Encode des octets en Base32. */
export function encodeBase32(bytes: Uint8Array, options: Base32EncodeOptions = {}): string {
  const alphabet = ALPHABETS[options.alphabet ?? "rfc4648"];
  const padding = options.padding ?? true;

  let output = "";
  // Accumulateur de bits : on lit par octets de 8 bits, on écrit par blocs de 5.
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) {
    // Les bits restants sont complétés par des zéros à droite.
    output += alphabet[(buffer << (5 - bits)) & 31];
  }
  if (padding) {
    while (output.length % 8 !== 0) output += "=";
  }
  return output;
}

/** Décode du Base32 en octets. */
export function decodeBase32(input: string, options: Base32DecodeOptions = {}): Uint8Array {
  const alphabet = ALPHABETS[options.alphabet ?? "rfc4648"];
  const ignoreWhitespace = options.ignoreWhitespace ?? true;

  let cleaned = ignoreWhitespace ? input.replace(/\s+/g, "") : input;
  // Le padding ne porte aucune information : il n'est là que pour aligner sur
  // 8 caractères. On le retire après avoir vérifié qu'il est bien en fin.
  const withoutPadding = cleaned.replace(/=+$/, "");
  if (withoutPadding.includes("=")) {
    throw new Base32Error("Le caractère « = » ne peut apparaître qu'à la fin.");
  }
  cleaned = withoutPadding.toUpperCase();
  if (cleaned.length === 0) return new Uint8Array(0);

  // 8 caractères → 5 octets. Les restes de 1, 3 et 6 caractères sont
  // impossibles : aucun nombre d'octets ne les produit.
  const remainder = cleaned.length % 8;
  if (remainder === 1 || remainder === 3 || remainder === 6) {
    throw new Base32Error(
      `Longueur impossible : ${cleaned.length} caractères utiles ne correspondent à aucun nombre entier d'octets.`,
    );
  }

  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of cleaned) {
    const value = alphabet.indexOf(char);
    if (value === -1) {
      throw new Base32Error(
        `« ${char} » n'appartient pas à l'alphabet Base32 choisi (${alphabet}).`,
      );
    }
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  // Les bits restants (moins de 8) doivent être des zéros de remplissage : s'ils
  // portent une valeur, l'entrée n'a pas été produite par un encodeur conforme.
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
    throw new Base32Error(
      "Les derniers bits ne sont pas nuls : cette chaîne n'a pas été produite par un encodeur RFC 4648.",
    );
  }
  return Uint8Array.from(out);
}

/** Encode du texte UTF-8 en Base32. */
export function encodeBase32Text(text: string, options?: Base32EncodeOptions): string {
  return encodeBase32(new TextEncoder().encode(text), options);
}

/**
 * Décode du Base32 vers du texte UTF-8.
 *
 * Échoue si les octets ne forment pas de l'UTF-8 valide, plutôt que de rendre
 * des caractères de remplacement : le Base32 sert aussi à transporter des
 * octets qui ne sont pas du texte, et il vaut mieux le dire.
 */
export function decodeBase32Text(input: string, options?: Base32DecodeOptions): string {
  const bytes = decodeBase32(input, options);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Base32Error(
      "Les octets décodés ne sont pas du texte UTF-8 : ce Base32 encode probablement des données binaires.",
    );
  }
}

/** Découpe une sortie longue en lignes, pour la rendre lisible. */
export function wrapBase32(value: string, width = 64): string {
  if (width <= 0) return value;
  const lines: string[] = [];
  for (let start = 0; start < value.length; start += width) {
    lines.push(value.slice(start, start + width));
  }
  return lines.join("\n");
}
