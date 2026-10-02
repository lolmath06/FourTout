import { useMemo, useState } from "react";
import { formatNumber as formatLocaleNumber } from "@/i18n";
import { CheckOption, TextToolShell } from "@/components/text/TextToolShell";
import { Field, Fieldset } from "@/components/pdf/Field";
import { extractEmails, extractNumbers, extractUrls } from "@/core/text/extract";
import type { ToolComponentProps } from "@/tools/implementations";
import { Trans, compareText, msg, t } from "@/i18n";

/**
 * Extraction d'URL, d'adresses e-mail ou de nombres.
 *
 * Un seul composant pour trois outils : ils partagent les mêmes gestes et ne
 * diffèrent que par le motif recherché. Le registre reste l'autorité — c'est
 * l'identifiant de l'outil qui choisit le mode.
 */
const SAMPLE = msg("Contact : marie.dupont@example.com ou support@fourtout.test\nDocumentation : https://example.com/docs?section=2 et www.example.org/page\nMontants : 1 250,50 € puis 42 et -7.5\nDoublon : support@fourtout.test");

export function TextExtractTool({ tool }: ToolComponentProps) {
  const [input, setInput] = useState("");
  const [unique, setUnique] = useState(true);
  const [sorted, setSorted] = useState(false);

  const mode = tool.id === "text-extract-emails" ? "emails" : tool.id === "text-extract-numbers" ? "numbers" : "urls";

  const result = useMemo(() => {
    if (mode === "emails") return extractEmails(input, unique);
    if (mode === "numbers") return extractNumbers(input, unique);
    return extractUrls(input, unique);
  }, [input, mode, unique]);

  const values = sorted ? [...result.values].sort((a, b) => compareText(a, b)) : result.values;
  const numbers = mode === "numbers" ? (result as ReturnType<typeof extractNumbers>) : undefined;

  const outputLabel =
    mode === "emails"
      ? t("{count} {count, plural, one {adresse e-mail} other {adresses e-mail}}", { count: values.length })
      : mode === "numbers"
        ? t("{count} {count, plural, one {nombre} other {nombres}}", { count: values.length })
        : t("{count} URL", { count: values.length });

  const foundSummary =
    mode === "emails" && result.duplicates > 0 ? (
      <Trans
        source={"<0>{count}</0> {count, plural, one {adresse e-mail trouvée} other {adresses e-mail trouvées}} · {duplicates} {duplicates, plural, one {doublon ignoré} other {doublons ignorés}}"}
        values={{ count: values.length, duplicates: result.duplicates }}
        components={[<strong />]}
      />
    ) : mode === "emails" ? (
      <Trans
        source={"<0>{count}</0> {count, plural, one {adresse e-mail trouvée} other {adresses e-mail trouvées}}"}
        values={{ count: values.length }}
        components={[<strong />]}
      />
    ) : mode === "numbers" && result.duplicates > 0 ? (
      <Trans
        source={"<0>{count}</0> {count, plural, one {nombre trouvé} other {nombres trouvés}} · {duplicates} {duplicates, plural, one {doublon ignoré} other {doublons ignorés}}"}
        values={{ count: values.length, duplicates: result.duplicates }}
        components={[<strong />]}
      />
    ) : mode === "numbers" ? (
      <Trans
        source={"<0>{count}</0> {count, plural, one {nombre trouvé} other {nombres trouvés}}"}
        values={{ count: values.length }}
        components={[<strong />]}
      />
    ) : result.duplicates > 0 ? (
      <Trans
        source={"<0>{count}</0> URL {count, plural, one {trouvée} other {trouvées}} · {duplicates} {duplicates, plural, one {doublon ignoré} other {doublons ignorés}}"}
        values={{ count: values.length, duplicates: result.duplicates }}
        components={[<strong />]}
      />
    ) : (
      <Trans
        source={"<0>{count}</0> URL {count, plural, one {trouvée} other {trouvées}}"}
        values={{ count: values.length }}
        components={[<strong />]}
      />
    );

  return (
    <TextToolShell
      input={input}
      onInputChange={setInput}
      output={values.join("\n")}
      outputLabel={outputLabel}
      downloadName={`${mode}.txt`}
      sample={SAMPLE}
      summary={
        input.length > 0 ? (
          <span className="tabular-nums">
            {foundSummary}
            {numbers && values.length > 0 && (
              <>
                {" "}{t("· somme {sum} · moyenne {average} · min {min} · max {max}", { sum: formatNumber(numbers.sum), average: formatNumber(numbers.average), min: formatNumber(numbers.min), max: formatNumber(numbers.max) })}
              </>
            )}
          </span>
        ) : undefined
      }
    >
      <Fieldset columns={1}>
        <Field label={t("Options")} full>
          <div className="grid gap-0.5 sm:grid-cols-2">
            <CheckOption checked={unique} onChange={setUnique} label={t("Retirer les doublons")} />
            <CheckOption checked={sorted} onChange={setSorted} label={t("Trier le résultat")} />
          </div>
        </Field>
      </Fieldset>
    </TextToolShell>
  );
}

function formatNumber(value: number): string {
  return formatLocaleNumber(value, { maximumFractionDigits: 4 });
}
