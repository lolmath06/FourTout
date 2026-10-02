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
import { Trans, msg, t } from "@/i18n";

const SAMPLE = msg("Le chat dort. Le chaton joue avec le chat.\nCHAT en majuscules, chat en minuscules.\nUn chat, deux chats, trois chats.");

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
      outputLabel={t("Texte modifié")}
      downloadName="texte-remplace.txt"
      sample={SAMPLE}
      error={searchEmpty ? undefined : (result.error ?? undefined)}
      summary={
        !searchEmpty && !result.error && input.length > 0 ? (
          <span className="tabular-nums">
            <Trans source={"<0>{count}</0> {count, plural, one {occurrence} other {occurrences}} {count, plural, one {trouvée} other {trouvées}}{value}"} values={{ count: matches.count, value: result.count > 0 && t(" · {count} {count, plural, one {remplacée} other {remplacées}}", { count: result.count }) }} components={[<strong />]} />
          </span>
        ) : undefined
      }
    >
      <Fieldset columns={2}>
        <Field label={t("Rechercher")}>
          <TextInput
            value={options.search}
            onChange={(event) => set("search", event.target.value)}
            placeholder={options.regex ? "\\bchat\\w*" : "chat"}
            aria-label={t("Texte à rechercher")}
          />
        </Field>
        <Field label={t("Remplacer par")} hint={options.regex ? "$1, $2… reprennent les groupes capturés" : undefined}>
          <TextInput
            value={options.replacement}
            onChange={(event) => set("replacement", event.target.value)}
            placeholder="chien"
            aria-label={t("Texte de remplacement")}
          />
        </Field>
        <Field label={t("Options")} full>
          <div className="grid gap-0.5 sm:grid-cols-2">
            <CheckOption
              checked={options.all}
              onChange={(v) => set("all", v)}
              label={t("Toutes les occurrences")}
              hint={t("Sinon, seule la première")}
            />
            <CheckOption
              checked={options.caseSensitive}
              onChange={(v) => set("caseSensitive", v)}
              label={t("Sensible à la casse")}
            />
            <CheckOption
              checked={options.wholeWord}
              onChange={(v) => set("wholeWord", v)}
              label={t("Mot entier")}
              hint={t("« chat » ne trouve pas « chaton »")}
              disabled={options.regex}
            />
            <CheckOption
              checked={options.regex}
              onChange={(v) => set("regex", v)}
              label={t("Expression régulière")}
              hint={t("Syntaxe JavaScript")}
            />
          </div>
        </Field>
      </Fieldset>
    </TextToolShell>
  );
}
