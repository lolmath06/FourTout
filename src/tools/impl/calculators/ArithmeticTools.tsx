import { useState } from "react";
import { Field, Fieldset, OptionGroup, TextInput } from "@/components/pdf/Field";
import { InputError, ResultBlock } from "@/components/calc/CalcShell";
import { percentChange, percentOf, percentShare, ruleOfThree } from "@/core/calc/arithmetic";
import { formatWithGrouping, parseNumber } from "@/core/units";
import type { ToolComponentProps } from "@/tools/implementations";

/** Lecture d'un champ numérique, avec le message d'erreur qui va avec. */
function useNumber(initial: string) {
  const [raw, setRaw] = useState(initial);
  const value = parseNumber(raw);
  return {
    raw,
    setRaw,
    value,
    invalid: raw.trim().length > 0 && value === undefined,
  };
}

type PercentageMode = "of" | "share" | "change";

/**
 * Pourcentages, dans les trois formes qu'on cherche réellement.
 *
 * Les trois questions sont posées en toutes lettres plutôt qu'avec des
 * étiquettes abstraites : « X % de Y » et « X est quel % de Y » se confondent
 * dès qu'on les réduit à « valeur » et « total ».
 */
export function PercentageTool(_props: ToolComponentProps) {
  const [mode, setMode] = useState<PercentageMode>("of");
  const first = useNumber("20");
  const second = useNumber("250");

  let output: { value: number; formula: string; note?: string } | undefined;
  let error: string | undefined;

  if (first.value !== undefined && second.value !== undefined) {
    try {
      output =
        mode === "of"
          ? percentOf(first.value, second.value)
          : mode === "share"
            ? percentShare(first.value, second.value)
            : percentChange(first.value, second.value);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : "Calcul impossible.";
    }
  }

  const labels: Record<PercentageMode, [string, string, string]> = {
    of: ["Pourcentage", "Valeur totale", "Résultat"],
    share: ["Partie", "Total", "Proportion"],
    change: ["Valeur de départ", "Valeur d'arrivée", "Variation"],
  };
  const [firstLabel, secondLabel] = labels[mode];

  return (
    <div className="space-y-4">
      <Fieldset columns={1}>
        <Field label="Que voulez-vous calculer ?">
          <OptionGroup
            ariaLabel="Type de calcul"
            value={mode}
            onChange={setMode}
            options={[
              { value: "of", label: "X % de Y" },
              { value: "share", label: "X est quel % de Y" },
              { value: "change", label: "Variation de A à B" },
            ]}
          />
        </Field>
      </Fieldset>

      <Fieldset columns={2}>
        <Field label={firstLabel}>
          <TextInput
            value={first.raw}
            inputMode="decimal"
            autoFocus
            onChange={(event) => first.setRaw(event.target.value)}
            aria-label={firstLabel}
          />
        </Field>
        <Field label={secondLabel}>
          <TextInput
            value={second.raw}
            inputMode="decimal"
            onChange={(event) => second.setRaw(event.target.value)}
            aria-label={secondLabel}
          />
        </Field>
      </Fieldset>

      <InputError
        message={
          first.invalid || second.invalid
            ? "Les deux champs doivent contenir un nombre."
            : error
        }
      />

      {output && (
        <ResultBlock
          value={formatWithGrouping(output.value)}
          unit={mode === "of" ? undefined : "%"}
          formula={output.formula}
          secondary={
            mode === "of"
              ? [
                  {
                    label: "Total augmenté",
                    value: formatWithGrouping((second.value ?? 0) + output.value),
                  },
                  {
                    label: "Total diminué",
                    value: formatWithGrouping((second.value ?? 0) - output.value),
                  },
                ]
              : output.note
                ? [{ label: "Lecture", value: output.note }]
                : undefined
          }
        />
      )}
    </div>
  );
}

/**
 * Règle de trois.
 *
 * L'énoncé est affiché tel qu'on le formule à l'oral : « si A correspond à B,
 * alors C correspond à ? ». C'est ce qui rend l'outil utilisable sans avoir à
 * se rappeler quelle valeur va où.
 */
export function ProportionTool(_props: ToolComponentProps) {
  const a = useNumber("3");
  const b = useNumber("12");
  const c = useNumber("7");

  let output: { value: number; formula: string } | undefined;
  let error: string | undefined;
  if (a.value !== undefined && b.value !== undefined && c.value !== undefined) {
    try {
      output = ruleOfThree(a.value, b.value, c.value);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : "Calcul impossible.";
    }
  }

  return (
    <div className="space-y-4">
      <p className="ft-meta">
        Si <strong className="text-[var(--ft-text)]">A</strong> correspond à{" "}
        <strong className="text-[var(--ft-text)]">B</strong>, alors{" "}
        <strong className="text-[var(--ft-text)]">C</strong> correspond à combien ?
      </p>

      <Fieldset columns={3}>
        <Field label="A">
          <TextInput
            value={a.raw}
            inputMode="decimal"
            autoFocus
            onChange={(event) => a.setRaw(event.target.value)}
            aria-label="A"
          />
        </Field>
        <Field label="correspond à B">
          <TextInput
            value={b.raw}
            inputMode="decimal"
            onChange={(event) => b.setRaw(event.target.value)}
            aria-label="B"
          />
        </Field>
        <Field label="C">
          <TextInput
            value={c.raw}
            inputMode="decimal"
            onChange={(event) => c.setRaw(event.target.value)}
            aria-label="C"
          />
        </Field>
      </Fieldset>

      <InputError
        message={
          a.invalid || b.invalid || c.invalid ? "Les trois champs doivent contenir un nombre." : error
        }
      />

      {output && (
        <ResultBlock
          value={formatWithGrouping(output.value)}
          formula={`${output.formula}   —   ${a.raw} → ${b.raw}, donc ${c.raw} → ${formatWithGrouping(output.value)}`}
        />
      )}
    </div>
  );
}
