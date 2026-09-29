/**
 * Testeur d'expressions régulières.
 *
 * Deux dangers concrets, traités explicitement :
 *
 *  - une regex pathologique (`(a+)+$` sur « aaaa…b ») peut faire exploser le
 *    temps d'exécution. Le moteur JavaScript n'est pas interruptible : le
 *    budget de temps ci-dessous n'est vérifié qu'**entre** deux
 *    correspondances, il ne peut donc rien contre un unique `exec` parti en
 *    retour sur trace. Ce module borne ce qu'il peut borner — taille du sujet,
 *    nombre de correspondances, nombre d'itérations — et la vraie
 *    interruption est apportée par `regexRunner.ts`, qui l'exécute dans un
 *    worker qu'il peut tuer ;
 *  - une regex globale sans progression (le motif `a*` avec le drapeau `g`,
 *    sur la chaîne « b ») boucle indéfiniment : on force donc l'avancée du
 *    curseur sur les correspondances vides.
 */

/** Au-delà, on refuse : ce n'est plus un test de regex, c'est un traitement. */
export const MAX_SUBJECT_LENGTH = 200_000;
/** Au-delà, la liste n'est plus lisible et le rendu devient le goulot. */
export const MAX_MATCHES = 1000;
/**
 * Budget de temps au-delà duquel on cesse de collecter des correspondances.
 * Il n'interrompt pas un `exec` en cours : il évite seulement qu'une recherche
 * globale sur un très long sujet n'occupe le fil indéfiniment.
 */
export const TIME_BUDGET_MS = 400;

export interface RegexGroup {
  index: number;
  name?: string;
  value?: string;
}

export interface RegexMatch {
  index: number;
  length: number;
  value: string;
  groups: RegexGroup[];
  /** Numéro de ligne (1-indexé) du début de la correspondance. */
  line: number;
}

export interface RegexRun {
  matches: RegexMatch[];
  /** Vrai quand la recherche a été arrêtée avant la fin du sujet. */
  truncated: boolean;
  truncationReason?: string;
  elapsedMs: number;
  groupCount: number;
  groupNames: string[];
}

export class RegexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegexError";
  }
}

export const FLAGS: { value: string; label: string; hint: string }[] = [
  { value: "g", label: "g", hint: "global — toutes les correspondances, pas seulement la première" },
  { value: "i", label: "i", hint: "insensible à la casse" },
  { value: "m", label: "m", hint: "multiligne — ^ et $ encadrent chaque ligne" },
  { value: "s", label: "s", hint: "dotAll — le point accepte aussi les retours à la ligne" },
  { value: "u", label: "u", hint: "unicode — les échappements \\u{…} et les propriétés \\p{…}" },
  { value: "y", label: "y", hint: "sticky — la recherche démarre exactement à lastIndex" },
];

export function compileRegex(pattern: string, flags: string): RegExp {
  if (pattern.length === 0) throw new RegexError("L'expression est vide.");
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new RegexError(
      error instanceof Error
        ? error.message.replace(/^Invalid regular expression: /, "Expression invalide : ")
        : "Expression invalide.",
    );
  }
}

/** Compte les groupes capturants et relève les groupes nommés. */
function describeGroups(regex: RegExp): { count: number; names: string[] } {
  const names = [...regex.source.matchAll(/\(\?<([A-Za-z_$][\w$]*)>/g)].map((match) => match[1]);
  // Les groupes capturants sont les `(` non suivis de `?`, hors classe et hors
  // échappement. Compter à la main évite d'exécuter la regex pour le savoir.
  let count = 0;
  let escaped = false;
  let inClass = false;
  for (let i = 0; i < regex.source.length; i += 1) {
    const char = regex.source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (inClass) {
      if (char === "]") inClass = false;
      continue;
    }
    if (char === "[") {
      inClass = true;
      continue;
    }
    if (char !== "(") continue;
    const next = regex.source[i + 1];
    if (next !== "?" || regex.source.startsWith("(?<", i) === false) {
      if (next === "?" && !regex.source.startsWith("(?<", i)) continue;
      count += 1;
      continue;
    }
    // `(?<name>` capture ; `(?<=` et `(?<!` sont des assertions.
    const third = regex.source[i + 3];
    if (third !== "=" && third !== "!") count += 1;
  }
  return { count, names };
}

export function runRegex(pattern: string, flags: string, subject: string): RegexRun {
  if (subject.length > MAX_SUBJECT_LENGTH) {
    throw new RegexError(
      `Le texte dépasse ${MAX_SUBJECT_LENGTH.toLocaleString("fr-FR")} caractères. ` +
        "Au-delà, une expression mal écrite peut bloquer l'interface : réduisez l'échantillon.",
    );
  }
  const regex = compileRegex(pattern, flags.includes("g") ? flags : `${flags}g`);
  const { count, names } = describeGroups(regex);

  const matches: RegexMatch[] = [];
  const started = performance.now();
  let truncated = false;
  let truncationReason: string | undefined;

  // Index des débuts de ligne, pour situer chaque correspondance sans
  // re-parcourir le sujet à chaque fois.
  const lineStarts = [0];
  for (let i = 0; i < subject.length; i += 1) {
    if (subject[i] === "\n") lineStarts.push(i + 1);
  }
  const lineOf = (index: number) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (lineStarts[mid] <= index) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };

  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(subject)) !== null) {
    matches.push({
      index: match.index,
      length: match[0].length,
      value: match[0],
      line: lineOf(match.index),
      groups: Array.from({ length: Math.max(0, match.length - 1) }, (_, i) => ({
        index: i + 1,
        name: names.find((_, position) => position === i),
        value: match?.[i + 1],
      })),
    });

    // Une correspondance vide ne fait pas avancer `lastIndex` : sans ce
    // décalage, `/a*/g` sur « b » bouclerait pour toujours.
    if (match[0].length === 0) regex.lastIndex += 1;

    if (matches.length >= MAX_MATCHES) {
      truncated = true;
      truncationReason = `Affichage limité aux ${MAX_MATCHES} premières correspondances.`;
      break;
    }
    if (performance.now() - started > TIME_BUDGET_MS) {
      truncated = true;
      truncationReason =
        `Recherche arrêtée après ${TIME_BUDGET_MS} ms : cette expression est trop coûteuse ` +
        "pour ce texte. Les correspondances suivantes n'ont pas été cherchées.";
      break;
    }
  }

  return {
    matches,
    truncated,
    truncationReason,
    elapsedMs: performance.now() - started,
    groupCount: count,
    groupNames: names,
  };
}

/**
 * Remplace toutes les correspondances.
 *
 * Le motif de remplacement est celui de `String.replace` : `$1`, `$<nom>`,
 * `$&`. Aucune fonction n'est acceptée — ce serait de l'exécution de code.
 */
export function replaceAll(
  pattern: string,
  flags: string,
  subject: string,
  replacement: string,
): string {
  if (subject.length > MAX_SUBJECT_LENGTH) {
    throw new RegexError(`Le texte dépasse ${MAX_SUBJECT_LENGTH.toLocaleString("fr-FR")} caractères.`);
  }
  const regex = compileRegex(pattern, flags.includes("g") ? flags : `${flags}g`);
  return subject.replace(regex, replacement);
}
