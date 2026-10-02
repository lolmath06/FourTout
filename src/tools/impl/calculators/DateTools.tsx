import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Field, Fieldset, OptionGroup, Select, TextInput } from "@/components/pdf/Field";
import { TextPane } from "@/components/text/TextToolShell";
import { InputError, ResultBlock, ValueTable } from "@/components/calc/CalcShell";
import {
  addToDate,
  computeAge,
  dateDifference,
  describeDuration,
  formatDuration,
  parseDateOnly,
  parseDuration,
  toDateOnly,
  type DateUnit,
} from "@/core/calc/datetime";
import type { ToolComponentProps } from "@/tools/implementations";
import { Trans, formatDate, formatNumber, t, tx } from "@/i18n";

const today = () => toDateOnly(new Date());

/** Champ de date, avec message d'erreur explicite plutôt qu'un champ vide. */
function DateField({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <Field label={tx(label)}>
      <TextInput
        type="date"
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        aria-label={tx(label)}
      />
    </Field>
  );
}

/**
 * Différence entre deux dates, et ajout d'une durée calendaire.
 *
 * Les deux opérations vivent dans le même outil parce qu'elles répondent à la
 * même question posée dans les deux sens, et parce que l'utilisateur passe de
 * l'une à l'autre en permanence.
 */
export function DateDifferenceTool(_props: ToolComponentProps) {
  const [mode, setMode] = useState<"difference" | "add">("difference");
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [amount, setAmount] = useState("30");
  const [unit, setUnit] = useState<DateUnit>("days");
  const [direction, setDirection] = useState<"add" | "subtract">("add");

  const start = parseDateOnly(from);
  const end = parseDateOnly(to);

  const difference = useMemo(
    () => (start && end ? dateDifference(start, end) : undefined),
    [start, end],
  );

  const quantity = Number.parseInt(amount, 10);
  const shifted = useMemo(() => {
    if (!start || !Number.isFinite(quantity)) return undefined;
    return addToDate(start, direction === "add" ? quantity : -quantity, unit);
  }, [start, quantity, unit, direction]);

  return (
    <div className="space-y-4">
      <Fieldset columns={1}>
        <Field label={t("Opération")}>
          <OptionGroup
            ariaLabel={t("Opération")}
            value={mode}
            onChange={setMode}
            options={[
              { value: "difference", label: t("Entre deux dates") },
              { value: "add", label: t("Ajouter ou retirer") },
            ]}
          />
        </Field>
      </Fieldset>

      {mode === "difference" ? (
        <>
          <Fieldset columns={2}>
            <DateField label={t("Date de départ")} value={from} onChange={setFrom} autoFocus />
            <DateField label={t("Date d'arrivée")} value={to} onChange={setTo} />
          </Fieldset>

          <InputError
            message={!start || !end ? t("Renseignez deux dates valides (jour, mois, année).") : undefined}
          />

          {difference && (
            <>
              <ResultBlock
                value={formatNumber(difference.days)}
                unit={Math.abs(difference.days) > 1 ? "jours" : "jour"}
                formula={t("du {from} au {to}", { from, to })}
              />
              <ValueTable
                caption={t("Autres lectures")}
                rows={[
                  {
                    label: t("Semaines et jours"),
                    value: t("{weeks} {value, plural, one {semaine} other {semaines}} et {value2} {value2, plural, one {jour} other {jours}}", { weeks: difference.weeks, value: Math.abs(difference.weeks), value2: Math.abs(difference.remainingDays) }),
                  },
                  {
                    label: t("Années, mois et jours"),
                    value: t("{years} {value, plural, one {an} other {ans}}, {value2} mois et {value3} {value3, plural, one {jour} other {jours}}", { years: difference.years, value: Math.abs(difference.years), value2: Math.abs(difference.months), value3: Math.abs(difference.daysAfterMonths) }),
                  },
                  {
                    label: t("Jours ouvrés"),
                    hint: t("lundi à vendredi, bornes comprises"),
                    value: formatNumber(difference.businessDays),
                  },
                  {
                    label: t("Heures"),
                    value: formatNumber((difference.days * 24)),
                  },
                ]}
              />
            </>
          )}
        </>
      ) : (
        <>
          <Fieldset columns={2}>
            <DateField label={t("Date de départ")} value={from} onChange={setFrom} autoFocus />
            <Field label={t("Sens")}>
              <OptionGroup
                ariaLabel={t("Sens")}
                value={direction}
                onChange={setDirection}
                options={[
                  { value: "add", label: t("Ajouter") },
                  { value: "subtract", label: t("Retirer") },
                ]}
              />
            </Field>
            <Field label={t("Quantité")}>
              <TextInput
                value={amount}
                inputMode="numeric"
                onChange={(event) => setAmount(event.target.value)}
                aria-label={t("Quantité")}
              />
            </Field>
            <Field label={t("Unité")} hint={t("Mois et années suivent le calendrier, pas 30 ou 365 jours.")}>
              <Select
                value={unit}
                onChange={setUnit}
                aria-label={t("Unité")}
                options={[
                  { value: "days", label: "jours" },
                  { value: "weeks", label: "semaines" },
                  { value: "months", label: "mois" },
                  { value: "years", label: t("années") },
                ]}
              />
            </Field>
          </Fieldset>

          <InputError
            message={
              !start
                ? t("Renseignez une date valide.")
                : !Number.isFinite(quantity)
                  ? t("La quantité doit être un nombre entier.")
                  : undefined
            }
          />

          {shifted && (
            <ResultBlock
              value={toDateOnly(shifted)}
              formula={formatDate(shifted, {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Calculs de durées.
 *
 * Une ligne par durée, plusieurs écritures acceptées (`1:30:00`, `1h30`,
 * `90m`, `90`). Un signe moins en tête soustrait — c'est la façon la plus
 * simple de mélanger additions et retraits sans deuxième colonne.
 */
export function DurationTool(_props: ToolComponentProps) {
  const [input, setInput] = useState("01:30:00\n0:45\n-0:15");

  const lines = input.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const parsed = lines.map((line) => ({ line, seconds: parseDuration(line) }));
  const invalid = parsed.filter((entry) => entry.seconds === undefined);
  const total = parsed.reduce((sum, entry) => sum + (entry.seconds ?? 0), 0);
  const breakdown = describeDuration(total);

  return (
    <div className="space-y-4">
      <TextPane
        label={t("Durées, une par ligne")}
        value={input}
        onChange={setInput}
        placeholder={"01:30:00\n1h30\n90m\n-0:15"}
        minHeight="9rem"
      />

      <p className="ft-meta">
        <Trans source={"Écritures acceptées : <0>hh:mm:ss</0>, <1>hh:mm</1>, <2>1h30</2>, <3>90m</3>, <4>45s</4>, ou un nombre seul (minutes). Un signe moins en tête soustrait la ligne."} components={[<code />, <code />, <code />, <code />, <code />]} />
      </p>

      <InputError
        message={
          invalid.length > 0
            ? t("{count, plural, one {Ligne} other {Lignes}} non {count, plural, one {comprise} other {comprises}} : {value}", { count: invalid.length, value: invalid
                .map((entry) => `« ${entry.line} »`)
                .join(", ") })
            : undefined
        }
      />

      {parsed.length > 0 && invalid.length === 0 && (
        <>
          <ResultBlock value={breakdown.formatted} formula={breakdown.human} />
          <ValueTable
            caption={t("Le même total, autrement")}
            rows={[
              { label: t("Secondes"), value: formatNumber(Math.round(breakdown.seconds)) },
              { label: t("Minutes"), value: breakdown.minutes.toFixed(2) },
              { label: t("Heures"), value: breakdown.hours.toFixed(3) },
              { label: t("Jours"), value: breakdown.days.toFixed(4) },
            ]}
          />
          <ValueTable
            caption={t("Détail des lignes")}
            rows={parsed.map((entry, index) => ({
              label: `${index + 1}. ${entry.line}`,
              value: formatDuration(entry.seconds ?? 0),
            }))}
          />
        </>
      )}
    </div>
  );
}

/**
 * Âge à une date de référence.
 *
 * Le prochain anniversaire est affiché parce que c'est la deuxième question
 * qu'on se pose immédiatement après la première.
 */
export function AgeTool(_props: ToolComponentProps) {
  const [birth, setBirth] = useState("1990-05-15");
  const [reference, setReference] = useState(today());

  const birthDate = parseDateOnly(birth);
  const referenceDate = parseDateOnly(reference);

  let age: ReturnType<typeof computeAge> | undefined;
  let error: string | undefined;
  if (birthDate && referenceDate) {
    try {
      age = computeAge(birthDate, referenceDate);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : t("Calcul impossible.");
    }
  }

  return (
    <div className="space-y-4">
      <Fieldset columns={2}>
        <DateField label={t("Date de naissance")} value={birth} onChange={setBirth} autoFocus />
        <DateField label={t("Date de référence")} value={reference} onChange={setReference} />
      </Fieldset>

      <div className="flex justify-end">
        <Button size="sm" onClick={() => setReference(today())}>
          <Icon name="Clock3" size={13} />{" "}{t("Aujourd'hui")}
        </Button>
      </div>

      <InputError
        message={!birthDate || !referenceDate ? t("Renseignez deux dates valides.") : error}
      />

      {age && (
        <>
          <ResultBlock
            value={String(age.years)}
            unit={age.years > 1 ? "ans" : "an"}
            formula={`${age.years} an${age.years > 1 ? "s" : ""}, ${age.months} mois et ${age.days} jour${age.days > 1 ? "s" : ""}`}
          />
          <ValueTable
            caption={t("Détail")}
            rows={[
              { label: t("Jours vécus"), value: formatNumber(age.totalDays) },
              { label: t("Semaines vécues"), value: formatNumber(age.totalWeeks) },
              { label: t("Prochain anniversaire"), value: toDateOnly(age.nextBirthday) },
              {
                label: t("Dans"),
                value: `${formatNumber(age.daysUntilNextBirthday)} jour${age.daysUntilNextBirthday > 1 ? "s" : ""}`,
              },
            ]}
          />
        </>
      )}
    </div>
  );
}
