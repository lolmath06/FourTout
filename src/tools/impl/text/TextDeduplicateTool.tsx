import { useMemo, useState } from "react";
import { CheckOption, TextToolShell } from "@/components/text/TextToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { deduplicateLines, DEFAULT_DEDUPE_OPTIONS, type DedupeOptions } from "@/core/text/lines";
import type { ToolComponentProps } from "@/tools/implementations";
import { Trans, t } from "@/i18n";

const SAMPLE = `pomme
poire
Pomme
banane
poire

cerise
banane`;

export function TextDeduplicateTool(_props: ToolComponentProps) {
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<DedupeOptions>(DEFAULT_DEDUPE_OPTIONS);

  const result = useMemo(() => deduplicateLines(input, options), [input, options]);
  const set = <K extends keyof DedupeOptions>(key: K, value: DedupeOptions[K]) =>
    setOptions((current) => ({ ...current, [key]: value }));

  return (
    <TextToolShell
      input={input}
      onInputChange={setInput}
      output={result.text}
      outputLabel={t("Lignes uniques")}
      downloadName="lignes-uniques.txt"
      sample={SAMPLE}
      summary={
        input.length > 0 ? (
          <span className="tabular-nums">
            <Trans source={"{linesBefore} lignes → {linesAfter} lignes · <0>{removed}</0> {removed, plural, one {doublon} other {doublons}} {removed, plural, one {supprimé} other {supprimés}}"} values={{ linesBefore: result.linesBefore, linesAfter: result.linesAfter, removed: result.removed }} components={[<strong />]} />
          </span>
        ) : undefined
      }
    >
      <Fieldset columns={2}>
        <Field label={t("Occurrence conservée")}>
          <OptionGroup
            ariaLabel={t("Occurrence conservée")}
            value={options.keep}
            onChange={(v) => set("keep", v)}
            options={[
              { value: "first", label: t("La première") },
              { value: "last", label: t("La dernière") },
            ]}
          />
        </Field>
        <Field label={t("Comparaison")} full>
          <div className="grid gap-0.5 sm:grid-cols-3">
            <CheckOption
              checked={options.caseSensitive}
              onChange={(v) => set("caseSensitive", v)}
              label={t("Sensible à la casse")}
              hint={t("« Pomme » ≠ « pomme »")}
            />
            <CheckOption
              checked={options.trimComparison}
              onChange={(v) => set("trimComparison", v)}
              label={t("Ignorer les espaces de bord")}
            />
            <CheckOption
              checked={options.ignoreBlank}
              onChange={(v) => set("ignoreBlank", v)}
              label={t("Conserver les lignes vides")}
            />
          </div>
        </Field>
      </Fieldset>
    </TextToolShell>
  );
}
