import { useEffect, useRef, useState } from "react";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { PdfSourceList } from "@/components/pdf/PdfSourceList";
import { usePdfSources } from "@/components/pdf/usePdfSources";
import { usePdfPage } from "@/components/pdf/usePdfPage";
import { PreviewFrame } from "@/components/image/ImagePreview";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ResultPanel, type OperationOutcome } from "@/components/pdf/ResultPanel";
import { useJob } from "@/core/jobs";
import { redactPdf, type PageRedaction, type RedactRect } from "@/core/pdf/operations/redact";
import { toPdfError } from "@/core/pdf/errors";
import { notify } from "@/features/notifications/store";
import type { PdfSource } from "@/core/pdf/types";
import type { ToolComponentProps } from "@/tools/implementations";

export function PdfRedactTool({ tool }: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [rects, setRects] = useState<Record<number, RedactRect[]>>({});
  const [page, setPage] = useState(1);
  const [outcome, setOutcome] = useState<OperationOutcome | null>(null);
  const { loaded, unlock } = usePdfSources(files);
  const job = useJob<OperationOutcome>();

  const document = loaded[0];
  const usable = document && !document.error && !document.needsPassword ? document : undefined;
  const pageCount = usable?.info?.pageCount ?? 0;

  useEffect(() => {
    setRects({});
    setPage(1);
    setOutcome(null);
  }, [usable?.source.name]);

  const totalRects = Object.values(rects).reduce((sum, r) => sum + r.length, 0);

  const apply = async () => {
    if (!usable) return;
    setOutcome(null);
    const redactions: PageRedaction[] = Object.entries(rects)
      .filter(([, r]) => r.length > 0)
      .map(([p, r]) => ({ page: Number(p), rects: r }));
    const result = await job.run(async (context) => {
      const output = await redactPdf(usable.source, redactions, { dpi: 200 }, { report: context.report, signal: context.signal });
      return { files: [output], summary: `${totalRects} zone${totalRects > 1 ? "s" : ""} caviardée${totalRects > 1 ? "s" : ""} définitivement.` };
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
        label="Déposez le PDF à caviarder"
        disabled={job.isRunning}
      />
      {loaded.length > 0 && <PdfSourceList documents={loaded} onUnlock={unlock} />}

      {usable && (
        <>
          <p className="flex items-start gap-2 rounded-md border border-[var(--ft-warn)] bg-[color-mix(in_oklch,var(--ft-warn)_8%,transparent)] px-3 py-2 text-xs text-[var(--ft-warn)]">
            <Icon name="TriangleAlert" size={15} className="mt-px shrink-0" />
            Le caviardage est irréversible : sur les pages masquées, le contenu est rendu en image et le texte d'origine n'est plus récupérable.
          </p>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                <Icon name="ChevronLeft" size={15} />
              </Button>
              <span className="text-sm tabular-nums">Page {page} / {pageCount}</span>
              <Button size="sm" variant="ghost" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>
                <Icon name="ChevronRight" size={15} />
              </Button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRects((r) => ({ ...r, [page]: [] }))}
              disabled={!rects[page]?.length}
            >
              <Icon name="Trash" size={14} /> Effacer la page
            </Button>
          </div>

          <RedactStage
            source={usable.source}
            page={page}
            rects={rects[page] ?? []}
            onAdd={(rect) => setRects((r) => ({ ...r, [page]: [...(r[page] ?? []), rect] }))}
            onRemove={(index) => setRects((r) => ({ ...r, [page]: (r[page] ?? []).filter((_, i) => i !== index) }))}
          />

          <div className="flex items-center justify-between gap-3 border-t border-[var(--ft-border)] pt-4">
            <span className="text-xs text-[var(--ft-text-muted)]">{totalRects} zone{totalRects > 1 ? "s" : ""} au total</span>
            <div className="flex items-center gap-2">
              {job.isRunning && <Button size="sm" variant="ghost" onClick={job.cancel}>Annuler</Button>}
              <Button size="md" variant="primary" onClick={apply} disabled={job.isRunning || totalRects === 0}>
                {job.isRunning ? (
                  <><Icon name="Loader" size={15} className="animate-spin" />{job.progress.label ?? "Caviardage…"}</>
                ) : (
                  <><Icon name="SquareSlash" size={15} />Caviarder définitivement</>
                )}
              </Button>
            </div>
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

function RedactStage({
  source,
  page,
  rects,
  onAdd,
  onRemove,
}: {
  source: PdfSource;
  page: number;
  rects: RedactRect[];
  onAdd: (rect: RedactRect) => void;
  onRemove: (index: number) => void;
}) {
  const render = usePdfPage(source, page);
  const boxRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<RedactRect | null>(null);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const start = startRef.current;
      const el = boxRef.current;
      if (!start || !el) return;
      const box = el.getBoundingClientRect();
      const fx = clamp01((event.clientX - box.left) / box.width);
      const fy = clamp01((event.clientY - box.top) / box.height);
      setDraft({ x: Math.min(start.x, fx), y: Math.min(start.y, fy), width: Math.abs(fx - start.x), height: Math.abs(fy - start.y) });
    };
    const onUp = () => {
      if (draft && draft.width > 0.01 && draft.height > 0.01) onAdd(draft);
      startRef.current = null;
      setDraft(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [draft, onAdd]);

  const start = (event: React.PointerEvent) => {
    const el = boxRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    startRef.current = { x: clamp01((event.clientX - box.left) / box.width), y: clamp01((event.clientY - box.top) / box.height) };
    event.preventDefault();
  };

  return (
    <PreviewFrame maxHeight={560}>
      <div ref={boxRef} className="relative inline-block select-none" onPointerDown={start}>
        {render.url ? (
          <img src={render.url} alt={`Page ${page}`} className="block max-h-[540px] max-w-full object-contain" draggable={false} />
        ) : (
          <div className="flex h-64 items-center justify-center text-sm text-[var(--ft-text-muted)]">
            <Icon name="Loader" size={16} className="mr-2 animate-spin" /> Rendu de la page…
          </div>
        )}
        {rects.map((rect, index) => (
          <div
            key={index}
            onClick={(e) => { e.stopPropagation(); onRemove(index); }}
            title="Cliquer pour retirer"
            className="absolute cursor-pointer bg-black"
            style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}
          />
        ))}
        {draft && (
          <div className="pointer-events-none absolute border-2 border-dashed border-white bg-black/60" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%` }} />
        )}
      </div>
    </PreviewFrame>
  );
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
