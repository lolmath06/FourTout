import { md5 } from "./md5";

/**
 * Empreintes calculées dans la WebView, pour du **texte** et de petits
 * contenus. Les fichiers passent par le socle natif (`core/files/native`) :
 * il les lit en flux et n'a pas de limite de taille.
 */
export type TextHashAlgorithm = "MD5" | "SHA-1" | "SHA-256" | "SHA-512";

export const TEXT_HASH_ALGORITHMS: TextHashAlgorithm[] = ["MD5", "SHA-1", "SHA-256", "SHA-512"];

/** MD5 et SHA-1 ne conviennent plus à un usage de sécurité. */
export function isLegacyAlgorithm(algorithm: TextHashAlgorithm): boolean {
  return algorithm === "MD5" || algorithm === "SHA-1";
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashBytes(
  bytes: Uint8Array,
  algorithm: TextHashAlgorithm,
): Promise<string> {
  if (algorithm === "MD5") return md5(bytes);
  const digest = await crypto.subtle.digest(algorithm, bytes.slice().buffer as ArrayBuffer);
  return toHex(digest);
}

export async function hashText(text: string, algorithm: TextHashAlgorithm): Promise<string> {
  return hashBytes(new TextEncoder().encode(text), algorithm);
}

export { md5 };
