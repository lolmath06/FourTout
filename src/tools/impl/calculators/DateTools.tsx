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
    <Field label={label}>
      <TextInput
        type="date"
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
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
        <Field label="Opération">
          <OptionGroup
            ariaLabel="Opération"
            value={mode}
            onChange={setMode}
            options={[
              { value: "difference", label: "Entre deux dates" },
              { value: "add", label: "Ajouter ou retirer" },
            ]}
          />
        </Field>
      </Fieldset>

      {mode === "difference" ? (
        <>
          <Fieldset columns={2}>
            <DateField label="Date de départ" value={from} onChange={setFrom} autoFocus />
            <DateField label="Date d'arrivée" value={to} onChange={setTo} />
          </Fieldset>

          <InputError
            message={!start || !end ? "Renseignez deux dates valides (jour, mois, année)." : undefined}
          />

          {difference && (
            <>
              <ResultBlock
                value={difference.days.toLocaleString("fr-FR")}
                unit={Math.abs(difference.days) > 1 ? "jours" : "jour"}
                formula={`du ${from} au ${to}`}
              />
              <ValueTable
                caption="Autres lectures"
                rows={[
                  {
                    label: "Semaines et jours",
                    value: `${difference.weeks} semaine${Math.abs(difference.weeks) > 1 ? "s" : ""} et ${Math.abs(difference.remainingDays)} jour${Math.abs(difference.remainingDays) > 1 ? "s" : ""}`,
                  },
                  {
                    label: "Années, mois et jours",
                    value: `${difference.years} an${Math.abs(difference.years) > 1 ? "s" : ""}, ${Math.abs(difference.months)} mois et ${Math.abs(difference.daysAfterMonths)} jour${Math.abs(difference.daysAfterMonths) > 1 ? "s" : ""}`,
                  },
                  {
                    label: "Jours ouvrés",
                    hint: "lundi à vendredi, bornes comprises",
                    value: difference.businessDays.toLocaleString("fr-FR"),
                  },
                  {
                    label: "Heures",
                    value: (difference.days * 24).toLocaleString("fr-FR"),
                  },
                ]}
              />
            </>
          )}
        </>
      ) : (
        <>
          <Fieldset columns={2}>
            <DateField label="Date de départ" value={from} onChange={setFrom} autoFocus />
            <Field label="Sens">
              <OptionGroup
                ariaLabel="Sens"
                value={direction}
                onChange={setDirection}
                options={[
                  { value: "add", label: "Ajouter" },
                  { value: "subtract", label: "Retirer" },
                ]}
              />
            </Field>
            <Field label="Quantité">
              <TextInput
                value={amount}
                inputMode="numeric"
                onChange={(event) => setAmount(event.target.value)}
                aria-label="Quantité"
              />
            </Field>
            <Field label="Unité" hint="Mois et années suivent le calendrier, pas 30 ou 365 jours.">
              <Select
                value={unit}
                onChange={setUnit}
                aria-label="Unité"
                options={[
                  { value: "days", label: "jours" },
                  { value: "weeks", label: "semaines" },
                  { value: "months", label: "mois" },
                  { value: "years", label: "années" },
                ]}
              />
            </Field>
          </Fieldset>

          <InputError
            message={
              !start
                ? "Renseignez une date valide."
                : !Number.isFinite(quantity)
                  ? "La quantité doit être un nombre entier."
                  : undefined
            }
          />

          {shifted && (
            <ResultBlock
              value={toDateOnly(shifted)}
              formula={shifted.toLocaleDateString("fr-FR", {
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
        label="Durées, une par ligne"
        value={input}
        onChange={setInput}
        placeholder={"01:30:00\n1h30\n90m\n-0:15"}
        minHeight="9rem"
      />

      <p className="ft-meta">
        Écritures acceptées : <code>hh:mm:ss</code>, <code>hh:mm</code>, <code>1h30</code>,{" "}
        <code>90m</code>, <code>45s</code>, ou un nombre seul (minutes). Un signe moins en tête
        soustrait la ligne.
      </p>

      <InputError
        message={
          invalid.length > 0
            ? `Ligne${invalid.length > 1 ? "s" : ""} non comprise${invalid.length > 1 ? "s" : ""} : ${invalid
                .map((entry) => `« ${entry.line} »`)
                .join(", ")}`
            : undefined
        }
      />

      {parsed.length > 0 && invalid.length === 0 && (
        <>
          <ResultBlock value={breakdown.formatted} formula={breakdown.human} />
          <ValueTable
            caption="Le même total, autrement"
            rows={[
              { label: "Secondes", value: Math.round(breakdown.seconds).toLocaleString("fr-FR") },
              { label: "Minutes", value: breakdown.minutes.toFixed(2) },
              { label: "Heures", value: breakdown.hours.toFixed(3) },
              { label: "Jours", value: breakdown.days.toFixed(4) },
            ]}
          />
          <ValueTable
            caption="Détail des lignes"
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
      error = failure instanceof Error ? failure.message : "Calcul impossible.";
    }
  }

  return (
    <div className="space-y-4">
      <Fieldset columns={2}>
        <DateField label="Date de naissance" value={birth} onChange={setBirth} autoFocus />
        <DateField label="Date de référence" value={reference} onChange={setReference} />
      </Fieldset>

      <div className="flex justify-end">
        <Button size="sm" onClick={() => setReference(today())}>
          <Icon name="Clock3" size={13} /> Aujourd'hui
        </Button>
      </div>

      <InputError
        message={!birthDate || !referenceDate ? "Renseignez deux dates valides." : error}
      />

      {age && (
        <>
          <ResultBlock
            value={String(age.years)}
            unit={age.years > 1 ? "ans" : "an"}
            formula={`${age.years} an${age.years > 1 ? "s" : ""}, ${age.months} mois et ${age.days} jour${age.days > 1 ? "s" : ""}`}
          />
          <ValueTable
            caption="Détail"
            rows={[
              { label: "Jours vécus", value: age.totalDays.toLocaleString("fr-FR") },
              { label: "Semaines vécues", value: age.totalWeeks.toLocaleString("fr-FR") },
              { label: "Prochain anniversaire", value: toDateOnly(age.nextBirthday) },
              {
                label: "Dans",
                value: `${age.daysUntilNextBirthday.toLocaleString("fr-FR")} jour${age.daysUntilNextBirthday > 1 ? "s" : ""}`,
              },
            ]}
          />
        </>
      )}
    </div>
  );
}
