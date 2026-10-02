import { useMemo, useState } from "react";
import { TextToolShell } from "@/components/text/TextToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Icon } from "@/components/ui/Icon";
import { convertLineEndings, detectLineEndings, type Eol } from "@/core/text/lines";
import type { ToolComponentProps } from "@/tools/implementations";
import { Trans, msg, t } from "@/i18n";

/**
 * Conversion des fins de ligne.
 *
 * Un fichier venu de Windows ouvert sous Linux (ou l'inverse) affiche des `^M`,
 * casse les diffs et fait échouer certains scripts. L'outil dit d'abord ce que
 * contient le fichier, puis convertit — jamais l'inverse.
 */
const EOL_LABELS: Record<Eol, string> = {
  lf: "LF — Unix, Linux, macOS",
  crlf: "CRLF — Windows",
  cr: "CR — Mac OS classique",
};

const SAMPLE = msg("Première ligne\r\nDeuxième ligne\nTroisième ligne\r\n");

export function LineEndingsTool(_props: ToolComponentProps) {
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<Eol>("lf");

  const before = useMemo(() => detectLineEndings(input), [input]);
  const output = useMemo(() => convertLineEndings(input, target), [input, target]);
  const after = useMemo(() => detectLineEndings(output), [output]);

  return (
    <TextToolShell
      input={input}
      onInputChange={setInput}
      output={output}
      inputLabel={t("Texte ou fichier déposé")}
      outputLabel={t("Texte converti ({value})", { value: target.toUpperCase() })}
      downloadName={`texte-${target}.txt`}
      sample={SAMPLE}
      summary={
        input.length > 0 ? (
          <div className="space-y-1">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
              <span className="flex items-center gap-1.5 font-medium">
                <Icon name={before.mixed ? "TriangleAlert" : "Info"} size={14} />
                {before.mixed
                  ? t("Fins de ligne mélangées")
                  : t("Fins de ligne : {value}", { value: before.dominant.toUpperCase() })}
              </span>
              <Trans source={"<0>LF : {lf}</0><1>CRLF : {crlf}</1><2>CR : {cr}</2><3>{lines} lignes</3>"} values={{ lf: before.lf, crlf: before.crlf, cr: before.cr, lines: before.lines }} components={[<span />, <span />, <span />, <span className="text-[var(--ft-text-muted)]" />]} />
            </p>
            <p className="tabular-nums text-xs text-[var(--ft-text-muted)]">
              {t("Après conversion : LF {lf} · CRLF {crlf} · CR {cr} · {count} → {outputCount} caractères", { lf: after.lf, crlf: after.crlf, cr: after.cr, count: input.length, outputCount: output.length })}
            </p>
          </div>
        ) : undefined
      }
    >
      <Fieldset columns={1}>
        <Field label={t("Convertir vers")} hint={EOL_LABELS[target]}>
          <OptionGroup
            ariaLabel={t("Fin de ligne cible")}
            value={target}
            onChange={setTarget}
            options={(Object.keys(EOL_LABELS) as Eol[]).map((value) => ({
              value,
              label: value.toUpperCase(),
              hint: EOL_LABELS[value],
            }))}
          />
        </Field>
      </Fieldset>
    </TextToolShell>
  );
}
