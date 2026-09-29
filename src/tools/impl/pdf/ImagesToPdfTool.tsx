import { useCallback, useState } from "react";
import { constraintsForTool, formatFileSize, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { ResultPanel, type OperationOutcome } from "@/components/pdf/ResultPanel";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useJob } from "@/core/jobs";
import { imagesToPdf, type ImagePageMode } from "@/core/pdf/operations/imagesToPdf";
import { toPdfError } from "@/core/pdf/errors";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Images vers PDF.
 *
 * Cet outil ne part pas d'un PDF : il n'utilise donc pas `PdfToolShell`, mais
 * reprend la même disposition — dépôt, liste ordonnable, réglages, action,
 * résultat — pour rester cohérent avec le reste de la catégorie.
 */

const MODES = [
  { value: "fit-image" as ImagePageMode, label: "Ajuster à l'image" },
  { value: "a4-portrait" as ImagePageMode, label: "A4 portrait" },
  { value: "a4-landscape" as ImagePageMode, label: "A4 paysage" },
];

export function ImagesToPdfTool({ tool }: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [mode, setMode] = useState<ImagePageMode>("fit-image");
  const [outcome, setOutcome] = useState<OperationOutcome | null>(null);
  const job = useJob<OperationOutcome>();

  const move = useCallback((index: number, direction: -1 | 1) => {
    setFiles((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const execute = async () => {
    setOutcome(null);
    const result = await job.run(async (context) => {
      const images = [];
      for (const file of files) {
        if (!file.file) continue;
        images.push({
          name: file.name,
          bytes: new Uint8Array(await file.file.arrayBuffer()),
          mimeType: file.mimeType,
        });
      }
      const output = await imagesToPdf(images, { mode }, {
        report: context.report,
        signal: context.signal,
      });
      return {
        files: [output],
        summary: `${images.length} image${images.length > 1 ? "s" : ""} converties en un PDF de ${images.length} page${images.length > 1 ? "s" : ""}.`,
      };
    });
    if (result) {
      setOutcome(result);
      notify.success("PDF prêt", result.summary);
    }
  };

  const errorMessage = job.error ? toPdfError(job.error.cause).message : undefined;

  return (
    <div className="space-y-4">
      <FileDropZone
        constraints={constraintsForTool(tool)}
        files={files}
        onChange={setFiles}
        label="Déposez vos images ici"
        hint="PNG, JPEG et WebP. Une image par page, dans l'ordre de la liste."
        disabled={job.isRunning}
      />

      {files.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {files.map((file, index) => (
            <li
              key={file.id}
              className="flex items-center gap-2.5 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] px-3 py-2"
            >
              <span className="w-5 shrink-0 text-center text-xs tabular-nums text-[var(--ft-text-faint)]">
                {index + 1}
              </span>
              <Icon name="Image" size={15} className="shrink-0 text-[var(--ft-text-faint)]" />
              <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
              <span className="shrink-0 text-xs text-[var(--ft-text-muted)]">
                {formatFileSize(file.size)}
              </span>
              <button
                type="button"
                aria-label={`Monter ${file.name}`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
                className="rounded p-1 text-[var(--ft-text-faint)] hover:text-[var(--ft-text)] disabled:opacity-30"
              >
                <Icon name="ArrowUpDown" size={14} />
              </button>
              <button
                type="button"
                aria-label={`Descendre ${file.name}`}
                disabled={index === files.length - 1}
                onClick={() => move(index, 1)}
                className="rotate-180 rounded p-1 text-[var(--ft-text-faint)] hover:text-[var(--ft-text)] disabled:opacity-30"
              >
                <Icon name="ArrowUpDown" size={14} />
              </button>
              <button
                type="button"
                aria-label={`Retirer ${file.name}`}
                onClick={() => setFiles((c) => c.filter((f) => f.id !== file.id))}
                className="rounded p-1 text-[var(--ft-text-faint)] hover:text-[var(--ft-danger)]"
              >
                <Icon name="X" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <>
          <Fieldset columns={1}>
            <Field
              label="Format des pages"
              hint="Le ratio de l'image est toujours conservé : aucune déformation."
            >
              <OptionGroup
                ariaLabel="Format des pages"
                value={mode}
                onChange={setMode}
                options={MODES}
              />
            </Field>
          </Fieldset>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--ft-border)] pt-4">
            {job.isRunning && (
              <Button size="sm" variant="ghost" onClick={job.cancel}>
                Annuler
              </Button>
            )}
            <Button variant="primary" onClick={execute} disabled={job.isRunning}>
              {job.isRunning ? (
                <>
                  <Icon name="Loader" size={15} className="animate-spin" />
                  {job.progress.label ?? "Conversion…"}
                </>
              ) : (
                <>
                  <Icon name="Play" size={15} />
                  Créer le PDF
                </>
              )}
            </Button>
          </div>
        </>
      )}

      {errorMessage && job.status === "error" && (
        <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-[var(--ft-danger)] bg-[color-mix(in_oklch,var(--ft-danger)_8%,transparent)] px-3 py-2.5 text-sm text-[var(--ft-danger)]">
          <Icon name="CircleAlert" size={16} className="mt-0.5 shrink-0" />
          {errorMessage}
        </p>
      )}

      {outcome && <ResultPanel outcome={outcome} />}
    </div>
  );
}
