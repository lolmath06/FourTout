/**
 * Petits outils de développeur qui manipulent des jetons et des nombres :
 * JWT, UUID, timestamp Unix, bases numériques.
 *
 * Tous partagent la même exigence : ne rien inventer et ne rien envoyer. Un
 * JWT décodé n'est pas un JWT vérifié, un UUID doit venir d'un générateur
 * cryptographique, et une conversion de base doit être exacte quelle que soit
 * la taille du nombre.
 */

/* ------------------------------------------------------------------------ */
/* JWT                                                                       */
/* ------------------------------------------------------------------------ */

export interface JwtClaim {
  name: string;
  raw: unknown;
  /** Lecture humaine d'un claim connu (dates, durées). */
  readable?: string;
  description: string;
  /** Vrai quand le claim rend le token inutilisable *à cet instant*. */
  expired?: boolean;
}

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  /** Signature telle qu'elle apparaît, en base64url. Jamais vérifiée. */
  signature: string;
  algorithm: string;
  claims: JwtClaim[];
  /** Vrai si `exp` est dépassé, `nbf` pas encore atteint, etc. */
  usable: boolean;
  warnings: string[];
}

export class JwtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JwtError";
  }
}

const CLAIM_DESCRIPTIONS: Record<string, string> = {
  iss: "Émetteur du token (issuer)",
  sub: "Sujet : l'entité que le token décrit (subject)",
  aud: "Destinataire prévu (audience)",
  exp: "Date d'expiration (expiration time)",
  nbf: "Pas valide avant cette date (not before)",
  iat: "Date d'émission (issued at)",
  jti: "Identifiant unique du token (JWT ID)",
};

function base64UrlDecode(segment: string): string {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(withPadding);
  } catch {
    throw new JwtError("Segment non décodable : ce n'est pas du base64url valide.");
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function formatEpoch(seconds: number): string {
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return "date invalide";
  return `${date.toLocaleString("fr-FR")} (${date.toISOString()})`;
}

/**
 * Décode un JWT. **Ne vérifie jamais la signature** : sans la clé publique ou
 * le secret, c'est impossible, et laisser croire le contraire serait le pire
 * service à rendre à l'utilisateur.
 */
export function decodeJwt(token: string, now: Date = new Date()): DecodedJwt {
  const trimmed = token.trim().replace(/^Bearer\s+/i, "");
  const parts = trimmed.split(".");
  if (parts.length !== 3) {
    throw new JwtError(
      `Un JWT compte trois segments séparés par des points ; celui-ci en a ${parts.length}.`,
    );
  }
  if (parts.some((part) => part.length === 0)) {
    throw new JwtError("Un des trois segments du token est vide.");
  }

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(base64UrlDecode(parts[0])) as Record<string, unknown>;
  } catch (error) {
    throw error instanceof JwtError ? error : new JwtError("L'en-tête n'est pas un JSON valide.");
  }
  try {
    payload = JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>;
  } catch (error) {
    throw error instanceof JwtError
      ? error
      : new JwtError("La charge utile n'est pas un JSON valide.");
  }

  const seconds = Math.floor(now.getTime() / 1000);
  const warnings: string[] = [];
  const claims: JwtClaim[] = [];
  let usable = true;

  for (const [name, raw] of Object.entries(payload)) {
    const description = CLAIM_DESCRIPTIONS[name] ?? "Claim spécifique à l'application";
    if ((name === "exp" || name === "nbf" || name === "iat") && typeof raw === "number") {
      const readable = formatEpoch(raw);
      let expired = false;
      if (name === "exp" && raw <= seconds) {
        expired = true;
        usable = false;
        warnings.push(`Le token a expiré le ${formatEpoch(raw)}.`);
      }
      if (name === "nbf" && raw > seconds) {
        expired = true;
        usable = false;
        warnings.push(`Le token n'est pas encore valide : utilisable à partir du ${formatEpoch(raw)}.`);
      }
      claims.push({ name, raw, readable, description, expired });
      continue;
    }
    claims.push({ name, raw, description });
  }

  const algorithm = typeof header.alg === "string" ? header.alg : "inconnu";
  if (algorithm.toLowerCase() === "none") {
    warnings.push(
      "L'en-tête annonce l'algorithme « none » : ce token n'est pas signé du tout.",
    );
  }

  return { header, payload, signature: parts[2], algorithm, claims, usable, warnings };
}

/** Rappel affiché en permanence par l'outil. */
export const JWT_SIGNATURE_NOTE =
  "Décodé n'est pas vérifié : sans la clé, personne ne peut dire si la signature est " +
  "authentique. Ne faites jamais confiance au contenu d'un token sur la seule foi de ce décodage.";

/* ------------------------------------------------------------------------ */
/* UUID                                                                      */
/* ------------------------------------------------------------------------ */

export type UuidVersion = "v4" | "v7";

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    // Un générateur d'identifiants qui retomberait sur `Math.random()` serait
    // prévisible : mieux vaut échouer bruyamment.
    throw new Error("Aucun générateur aléatoire cryptographique n'est disponible.");
  }
  cryptoApi.getRandomValues(bytes);
  return bytes;
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** UUID v4 : 122 bits d'aléa cryptographique. */
export function uuidV4(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
  return formatUuid(bytes);
}

/**
 * UUID v7 : 48 bits d'horodatage en millisecondes, puis de l'aléa.
 *
 * Deux identifiants générés à des instants différents se trient dans l'ordre
 * chronologique — c'est tout l'intérêt de la v7 comme clé de base de données.
 */
export function uuidV7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  const timestamp = BigInt(Math.max(0, Math.floor(now)));
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = Number((timestamp >> BigInt(8 * (5 - i))) & 0xffn);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
  return formatUuid(bytes);
}

/** Au-delà, la liste devient inexploitable dans une zone de texte. */
export const MAX_UUID_COUNT = 1000;

export function generateUuids(version: UuidVersion, count: number): string[] {
  const total = Math.min(Math.max(1, Math.floor(count)), MAX_UUID_COUNT);
  const result: string[] = [];
  for (let i = 0; i < total; i += 1) {
    result.push(version === "v7" ? uuidV7() : uuidV4());
  }
  return result;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-([1-8])[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function uuidVersionOf(value: string): number | undefined {
  const match = UUID_PATTERN.exec(value.trim());
  return match ? Number(match[1]) : undefined;
}

/* ------------------------------------------------------------------------ */
/* Timestamp Unix                                                            */
/* ------------------------------------------------------------------------ */

export type TimestampUnit = "s" | "ms";

export interface TimestampView {
  unit: TimestampUnit;
  value: number;
  date: Date;
  local: string;
  utc: string;
  iso: string;
  relative: string;
}

/** Distingue secondes et millisecondes sur l'ordre de grandeur. */
export function guessTimestampUnit(value: number): TimestampUnit {
  // 1e11 s ≈ l'an 5138 : au-delà, c'est forcément des millisecondes.
  return Math.abs(value) >= 1e11 ? "ms" : "s";
}

export function describeTimestamp(
  value: number,
  unit: TimestampUnit,
  now: Date = new Date(),
): TimestampView {
  const ms = unit === "s" ? value * 1000 : value;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Ce nombre ne correspond à aucune date représentable.");
  }
  return {
    unit,
    value,
    date,
    local: date.toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "long" }),
    utc: date.toUTCString(),
    iso: date.toISOString(),
    relative: relativeTime(date, now),
  };
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["week", 604_800_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1000],
];

export function relativeTime(date: Date, now: Date = new Date()): string {
  const delta = date.getTime() - now.getTime();
  const formatter = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(delta) >= size) return formatter.format(Math.round(delta / size), unit);
  }
  return "maintenant";
}

/* ------------------------------------------------------------------------ */
/* Bases numériques                                                          */
/* ------------------------------------------------------------------------ */

export const MIN_BASE = 2;
export const MAX_BASE = 36;

export class BaseConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaseConversionError";
  }
}

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Lit un entier dans une base donnée, **en `BigInt`**.
 *
 * `parseInt` perd silencieusement les chiffres au-delà de 2^53 :
 * `9007199254740993` deviendrait `9007199254740992`. Un convertisseur qui
 * abîme le nombre qu'on lui confie n'a aucune valeur.
 */
export function parseInBase(input: string, base: number): bigint {
  if (base < MIN_BASE || base > MAX_BASE || !Number.isInteger(base)) {
    throw new BaseConversionError(`La base doit être un entier entre ${MIN_BASE} et ${MAX_BASE}.`);
  }
  const cleaned = input
    .trim()
    .replace(/[\s_]/g, "")
    .replace(/^0[xXbBoO]/, "")
    .toLowerCase();
  if (cleaned.length === 0) throw new BaseConversionError("Aucun nombre à convertir.");

  const negative = cleaned.startsWith("-");
  const digits = negative ? cleaned.slice(1) : cleaned;
  if (digits.length === 0) throw new BaseConversionError("Aucun chiffre après le signe.");

  const allowed = DIGITS.slice(0, base);
  let value = 0n;
  const bigBase = BigInt(base);
  for (const char of digits) {
    const digit = allowed.indexOf(char);
    if (digit === -1) {
      throw new BaseConversionError(
        `« ${char} » n'est pas un chiffre valide en base ${base} (chiffres autorisés : ${allowed}).`,
      );
    }
    value = value * bigBase + BigInt(digit);
  }
  return negative ? -value : value;
}

export function formatInBase(value: bigint, base: number): string {
  if (base < MIN_BASE || base > MAX_BASE || !Number.isInteger(base)) {
    throw new BaseConversionError(`La base doit être un entier entre ${MIN_BASE} et ${MAX_BASE}.`);
  }
  return value.toString(base);
}

export interface BaseViews {
  binary: string;
  octal: string;
  decimal: string;
  hexadecimal: string;
  /** Nombre de bits nécessaires pour représenter la valeur absolue. */
  bits: number;
}

export function baseViews(value: bigint): BaseViews {
  const magnitude = value < 0n ? -value : value;
  return {
    binary: formatInBase(value, 2),
    octal: formatInBase(value, 8),
    decimal: value.toString(10),
    hexadecimal: formatInBase(value, 16).toUpperCase(),
    bits: magnitude === 0n ? 1 : magnitude.toString(2).length,
  };
}

/** Regroupe les chiffres par paquets, pour rendre un binaire lisible. */
export function groupDigits(text: string, size: number): string {
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const groups: string[] = [];
  for (let end = body.length; end > 0; end -= size) {
    groups.unshift(body.slice(Math.max(0, end - size), end));
  }
  return (negative ? "-" : "") + groups.join(" ");
}
