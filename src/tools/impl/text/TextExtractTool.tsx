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

  const label = mode === "emails" ? "adresses e-mail" : mode === "numbers" ? "nombres" : "URL";

  return (
    <TextToolShell
      input={input}
      onInputChange={setInput}
      output={values.join("\n")}
      outputLabel={`${values.length} ${label}`}
      downloadName={`${mode}.txt`}
      sample={SAMPLE}
      summary={
        input.length > 0 ? (
          <span className="tabular-nums">
            <Trans source={"<0>{count}</0> {label} {count, plural, one {trouvée} other {trouvées}}{value}"} values={{ count: values.length, label, value: result.duplicates > 0 && t(" · {duplicates} doublon(s) ignoré(s)", { duplicates: result.duplicates }) }} components={[<strong />]} />
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
