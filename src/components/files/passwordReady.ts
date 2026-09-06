/**
 * Le mot de passe est-il utilisable pour lancer l'opération ?
 *
 * Séparé de `PasswordField` : un module qui exporte à la fois un composant et
 * une fonction perd le rechargement à chaud du composant.
 */
export function passwordReady(value: string, confirmation?: string): boolean {
  if (value.length === 0) return false;
  return confirmation === undefined || confirmation === value;
}
