import { useEffect, useRef, useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { Field, Fieldset, OptionGroup, Slider } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { PreviewFrame } from "@/components/image/ImagePreview";
import { useSourceCanvas } from "@/components/image/useSourceCanvas";
import { useProcessedPreview } from "@/components/image/useProcessedPreview";
import { processImage } from "@/core/image/pipeline";
import { blur, pixelate } from "@/core/image/operations";
import type { PixelRect } from "@/core/image/types";
import type { SelectedFile } from "@/core/files";
import type { RasterCanvas } from "@/core/pdf/raster/types";
import type { ToolComponentProps } from "@/tools/implementations";

type Mode = "blur" | "pixelate";
interface NormRect { x: number; y: number; w: number; h: number }

export function ImageBlurTool({ tool }: ToolComponentProps) {
  const [mode, setMode] = useState<Mode>("blur");
  const [strength, setStrength] = useState(12);
  const [region, setRegion] = useState<NormRect | null>(null);

  const apply = (canvas: RasterCanvas) => {
    const rect: PixelRect | undefined = region
      ? { x: region.x * canvas.width, y: region.y * canvas.height, width: region.w * canvas.width, height: region.h * canvas.height }
      : undefined;
    return mode === "blur" ? blur(canvas, strength, rect) : pixelate(canvas, strength, rect);
  };

  return (
    <ImageToolShell
      tool={tool}
      selection="single"
      actionLabel="Appliquer"
      hint="Dessinez un rectangle pour ne traiter qu'une zone (ex. masquer une information)."
      run={async ({ files, context }) => {
        const output = await processImage(files[0], apply, { format: "same", suffix: mode === "blur" ? "floutee" : "pixelisee" }, context);
        return { files: [output], summary: region ? "Zone traitée." : "Image entière traitée." };
      }}
    >
      {(files) => (
        <div className="space-y-3">
          <Fieldset columns={1}>
            <Field label="Effet">
              <OptionGroup
                ariaLabel="Effet"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "blur", label: "Flou" },
                  { value: "pixelate", label: "Pixellisation" },
                ]}
              />
            </Field>
            <Field label={mode === "blur" ? `Intensité du flou (${strength})` : `Taille des blocs (${strength} px)`}>
              <Slider value={strength} onChange={setStrength} min={mode === "blur" ? 1 : 4} max={mode === "blur" ? 40 : 60} />
            </Field>
            <Field label="Zone">
              <Button size="sm" variant={region ? "primary" : "secondary"} onClick={() => setRegion(region ? null : { x: 0.3, y: 0.3, w: 0.4, h: 0.4 })}>
                {region ? "Zone active — cliquer pour tout traiter" : "Traiter une zone rectangulaire"}
              </Button>
            </Field>
          </Fieldset>
          <BlurStage file={files[0]} apply={apply} region={region} setRegion={setRegion} depsKey={`${mode}-${strength}-${region ? "r" : "n"}-${region?.x}-${region?.y}-${region?.w}-${region?.h}`} />
        </div>
      )}
    </ImageToolShell>
  );
}

function BlurStage({
  file,
  apply,
  region,
  setRegion,
  depsKey,
}: {
  file: SelectedFile;
  apply: (c: RasterCanvas) => RasterCanvas;
  region: NormRect | null;
  setRegion: (r: NormRect) => void;
  depsKey: string;
}) {
  const source = useSourceCanvas(file);
  const url = useProcessedPreview(source.preview, apply, [depsKey]);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      const el = boxRef.current;
      if (!drag || !el) return;
      const box = el.getBoundingClientRect();
      const fx = clamp01((event.clientX - box.left) / box.width);
      const fy = clamp01((event.clientY - box.top) / box.height);
      setRegion({
        x: Math.min(drag.startX, fx),
        y: Math.min(drag.startY, fy),
        w: Math.abs(fx - drag.startX),
        h: Math.abs(fy - drag.startY),
      });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [setRegion]);

  const start = (event: React.PointerEvent) => {
    if (!region) return;
    const el = boxRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    dragRef.current = {
      startX: clamp01((event.clientX - box.left) / box.width),
      startY: clamp01((event.clientY - box.top) / box.height),
    };
  };

  return (
    <PreviewFrame maxHeight={420}>
      <div ref={boxRef} className="relative inline-block select-none" onPointerDown={start}>
        {url && <img src={url} alt="Aperçu" className="block max-h-[400px] max-w-full object-contain" draggable={false} />}
        {region && (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-[var(--ft-accent)] bg-[var(--ft-accent)]/10"
            style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }}
          />
        )}
      </div>
    </PreviewFrame>
  );
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
