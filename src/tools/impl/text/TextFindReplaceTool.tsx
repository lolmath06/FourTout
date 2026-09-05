import { useMemo, useState } from "react";
import { CheckOption, TextToolShell } from "@/components/text/TextToolShell";
import { Field, Fieldset, TextInput } from "@/components/pdf/Field";
import {
  countMatches,
  DEFAULT_REPLACE_OPTIONS,
  findReplace,
  type ReplaceOptions,
} from "@/core/text/replace";
import type { ToolComponentProps } from "@/tools/implementations";

const SAMPLE = `Le chat dort. Le chaton joue avec le chat.
CHAT en majuscules, chat en minuscules.
Un chat, deux chats, trois chats.`;

export function TextFindReplaceTool(_props: ToolComponentProps) {
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<ReplaceOptions>(DEFAULT_REPLACE_OPTIONS);

  const matches = useMemo(() => countMatches(input, options), [input, options]);
  const result = useMemo(() => findReplace(input, options), [input, options]);

  const set = <K extends keyof ReplaceOptions>(key: K, value: ReplaceOptions[K]) =>
    setOptions((current) => ({ ...current, [key]: value }));

  const searchEmpty = options.search.length === 0;

  return (
    <TextToolShell
      input={input}
      onInputChange={setInput}
      output={result.text}
      outputLabel="Texte modifié"
      downloadName="texte-remplace.txt"
      sample={SAMPLE}
      error={searchEmpty ? undefined : (result.error ?? undefined)}
      summary={
        !searchEmpty && !result.error && input.length > 0 ? (
          <span className="tabular-nums">
            <strong>{matches.count}</strong> occurrence{matches.count > 1 ? "s" : ""} trouvée
            {matches.count > 1 ? "s" : ""}
            {result.count > 0 && ` · ${result.count} remplacée${result.count > 1 ? "s" : ""}`}
          </span>
        ) : undefined
      }
    >
      <Fieldset columns={2}>
        <Field label="Rechercher">
          <TextInput
            value={options.search}
            onChange={(event) => set("search", event.target.value)}
            placeholder={options.regex ? "\\bchat\\w*" : "chat"}
            aria-label="Texte à rechercher"
          />
        </Field>
        <Field label="Remplacer par" hint={options.regex ? "$1, $2… reprennent les groupes capturés" : undefined}>
          <TextInput
            value={options.replacement}
            onChange={(event) => set("replacement", event.target.value)}
            placeholder="chien"
            aria-label="Texte de remplacement"
          />
        </Field>
        <Field label="Options" full>
          <div className="grid gap-0.5 sm:grid-cols-2">
            <CheckOption
              checked={options.all}
              onChange={(v) => set("all", v)}
              label="Toutes les occurrences"
              hint="Sinon, seule la première"
            />
            <CheckOption
              checked={options.caseSensitive}
              onChange={(v) => set("caseSensitive", v)}
              label="Sensible à la casse"
            />
            <CheckOption
              checked={options.wholeWord}
              onChange={(v) => set("wholeWord", v)}
              label="Mot entier"
              hint="« chat » ne trouve pas « chaton »"
              disabled={options.regex}
            />
            <CheckOption
              checked={options.regex}
              onChange={(v) => set("regex", v)}
              label="Expression régulière"
              hint="Syntaxe JavaScript"
            />
          </div>
        </Field>
      </Fieldset>
    </TextToolShell>
  );
}
