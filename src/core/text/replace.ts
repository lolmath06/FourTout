/**
 * Recherche et remplacement.
 *
 * Une expression régulière invalide est une saisie ordinaire, pas une panne :
 * elle renvoie un message clair et laisse le texte intact.
 */

export interface ReplaceOptions {
  search: string;
  replacement: string;
  /** Interpréter la recherche comme une expression régulière. */
  regex: boolean;
  caseSensitive: boolean;
  /** N'accepter que des mots entiers (ignoré en mode expression régulière). */
  wholeWord: boolean;
  /** Remplacer toutes les occurrences, ou seulement la première. */
  all: boolean;
}

export const DEFAULT_REPLACE_OPTIONS: ReplaceOptions = {
  search: "",
  replacement: "",
  regex: false,
  caseSensitive: false,
  wholeWord: false,
  all: true,
};

export interface ReplaceResult {
  text: string;
  /** Nombre d'occurrences trouvées (avant remplacement). */
  count: number;
  /** Message d'erreur si l'expression régulière est invalide. */
  error?: string;
}

/** Échappe une chaîne pour l'utiliser littéralement dans une regex. */
export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Construit l'expression de recherche. Renvoie `null` (et un message) si le
 * motif fourni par l'utilisateur est invalide.
 */
export function buildSearchRegExp(
  options: Pick<ReplaceOptions, "search" | "regex" | "caseSensitive" | "wholeWord">,
): { regexp: RegExp } | { error: string } {
  if (options.search.length === 0) return { error: "Saisissez le texte à rechercher." };
  let source = options.regex ? options.search : escapeRegExp(options.search);
  if (!options.regex && options.wholeWord) {
    // `\b` ne fonctionne pas avec les lettres accentuées : on borne
    // explicitement sur « pas un caractère de mot Unicode ».
    source = `(?<![\\p{L}\\p{N}_])${source}(?![\\p{L}\\p{N}_])`;
  }
  const flags = `gu${options.caseSensitive ? "" : "i"}`;
  try {
    return { regexp: new RegExp(source, flags) };
  } catch (error) {
    // Le drapeau `u` refuse des motifs tolérés sans lui : on retente sans.
    try {
      return { regexp: new RegExp(source, flags.replace("u", "")) };
    } catch {
      return {
        error: `Expression régulière invalide : ${error instanceof Error ? error.message : "motif incorrect"}`,
      };
    }
  }
}

/** Nombre d'occurrences, sans rien modifier. */
export function countMatches(input: string, options: ReplaceOptions): ReplaceResult {
  const built = buildSearchRegExp(options);
  if ("error" in built) return { text: input, count: 0, error: built.error };
  const matches = input.match(built.regexp);
  return { text: input, count: matches?.length ?? 0 };
}

export function findReplace(input: string, options: ReplaceOptions): ReplaceResult {
  const built = buildSearchRegExp(options);
  if ("error" in built) return { text: input, count: 0, error: built.error };

  const { regexp } = built;
  const count = (input.match(regexp) ?? []).length;
  if (count === 0) return { text: input, count: 0 };

  // Hors mode regex, `$` du remplacement doit rester littéral.
  const replacement = options.regex ? options.replacement : options.replacement.replace(/\$/g, "$$$$");

  if (options.all) return { text: input.replace(regexp, replacement), count };

  const once = new RegExp(regexp.source, regexp.flags.replace("g", ""));
  return { text: input.replace(once, replacement), count: 1 };
}
