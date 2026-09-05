import { useMemo, useState } from "react";
import { TextPane } from "@/components/text/TextToolShell";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { markdownToHtml } from "@/core/text/markdown";
import { htmlToMarkdown, htmlToText, sanitizeHtml } from "@/core/text/html";
import { notify } from "@/features/notifications/store";
import { saveFile } from "@/core/output/save";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Conversions Markdown ↔ HTML ↔ texte.
 *
 * Sécurité : l'aperçu n'affiche jamais le HTML de l'utilisateur tel quel. Le
 * Markdown est rendu par un module qui échappe tout HTML brut, et le HTML
 * importé passe par l'assainisseur avant d'être injecté. Aucun script d'un
 * fichier reçu de l'extérieur ne peut s'exécuter dans FourTout.
 */
type Direction = "md-html" | "html-md" | "html-text" | "md-text";

const DIRECTION_LABELS: Record<Direction, string> = {
  "md-html": "Markdown → HTML",
  "html-md": "HTML → Markdown",
  "html-text": "HTML → texte",
  "md-text": "Markdown → texte",
};

const SAMPLE_MARKDOWN = `# Titre principal

Un paragraphe avec du **gras**, de l'*italique* et du \`code\`.

## Liste

- premier point
- second point
  - sous-point
1. numéroté
2. suite

> Une citation.

| Colonne A | Colonne B |
| --- | --- |
| 1 | 2 |

[Lien](https://example.com)

\`\`\`js
const x = 1;
\`\`\`
`;

const SAMPLE_HTML = `<h1>Titre</h1>
<p>Un paragraphe <strong>important</strong>.</p>
<ul><li>un</li><li>deux</li></ul>
<script>alert('coucou')</script>
`;

export function MarkdownConvertTool(_props: ToolComponentProps) {
  const [direction, setDirection] = useState<Direction>("md-html");
  const [input, setInput] = useState("");
  const [showPreview, setShowPreview] = useState(true);

  const output = useMemo(() => {
    if (input.length === 0) return "";
    switch (direction) {
      case "md-html":
        return markdownToHtml(input);
      case "html-md":
        return htmlToMarkdown(input);
      case "html-text":
        return htmlToText(input);
      case "md-text":
        return htmlToText(markdownToHtml(input));
    }
  }, [direction, input]);

  // Même pour notre propre rendu : l'aperçu ne montre que du HTML assaini.
  const preview = useMemo(() => {
    if (direction === "md-html") return sanitizeHtml(output);
    if (direction === "html-md" || direction === "html-text") return sanitizeHtml(input);
    return "";
  }, [direction, input, output]);

  const outputExtension = direction === "md-html" ? "html" : direction === "html-md" ? "md" : "txt";
  const sample = direction.startsWith("md") ? SAMPLE_MARKDOWN : SAMPLE_HTML;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      notify.success("Copié dans le presse-papiers");
    } catch {
      notify.error("Copie impossible");
    }
  };

  const download = async () => {
    const bytes = new TextEncoder().encode(output);
    const saved = await saveFile({
      name: `conversion.${outputExtension}`,
      bytes,
      mimeType: outputExtension === "html" ? "text/html" : "text/plain",
    });
    if (saved.saved) notify.success("Fichier enregistré", saved.path);
  };

  return (
    <div className="space-y-4">
      <Fieldset columns={1}>
        <Field label="Conversion">
          <OptionGroup
            ariaLabel="Sens de conversion"
            value={direction}
            onChange={setDirection}
            options={(Object.keys(DIRECTION_LABELS) as Direction[]).map((value) => ({
              value,
              label: DIRECTION_LABELS[value],
            }))}
          />
        </Field>
      </Fieldset>

      <div className="flex flex-col gap-4 lg:flex-row">
        <TextPane
          label={direction.startsWith("md") ? "Markdown" : "HTML"}
          value={input}
          onChange={setInput}
          placeholder={
            direction.startsWith("md")
              ? "# Votre Markdown…"
              : "<p>Votre HTML…</p>"
          }
        />
        <TextPane label={DIRECTION_LABELS[direction].split(" → ")[1]} value={output} readOnly droppable={false} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setInput(sample)}>
          <Icon name="Sparkles" size={14} /> Exemple
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setInput("")} disabled={!input}>
          <Icon name="Eraser" size={14} /> Effacer
        </Button>
        {preview !== "" && (
          <Button size="sm" variant="ghost" onClick={() => setShowPreview((v) => !v)}>
            <Icon name={showPreview ? "EyeOff" : "Eye"} size={14} />
            {showPreview ? "Masquer l'aperçu" : "Afficher l'aperçu"}
          </Button>
        )}
        <div className="flex-1" />
        <Button size="sm" onClick={download} disabled={!output}>
          <Icon name="Download" size={14} /> Télécharger
        </Button>
        <Button size="sm" variant="primary" onClick={copy} disabled={!output}>
          <Icon name="Copy" size={14} /> Copier
        </Button>
      </div>

      {showPreview && preview !== "" && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs text-[var(--ft-text-muted)]">
            <Icon name="ShieldCheck" size={13} />
            Aperçu assaini : scripts, styles et cadres externes sont retirés avant affichage.
          </p>
          <div
            data-testid="markdown-preview"
            className="prose-fourtout max-h-96 overflow-auto rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-4 text-sm"
            dangerouslySetInnerHTML={{ __html: preview }}
          />
        </div>
      )}
    </div>
  );
}
