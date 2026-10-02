import { useState } from "react";
import { Field, Fieldset, OptionGroup, TextInput } from "@/components/pdf/Field";
import { InputError, ResultBlock } from "@/components/calc/CalcShell";
import { percentChange, percentOf, percentShare, ruleOfThree } from "@/core/calc/arithmetic";
import { formatWithGrouping, parseNumber } from "@/core/units";
import type { ToolComponentProps } from "@/tools/implementations";
import { Trans, t } from "@/i18n";

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
      error = failure instanceof Error ? failure.message : t("Calcul impossible.");
    }
  }

  const labels: Record<PercentageMode, [string, string, string]> = {
    of: ["Pourcentage", t("Valeur totale"), t("Résultat")],
    share: ["Partie", "Total", "Proportion"],
    change: [t("Valeur de départ"), t("Valeur d'arrivée"), "Variation"],
  };
  const [firstLabel, secondLabel] = labels[mode];

  return (
    <div className="space-y-4">
      <Fieldset columns={1}>
        <Field label={t("Que voulez-vous calculer ?")}>
          <OptionGroup
            ariaLabel={t("Type de calcul")}
            value={mode}
            onChange={setMode}
            options={[
              { value: "of", label: t("X % de Y") },
              { value: "share", label: t("X est quel % de Y") },
              { value: "change", label: t("Variation de A à B") },
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
            ? t("Les deux champs doivent contenir un nombre.")
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
                    label: t("Total augmenté"),
                    value: formatWithGrouping((second.value ?? 0) + output.value),
                  },
                  {
                    label: t("Total diminué"),
                    value: formatWithGrouping((second.value ?? 0) - output.value),
                  },
                ]
              : output.note
                ? [{ label: t("Lecture"), value: output.note }]
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
      error = failure instanceof Error ? failure.message : t("Calcul impossible.");
    }
  }

  return (
    <div className="space-y-4">
      <p className="ft-meta">
        <Trans source={"Si <0>A</0> correspond à <1>B</1>, alors <2>C</2> correspond à combien ?"} components={[<strong className="text-[var(--ft-text)]" />, <strong className="text-[var(--ft-text)]" />, <strong className="text-[var(--ft-text)]" />]} />
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
        <Field label={t("correspond à B")}>
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
          a.invalid || b.invalid || c.invalid ? t("Les trois champs doivent contenir un nombre.") : error
        }
      />

      {output && (
        <ResultBlock
          value={formatWithGrouping(output.value)}
          formula={t("{formula}   —   {raw} → {raw2}, donc {raw3} → {value}", { formula: output.formula, raw: a.raw, raw2: b.raw, raw3: c.raw, value: formatWithGrouping(output.value) })}
        />
      )}
    </div>
  );
}
