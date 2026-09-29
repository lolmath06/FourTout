import { useMemo, useState } from "react";
import { TextToolShell } from "@/components/text/TextToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Icon } from "@/components/ui/Icon";
import {
  decodeUrlText,
  encodeUrlText,
  parseUrlParts,
  URL_MODE_LABELS,
  type UrlMode,
} from "@/core/text/url";
import type { ToolComponentProps } from "@/tools/implementations";

export function UrlEncodeTool(_props: ToolComponentProps) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<UrlMode>("component");
  const [action, setAction] = useState<"encode" | "decode">("encode");

  const result = useMemo(
    () => (action === "encode" ? encodeUrlText(input, mode) : decodeUrlText(input, mode)),
    [action, input, mode],
  );
  const parts = useMemo(() => parseUrlParts(action === "encode" ? input : result.text), [action, input, result.text]);

  return (
    <TextToolShell
      input={input}
      onInputChange={setInput}
      output={result.text}
      inputLabel={action === "encode" ? "Texte ou URL" : "URL encodée"}
      outputLabel={action === "encode" ? "Résultat encodé" : "Résultat décodé"}
      downloadName="url.txt"
      layout="side-by-side"
      error={result.error}
      sample={
        action === "encode"
          ? "https://example.com/recherche?q=café & thé&page=2"
          : "https://example.com/recherche?q=caf%C3%A9%20%26%20th%C3%A9&page=2"
      }
    >
      <Fieldset columns={2}>
        <Field label="Opération">
          <OptionGroup
            ariaLabel="Opération"
            value={action}
            onChange={setAction}
            options={[
              { value: "encode", label: "Encoder" },
              { value: "decode", label: "Décoder" },
            ]}
          />
        </Field>
        <Field label="Portée">
          <OptionGroup
            ariaLabel="Portée"
            value={mode}
            onChange={setMode}
            options={(Object.keys(URL_MODE_LABELS) as UrlMode[]).map((value) => ({
              value,
              label: value === "component" ? "Valeur" : value === "uri" ? "URL complète" : "Formulaire",
              hint: URL_MODE_LABELS[value],
            }))}
          />
        </Field>
      </Fieldset>

      {parts && (
        <div className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3 text-sm">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--ft-text-muted)]">
            <Icon name="Link2" size={13} /> Décomposition de l'URL
          </p>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[8rem_1fr]">
            <dt className="text-xs text-[var(--ft-text-faint)]">Protocole</dt>
            <dd className="font-mono text-xs">{parts.protocol}</dd>
            <dt className="text-xs text-[var(--ft-text-faint)]">Hôte</dt>
            <dd className="font-mono text-xs">{parts.host}</dd>
            <dt className="text-xs text-[var(--ft-text-faint)]">Chemin</dt>
            <dd className="break-all font-mono text-xs">{parts.path}</dd>
            {parts.params.map((param) => (
              <div key={param.key} className="contents">
                <dt className="text-xs text-[var(--ft-text-faint)]">{param.key}</dt>
                <dd className="break-all font-mono text-xs">{param.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </TextToolShell>
  );
}
