import { useMemo, useState } from "react";
import { TextToolShell } from "@/components/text/TextToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Icon } from "@/components/ui/Icon";
import { convertLineEndings, detectLineEndings, type Eol } from "@/core/text/lines";
import type { ToolComponentProps } from "@/tools/implementations";

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

const SAMPLE = "Première ligne\r\nDeuxième ligne\nTroisième ligne\r\n";

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
      inputLabel="Texte ou fichier déposé"
      outputLabel={`Texte converti (${target.toUpperCase()})`}
      downloadName={`texte-${target}.txt`}
      sample={SAMPLE}
      summary={
        input.length > 0 ? (
          <div className="space-y-1">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
              <span className="flex items-center gap-1.5 font-medium">
                <Icon name={before.mixed ? "TriangleAlert" : "Info"} size={14} />
                {before.mixed
                  ? "Fins de ligne mélangées"
                  : `Fins de ligne : ${before.dominant.toUpperCase()}`}
              </span>
              <span>LF : {before.lf}</span>
              <span>CRLF : {before.crlf}</span>
              <span>CR : {before.cr}</span>
              <span className="text-[var(--ft-text-muted)]">{before.lines} lignes</span>
            </p>
            <p className="tabular-nums text-xs text-[var(--ft-text-muted)]">
              Après conversion : LF {after.lf} · CRLF {after.crlf} · CR {after.cr} ·{" "}
              {input.length} → {output.length} caractères
            </p>
          </div>
        ) : undefined
      }
    >
      <Fieldset columns={1}>
        <Field label="Convertir vers" hint={EOL_LABELS[target]}>
          <OptionGroup
            ariaLabel="Fin de ligne cible"
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
