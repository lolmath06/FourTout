import cronstrue from "cronstrue/i18n";
import { CronExpressionParser } from "cron-parser";
import { localized, t } from "@/i18n";

/**
 * Assistant cron.
 *
 * Le format retenu est le cron Unix classique à **cinq champs** : minute,
 * heure, jour du mois, mois, jour de la semaine. C'est celui de crontab, de
 * systemd-cron et des planificateurs les plus courants. Les variantes à six ou
 * sept champs (Quartz, avec secondes et années) ne sont pas acceptées : mieux
 * vaut un outil qui dit non que deux syntaxes qui se ressemblent et ne se
 * comportent pas pareil.
 *
 * Rien n'est planifié ni exécuté : l'outil lit, explique et prédit.
 */

export class CronError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronError";
  }
}

export interface CronField {
  key: "minute" | "hour" | "dayOfMonth" | "month" | "dayOfWeek";
  label: string;
  value: string;
  range: string;
}

export interface CronExplanation {
  expression: string;
  /** Phrase en français décrivant la planification. */
  description: string;
  fields: CronField[];
  /** Prochaines occurrences, calculées depuis la date de référence. */
  occurrences: Date[];
  warnings: string[];
}

const FIELD_LABELS: { key: CronField["key"]; label: string; range: string }[] = localized(() => [
  { key: "minute", label: t("Minute"), range: "0–59" },
  { key: "hour", label: t("Heure"), range: "0–23" },
  { key: "dayOfMonth", label: t("Jour du mois"), range: "1–31" },
  { key: "month", label: t("Mois"), range: t("1–12 ou JAN–DEC") },
  { key: "dayOfWeek", label: t("Jour de la semaine"), range: t("0–7 ou SUN–SAT (0 et 7 = dimanche)") },
]);

export const CRON_PRESETS: { label: string; expression: string }[] = localized(() => [
  { label: t("Toutes les minutes"), expression: "* * * * *" },
  { label: t("Tous les quarts d'heure"), expression: "*/15 * * * *" },
  { label: t("Toutes les heures"), expression: "0 * * * *" },
  { label: t("Chaque jour à 9 h"), expression: "0 9 * * *" },
  { label: t("Jours ouvrés à 9 h"), expression: "0 9 * * 1-5" },
  { label: t("Chaque lundi à 8 h 30"), expression: "30 8 * * 1" },
  { label: t("Le 1er de chaque mois à minuit"), expression: "0 0 1 * *" },
  { label: t("Chaque dimanche à 3 h"), expression: "0 3 * * 0" },
]);

/** Découpe l'expression et refuse tout ce qui n'a pas exactement cinq champs. */
export function splitCron(expression: string): string[] {
  const parts = expression.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) throw new CronError(t("L'expression est vide."));
  if (parts.length === 6 || parts.length === 7) {
    throw new CronError(
      t("Cette expression compte {count} champs : c'est la syntaxe Quartz (secondes et année). FourTout lit le cron Unix à cinq champs — retirez le champ des secondes.", { count: parts.length }),
    );
  }
  if (parts.length !== 5) {
    throw new CronError(
      t("Une expression cron compte cinq champs (minute, heure, jour du mois, mois, jour de la semaine) ; celle-ci en a {count}.", { count: parts.length }),
    );
  }
  return parts;
}

export function buildCron(fields: Record<CronField["key"], string>): string {
  return [fields.minute, fields.hour, fields.dayOfMonth, fields.month, fields.dayOfWeek]
    .map((value) => (value.trim().length === 0 ? "*" : value.trim()))
    .join(" ");
}

export function explainCron(
  expression: string,
  reference: Date = new Date(),
  occurrenceCount = 5,
): CronExplanation {
  const parts = splitCron(expression);
  const normalized = parts.join(" ");

  let description: string;
  try {
    description = cronstrue.toString(normalized, { locale: "fr", use24HourTimeFormat: true });
  } catch (error) {
    throw new CronError(
      error instanceof Error ? error.message : t("Cette expression cron n'est pas valide."),
    );
  }

  const occurrences: Date[] = [];
  const warnings: string[] = [];
  try {
    const iterator = CronExpressionParser.parse(normalized, { currentDate: reference });
    for (let i = 0; i < occurrenceCount; i += 1) occurrences.push(iterator.next().toDate());
  } catch (error) {
    warnings.push(
      t("Les prochaines occurrences n'ont pas pu être calculées : {reason}", {
        reason: error instanceof Error ? error.message : t("expression trop inhabituelle."),
      }),
    );
  }

  // Piège classique de crontab : quand les deux champs de jour sont restreints,
  // cron déclenche si **l'un ou l'autre** correspond, pas les deux.
  if (parts[2] !== "*" && parts[4] !== "*") {
    warnings.push(
      t("Le jour du mois et le jour de la semaine sont tous deux restreints : cron déclenche alors dès que l'un OU l'autre correspond, pas seulement quand les deux correspondent."),
    );
  }

  return {
    expression: normalized,
    description,
    fields: FIELD_LABELS.map((field, index) => ({ ...field, value: parts[index] })),
    occurrences,
    warnings,
  };
}
