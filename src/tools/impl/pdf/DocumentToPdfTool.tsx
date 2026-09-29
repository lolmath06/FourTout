import { useEffect, useState } from "react";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { Field, Fieldset, NumberInput, OptionGroup, TextInput } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ResultPanel, type OperationOutcome } from "@/components/pdf/ResultPanel";
import { useJob } from "@/core/jobs";
import { documentToPdf, type DocumentKind } from "@/core/pdf/operations/documentToPdf";
import { extensionOf } from "@/core/files";
import { toPdfError } from "@/core/pdf/errors";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

function detectKind(name: string): DocumentKind {
  const ext = extensionOf(name);
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "html" || ext === "htm") return "html";
  return "text";
}

export function DocumentToPdfTool({ tool }: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [content, setContent] = useState<string>("");
  const [kind, setKind] = useState<DocumentKind>("text");
  const [title, setTitle] = useState("");
  const [fontSize, setFontSize] = useState(11);
  const [outcome, setOutcome] = useState<OperationOutcome | null>(null);
  const job = useJob<OperationOutcome>();
  const file = files[0];

  useEffect(() => {
    setOutcome(null);
    if (!file?.file) {
      setContent("");
      return;
    }
    setKind(detectKind(file.name));
    file.file.text().then(setContent).catch(() => setContent(""));
  }, [file]);

  const run = async () => {
    setOutcome(null);
    const result = await job.run(async (context) => {
      const output = await documentToPdf(file.name, content, { kind, title: title.trim() || undefined, fontSize }, {
        report: context.report,
        signal: context.signal,
      });
      return { files: [output], summary: `PDF généré depuis ${kind === "markdown" ? "Markdown" : kind === "html" ? "HTML" : "texte"}.` };
    });
    if (result) {
      setOutcome(result);
      notify.success("Fichier prêt", result.summary);
    }
  };

  const errorMessage = job.error ? toPdfError(job.error.cause).message : undefined;

  return (
    <div className="space-y-4">
      <FileDropZone
        constraints={{ ...constraintsForTool(tool), maxFiles: 1 }}
        files={files}
        onChange={setFiles}
        label="Déposez un fichier .txt, .md ou .html"
        disabled={job.isRunning}
      />

      {file && (
        <>
          <Fieldset>
            <Field label="Type de contenu">
              <OptionGroup
                ariaLabel="Type"
                value={kind}
                onChange={setKind}
                options={[
                  { value: "text", label: "Texte" },
                  { value: "markdown", label: "Markdown" },
                  { value: "html", label: "HTML" },
                ]}
              />
            </Field>
            <Field label="Titre (facultatif)">
              <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre en tête du document" />
            </Field>
            <Field label="Taille du texte (pt)">
              <NumberInput value={fontSize} min={8} max={24} onChange={(e) => setFontSize(Number(e.target.value) || 11)} />
            </Field>
          </Fieldset>

          {content && (
            <div className="max-h-40 overflow-auto rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface)] p-2.5 text-xs text-[var(--ft-text-muted)] whitespace-pre-wrap">
              {content.slice(0, 1200)}
              {content.length > 1200 ? "…" : ""}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            {job.isRunning && <Button size="sm" variant="ghost" onClick={job.cancel}>Annuler</Button>}
            <Button size="md" variant="primary" onClick={run} disabled={job.isRunning || content.trim().length === 0}>
              {job.isRunning ? (
                <><Icon name="Loader" size={15} className="animate-spin" />{job.progress.label ?? "Génération…"}</>
              ) : (
                <><Icon name="FileType2" size={15} />Créer le PDF</>
              )}
            </Button>
          </div>
        </>
      )}

      {errorMessage && job.status === "error" && (
        <p className="flex items-center gap-2 rounded-md border border-[var(--ft-danger)] px-3 py-2 text-sm text-[var(--ft-danger)]">
          <Icon name="CircleAlert" size={16} /> {errorMessage}
        </p>
      )}
      {outcome && <ResultPanel outcome={outcome} />}
    </div>
  );
}
