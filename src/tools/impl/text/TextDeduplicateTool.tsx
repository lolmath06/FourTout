import { useMemo, useState } from "react";
import { CheckOption, TextToolShell } from "@/components/text/TextToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { deduplicateLines, DEFAULT_DEDUPE_OPTIONS, type DedupeOptions } from "@/core/text/lines";
import type { ToolComponentProps } from "@/tools/implementations";

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
      outputLabel="Lignes uniques"
      downloadName="lignes-uniques.txt"
      sample={SAMPLE}
      summary={
        input.length > 0 ? (
          <span className="tabular-nums">
            {result.linesBefore} lignes → {result.linesAfter} lignes ·{" "}
            <strong>{result.removed}</strong> doublon{result.removed > 1 ? "s" : ""} supprimé
            {result.removed > 1 ? "s" : ""}
          </span>
        ) : undefined
      }
    >
      <Fieldset columns={2}>
        <Field label="Occurrence conservée">
          <OptionGroup
            ariaLabel="Occurrence conservée"
            value={options.keep}
            onChange={(v) => set("keep", v)}
            options={[
              { value: "first", label: "La première" },
              { value: "last", label: "La dernière" },
            ]}
          />
        </Field>
        <Field label="Comparaison" full>
          <div className="grid gap-0.5 sm:grid-cols-3">
            <CheckOption
              checked={options.caseSensitive}
              onChange={(v) => set("caseSensitive", v)}
              label="Sensible à la casse"
              hint="« Pomme » ≠ « pomme »"
            />
            <CheckOption
              checked={options.trimComparison}
              onChange={(v) => set("trimComparison", v)}
              label="Ignorer les espaces de bord"
            />
            <CheckOption
              checked={options.ignoreBlank}
              onChange={(v) => set("ignoreBlank", v)}
              label="Conserver les lignes vides"
            />
          </div>
        </Field>
      </Fieldset>
    </TextToolShell>
  );
}
