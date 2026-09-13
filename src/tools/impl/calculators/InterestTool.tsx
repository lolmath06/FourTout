import { useMemo, useState } from "react";
import { Callout } from "@/components/ui/Callout";
import { Field, Fieldset, OptionGroup, Select, TextInput } from "@/components/pdf/Field";
import { InputError, ResultBlock } from "@/components/calc/CalcShell";
import {
  computeInterest,
  FREQUENCY_LABELS,
  formatMoney,
  formatRate,
  INTEREST_DISCLAIMER,
  type CompoundFrequency,
  type InterestMode,
} from "@/core/calc/interest";
import { parseNumber } from "@/core/units";
import type { ToolComponentProps } from "@/tools/implementations";

function useNumber(initial: string) {
  const [raw, setRaw] = useState(initial);
  const value = parseNumber(raw);
  return { raw, setRaw, value, invalid: raw.trim().length > 0 && value === undefined };
}

const frequencies = Object.entries(FREQUENCY_LABELS).map(([value, label]) => ({
  value: value as CompoundFrequency,
  label,
}));

/**
 * Intérêts simples et composés.
 *
 * Le tableau année par année est là pour rendre le résultat vérifiable : on
 * doit pouvoir suivre la progression ligne à ligne plutôt que de faire
 * confiance à un total. Les nombres affichés sont arrondis au centime, mais le
 * calcul, lui, ne l'est jamais en cours de route — arrondir à chaque période
 * décalerait le total de plusieurs euros sur vingt ans.
 */
export function InterestTool(_props: ToolComponentProps) {
  const [mode, setMode] = useState<InterestMode>("compound");
  const principal = useNumber("1000");
  const rate = useNumber("5");
  const years = useNumber("2");
  const [frequency, setFrequency] = useState<CompoundFrequency>("annual");
  const contribution = useNumber("0");

  const outcome = useMemo(() => {
    if (principal.value === undefined || rate.value === undefined || years.value === undefined) {
      return undefined;
    }
    try {
      return {
        result: computeInterest({
          mode,
          principal: principal.value,
          annualRatePercent: rate.value,
          years: years.value,
          frequency,
          contribution: contribution.value ?? 0,
        }),
      };
    } catch (failure) {
      return { error: failure instanceof Error ? failure.message : "Calcul impossible." };
    }
  }, [mode, principal.value, rate.value, years.value, frequency, contribution.value]);

  const result = outcome?.result;

  return (
    <div className="space-y-4">
      <Fieldset columns={1}>
        <Field label="Type d'intérêt">
          <OptionGroup
            ariaLabel="Type d'intérêt"
            value={mode}
            onChange={setMode}
            options={[
              { value: "simple", label: "Simple — sur le capital initial" },
              { value: "compound", label: "Composé — les intérêts produisent des intérêts" },
            ]}
          />
        </Field>
      </Fieldset>

      <Fieldset columns={3}>
        <Field label="Capital initial (€)">
          <TextInput
            value={principal.raw}
            inputMode="decimal"
            autoFocus
            onChange={(event) => principal.setRaw(event.target.value)}
            aria-label="Capital initial"
          />
        </Field>
        <Field label="Taux annuel (%)">
          <TextInput
            value={rate.raw}
            inputMode="decimal"
            onChange={(event) => rate.setRaw(event.target.value)}
            aria-label="Taux annuel"
          />
        </Field>
        <Field label="Durée (années)">
          <TextInput
            value={years.raw}
            inputMode="decimal"
            onChange={(event) => years.setRaw(event.target.value)}
            aria-label="Durée en années"
          />
        </Field>
      </Fieldset>

      <Fieldset columns={2}>
        <Field
          label="Capitalisation"
          hint={
            mode === "simple"
              ? "Sans effet en intérêt simple : les intérêts ne sont jamais réinvestis."
              : "Plus elle est fréquente, plus le taux effectif dépasse le taux affiché."
          }
        >
          <Select
            value={frequency}
            onChange={setFrequency}
            aria-label="Fréquence de capitalisation"
            options={frequencies}
          />
        </Field>
        <Field
          label="Versement régulier (€)"
          hint="Effectué à la fin de chaque période de capitalisation. Laissez 0 s'il n'y en a pas."
        >
          <TextInput
            value={contribution.raw}
            inputMode="decimal"
            onChange={(event) => contribution.setRaw(event.target.value)}
            aria-label="Versement régulier"
          />
        </Field>
      </Fieldset>

      <InputError
        message={
          principal.invalid || rate.invalid || years.invalid || contribution.invalid
            ? "Tous les champs doivent contenir un nombre."
            : outcome?.error
        }
      />

      {result && (
        <>
          <ResultBlock
            value={formatMoney(result.total)}
            formula={result.formula}
            secondary={[
              { label: "Capital initial", value: formatMoney(result.principal) },
              { label: "Versements cumulés", value: formatMoney(result.contributions) },
              { label: "Total investi", value: formatMoney(result.invested) },
              { label: "Intérêts produits", value: formatMoney(result.interest) },
              {
                label: "Taux annuel effectif",
                value: formatRate(result.effectiveAnnualRatePercent),
              },
              { label: "Périodes de capitalisation", value: String(result.periods) },
            ]}
          />

          {result.schedule.length > 1 && (
            <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
              <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">
                Année par année
              </h3>
              <div className="max-h-80 overflow-auto">
                <table className="ft-table">
                  <thead>
                    <tr>
                      <th scope="col">Année</th>
                      <th scope="col" className="text-right">
                        Investi
                      </th>
                      <th scope="col" className="text-right">
                        Intérêts
                      </th>
                      <th scope="col" className="text-right">
                        Capital
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.schedule.map((row) => (
                      <tr key={row.year}>
                        <th scope="row" className="font-normal">
                          {row.year}
                        </th>
                        <td className="ft-value text-right">{formatMoney(row.invested)}</td>
                        <td className="ft-value text-right">{formatMoney(row.interest)}</td>
                        <td className="ft-value text-right font-medium">
                          {formatMoney(row.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <Callout tone="neutral" title="Outil mathématique">
            {INTEREST_DISCLAIMER}
          </Callout>
        </>
      )}
    </div>
  );
}
