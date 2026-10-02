import { useMemo, useState } from "react";
import { Callout } from "@/components/ui/Callout";
import { Field, Fieldset, Select, TextInput } from "@/components/pdf/Field";
import { InputError, ResultBlock, ValueTable } from "@/components/calc/CalcShell";
import {
  BITS_VERSUS_BYTES_NOTE,
  RATE_UNITS,
  SIZE_UNITS,
  TRANSFER_THEORETICAL_NOTE,
  bandwidthFromTransfer,
  transferTime,
  type RateView,
} from "@/core/calc/bandwidth";
import { formatWithGrouping, parseNumber } from "@/core/units";
import type { ToolComponentProps } from "@/tools/implementations";
import { Trans, localized, t, tx } from "@/i18n";

const sizeOptions = localized(() => SIZE_UNITS.map((unit) => ({ value: unit.id, label: unit.label })));
const rateOptions = localized(() => RATE_UNITS.map((unit) => ({ value: unit.id, label: unit.label })));

/** Nombre lisible : beaucoup de décimales pour les petites valeurs, peu sinon. */
function pretty(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const digits = value >= 100 ? 1 : value >= 1 ? 3 : 6;
  return formatWithGrouping(Number(value.toFixed(digits)));
}

function rateRows(views: RateView[], basis: "bit" | "byte") {
  return views
    .filter((view) => view.basis === basis)
    .map((view) => ({
      label: view.label,
      value: pretty(view.value),
      hint: view.system === "iec" ? "×1024" : "×1000",
    }));
}

/** Champ numérique et son message d'erreur, partagés par les deux outils. */
function useNumber(initial: string) {
  const [raw, setRaw] = useState(initial);
  const value = parseNumber(raw);
  return { raw, setRaw, value, invalid: raw.trim().length > 0 && value === undefined };
}

/**
 * Bande passante : un volume, une durée, un débit moyen.
 *
 * Toutes les lectures du même débit sont affichées côte à côte — bits et
 * octets, préfixes décimaux et binaires — parce que c'est précisément entre ces
 * quatre colonnes que se logent les malentendus sur les débits.
 */
export function BandwidthTool(_props: ToolComponentProps) {
  const size = useNumber("1");
  const [sizeUnit, setSizeUnit] = useState("GiB");
  const duration = useNumber("8");

  const outcome = useMemo(() => {
    if (size.value === undefined || duration.value === undefined) return undefined;
    try {
      return { result: bandwidthFromTransfer(size.value, sizeUnit, duration.value) };
    } catch (failure) {
      return { error: failure instanceof Error ? failure.message : t("Calcul impossible.") };
    }
  }, [size.value, sizeUnit, duration.value]);

  return (
    <div className="space-y-4">
      <Callout tone="info" title={t("Bits, octets, 1000 et 1024")}>
        {BITS_VERSUS_BYTES_NOTE}
      </Callout>

      <Fieldset columns={3}>
        <Field label={t("Volume transféré")}>
          <TextInput
            value={size.raw}
            inputMode="decimal"
            autoFocus
            onChange={(event) => size.setRaw(event.target.value)}
            aria-label={t("Volume transféré")}
          />
        </Field>
        <Field label={t("Unité")}>
          <Select
            value={sizeUnit}
            onChange={setSizeUnit}
            aria-label={t("Unité de volume")}
            options={sizeOptions}
          />
        </Field>
        <Field label={t("Durée (secondes)")}>
          <TextInput
            value={duration.raw}
            inputMode="decimal"
            onChange={(event) => duration.setRaw(event.target.value)}
            aria-label={t("Durée en secondes")}
          />
        </Field>
      </Fieldset>

      <InputError
        message={
          size.invalid || duration.invalid
            ? t("Le volume et la durée doivent être des nombres.")
            : outcome?.error
        }
      />

      {outcome?.result && (
        <>
          <ResultBlock
            value={pretty(outcome.result.bestBitRate.value)}
            unit={tx(outcome.result.bestBitRate.label)}
            formula={t("{bits} bits ÷ {seconds} s", { bits: pretty(outcome.result.bits), seconds: pretty(outcome.result.seconds) })}
            secondary={[
              {
                label: t("En octets par seconde"),
                value: `${pretty(outcome.result.bestByteRate.value)} ${outcome.result.bestByteRate.label}`,
              },
              { label: t("En bits par seconde"), value: pretty(outcome.result.bitsPerSecond) },
            ]}
          />
          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="min-w-0 flex-1">
              <ValueTable
                caption={t("En bits par seconde")}
                rows={rateRows(outcome.result.views, "bit")}
              />
            </div>
            <div className="min-w-0 flex-1">
              <ValueTable
                caption={t("En octets par seconde")}
                rows={rateRows(outcome.result.views, "byte")}
              />
            </div>
          </div>
          <p className="ft-meta">
            <Trans source={"Débit <0>moyen</0> sur toute la durée : il inclut les creux, les reprises et l'établissement de la connexion. Ce n'est pas un débit instantané."} components={[<strong />]} />
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Temps de transfert : une taille, un débit, une durée.
 *
 * Le résultat est théorique au sens strict — taille divisée par débit — et
 * l'écran le répète, parce que l'écart avec la réalité (en-têtes de protocole,
 * latence, congestion, vitesse d'écriture du disque) est systématique et
 * toujours dans le même sens.
 */
export function TransferTimeTool(_props: ToolComponentProps) {
  const size = useNumber("100");
  const [sizeUnit, setSizeUnit] = useState("GiB");
  const rate = useNumber("1");
  const [rateUnitId, setRateUnitId] = useState("Gibit/s");

  const outcome = useMemo(() => {
    if (size.value === undefined || rate.value === undefined) return undefined;
    try {
      return { result: transferTime(size.value, sizeUnit, rate.value, rateUnitId) };
    } catch (failure) {
      return { error: failure instanceof Error ? failure.message : t("Calcul impossible.") };
    }
  }, [size.value, sizeUnit, rate.value, rateUnitId]);

  return (
    <div className="space-y-4">
      <Callout tone="info" title={t("Bits, octets, 1000 et 1024")}>
        {BITS_VERSUS_BYTES_NOTE}
      </Callout>

      <Fieldset columns={2}>
        <Field label={t("Taille à transférer")}>
          <TextInput
            value={size.raw}
            inputMode="decimal"
            autoFocus
            onChange={(event) => size.setRaw(event.target.value)}
            aria-label={t("Taille à transférer")}
          />
        </Field>
        <Field label={t("Unité")}>
          <Select
            value={sizeUnit}
            onChange={setSizeUnit}
            aria-label={t("Unité de taille")}
            options={sizeOptions}
          />
        </Field>
      </Fieldset>

      <Fieldset columns={2}>
        <Field label={t("Débit disponible")}>
          <TextInput
            value={rate.raw}
            inputMode="decimal"
            onChange={(event) => rate.setRaw(event.target.value)}
            aria-label={t("Débit disponible")}
          />
        </Field>
        <Field label={t("Unité de débit")}>
          <Select
            value={rateUnitId}
            onChange={setRateUnitId}
            aria-label={t("Unité de débit")}
            options={rateOptions}
          />
        </Field>
      </Fieldset>

      <InputError
        message={
          size.invalid || rate.invalid
            ? t("La taille et le débit doivent être des nombres.")
            : outcome?.error
        }
      />

      {outcome?.result && (
        <>
          <ResultBlock
            value={outcome.result.readable}
            formula={t("{bits} bits ÷ {bitsPerSecond} bit/s", { bits: pretty(outcome.result.bits), bitsPerSecond: pretty(outcome.result.bitsPerSecond) })}
            secondary={[
              { label: t("En secondes"), value: pretty(outcome.result.duration.totalSeconds) },
              {
                label: t("En minutes"),
                value: pretty(outcome.result.duration.totalSeconds / 60),
              },
              {
                label: t("En heures"),
                value: pretty(outcome.result.duration.totalSeconds / 3600),
              },
            ]}
          />
          <Callout tone="warning" title={t("Durée théorique")}>
            {TRANSFER_THEORETICAL_NOTE}
          </Callout>
        </>
      )}
    </div>
  );
}
