import { useMemo, useState } from "react";
import { CheckOption, TextToolShell } from "@/components/text/TextToolShell";
import { Field, Fieldset, Select } from "@/components/pdf/Field";
import { sortLines, SORT_LABELS, type SortMode, type SortOptions } from "@/core/text/lines";
import type { ToolComponentProps } from "@/tools/implementations";
import { t } from "@/i18n";

const SAMPLE = `banane
12 pommes
Cerise
3 poires
abricot
100 fraises`;

export function TextSortLinesTool(_props: ToolComponentProps) {
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<SortOptions>({
    mode: "alpha-asc",
    caseSensitive: false,
    keepBlank: false,
  });
  // Le tri aléatoire doit pouvoir être relancé sans changer le texte.
  const [seed, setSeed] = useState(0);

  const result = useMemo(() => {
    void seed;
    return sortLines(input, options);
  }, [input, options, seed]);

  const set = <K extends keyof SortOptions>(key: K, value: SortOptions[K]) =>
    setOptions((current) => ({ ...current, [key]: value }));

  return (
    <TextToolShell
      input={input}
      onInputChange={setInput}
      output={result.text}
      outputLabel={t("Lignes triées")}
      downloadName="lignes-triees.txt"
      sample={SAMPLE}
      summary={
        input.length > 0 ? (
          <span className="tabular-nums">
            {t("{linesBefore} lignes → {linesAfter} lignes · {value}", { linesBefore: result.linesBefore, linesAfter: result.linesAfter, value: SORT_LABELS[options.mode] })}
          </span>
        ) : undefined
      }
    >
      <Fieldset columns={2}>
        <Field label={t("Ordre")}>
          <Select
            aria-label={t("Ordre de tri")}
            value={options.mode}
            onChange={(mode: SortMode) => {
              set("mode", mode);
              if (mode === "shuffle") setSeed((s) => s + 1);
            }}
            options={(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => ({
              value: mode,
              label: SORT_LABELS[mode],
            }))}
          />
        </Field>
        <Field label={t("Options")} full>
          <div className="grid gap-0.5 sm:grid-cols-2">
            <CheckOption
              checked={options.caseSensitive}
              onChange={(v) => set("caseSensitive", v)}
              label={t("Sensible à la casse")}
            />
            <CheckOption
              checked={options.keepBlank}
              onChange={(v) => set("keepBlank", v)}
              label={t("Conserver les lignes vides")}
            />
          </div>
        </Field>
      </Fieldset>
    </TextToolShell>
  );
}
