import { useEffect, useRef, useState } from "react";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { PdfSourceList } from "@/components/pdf/PdfSourceList";
import { usePdfSources } from "@/components/pdf/usePdfSources";
import { usePdfPage } from "@/components/pdf/usePdfPage";
import { useRenderedSize } from "@/components/image/useRenderedSize";
import { PreviewFrame } from "@/components/image/ImagePreview";
import { ColorField } from "@/components/image/ColorField";
import { Field, Fieldset, Slider, TextInput } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ResultPanel, type OperationOutcome } from "@/components/pdf/ResultPanel";
import { useJob } from "@/core/jobs";
import { addTextToPdf, type TextBox } from "@/core/pdf/operations/addContent";
import { rgbToHex } from "@/core/image/types";
import { toPdfError } from "@/core/pdf/errors";
import { notify } from "@/features/notifications/store";
import type { PdfSource } from "@/core/pdf/types";
import type { ToolComponentProps } from "@/tools/implementations";

interface Box extends TextBox {
  id: string;
}

let counter = 0;

export function PdfAddTextTool({ tool }: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [outcome, setOutcome] = useState<OperationOutcome | null>(null);
  const { loaded, unlock } = usePdfSources(files);
  const job = useJob<OperationOutcome>();

  const document = loaded[0];
  const usable = document && !document.error && !document.needsPassword ? document : undefined;
  const pageCount = usable?.info?.pageCount ?? 0;
  const current = boxes.find((b) => b.id === selected);

  useEffect(() => {
    setBoxes([]);
    setSelected(null);
    setPage(1);
    setOutcome(null);
  }, [usable?.source.name]);

  const addBox = (x: number, y: number) => {
    counter += 1;
    const box: Box = { id: `b${counter}`, page, x, y, text: "Texte", size: 16, color: { r: 0, g: 0, b: 0 }, bold: false };
    setBoxes((b) => [...b, box]);
    setSelected(box.id);
  };
  const update = (id: string, patch: Partial<Box>) => setBoxes((b) => b.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const apply = async () => {
    if (!usable) return;
    setOutcome(null);
    const result = await job.run(async (context) => {
      const output = await addTextToPdf(usable.source, boxes, { report: context.report, signal: context.signal });
      return { files: [output], summary: `${boxes.length} zone${boxes.length > 1 ? "s" : ""} de texte ajoutée${boxes.length > 1 ? "s" : ""}.` };
    });
    if (result) { setOutcome(result); notify.success("Fichier prêt", result.summary); }
  };

  const errorMessage = job.error ? toPdfError(job.error.cause).message : undefined;

  return (
    <div className="space-y-4">
      <FileDropZone constraints={{ ...constraintsForTool(tool), maxFiles: 1 }} files={files} onChange={setFiles} label="Déposez votre PDF" disabled={job.isRunning} />
      {loaded.length > 0 && <PdfSourceList documents={loaded} onUnlock={unlock} />}

      {usable && (
        <>
          <PageNav page={page} pageCount={pageCount} onPage={setPage} />
          <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
            <TextStage
              source={usable.source}
              page={page}
              boxes={boxes.filter((b) => b.page === page)}
              selected={selected}
              onSelect={setSelected}
              onAdd={addBox}
              onMove={(id, x, y) => update(id, { x, y })}
            />
            <Fieldset columns={1}>
              {current ? (
                <>
                  <Field label="Texte"><TextInput value={current.text} onChange={(e) => update(current.id, { text: e.target.value })} /></Field>
                  <Field label={`Taille (${current.size} pt)`}><Slider value={current.size} onChange={(v) => update(current.id, { size: v })} min={6} max={48} /></Field>
                  <Field label="Couleur"><ColorField value={current.color} onChange={(c) => update(current.id, { color: c })} /></Field>
                  <Field label="Graisse">
                    <Button size="sm" variant={current.bold ? "primary" : "secondary"} onClick={() => update(current.id, { bold: !current.bold })}>{current.bold ? "Gras" : "Normal"}</Button>
                  </Field>
                  <Button size="sm" variant="ghost" onClick={() => { setBoxes((b) => b.filter((x) => x.id !== current.id)); setSelected(null); }}>
                    <Icon name="Trash" size={14} /> Supprimer
                  </Button>
                </>
              ) : (
                <p className="text-xs text-[var(--ft-text-muted)]">Cliquez sur la page pour ajouter une zone de texte, puis déplacez-la.</p>
              )}
            </Fieldset>
          </div>

          <ApplyBar job={job} onApply={apply} disabled={boxes.length === 0} label="Ajouter le texte" icon="PenLine" />
        </>
      )}

      {errorMessage && job.status === "error" && (
        <p className="flex items-center gap-2 rounded-md border border-[var(--ft-danger)] px-3 py-2 text-sm text-[var(--ft-danger)]"><Icon name="CircleAlert" size={16} /> {errorMessage}</p>
      )}
      {outcome && <ResultPanel outcome={outcome} />}
    </div>
  );
}

function TextStage({ source, page, boxes, selected, onSelect, onAdd, onMove }: {
  source: PdfSource; page: number; boxes: Box[]; selected: string | null;
  onSelect: (id: string | null) => void; onAdd: (x: number, y: number) => void; onMove: (id: string, x: number, y: number) => void;
}) {
  const render = usePdfPage(source, page);
  const boxRef = useRef<HTMLDivElement>(null);
  const rendered = useRenderedSize(boxRef);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  // Taille de police en pixels réels : la taille en points est mise à l'échelle
  // d'après la hauteur d'affichage de la page (le PDF fait `heightPts` de haut).
  const fontPx = (size: number) =>
    render.heightPts > 0 && rendered.height > 0 ? `${(size / render.heightPts) * rendered.height}px` : `${size}px`;

  useEffect(() => {
    const onMoveEvt = (event: PointerEvent) => {
      const drag = dragRef.current; const el = boxRef.current;
      if (!drag || !el) return;
      const box = el.getBoundingClientRect();
      onMove(drag.id, clamp01((event.clientX - box.left) / box.width - drag.dx), clamp01((event.clientY - box.top) / box.height - drag.dy));
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("pointermove", onMoveEvt);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMoveEvt); window.removeEventListener("pointerup", onUp); };
  }, [onMove]);

  const onStageDown = (event: React.PointerEvent) => {
    const el = boxRef.current; if (!el) return;
    const box = el.getBoundingClientRect();
    onAdd(clamp01((event.clientX - box.left) / box.width), clamp01((event.clientY - box.top) / box.height));
  };

  return (
    <PreviewFrame maxHeight={560}>
      <div ref={boxRef} className="relative inline-block select-none" onPointerDown={onStageDown}>
        {render.url ? (
          <img src={render.url} alt={`Page ${page}`} className="block max-h-[540px] max-w-full object-contain" draggable={false} />
        ) : (
          <div className="flex h-64 items-center justify-center text-sm text-[var(--ft-text-muted)]"><Icon name="Loader" size={16} className="mr-2 animate-spin" /> Rendu…</div>
        )}
        {boxes.map((b) => (
          <div
            key={b.id}
            onPointerDown={(e) => {
              e.stopPropagation(); e.preventDefault();
              onSelect(b.id);
              const el = boxRef.current; if (!el) return;
              const box = el.getBoundingClientRect();
              dragRef.current = { id: b.id, dx: (e.clientX - box.left) / box.width - b.x, dy: (e.clientY - box.top) / box.height - b.y };
            }}
            className={`absolute cursor-move whitespace-pre leading-none ${b.id === selected ? "outline outline-1 outline-[var(--ft-accent)]" : ""}`}
            style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, color: rgbToHex(b.color), fontWeight: b.bold ? 700 : 400, fontFamily: "Helvetica, Arial, sans-serif", fontSize: fontPx(b.size) }}
          >
            {b.text}
          </div>
        ))}
      </div>
    </PreviewFrame>
  );
}

export function PageNav({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="ghost" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}><Icon name="ChevronLeft" size={15} /></Button>
      <span className="text-sm tabular-nums">Page {page} / {pageCount}</span>
      <Button size="sm" variant="ghost" onClick={() => onPage(Math.min(pageCount, page + 1))} disabled={page >= pageCount}><Icon name="ChevronRight" size={15} /></Button>
    </div>
  );
}

export function ApplyBar({ job, onApply, disabled, label, icon }: { job: ReturnType<typeof useJob<OperationOutcome>>; onApply: () => void; disabled: boolean; label: string; icon: string }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-[var(--ft-border)] pt-4">
      {job.isRunning && <Button size="sm" variant="ghost" onClick={job.cancel}>Annuler</Button>}
      <Button size="md" variant="primary" onClick={onApply} disabled={job.isRunning || disabled}>
        {job.isRunning ? (<><Icon name="Loader" size={15} className="animate-spin" />{job.progress.label ?? "Traitement…"}</>) : (<><Icon name={icon} size={15} />{label}</>)}
      </Button>
    </div>
  );
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
