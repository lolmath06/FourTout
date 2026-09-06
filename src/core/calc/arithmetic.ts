/**
 * Pourcentages et règle de trois.
 *
 * Deux outils du catalogue, une seule règle de conduite : ne jamais renvoyer un
 * nombre quand la question n'a pas de réponse. Une division par zéro rend un
 * message, pas `Infinity`.
 */

export type PercentageMode = "of" | "share" | "change";

export interface PercentageResult {
  value: number;
  /** Formule développée, pour que l'utilisateur puisse vérifier. */
  formula: string;
  /** Précision d'interprétation quand le résultat peut se lire de deux façons. */
  note?: string;
}

/** « X % de Y ». */
export function percentOf(percent: number, total: number): PercentageResult {
  const value = (percent / 100) * total;
  return {
    value,
    formula: `${format(percent)} % × ${format(total)} = ${format(percent)} ÷ 100 × ${format(total)}`,
  };
}

/** « X représente quel pourcentage de Y ? ». */
export function percentShare(part: number, total: number): PercentageResult {
  if (total === 0) {
    throw new RangeError("Un pourcentage d'un total nul n'a pas de sens : le total doit être non nul.");
  }
  return {
    value: (part / total) * 100,
    formula: `${format(part)} ÷ ${format(total)} × 100`,
  };
}

/** Variation de A vers B, en pourcentage. */
export function percentChange(from: number, to: number): PercentageResult {
  if (from === 0) {
    throw new RangeError(
      "Une variation depuis zéro n'a pas de pourcentage : toute augmentation serait infinie.",
    );
  }
  const value = ((to - from) / Math.abs(from)) * 100;
  return {
    value,
    formula: `(${format(to)} − ${format(from)}) ÷ |${format(from)}| × 100`,
    note:
      value >= 0
        ? `Augmentation de ${format(Math.abs(value))} %`
        : `Diminution de ${format(Math.abs(value))} %`,
  };
}

export interface ProportionResult {
  value: number;
  formula: string;
}

/**
 * Règle de trois : si A correspond à B, à quoi correspond C ?
 *
 * `a` au dénominateur : c'est le seul cas dégénéré, et il doit être refusé
 * explicitement plutôt que produire `Infinity`.
 */
export function ruleOfThree(a: number, b: number, c: number): ProportionResult {
  if (a === 0) {
    throw new RangeError(
      "La première valeur ne peut pas être nulle : sans elle, aucune proportion n'est définie.",
    );
  }
  return {
    value: (b * c) / a,
    formula: `(${format(b)} × ${format(c)}) ÷ ${format(a)}`,
  };
}

function format(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return String(Number(value.toPrecision(12)));
}
