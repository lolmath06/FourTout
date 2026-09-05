import { useCallback, useEffect, useState } from "react";
import { CheckOption } from "@/components/text/TextToolShell";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Field, Fieldset, NumberInput, OptionGroup } from "@/components/pdf/Field";
import { generateLorem, type LoremOptions, type LoremUnit } from "@/core/text/lorem";
import { measureText } from "@/core/text/clean";
import { notify } from "@/features/notifications/store";
import { saveFile } from "@/core/output/save";
import type { ToolComponentProps } from "@/tools/implementations";

export function LoremIpsumTool(_props: ToolComponentProps) {
  const [options, setOptions] = useState<LoremOptions>({
    unit: "paragraphs",
    count: 3,
    startWithLorem: true,
  });
  const [text, setText] = useState("");

  const generate = useCallback(() => setText(generateLorem(options)), [options]);
  useEffect(() => {
    generate();
  }, [generate]);

  const size = measureText(text);
  const set = <K extends keyof LoremOptions>(key: K, value: LoremOptions[K]) =>
    setOptions((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-4">
      <Fieldset columns={3}>
        <Field label="Unité">
          <OptionGroup
            ariaLabel="Unité"
            value={options.unit}
            onChange={(unit: LoremUnit) => set("unit", unit)}
            options={[
              { value: "paragraphs", label: "Paragraphes" },
              { value: "sentences", label: "Phrases" },
              { value: "words", label: "Mots" },
            ]}
          />
        </Field>
        <Field label="Quantité">
          <NumberInput
            min={1}
            max={500}
            value={options.count}
            onChange={(event) => set("count", Math.max(1, Math.min(500, Number(event.target.value) || 1)))}
            aria-label="Quantité"
          />
        </Field>
        <Field label="Début" full>
          <CheckOption
            checked={options.startWithLorem}
            onChange={(v) => set("startWithLorem", v)}
            label="Commencer par « Lorem ipsum dolor sit amet »"
          />
        </Field>
      </Fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={generate}>
          <Icon name="Repeat" size={14} /> Régénérer
        </Button>
        <span className="font-mono text-[11px] tabular-nums text-[var(--ft-text-faint)]">
          {size.characters} caractères · {size.words} mots
        </span>
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={async () => {
            const saved = await saveFile({
              name: "lorem-ipsum.txt",
              bytes: new TextEncoder().encode(text),
              mimeType: "text/plain",
            });
            if (saved.saved) notify.success("Fichier enregistré", saved.path);
          }}
        >
          <Icon name="Download" size={14} /> Télécharger
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              notify.success("Copié dans le presse-papiers");
            } catch {
              notify.error("Copie impossible");
            }
          }}
        >
          <Icon name="Copy" size={14} /> Copier
        </Button>
      </div>

      <textarea
        value={text}
        readOnly
        aria-label="Texte généré"
        className="min-h-64 w-full resize-y rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] p-3 text-sm"
      />
    </div>
  );
}
