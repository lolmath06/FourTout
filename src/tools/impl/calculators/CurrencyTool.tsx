import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Callout } from "@/components/ui/Callout";
import { Field, Fieldset, Select, TextInput } from "@/components/pdf/Field";
import { InputError, ResultBlock, ValueTable } from "@/components/calc/CalcShell";
import {
  convertCurrency,
  currencyLabel,
  CURRENCY_NOTE,
  describeAge,
  loadRates,
  unitRate,
  type RateResult,
} from "@/core/currency";
import { formatWithGrouping, parseNumber } from "@/core/units";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Convertisseur de devises.
 *
 * Le seul outil de FourTout qui a besoin d'Internet, et il le dit :
 *
 *  - la date du relevé est affichée en permanence, jamais masquée ;
 *  - hors ligne, le dernier relevé connu est utilisé **et daté** ;
 *  - si aucun relevé n'a jamais été téléchargé, aucun chiffre n'est affiché.
 *    Inventer un taux serait bien pire que ne rien afficher.
 */
export function CurrencyTool(_props: ToolComponentProps) {
  const [rates, setRates] = useState<RateResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [raw, setRaw] = useState("100");
  const [from, setFrom] = useState("EUR");
  const [to, setTo] = useState("USD");

  const refresh = useCallback(async (force: boolean) => {
    setLoading(true);
    setError(undefined);
    try {
      setRates(await loadRates({ force }));
    } catch (failure) {
      setRates(undefined);
      setError(failure instanceof Error ? failure.message : "Taux indisponibles.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  const amount = parseNumber(raw);
  const snapshot = rates?.snapshot;
  const codes = snapshot?.rates.map(([code]) => code) ?? [];

  let converted: number | undefined;
  let conversionError: string | undefined;
  if (snapshot && amount !== undefined) {
    try {
      converted = convertCurrency(amount, from, to, snapshot);
    } catch (failure) {
      conversionError = failure instanceof Error ? failure.message : undefined;
    }
  }

  return (
    <div className="space-y-4">
      {loading && !snapshot && (
        <p className="ft-meta flex items-center gap-2">
          <Icon name="Loader" size={14} className="animate-spin" />
          Récupération des taux de la Banque centrale européenne…
        </p>
      )}

      {error && (
        <Callout tone="error" title="Aucun taux disponible">
          {error}
        </Callout>
      )}

      {snapshot && (
        <>
          {rates?.warning && (
            <Callout tone="warning" title="Taux non actualisés">
              {rates.warning}
            </Callout>
          )}

          <Fieldset columns={3} title="Conversion">
            <Field label="Montant">
              <TextInput
                value={raw}
                inputMode="decimal"
                autoFocus
                onChange={(event) => setRaw(event.target.value)}
                aria-label="Montant à convertir"
                data-testid="currency-amount"
              />
            </Field>
            <Field label="De">
              <Select
                value={from}
                onChange={setFrom}
                aria-label="Devise de départ"
                options={codes.map((code) => ({ value: code, label: currencyLabel(code) }))}
              />
            </Field>
            <Field label="Vers">
              <Select
                value={to}
                onChange={setTo}
                aria-label="Devise d'arrivée"
                options={codes.map((code) => ({ value: code, label: currencyLabel(code) }))}
              />
            </Field>
          </Fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <span className="ft-meta ft-num flex-1">
              {describeAge(snapshot)} · {snapshot.source}
            </span>
            <Button
              size="sm"
              onClick={() => {
                setFrom(to);
                setTo(from);
              }}
            >
              <Icon name="ArrowUpDown" size={13} /> Inverser
            </Button>
            <Button size="sm" onClick={() => void refresh(true)} disabled={loading}>
              <Icon name="RefreshCw" size={13} className={loading ? "animate-spin" : undefined} />
              Actualiser
            </Button>
          </div>

          <InputError
            message={
              raw.trim().length > 0 && amount === undefined
                ? `« ${raw} » n'est pas un montant valide.`
                : conversionError
            }
          />

          {converted !== undefined && (
            <ResultBlock
              value={formatWithGrouping(converted, 12)}
              unit={to}
              formula={`1 ${from} = ${formatWithGrouping(unitRate(from, to, snapshot), 8)} ${to}   ·   1 ${to} = ${formatWithGrouping(unitRate(to, from, snapshot), 8)} ${from}`}
            />
          )}

          {amount !== undefined && (
            <ValueTable
              caption={`${formatWithGrouping(amount)} ${from} dans les autres devises`}
              rows={snapshot.rates
                .filter(([code]) => code !== from)
                .map(([code]) => ({
                  label: currencyLabel(code),
                  value: formatWithGrouping(convertCurrency(amount, from, code, snapshot), 10),
                  highlight: code === to,
                }))}
            />
          )}

          <Callout tone="info" title="Taux indicatifs">
            {CURRENCY_NOTE}
          </Callout>
        </>
      )}
    </div>
  );
}
