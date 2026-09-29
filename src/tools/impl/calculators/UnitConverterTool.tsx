import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Field, Fieldset, Select, TextInput } from "@/components/pdf/Field";
import { InputError, ResultBlock, ValueTable } from "@/components/calc/CalcShell";
import {
  convert,
  dimension,
  formatNumber,
  formatWithGrouping,
  parseNumber,
  type DimensionId,
} from "@/core/units";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Convertisseur d'unités, unique pour les dix cartes du catalogue.
 *
 * La dimension est fixée par l'outil qui monte ce composant ; tout le reste
 * — lecture de la saisie, conversion, mise en forme, table de toutes les
 * unités — est identique. Écrire dix écrans aurait produit dix arrondis
 * différents.
 */
export function UnitConverterTool({ dimensionId }: { dimensionId: DimensionId }) {
  const definition = useMemo(() => dimension(dimensionId), [dimensionId]);
  const [raw, setRaw] = useState("1");
  const [from, setFrom] = useState(definition.defaults[0]);
  const [to, setTo] = useState(definition.defaults[1]);

  const amount = parseNumber(raw);
  const invalid = raw.trim().length > 0 && amount === undefined;

  const result = amount === undefined ? undefined : convert(amount, dimensionId, from, to);
  const fromUnit = definition.units.find((unit) => unit.id === from);
  const toUnit = definition.units.find((unit) => unit.id === to);

  const swap = () => {
    setFrom(to);
    setTo(from);
    // La valeur convertie devient la nouvelle saisie : c'est ce qu'on attend
    // d'un bouton d'inversion, sinon le résultat affiché change de sens.
    if (result !== undefined) setRaw(formatNumber(result));
  };

  const rows = definition.units.map((unit) => ({
    label: `${unit.name} (${unit.symbol})`,
    hint: unit.note,
    value:
      amount === undefined ? "—" : formatWithGrouping(convert(amount, dimensionId, from, unit.id)),
    highlight: unit.id === to,
  }));

  return (
    <div className="space-y-4">
      <Fieldset columns={3} title={definition.name}>
        <Field label="Valeur" hint="La virgule et les espaces sont acceptés.">
          <TextInput
            value={raw}
            inputMode="decimal"
            autoFocus
            onChange={(event) => setRaw(event.target.value)}
            aria-label="Valeur à convertir"
            data-testid="unit-input"
          />
        </Field>
        <Field label="De">
          <Select
            value={from}
            onChange={setFrom}
            aria-label="Unité de départ"
            options={definition.units.map((unit) => ({
              value: unit.id,
              label: `${unit.symbol} — ${unit.name}`,
            }))}
          />
        </Field>
        <Field label="Vers">
          <Select
            value={to}
            onChange={setTo}
            aria-label="Unité d'arrivée"
            options={definition.units.map((unit) => ({
              value: unit.id,
              label: `${unit.symbol} — ${unit.name}`,
            }))}
          />
        </Field>
      </Fieldset>

      <div className="flex justify-end">
        <Button size="sm" onClick={swap} disabled={result === undefined}>
          <Icon name="ArrowUpDown" size={13} /> Inverser
        </Button>
      </div>

      <InputError
        message={
          invalid ? `« ${raw} » n'est pas un nombre. Utilisez des chiffres, avec une virgule ou un point.` : undefined
        }
      />

      {result !== undefined && (
        <ResultBlock
          value={formatWithGrouping(result)}
          unit={toUnit?.symbol}
          formula={`${formatNumber(amount ?? 0)} ${fromUnit?.symbol ?? ""} → ${toUnit?.symbol ?? ""}${
            toUnit?.note ? ` · ${toUnit.note}` : ""
          }`}
        />
      )}

      <ValueTable rows={rows} caption="Toutes les unités" />
    </div>
  );
}

/**
 * Fabrique le composant d'un outil à partir de sa dimension. Le catalogue
 * référence dix identifiants ; ils pointent tous ici.
 */
function unitTool(dimensionId: DimensionId) {
  return function UnitTool(_props: ToolComponentProps) {
    return <UnitConverterTool dimensionId={dimensionId} />;
  };
}

export const UnitLengthTool = unitTool("length");
export const UnitMassTool = unitTool("mass");
export const UnitTemperatureTool = unitTool("temperature");
export const UnitVolumeTool = unitTool("volume");
export const UnitAreaTool = unitTool("area");
export const UnitSpeedTool = unitTool("speed");
export const UnitPressureTool = unitTool("pressure");
export const UnitEnergyTool = unitTool("energy");
export const UnitPowerTool = unitTool("power");
export const UnitDataTool = unitTool("data");
