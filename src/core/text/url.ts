/**
 * Encodage et décodage d'URL (percent-encoding).
 *
 * Un `%` mal formé est une saisie ordinaire : il produit un message clair, pas
 * une exception qui casse l'écran.
 */

export type UrlMode = "component" | "uri" | "query";

export const URL_MODE_LABELS: Record<UrlMode, string> = {
  component: "Valeur (encodeURIComponent)",
  uri: "URL complète (encodeURI)",
  query: "Paramètre de formulaire (+ pour l'espace)",
};

export interface UrlResult {
  text: string;
  error?: string;
}

export function encodeUrlText(input: string, mode: UrlMode): UrlResult {
  try {
    if (mode === "uri") return { text: encodeURI(input) };
    if (mode === "query") return { text: encodeURIComponent(input).replace(/%20/g, "+") };
    return { text: encodeURIComponent(input) };
  } catch (error) {
    return { text: "", error: describe(error) };
  }
}

export function decodeUrlText(input: string, mode: UrlMode): UrlResult {
  try {
    const source = mode === "query" ? input.replace(/\+/g, " ") : input;
    return { text: mode === "uri" ? decodeURI(source) : decodeURIComponent(source) };
  } catch {
    const bad = input.match(/%(?![0-9a-fA-F]{2})[^\s]{0,2}/);
    return {
      text: "",
      error: bad
        ? `Séquence d'échappement invalide : « ${bad[0]} ». Un « % » doit être suivi de deux chiffres hexadécimaux.`
        : "Texte impossible à décoder : séquence d'échappement invalide.",
    };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Encodage impossible.";
}

export interface UrlParts {
  protocol: string;
  host: string;
  path: string;
  hash: string;
  params: { key: string; value: string }[];
}

/** Décompose une URL en ses parties lisibles. `null` si ce n'est pas une URL. */
export function parseUrlParts(input: string): UrlParts | null {
  try {
    const url = new URL(input.trim());
    return {
      protocol: url.protocol.replace(":", ""),
      host: url.host,
      path: url.pathname,
      hash: url.hash,
      params: [...url.searchParams.entries()].map(([key, value]) => ({ key, value })),
    };
  } catch {
    return null;
  }
}
