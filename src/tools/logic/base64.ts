/**
 * Base64 : texte et fichiers.
 *
 * `btoa` travaille sur des octets latin-1 : l'appliquer directement à une
 * chaîne JavaScript échoue dès le premier caractère accentué. On passe donc
 * systématiquement par un encodage UTF-8 explicite.
 */

/** Encodage UTF-8 sûr (btoa seul échoue sur les caractères non latins). */
export function encodeBase64(input: string, urlSafe = false): string {
  return bytesToBase64(new TextEncoder().encode(input), urlSafe);
}

export function decodeBase64(input: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(base64ToBytes(input));
}

/** Octets → Base64, par blocs pour ne pas dépasser la pile d'appels. */
export function bytesToBase64(bytes: Uint8Array, urlSafe = false): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  const base64 = btoa(binary);
  return urlSafe ? base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : base64;
}

/** Base64 (standard ou base64url) → octets. Lève si l'entrée est invalide. */
export function base64ToBytes(input: string): Uint8Array {
  const compact = input.replace(/\s+/g, "");
  const normalized = compact.replace(/-/g, "+").replace(/_/g, "/");
  if (normalized.length === 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error("Entrée Base64 invalide.");
  }
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Data URI complet, prêt à coller dans du HTML ou du CSS. */
export function toDataUri(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType || "application/octet-stream"};base64,${bytesToBase64(bytes)}`;
}

/** Extrait les octets d'un data URI ; `null` si ce n'en est pas un. */
export function fromDataUri(input: string): { bytes: Uint8Array; mimeType: string } | null {
  const match = input.trim().match(/^data:([^;,]*)(;base64)?,(.*)$/s);
  if (!match) return null;
  const [, mimeType, isBase64, payload] = match;
  const bytes = isBase64
    ? base64ToBytes(payload)
    : new TextEncoder().encode(decodeURIComponent(payload));
  return { bytes, mimeType: mimeType || "application/octet-stream" };
}
