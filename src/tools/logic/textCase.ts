/** Transformations de casse : logique pure, réutilisable et testable. */
export type CaseKey = "upper" | "lower" | "title" | "sentence" | "camel" | "snake" | "kebab";

const WORD_SPLIT = /[\s_\-.]+|(?<=[a-z0-9])(?=[A-Z])/;

function words(input: string): string[] {
  return input.split(WORD_SPLIT).filter(Boolean);
}

export const CASE_TRANSFORMS: Record<CaseKey, { label: string; apply: (input: string) => string }> = {
  upper: { label: "MAJUSCULES", apply: (s) => s.toLocaleUpperCase("fr") },
  lower: { label: "minuscules", apply: (s) => s.toLocaleLowerCase("fr") },
  title: {
    label: "Première Lettre",
    apply: (s) =>
      s.replace(/\p{L}[\p{L}\p{M}']*/gu, (word) =>
        word.charAt(0).toLocaleUpperCase("fr") + word.slice(1).toLocaleLowerCase("fr"),
      ),
  },
  sentence: {
    label: "Début de phrase",
    apply: (s) =>
      s
        .toLocaleLowerCase("fr")
        .replace(/(^\s*|[.!?…]\s+)(\p{L})/gu, (_m, prefix, letter: string) =>
          prefix + letter.toLocaleUpperCase("fr"),
        ),
  },
  camel: {
    label: "camelCase",
    apply: (s) =>
      words(s)
        .map((word, index) =>
          index === 0
            ? word.toLocaleLowerCase("fr")
            : word.charAt(0).toLocaleUpperCase("fr") + word.slice(1).toLocaleLowerCase("fr"),
        )
        .join(""),
  },
  snake: {
    label: "snake_case",
    apply: (s) => words(s).map((w) => w.toLocaleLowerCase("fr")).join("_"),
  },
  kebab: {
    label: "kebab-case",
    apply: (s) => words(s).map((w) => w.toLocaleLowerCase("fr")).join("-"),
  },
};
