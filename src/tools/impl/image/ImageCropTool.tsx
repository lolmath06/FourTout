import { useCallback, useEffect, useRef, useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { Field, Fieldset } from "@/components/pdf/Field";
import { OptionGroup } from "@/components/pdf/Field";
import { PreviewFrame } from "@/components/image/ImagePreview";
import { useImagePreview } from "@/components/image/useImagePreview";
import { processImage } from "@/core/image/pipeline";
import { crop } from "@/core/image/operations";
import type { SelectedFile } from "@/core/files";
import type { PixelRect } from "@/core/image/types";
import type { ToolComponentProps } from "@/tools/implementations";

/** Sélection normalisée : fractions de 0 à 1 de l'image affichée. */
interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DEFAULT: NormRect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };

const RATIOS = [
  { value: "free", label: "Libre", ratio: 0 },
  { value: "1:1", label: "1:1", ratio: 1 },
  { value: "4:3", label: "4:3", ratio: 4 / 3 },
  { value: "16:9", label: "16:9", ratio: 16 / 9 },
  { value: "3:2", label: "3:2", ratio: 3 / 2 },
];

export function ImageCropTool({ tool }: ToolComponentProps) {
  const [rect, setRect] = useState<NormRect>(DEFAULT);
  const [ratioKey, setRatioKey] = useState("free");

  return (
    <ImageToolShell
      tool={tool}
      selection="single"
      actionLabel="Recadrer"
      run={async ({ files, context }) => {
        const output = await processImage(
          files[0],
          (canvas) => {
            const pixel: PixelRect = {
              x: rect.x * canvas.width,
              y: rect.y * canvas.height,
              width: rect.w * canvas.width,
              height: rect.h * canvas.height,
            };
            return crop(canvas, pixel);
          },
          { format: "same", suffix: "recadree" },
          context,
        );
        return { files: [output], summary: "Image recadrée." };
      }}
    >
      {(files) => (
        <div className="space-y-3">
          <Fieldset columns={1}>
            <Field label="Proportions">
              <OptionGroup
                ariaLabel="Proportions"
                value={ratioKey}
                onChange={(key) => {
                  setRatioKey(key);
                  const ratio = RATIOS.find((r) => r.value === key)?.ratio ?? 0;
                  if (ratio > 0) setRect((r) => fitRatio(r, ratio));
                }}
                options={RATIOS.map((r) => ({ value: r.value, label: r.label }))}
              />
            </Field>
          </Fieldset>
          <CropStage
            file={files[0]}
            rect={rect}
            onChange={setRect}
            ratio={RATIOS.find((r) => r.value === ratioKey)?.ratio ?? 0}
          />
          <p className="text-xs text-[var(--ft-text-muted)]">
            Faites glisser la zone ou ses poignées. Le résultat correspond exactement à la sélection.
          </p>
        </div>
      )}
    </ImageToolShell>
  );
}

type DragMode =
  | { kind: "move"; startX: number; startY: number; orig: NormRect }
  | { kind: "resize"; handle: string; orig: NormRect };

function CropStage({
  file,
  rect,
  onChange,
  ratio,
}: {
  file: SelectedFile;
  rect: NormRect;
  onChange: (rect: NormRect) => void;
  ratio: number;
}) {
  const preview = useImagePreview(file);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<DragMode | null>(null);

  const pointerFraction = useCallback((event: PointerEvent | React.PointerEvent) => {
    const el = imgRef.current;
    if (!el) return { fx: 0, fy: 0 };
    const box = el.getBoundingClientRect();
    return {
      fx: clamp01((event.clientX - box.left) / box.width),
      fy: clamp01((event.clientY - box.top) / box.height),
    };
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const { fx, fy } = pointerFraction(event);
      if (drag.kind === "move") {
        const w = drag.orig.w;
        const h = drag.orig.h;
        onChange({
          x: clamp(fx - drag.startX, 0, 1 - w),
          y: clamp(fy - drag.startY, 0, 1 - h),
          w,
          h,
        });
      } else {
        onChange(resizeRect(drag.orig, drag.handle, fx, fy, ratio));
      }
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [onChange, pointerFraction, ratio]);

  const startMove = (event: React.PointerEvent) => {
    event.preventDefault();
    const { fx, fy } = pointerFraction(event);
    dragRef.current = { kind: "move", startX: fx - rect.x, startY: fy - rect.y, orig: rect };
  };

  const startResize = (handle: string) => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { kind: "resize", handle, orig: rect };
  };

  const style = {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };

  const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

  return (
    <PreviewFrame maxHeight={460}>
      <div className="relative inline-block select-none">
        {preview.url && (
          <img
            ref={imgRef}
            src={preview.url}
            alt={file.name}
            className="block max-h-[440px] max-w-full object-contain"
            draggable={false}
          />
        )}
        {/* Voile sombre autour de la sélection. */}
        <div className="pointer-events-none absolute inset-0 bg-black/45" style={{
          clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.x*100}% ${rect.y*100}%, ${rect.x*100}% ${(rect.y+rect.h)*100}%, ${(rect.x+rect.w)*100}% ${(rect.y+rect.h)*100}%, ${(rect.x+rect.w)*100}% ${rect.y*100}%, ${rect.x*100}% ${rect.y*100}%)`,
        }} />
        <div
          className="absolute cursor-move border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
          style={style}
          onPointerDown={startMove}
        >
          {handles.map((handle) => (
            <span
              key={handle}
              onPointerDown={startResize(handle)}
              className="absolute size-3 rounded-full border border-[var(--ft-accent)] bg-white"
              style={handleStyle(handle)}
            />
          ))}
        </div>
      </div>
    </PreviewFrame>
  );
}

function handleStyle(handle: string): React.CSSProperties {
  const pos: React.CSSProperties = { cursor: `${handle}-resize` };
  const map: Record<string, [string, string]> = {
    nw: ["0%", "0%"], n: ["50%", "0%"], ne: ["100%", "0%"], e: ["100%", "50%"],
    se: ["100%", "100%"], s: ["50%", "100%"], sw: ["0%", "100%"], w: ["0%", "50%"],
  };
  const [x, y] = map[handle];
  return { ...pos, left: x, top: y, transform: "translate(-50%, -50%)" };
}

function resizeRect(orig: NormRect, handle: string, fx: number, fy: number, ratio: number): NormRect {
  let { x, y, w, h } = orig;
  const right = x + w;
  const bottom = y + h;
  if (handle.includes("w")) { x = clamp(fx, 0, right - 0.02); w = right - x; }
  if (handle.includes("e")) { w = clamp(fx, x + 0.02, 1) - x; }
  if (handle.includes("n")) { y = clamp(fy, 0, bottom - 0.02); h = bottom - y; }
  if (handle.includes("s")) { h = clamp(fy, y + 0.02, 1) - y; }
  let next = { x, y, w, h };
  if (ratio > 0) next = fitRatio(next, ratio, handle);
  return next;
}

/** Ajuste un rectangle à un ratio donné, en le gardant dans l'image. */
function fitRatio(rect: NormRect, ratio: number, handle = "se"): NormRect {
  // On raisonne en pixels carrés approximés : le ratio est largeur/hauteur en
  // fractions ; comme l'aperçu conserve l'aspect, on ajuste h à partir de w.
  const { x, y } = rect;
  let { w, h } = rect;
  h = w / ratio;
  if (y + h > 1) { h = 1 - y; w = h * ratio; }
  if (x + w > 1) { w = 1 - x; h = w / ratio; }
  void handle;
  return { x, y, w: clamp01(w), h: clamp01(h) };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
