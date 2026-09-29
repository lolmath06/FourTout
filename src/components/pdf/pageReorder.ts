/**
 * Logique pure de réordonnancement par insertion, isolée du composant pour
 * rester testable et ne pas gêner le rechargement à chaud.
 *
 * Déplace l'élément d'index `from` pour l'insérer devant `insertBefore`
 * (position dans [0, items.length]).
 */
export function reorderByInsertion<T>(
  items: readonly T[],
  from: number,
  insertBefore: number,
): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  let target = insertBefore;
  if (from < insertBefore) target -= 1;
  next.splice(target, 0, item);
  return next;
}
