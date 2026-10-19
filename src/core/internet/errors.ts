/** Message affichable d'une erreur quelconque (native, structurée ou texte). */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
