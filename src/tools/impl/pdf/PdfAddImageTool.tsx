import { useEffect, useRef, useState } from "react";
import { type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { PdfSourceList } from "@/components/pdf/PdfSourceList";
import { usePdfSources } from "@/components/pdf/usePdfSources";
import { usePdfPage } from "@/components/pdf/usePdfPage";
import { useImagePreview } from "@/components/image/useImagePreview";
import { PreviewFrame } from "@/components/image/ImagePreview";
import { PageNav, ApplyBar } from "./PdfAddTextTool";
import { Icon } from "@/components/ui/Icon";
import { ResultPanel, type OperationOutcome } from "@/components/pdf/ResultPanel";
import { useJob } from "@/core/jobs";
import { readSelectedFile } from "@/core/image/codec";
import { addImageToPdf } from "@/core/pdf/operations/addContent";
import { toPdfError } from "@/core/pdf/errors";
import { notify } from "@/features/notifications/store";
import type { PdfSource } from "@/core/pdf/types";
import type { ToolComponentProps } from "@/tools/implementations";

interface Placement { x: number; y: number; width: number; height: number }

export function PdfAddImageTool(_props: ToolComponentProps) {
  const [pdfFiles, setPdfFiles] = useState<SelectedFile[]>([]);
  const [imgFiles, setImgFiles] = useState<SelectedFile[]>([]);
  const [page, setPage] = useState(1);
  const [placement, setPlacement] = useState<Placement>({ x: 0.35, y: 0.35, width: 0.3, height: 0.15 });
  const [outcome, setOutcome] = useState<OperationOutcome | null>(null);
  const { loaded, unlock } = usePdfSources(pdfFiles);
  const job = useJob<OperationOutcome>();

  const document = loaded[0];
  const usable = document && !document.error && !document.needsPassword ? document : undefined;
  const pageCount = usable?.info?.pageCount ?? 0;
  const image = imgFiles[0];
  const imgPreview = useImagePreview(image);

  useEffect(() => { setOutcome(null); setPage(1); }, [usable?.source.name]);

  // Ajuste le ratio initial de la zone à l'image chargée.
  useEffect(() => {
    if (imgPreview.width > 0 && imgPreview.height > 0) {
      const ratio = imgPreview.width / imgPreview.height;
      setPlacement((p) => ({ ...p, height: p.width / ratio / 1.414 }));
    }
  }, [imgPreview.width, imgPreview.height]);

  const apply = async () => {
    if (!usable || !image) return;
    setOutcome(null);
    const bytes = await readSelectedFile(image);
    const result = await job.run(async (context) => {
      const output = await addImageToPdf(usable.source, [{ page, bytes, ...placement }], { report: context.report, signal: context.signal });
      return { files: [output], summary: "Image ajoutée au document." };
    });
    if (result) { setOutcome(result); notify.success("Fichier prêt", result.summary); }
  };

  const errorMessage = job.error ? toPdfError(job.error.cause).message : undefined;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <FileDropZone constraints={{ inputs: [{ kind: "pdf", extensions: ["pdf"] }], maxFiles: 1 }} files={pdfFiles} onChange={setPdfFiles} label="1. Déposez le PDF" disabled={job.isRunning} />
        <FileDropZone constraints={{ inputs: [{ kind: "image", extensions: ["png", "jpg", "jpeg", "webp"] }], maxFiles: 1 }} files={imgFiles} onChange={setImgFiles} label="2. Image ou signature (PNG transparent)" disabled={job.isRunning} />
      </div>
      {loaded.length > 0 && <PdfSourceList documents={loaded} onUnlock={unlock} />}

      {usable && image && (
        <>
          <PageNav page={page} pageCount={pageCount} onPage={setPage} />
          <ImageStage source={usable.source} page={page} imageUrl={imgPreview.url} placement={placement} onChange={setPlacement} />
          <ApplyBar job={job} onApply={apply} disabled={false} label="Ajouter l'image" icon="Signature" />
        </>
      )}

      {errorMessage && job.status === "error" && (
        <p className="flex items-center gap-2 rounded-md border border-[var(--ft-danger)] px-3 py-2 text-sm text-[var(--ft-danger)]"><Icon name="CircleAlert" size={16} /> {errorMessage}</p>
      )}
      {outcome && <ResultPanel outcome={outcome} />}
    </div>
  );
}

function ImageStage({ source, page, imageUrl, placement, onChange }: {
  source: PdfSource; page: number; imageUrl?: string; placement: Placement; onChange: (p: Placement) => void;
}) {
  const render = usePdfPage(source, page);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: "move" | "resize"; dx: number; dy: number; orig: Placement } | null>(null);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current; const el = boxRef.current;
      if (!drag || !el) return;
      const box = el.getBoundingClientRect();
      const fx = clamp01((event.clientX - box.left) / box.width);
      const fy = clamp01((event.clientY - box.top) / box.height);
      if (drag.mode === "move") {
        onChange({ ...placement, x: clamp01(fx - drag.dx), y: clamp01(fy - drag.dy) });
      } else {
        onChange({ ...placement, width: Math.max(0.03, fx - placement.x), height: Math.max(0.03, fy - placement.y) });
      }
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [placement, onChange]);

  const startMove = (event: React.PointerEvent) => {
    const el = boxRef.current; if (!el) return;
    const box = el.getBoundingClientRect();
    dragRef.current = { mode: "move", dx: (event.clientX - box.left) / box.width - placement.x, dy: (event.clientY - box.top) / box.height - placement.y, orig: placement };
    event.preventDefault();
  };
  const startResize = (event: React.PointerEvent) => {
    dragRef.current = { mode: "resize", dx: 0, dy: 0, orig: placement };
    event.preventDefault(); event.stopPropagation();
  };

  return (
    <PreviewFrame maxHeight={560}>
      <div ref={boxRef} className="relative inline-block select-none">
        {render.url ? (
          <img src={render.url} alt={`Page ${page}`} className="block max-h-[540px] max-w-full object-contain" draggable={false} />
        ) : (
          <div className="flex h-64 items-center justify-center text-sm text-[var(--ft-text-muted)]"><Icon name="Loader" size={16} className="mr-2 animate-spin" /> Rendu…</div>
        )}
        {imageUrl && (
          <div className="absolute cursor-move outline outline-1 outline-dashed outline-[var(--ft-accent)]" style={{ left: `${placement.x * 100}%`, top: `${placement.y * 100}%`, width: `${placement.width * 100}%`, height: `${placement.height * 100}%` }} onPointerDown={startMove}>
            <img src={imageUrl} alt="À insérer" className="h-full w-full object-contain" draggable={false} />
            <span onPointerDown={startResize} className="absolute -bottom-1.5 -right-1.5 size-3.5 cursor-se-resize rounded-full border border-[var(--ft-accent)] bg-white" />
          </div>
        )}
      </div>
    </PreviewFrame>
  );
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
