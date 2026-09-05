import { useCallback, useEffect, useRef } from "react";
import { fitAspect, type NormalizedRect, type Size } from "@/core/media/video/dimensions";

/**
 * Sélection rectangulaire superposée à une image ou une vidéo.
 *
 * Le rectangle est exprimé en **fractions** de la zone affichée : il survit donc
 * au redimensionnement de la fenêtre, et se convertit exactement en pixels au
 * moment du traitement (`cropRectFor`). Ce que l'utilisateur voit est ce qu'il
 * obtient.
 *
 * Le rapport largeur/hauteur est contraint en **pixels de la source**, pas en
 * fractions : demander 1:1 sur une vidéo 16:9 donne bien un carré.
 */

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

type DragState =
  | { kind: "move"; offsetX: number; offsetY: number; origin: NormalizedRect }
  | { kind: "resize"; handle: string; origin: NormalizedRect };

export function CropOverlay({
  rect,
  onChange,
  source,
  ratio,
  disabled = false,
}: {
  rect: NormalizedRect;
  onChange: (rect: NormalizedRect) => void;
  /** Dimensions réelles de la source, pour contraindre le rapport en pixels. */
  source: Size;
  /** Rapport largeur/hauteur imposé, ou 0 pour « libre ». */
  ratio: number;
  disabled?: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const rectRef = useRef(rect);
  rectRef.current = rect;

  const fraction = useCallback((event: PointerEvent | React.PointerEvent) => {
    const element = frameRef.current;
    if (!element) return { fx: 0, fy: 0 };
    const box = element.getBoundingClientRect();
    return {
      fx: clamp01((event.clientX - box.left) / box.width),
      fy: clamp01((event.clientY - box.top) / box.height),
    };
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      const { fx, fy } = fraction(event);
      if (drag.kind === "move") {
        const { w, h } = drag.origin;
        onChange({
          x: clamp(fx - drag.offsetX, 0, 1 - w),
          y: clamp(fy - drag.offsetY, 0, 1 - h),
          w,
          h,
        });
      } else {
        onChange(resize(drag.origin, drag.handle, fx, fy, source, ratio));
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
  }, [fraction, onChange, ratio, source]);

  const startMove = (event: React.PointerEvent) => {
    if (disabled) return;
    event.preventDefault();
    const { fx, fy } = fraction(event);
    dragRef.current = {
      kind: "move",
      offsetX: fx - rectRef.current.x,
      offsetY: fy - rectRef.current.y,
      origin: rectRef.current,
    };
  };

  const startResize = (handle: string) => (event: React.PointerEvent) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { kind: "resize", handle, origin: rectRef.current };
  };

  const percent = (value: number) => `${value * 100}%`;
  const mask =
    `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ` +
    `${percent(rect.x)} ${percent(rect.y)}, ${percent(rect.x)} ${percent(rect.y + rect.h)}, ` +
    `${percent(rect.x + rect.w)} ${percent(rect.y + rect.h)}, ${percent(rect.x + rect.w)} ${percent(rect.y)}, ` +
    `${percent(rect.x)} ${percent(rect.y)})`;

  return (
    <div ref={frameRef} className="absolute inset-0 select-none">
      <div className="pointer-events-none absolute inset-0 bg-black/50" style={{ clipPath: mask }} />
      <div
        role="group"
        aria-label="Zone de rognage"
        className={`absolute border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)] ${disabled ? "" : "cursor-move"}`}
        style={{
          left: percent(rect.x),
          top: percent(rect.y),
          width: percent(rect.w),
          height: percent(rect.h),
        }}
        onPointerDown={startMove}
      >
        {!disabled &&
          HANDLES.map((handle) => (
            <span
              key={handle}
              onPointerDown={startResize(handle)}
              className="absolute size-3 rounded-full border border-[var(--ft-accent)] bg-white"
              style={handleStyle(handle)}
            />
          ))}
      </div>
    </div>
  );
}

function handleStyle(handle: string): React.CSSProperties {
  const positions: Record<string, [string, string]> = {
    nw: ["0%", "0%"], n: ["50%", "0%"], ne: ["100%", "0%"], e: ["100%", "50%"],
    se: ["100%", "100%"], s: ["50%", "100%"], sw: ["0%", "100%"], w: ["0%", "50%"],
  };
  const [left, top] = positions[handle];
  return { left, top, transform: "translate(-50%, -50%)", cursor: `${handle}-resize` };
}

function resize(
  origin: NormalizedRect,
  handle: string,
  fx: number,
  fy: number,
  source: Size,
  ratio: number,
): NormalizedRect {
  let { x, y, w, h } = origin;
  const right = x + w;
  const bottom = y + h;
  if (handle.includes("w")) {
    x = clamp(fx, 0, right - 0.02);
    w = right - x;
  }
  if (handle.includes("e")) w = clamp(fx, x + 0.02, 1) - x;
  if (handle.includes("n")) {
    y = clamp(fy, 0, bottom - 0.02);
    h = bottom - y;
  }
  if (handle.includes("s")) h = clamp(fy, y + 0.02, 1) - y;

  const next = { x, y, w, h };
  return ratio > 0 ? fitAspect(next, source, ratio) : next;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
