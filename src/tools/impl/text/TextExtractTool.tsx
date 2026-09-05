import { useMemo, useState } from "react";
import { CheckOption, TextToolShell } from "@/components/text/TextToolShell";
import { Field, Fieldset } from "@/components/pdf/Field";
import { extractEmails, extractNumbers, extractUrls } from "@/core/text/extract";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Extraction d'URL, d'adresses e-mail ou de nombres.
 *
 * Un seul composant pour trois outils : ils partagent les mêmes gestes et ne
 * diffèrent que par le motif recherché. Le registre reste l'autorité — c'est
 * l'identifiant de l'outil qui choisit le mode.
 */
const SAMPLE = `Contact : marie.dupont@example.com ou support@fourtout.test
Documentation : https://example.com/docs?section=2 et www.example.org/page
Montants : 1 250,50 € puis 42 et -7.5
Doublon : support@fourtout.test`;

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

  const values = sorted ? [...result.values].sort((a, b) => a.localeCompare(b, "fr")) : result.values;
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
            <strong>{values.length}</strong> {label} trouvée{values.length > 1 ? "s" : ""}
            {result.duplicates > 0 && ` · ${result.duplicates} doublon(s) ignoré(s)`}
            {numbers && values.length > 0 && (
              <>
                {" · "}somme {formatNumber(numbers.sum)} · moyenne {formatNumber(numbers.average)} · min{" "}
                {formatNumber(numbers.min)} · max {formatNumber(numbers.max)}
              </>
            )}
          </span>
        ) : undefined
      }
    >
      <Fieldset columns={1}>
        <Field label="Options" full>
          <div className="grid gap-0.5 sm:grid-cols-2">
            <CheckOption checked={unique} onChange={setUnique} label="Retirer les doublons" />
            <CheckOption checked={sorted} onChange={setSorted} label="Trier le résultat" />
          </div>
        </Field>
      </Fieldset>
    </TextToolShell>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 }).format(value);
}
