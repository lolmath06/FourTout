import { useEffect, useMemo, useState } from "react";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { PdfSourceList } from "@/components/pdf/PdfSourceList";
import { usePdfSources } from "@/components/pdf/usePdfSources";
import { PreviewFrame } from "@/components/image/ImagePreview";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { PageNav } from "./PdfAddTextTool";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useJob } from "@/core/jobs";
import { comparePdfs, type CompareResult, type PageComparison } from "@/core/pdf/operations/compare";
import { toPdfError } from "@/core/pdf/errors";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

type ViewMode = "side" | "diff";

export function PdfCompareTool({ tool }: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<ViewMode>("diff");
  const { loaded, unlock } = usePdfSources(files);
  const job = useJob<CompareResult>();

  const usable = loaded.filter((d) => !d.error && !d.needsPassword);
  const ready = usable.length === 2;

  useEffect(() => { setResult(null); setPage(1); }, [files]);

  const run = async () => {
    if (!ready) return;
    setResult(null);
    const res = await job.run((context) =>
      comparePdfs(usable[0].source, usable[1].source, { dpi: 120 }, { report: context.report, signal: context.signal }),
    );
    if (res) {
      setResult(res);
      notify.success("Comparaison terminée", `${Math.round(res.overallDiff * 100)}% de différence moyenne.`);
    }
  };

  const errorMessage = job.error ? toPdfError(job.error.cause).message : undefined;
  const comparison = result?.pages.find((p) => p.page === page);

  return (
    <div className="space-y-4">
      <FileDropZone constraints={{ ...constraintsForTool(tool), maxFiles: 2 }} files={files} onChange={setFiles} label="Déposez deux PDF à comparer" disabled={job.isRunning} />
      {loaded.length > 0 && <PdfSourceList documents={loaded} />}
      {loaded.some((d) => d.needsPassword) && loaded.map((d) => d.needsPassword && <PdfSourceList key={d.id} documents={[d]} onUnlock={unlock} />)}

      {ready && !result && (
        <div className="flex items-center justify-end gap-2">
          {job.isRunning && <Button size="sm" variant="ghost" onClick={job.cancel}>Annuler</Button>}
          <Button size="md" variant="primary" onClick={run} disabled={job.isRunning}>
            {job.isRunning ? (<><Icon name="Loader" size={15} className="animate-spin" />{job.progress.label ?? "Comparaison…"}</>) : (<><Icon name="GitCompare" size={15} />Comparer</>)}
          </Button>
        </div>
      )}

      {job.isRunning && (
        <div className="h-1 overflow-hidden rounded-full bg-[var(--ft-surface-2)]"><div className="h-full rounded-full bg-[var(--ft-accent)] transition-[width]" style={{ width: `${Math.round((job.progress.ratio ?? 0) * 100)}%` }} /></div>
      )}
      {errorMessage && job.status === "error" && (
        <p className="flex items-center gap-2 rounded-md border border-[var(--ft-danger)] px-3 py-2 text-sm text-[var(--ft-danger)]"><Icon name="CircleAlert" size={16} /> {errorMessage}</p>
      )}

      {result && (
        <>
          <div className="rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface)] px-3 py-2 text-sm">
            {result.pageCountA === result.pageCountB
              ? `${result.pageCountA} pages · ${Math.round(result.overallDiff * 100)}% de différence moyenne.`
              : `Nombre de pages différent : ${result.pageCountA} contre ${result.pageCountB}.`}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <PageNav page={page} pageCount={result.pages.length} onPage={setPage} />
            <Fieldset columns={1}>
              <Field label="Affichage">
                <OptionGroup ariaLabel="Affichage" value={mode} onChange={setMode} options={[{ value: "diff", label: "Différences" }, { value: "side", label: "Côte à côte" }]} />
              </Field>
            </Fieldset>
          </div>

          {comparison && <ComparisonView comparison={comparison} mode={mode} />}
        </>
      )}
    </div>
  );
}

function ComparisonView({ comparison, mode }: { comparison: PageComparison; mode: ViewMode }) {
  const urlA = useObjectUrl(comparison.pngA);
  const urlB = useObjectUrl(comparison.pngB);
  const urlDiff = useObjectUrl(comparison.diffPng);

  const badge = {
    identical: { label: "Identique", color: "var(--ft-ok)" },
    different: { label: `${Math.round(comparison.diffRatio * 100)}% différent`, color: "var(--ft-warn)" },
    "only-in-a": { label: "Seulement dans le 1er PDF", color: "var(--ft-danger)" },
    "only-in-b": { label: "Seulement dans le 2e PDF", color: "var(--ft-danger)" },
  }[comparison.status];

  return (
    <div className="space-y-2">
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ color: badge.color, background: `color-mix(in oklch, ${badge.color} 12%, transparent)` }}>
        <Icon name="GitCompare" size={12} /> Page {comparison.page} · {badge.label}
      </span>

      {mode === "diff" && comparison.diffPng ? (
        <PreviewFrame maxHeight={560}>{urlDiff && <img src={urlDiff} alt="Différences" className="max-h-[540px] max-w-full object-contain" />}</PreviewFrame>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <PreviewFrame maxHeight={520}>{urlA ? <img src={urlA} alt="PDF 1" className="max-h-[500px] max-w-full object-contain" /> : <Absent />}</PreviewFrame>
          <PreviewFrame maxHeight={520}>{urlB ? <img src={urlB} alt="PDF 2" className="max-h-[500px] max-w-full object-contain" /> : <Absent />}</PreviewFrame>
        </div>
      )}
    </div>
  );
}

function Absent() {
  return <div className="flex h-40 items-center justify-center text-sm text-[var(--ft-text-muted)]">Page absente</div>;
}

function useObjectUrl(bytes: Uint8Array | undefined): string | undefined {
  return useMemo(() => {
    if (!bytes) return undefined;
    return URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: "image/png" }));
  }, [bytes]);
}
