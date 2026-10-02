import { useMemo, useState } from "react";
import { Callout } from "@/components/ui/Callout";
import { Field, Fieldset, OptionGroup, TextInput } from "@/components/pdf/Field";
import { InputError, ValueTable } from "@/components/calc/CalcShell";
import {
  convertZone,
  formatWallDate,
  formatWallTime,
  parseWallClock,
  searchZones,
  systemZone,
  zoneCity,
  type ZoneConversion,
  type ZonedTime,
} from "@/core/calc/timezone";
import type { ToolComponentProps } from "@/tools/implementations";
import { Trans, t, tx } from "@/i18n";

/** Champ de saisie d'un fuseau, avec recherche par ville. */
function ZonePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (zone: string) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => (query.trim().length === 0 ? [] : searchZones(query, 8)), [query]);

  return (
    <div className="space-y-1.5">
      <Field label={tx(label)} hint={t("Tapez une ville : « paris », « new york », « tokyo ».")}>
        <TextInput
          value={query}
          placeholder={value}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={tx(label)}
        />
      </Field>
      <p className="ft-meta">
        <Trans source={"Fuseau retenu : <0>{value}</0> ({value2})"} values={{ value, value2: zoneCity(value) }} components={[<strong />]} />
      </p>
      {matches.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {matches.map((zone) => (
            <li key={zone}>
              <button
                type="button"
                onClick={() => {
                  onChange(zone);
                  setQuery("");
                }}
                className="rounded-[var(--radius-md)] border border-[var(--ft-border)] bg-[var(--ft-surface)] px-2 py-0.5 text-[12px] hover:border-[var(--ft-accent)]"
              >
                {zoneCity(zone)}
                <span className="ml-1 text-[var(--ft-text-faint)]">{zone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function zoneRows(time: ZonedTime, label: string) {
  return [
    {
      label: t("{label} — date et heure", { label }),
      value: `${formatWallDate(time.wall)} ${formatWallTime(time.wall, true)}`,
      highlight: true,
    },
    {
      label: t("{label} — décalage", { label }),
      value: `UTC${time.offsetLabel}${time.abbreviation ? ` (${time.abbreviation})` : ""}`,
    },
  ];
}

/** Rendu d'une lecture complète : source, arrivée, instant UTC. */
function ConversionView({ conversion, title }: { conversion: ZoneConversion; title?: string }) {
  return (
    <ValueTable
      caption={tx(title)}
      rows={[
        ...zoneRows(conversion.source, conversion.source.zone),
        ...zoneRows(conversion.target, conversion.target.zone),
        { label: t("Instant UTC correspondant"), value: conversion.target.iso },
      ]}
    />
  );
}

/**
 * Conversion d'heure entre fuseaux.
 *
 * L'écran a une seule particularité, et c'est tout son intérêt : il refuse de
 * choisir à votre place quand l'heure saisie est ambiguë. Au retour à l'heure
 * d'hiver, 2 h 30 arrive deux fois et les **deux** lectures sont affichées ; au
 * passage à l'heure d'été, 2 h 30 n'existe pas et l'écran le dit au lieu de
 * rendre un chiffre plausible.
 */
export function TimezoneTool(_props: ToolComponentProps) {
  const today = new Date();
  const [date, setDate] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate(),
    ).padStart(2, "0")}`,
  );
  const [time, setTime] = useState("14:30");
  const [from, setFrom] = useState(systemZone());
  const [to, setTo] = useState("America/New_York");
  const [prefer, setPrefer] = useState<"first" | "second">("first");

  const outcome = useMemo(() => {
    try {
      return { conversion: convertZone(parseWallClock(date, time), from, to, { prefer }) };
    } catch (failure) {
      return {
        error: failure instanceof Error ? failure.message : t("Conversion impossible."),
      };
    }
  }, [date, time, from, to, prefer]);

  return (
    <div className="space-y-4">
      <Fieldset columns={2}>
        <Field label={t("Date")} hint={t("Écrite AAAA-MM-JJ.")}>
          <TextInput
            value={date}
            onChange={(event) => setDate(event.target.value)}
            aria-label={t("Date")}
            placeholder="2026-03-29"
          />
        </Field>
        <Field label={t("Heure")} hint={t("Écrite HH:MM, ou HH:MM:SS.")}>
          <TextInput
            value={time}
            onChange={(event) => setTime(event.target.value)}
            aria-label={t("Heure")}
            placeholder="14:30"
          />
        </Field>
      </Fieldset>

      <Fieldset columns={2}>
        <ZonePicker label={t("Fuseau de départ")} value={from} onChange={setFrom} />
        <ZonePicker label={t("Fuseau d'arrivée")} value={to} onChange={setTo} />
      </Fieldset>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
          className="rounded-[var(--radius-md)] border border-[var(--ft-border)] bg-[var(--ft-surface)] px-2 py-1 text-[12px] hover:border-[var(--ft-accent)]"
        >
          {t("Inverser les deux fuseaux")}
        </button>
      </div>

      <InputError message={tx(outcome.error)} />

      {outcome.conversion?.kind === "skipped" && (
        <Callout tone="warning" title={t("Cette heure n'existe pas")}>
          {tx(outcome.conversion.note)}
        </Callout>
      )}

      {outcome.conversion?.kind === "ambiguous" && (
        <>
          <Callout tone="warning" title={t("Cette heure existe deux fois")}>
            {tx(outcome.conversion.note)}
          </Callout>
          <Field label={t("Quelle occurrence mettre en avant ?")}>
            <OptionGroup
              ariaLabel={t("Occurrence")}
              value={prefer}
              onChange={setPrefer}
              options={[
                { value: "first", label: t("La première (heure d'été)") },
                { value: "second", label: t("La seconde (heure d'hiver)") },
              ]}
            />
          </Field>
        </>
      )}

      {outcome.conversion && (
        <ConversionView
          conversion={outcome.conversion}
          title={
            outcome.conversion.kind === "ambiguous"
              ? t("Occurrence retenue")
              : outcome.conversion.kind === "skipped"
                ? t("Instant réel le plus proche")
                : undefined
          }
        />
      )}

      {outcome.conversion?.alternative && (
        <ConversionView
          conversion={{
            ...outcome.conversion,
            source: outcome.conversion.alternative.source,
            target: outcome.conversion.alternative.target,
          }}
          title={t("Autre occurrence possible")}
        />
      )}

      <p className="ft-meta">
        {t("Les décalages viennent de la base de fuseaux du système, interrogée à la date demandée : ils tiennent donc compte de l'heure d'été de chaque pays, à ses propres dates de bascule.")}
      </p>
    </div>
  );
}
