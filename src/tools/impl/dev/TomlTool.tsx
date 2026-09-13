import { useMemo, useState } from "react";
import { Callout } from "@/components/ui/Callout";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { TextToolShell } from "@/components/text/TextToolShell";
import {
  countTomlComments,
  formatToml,
  TOML_COMMENT_NOTE,
  TomlFormatError,
  validateToml,
  type TomlProblem,
} from "@/core/code/toml";
import type { ToolComponentProps } from "@/tools/implementations";

type Mode = "validate" | "format";

const SAMPLE = `# Configuration d'exemple
titre = "FourTout"
version = 3

[serveur]
hote = "127.0.0.1"
port = 8080

[[journal]]
niveau = "info"
`;

/** Rend un problème de syntaxe lisible : la phrase, puis l'endroit. */
function problemText(problem: TomlProblem): string {
  if (!problem.position) return problem.message;
  return `Ligne ${problem.position.line}, colonne ${problem.position.column} : ${problem.message}`;
}

/**
 * TOML : valider, et reformater.
 *
 * Les deux modes sont séparés parce qu'ils n'engagent pas la même chose. La
 * validation ne touche à rien. Le reformatage réécrit le document à partir de
 * ses données, ce qui conserve exactement les valeurs mais fait disparaître les
 * commentaires : l'écran le dit avant, chiffres à l'appui, plutôt que de le
 * laisser découvrir après coup.
 */
export function TomlTool(_props: ToolComponentProps) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("validate");

  const analysis = useMemo(() => {
    if (input.trim().length === 0) return undefined;
    const validation = validateToml(input);
    if (!validation.valid) {
      return { validation, output: undefined, error: problemText(validation.problem!) };
    }
    if (mode === "validate") return { validation, output: undefined, error: undefined };
    try {
      return { validation, output: formatToml(input), error: undefined };
    } catch (failure) {
      return {
        validation,
        output: undefined,
        error:
          failure instanceof TomlFormatError
            ? problemText(failure.problem)
            : "Reformatage impossible.",
      };
    }
  }, [input, mode]);

  const comments = useMemo(() => countTomlComments(input), [input]);
  const summary = analysis?.validation.summary;

  return (
    <div className="space-y-4">
      <TextToolShell
        input={input}
        onInputChange={setInput}
        output={analysis?.output}
        inputLabel="Document TOML"
        outputLabel="TOML reformaté"
        placeholder="Collez votre TOML, ou déposez un fichier .toml ici…"
        downloadName="fourtout.toml"
        error={analysis?.error}
        sample={SAMPLE}
        layout={mode === "format" ? "side-by-side" : "stacked"}
        summary={
          analysis && !analysis.error && summary ? (
            <>
              Document valide · {summary.topLevelKeys} clé
              {summary.topLevelKeys > 1 ? "s" : ""} à la racine · {summary.tables} table
              {summary.tables > 1 ? "s" : ""} · {summary.arraysOfTables} tableau
              {summary.arraysOfTables > 1 ? "x" : ""} de tables · profondeur {summary.depth}
              {summary.dates > 0 && ` · ${summary.dates} date${summary.dates > 1 ? "s" : ""}`}
            </>
          ) : undefined
        }
      >
        <Fieldset columns={1}>
          <Field label="Que voulez-vous faire ?">
            <OptionGroup
              ariaLabel="Mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: "validate", label: "Valider seulement" },
                { value: "format", label: "Reformater" },
              ]}
            />
          </Field>
        </Fieldset>

        {mode === "format" && (
          <Callout tone="warning" title="Le reformatage perd les commentaires">
            {TOML_COMMENT_NOTE}
            {comments > 0 && (
              <>
                {" "}
                Ce document en contient <strong>{comments}</strong> ligne
                {comments > 1 ? "s" : ""}.
              </>
            )}
          </Callout>
        )}
      </TextToolShell>
    </div>
  );
}
