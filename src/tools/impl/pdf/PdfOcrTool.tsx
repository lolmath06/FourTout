import { useState } from "react";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { PdfSourceList } from "@/components/pdf/PdfSourceList";
import { usePdfSources } from "@/components/pdf/usePdfSources";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useJob } from "@/core/jobs";
import { recognizePdf, type OcrPageResult } from "@/core/ocr/pdf";
import { OCR_LANGUAGE_LABELS, type OcrLanguage } from "@/core/ocr";
import { toPdfError } from "@/core/pdf/errors";
import { saveFile } from "@/core/output/save";
import { outputName } from "@/core/pdf/filenames";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

const LANGS: { value: OcrLanguage; label: string }[] = [
  { value: "fra", label: OCR_LANGUAGE_LABELS.fra },
  { value: "eng", label: OCR_LANGUAGE_LABELS.eng },
  { value: "fra+eng", label: OCR_LANGUAGE_LABELS["fra+eng"] },
];

export function PdfOcrTool({ tool }: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [language, setLanguage] = useState<OcrLanguage>("fra");
  const [pages, setPages] = useState<OcrPageResult[]>([]);
  const [edited, setEdited] = useState<Record<number, string>>({});
  const { loaded, unlock } = usePdfSources(files);
  const job = useJob<OcrPageResult[]>();

  const document = loaded[0];
  const usable = document && !document.error && !document.needsPassword ? document : undefined;

  const run = async () => {
    if (!usable) return;
    setPages([]);
    setEdited({});
    const result = await job.run((context) =>
      recognizePdf(usable.source, { language }, { report: context.report, signal: context.signal }),
    );
    if (result) {
      setPages(result);
      setEdited(Object.fromEntries(result.map((p) => [p.page, p.text])));
      notify.success("Texte extrait", `${result.length} page${result.length > 1 ? "s" : ""} analysée${result.length > 1 ? "s" : ""}.`);
    }
  };

  const saveAll = async () => {
    const text = pages.map((p) => `--- Page ${p.page} ---\n${edited[p.page] ?? p.text}`).join("\n\n");
    const bytes = new TextEncoder().encode(text);
    const result = await saveFile({ name: outputName(usable?.source.name ?? "document", "ocr", "txt"), bytes, mimeType: "text/plain" });
    if (result.saved) notify.success("Fichier enregistré", result.path);
  };

  const errorMessage = job.error ? toPdfError(job.error.cause).message : undefined;

  return (
    <div className="space-y-4">
      <FileDropZone
        constraints={{ ...constraintsForTool(tool), maxFiles: 1 }}
        files={files}
        onChange={setFiles}
        label="Déposez un PDF scanné"
        hint="Reconnaissance 100 % locale, page par page."
        disabled={job.isRunning}
      />
      {loaded.length > 0 && <PdfSourceList documents={loaded} onUnlock={unlock} />}

      {usable && (
        <>
          <Fieldset columns={1}>
            <Field label="Langue">
              <OptionGroup ariaLabel="Langue" value={language} onChange={setLanguage} options={LANGS} disabled={job.isRunning} />
            </Field>
          </Fieldset>

          <div className="flex items-center justify-end gap-2">
            {job.isRunning && <Button size="sm" variant="ghost" onClick={job.cancel}>Annuler</Button>}
            <Button size="md" variant="primary" onClick={run} disabled={job.isRunning}>
              {job.isRunning ? (
                <><Icon name="Loader" size={15} className="animate-spin" />{job.progress.label ?? "Analyse…"}</>
              ) : (
                <><Icon name="ScanText" size={15} />Extraire le texte</>
              )}
            </Button>
          </div>
        </>
      )}

      {job.isRunning && (
        <div className="h-1 overflow-hidden rounded-full bg-[var(--ft-surface-2)]">
          <div className="h-full rounded-full bg-[var(--ft-accent)] transition-[width]" style={{ width: `${Math.round((job.progress.ratio ?? 0) * 100)}%` }} />
        </div>
      )}

      {errorMessage && job.status === "error" && (
        <p className="flex items-center gap-2 rounded-md border border-[var(--ft-danger)] px-3 py-2 text-sm text-[var(--ft-danger)]">
          <Icon name="CircleAlert" size={16} /> {errorMessage}
        </p>
      )}

      {pages.length > 0 && (
        <div className="flex justify-end">
          <Button size="sm" onClick={saveAll}><Icon name="HardDrive" size={14} />Enregistrer tout en .txt</Button>
        </div>
      )}

      {pages.map((page) => {
        const value = edited[page.page] ?? page.text;
        const words = value.trim() ? value.trim().split(/\s+/).length : 0;
        return (
          <div key={page.page} className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Icon name="FileText" size={14} className="text-[var(--ft-text-faint)]" />
              Page {page.page} <span className="text-xs text-[var(--ft-text-muted)]">· confiance {page.confidence} %</span>
            </p>
            <textarea
              value={value}
              onChange={(e) => setEdited((m) => ({ ...m, [page.page]: e.target.value }))}
              rows={Math.min(14, Math.max(3, value.split("\n").length + 1))}
              className="w-full resize-y rounded-md border border-[var(--ft-border)] bg-[var(--ft-bg)] p-2.5 font-mono text-sm outline-none focus:border-[var(--ft-accent)]"
              placeholder="Aucun texte détecté."
            />
            <p className="mt-1 text-right text-xs text-[var(--ft-text-muted)]">{words} mot{words > 1 ? "s" : ""}</p>
          </div>
        );
      })}
    </div>
  );
}
