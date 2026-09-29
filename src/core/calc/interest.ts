/**
 * Intérêts simples et composés.
 *
 * Un outil mathématique, pas un conseil financier : ni fiscalité, ni inflation,
 * ni frais de gestion, ni variation du taux. Le résultat répond exactement à la
 * question « que donne cette formule avec ces nombres ».
 *
 * Le point de méthode qui compte : **on n'arrondit qu'à l'affichage**. Arrondir
 * le capital au centime à chaque période, comme le ferait une feuille de calcul
 * mal écrite, décale le résultat de plusieurs euros sur vingt ans de
 * capitalisation mensuelle. Les calculs se font donc en flottant double
 * précision jusqu'au bout, et la mise en forme vient après.
 */

export type InterestMode = "simple" | "compound";

/** Nombre de capitalisations par an. */
export type CompoundFrequency = "annual" | "semiannual" | "quarterly" | "monthly" | "daily";

export const FREQUENCY_PER_YEAR: Record<CompoundFrequency, number> = {
  annual: 1,
  semiannual: 2,
  quarterly: 4,
  monthly: 12,
  // 365 jours : la convention « exact/365 », la plus répandue pour un calcul
  // d'épargne. Les conventions bancaires 360 jours existent, mais mélanger les
  // deux dans un même outil ne ferait qu'obscurcir le résultat.
  daily: 365,
};

export const FREQUENCY_LABELS: Record<CompoundFrequency, string> = {
  annual: "Annuelle (1 fois par an)",
  semiannual: "Semestrielle (2 fois par an)",
  quarterly: "Trimestrielle (4 fois par an)",
  monthly: "Mensuelle (12 fois par an)",
  daily: "Quotidienne (365 fois par an)",
};

export class InterestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InterestError";
  }
}

export interface InterestInput {
  mode: InterestMode;
  /** Capital initial. */
  principal: number;
  /** Taux **annuel** nominal, en pourcentage (5 pour 5 %). */
  annualRatePercent: number;
  /** Durée en années (2,5 pour deux ans et demi). */
  years: number;
  /** Fréquence de capitalisation ; ignorée en intérêt simple. */
  frequency?: CompoundFrequency;
  /**
   * Versement régulier, effectué à **chaque période de capitalisation**, en fin
   * de période. Facultatif : 0 ou absent = aucun versement.
   */
  contribution?: number;
}

/** Une ligne du tableau année par année. */
export interface InterestPeriod {
  /** Année révolue, à partir de 1. */
  year: number;
  /** Capital à la fin de l'année. */
  balance: number;
  /** Total versé depuis le début (capital initial compris). */
  invested: number;
  /** Intérêts cumulés depuis le début. */
  interest: number;
}

export interface InterestResult {
  mode: InterestMode;
  /** Capital de départ. */
  principal: number;
  /** Somme des versements réguliers. */
  contributions: number;
  /** Capital initial + versements : ce qui est sorti de la poche. */
  invested: number;
  /** Intérêts produits. */
  interest: number;
  /** Capital final. */
  total: number;
  /** Taux annuel effectif, une fois la capitalisation prise en compte. */
  effectiveAnnualRatePercent: number;
  /** Nombre de périodes de capitalisation. */
  periods: number;
  /** Détail année par année, jusqu'à 100 lignes. */
  schedule: InterestPeriod[];
  /** Formule appliquée, écrite avec les valeurs réelles. */
  formula: string;
}

/** Au-delà, le tableau annuel n'est plus lisible et le calcul reste exact. */
const MAX_SCHEDULE_ROWS = 100;

function check(input: InterestInput): void {
  if (!Number.isFinite(input.principal) || input.principal < 0) {
    throw new InterestError("Le capital initial doit être un nombre positif ou nul.");
  }
  if (!Number.isFinite(input.annualRatePercent)) {
    throw new InterestError("Le taux annuel doit être un nombre.");
  }
  if (input.annualRatePercent < -100) {
    throw new InterestError("Un taux annuel inférieur à −100 % n'a pas de sens.");
  }
  if (!Number.isFinite(input.years) || input.years < 0) {
    throw new InterestError("La durée doit être un nombre d'années positif ou nul.");
  }
  if (input.years > 200) {
    throw new InterestError("La durée est limitée à 200 ans.");
  }
  if (input.contribution !== undefined) {
    if (!Number.isFinite(input.contribution) || input.contribution < 0) {
      throw new InterestError("Le versement régulier doit être positif ou nul.");
    }
  }
  if (input.principal === 0 && !input.contribution) {
    throw new InterestError("Sans capital initial ni versement, il n'y a rien à faire fructifier.");
  }
}

const percent = (value: number) => `${value.toString().replace(".", ",")} %`;

/**
 * Intérêt simple : `A = P(1 + r·t)`.
 *
 * Les intérêts sont calculés sur le seul capital initial, jamais sur les
 * intérêts déjà produits. Un versement régulier ne produit d'intérêts que pour
 * le temps qui lui reste à courir — c'est ce que fait la somme ci-dessous.
 */
function simpleInterest(input: InterestInput): InterestResult {
  const rate = input.annualRatePercent / 100;
  const contribution = input.contribution ?? 0;
  // Sans versement, la période naturelle est l'année : elle suffit à décrire la
  // progression. Avec versements, on suit le rythme mensuel, le plus courant.
  const perYear = contribution > 0 ? FREQUENCY_PER_YEAR[input.frequency ?? "monthly"] : 1;
  const periods = Math.round(input.years * perYear);

  const principalInterest = input.principal * rate * input.years;

  let contributionInterest = 0;
  for (let index = 1; index <= periods; index += 1) {
    // Un versement effectué en fin de période `index` travaille le temps qui
    // reste jusqu'au terme.
    const remainingYears = input.years - index / perYear;
    contributionInterest += contribution * rate * Math.max(0, remainingYears);
  }

  const contributions = contribution * periods;
  const invested = input.principal + contributions;
  const interest = principalInterest + contributionInterest;

  const schedule: InterestPeriod[] = [];
  const years = Math.min(Math.ceil(input.years), MAX_SCHEDULE_ROWS);
  for (let year = 1; year <= years; year += 1) {
    const elapsed = Math.min(year, input.years);
    const done = Math.round(elapsed * perYear);
    const paid = contribution * done;
    let accrued = input.principal * rate * elapsed;
    for (let index = 1; index <= done; index += 1) {
      accrued += contribution * rate * Math.max(0, elapsed - index / perYear);
    }
    schedule.push({
      year,
      balance: input.principal + paid + accrued,
      invested: input.principal + paid,
      interest: accrued,
    });
  }

  return {
    mode: "simple",
    principal: input.principal,
    contributions,
    invested,
    interest,
    total: invested + interest,
    effectiveAnnualRatePercent: input.annualRatePercent,
    periods: periods || Math.round(input.years),
    schedule,
    formula: `A = P × (1 + r × t) = ${input.principal} × (1 + ${rate} × ${input.years})`,
  };
}

/**
 * Intérêt composé : `A = P(1 + r/n)^(n·t)`.
 *
 * Avec versements réguliers en fin de période, on ajoute la valeur acquise
 * d'une suite de versements : `C × ((1 + i)^N − 1) / i`, et `C × N` si le taux
 * est nul — sans quoi la division par zéro renverrait `NaN`.
 */
function compoundInterest(input: InterestInput): InterestResult {
  const frequency = input.frequency ?? "annual";
  const perYear = FREQUENCY_PER_YEAR[frequency];
  const rate = input.annualRatePercent / 100;
  const periodRate = rate / perYear;
  const periods = input.years * perYear;
  const contribution = input.contribution ?? 0;

  const growth = Math.pow(1 + periodRate, periods);
  const fromPrincipal = input.principal * growth;
  const fromContributions =
    contribution === 0
      ? 0
      : periodRate === 0
        ? contribution * periods
        : contribution * ((growth - 1) / periodRate);

  const contributions = contribution * Math.round(periods);
  const invested = input.principal + contributions;
  const total = fromPrincipal + fromContributions;

  const schedule: InterestPeriod[] = [];
  const years = Math.min(Math.ceil(input.years), MAX_SCHEDULE_ROWS);
  for (let year = 1; year <= years; year += 1) {
    const elapsed = Math.min(year, input.years);
    const done = elapsed * perYear;
    const factor = Math.pow(1 + periodRate, done);
    const balance =
      input.principal * factor +
      (contribution === 0
        ? 0
        : periodRate === 0
          ? contribution * done
          : contribution * ((factor - 1) / periodRate));
    const paid = input.principal + contribution * Math.round(done);
    schedule.push({ year, balance, invested: paid, interest: balance - paid });
  }

  return {
    mode: "compound",
    principal: input.principal,
    contributions,
    invested,
    interest: total - invested,
    total,
    effectiveAnnualRatePercent: (Math.pow(1 + periodRate, perYear) - 1) * 100,
    periods: Math.round(periods),
    schedule,
    formula:
      `A = P × (1 + r/n)^(n×t) = ${input.principal} × (1 + ${rate}/${perYear})^(${perYear}×${input.years})` +
      (contribution > 0 ? ` + C × ((1 + r/n)^(n×t) − 1) ÷ (r/n)` : ""),
  };
}

export function computeInterest(input: InterestInput): InterestResult {
  check(input);
  return input.mode === "simple" ? simpleInterest(input) : compoundInterest(input);
}

/** Mise en forme monétaire : c'est **ici**, et nulle part avant, qu'on arrondit. */
export function formatMoney(value: number, currency = "EUR"): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatRate(value: number): string {
  return percent(Math.round(value * 10000) / 10000);
}

/** Avertissement affiché en permanence par l'outil. */
export const INTEREST_DISCLAIMER =
  "Outil mathématique, pas conseil financier. Le calcul applique la formule aux nombres " +
  "fournis : il ignore la fiscalité, l'inflation, les frais de gestion et toute variation " +
  "du taux dans le temps.";
