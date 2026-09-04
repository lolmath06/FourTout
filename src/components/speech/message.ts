/** Message d'erreur lisible, sans le préfixe technique des erreurs relayées. */
export function cleanMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error:\s*/, "");
}
