import { useEffect, useRef, useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { Field, Fieldset, Slider, TextInput } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { ColorField } from "@/components/image/ColorField";
import { PreviewFrame } from "@/components/image/ImagePreview";
import { useImagePreview } from "@/components/image/useImagePreview";
import { processImage } from "@/core/image/pipeline";
import { drawText, type TextItem } from "@/core/image/operations";
import { rgbToHex, type Rgb } from "@/core/image/types";
import type { SelectedFile } from "@/core/files";
import type { ToolComponentProps } from "@/tools/implementations";

export function ImageAddTextTool({ tool }: ToolComponentProps) {
  const [text, setText] = useState("Votre texte");
  const [size, setSize] = useState(8); // % de la hauteur
  const [color, setColor] = useState<Rgb>({ r: 255, g: 255, b: 255 });
  const [bold, setBold] = useState(true);
  const [pos, setPos] = useState({ x: 0.1, y: 0.1 });

  const item: TextItem = { text, xFrac: pos.x, yFrac: pos.y, sizeFrac: size / 100, color, bold };

  return (
    <ImageToolShell
      tool={tool}
      selection="single"
      actionLabel="Ajouter le texte"
      actionDisabled={text.trim().length === 0}
      run={async ({ files, context }) => {
        const output = await processImage(files[0], (canvas) => drawText(canvas, [item]), { format: "same", suffix: "texte" }, context);
        return { files: [output], summary: "Texte ajouté." };
      }}
    >
      {(files) => (
        <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
          <TextStage file={files[0]} item={item} pos={pos} setPos={setPos} />
          <Fieldset columns={1}>
            <Field label="Texte">
              <TextInput value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <Field label={`Taille (${size} %)`}>
              <Slider value={size} onChange={setSize} min={2} max={25} />
            </Field>
            <Field label="Couleur">
              <ColorField value={color} onChange={setColor} />
            </Field>
            <Field label="Graisse">
              <Button size="sm" variant={bold ? "primary" : "secondary"} onClick={() => setBold((v) => !v)}>
                {bold ? "Gras" : "Normal"}
              </Button>
            </Field>
          </Fieldset>
        </div>
      )}
    </ImageToolShell>
  );
}

function TextStage({
  file,
  item,
  pos,
  setPos,
}: {
  file: SelectedFile;
  item: TextItem;
  pos: { x: number; y: number };
  setPos: (p: { x: number; y: number }) => void;
}) {
  const preview = useImagePreview(file);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      const el = boxRef.current;
      if (!drag || !el) return;
      const box = el.getBoundingClientRect();
      setPos({
        x: clamp01((event.clientX - box.left) / box.width - drag.dx),
        y: clamp01((event.clientY - box.top) / box.height - drag.dy),
      });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [setPos]);

  const start = (event: React.PointerEvent) => {
    const el = boxRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    dragRef.current = {
      dx: (event.clientX - box.left) / box.width - pos.x,
      dy: (event.clientY - box.top) / box.height - pos.y,
    };
    event.preventDefault();
  };

  return (
    <PreviewFrame maxHeight={440}>
      <div ref={boxRef} className="relative inline-block select-none" style={{ containerType: "size" }}>
        {preview.url && <img src={preview.url} alt={file.name} className="block max-h-[420px] max-w-full object-contain" draggable={false} />}
        <div
          onPointerDown={start}
          className="absolute cursor-move whitespace-pre leading-tight"
          style={{
            left: `${pos.x * 100}%`,
            top: `${pos.y * 100}%`,
            fontSize: `${item.sizeFrac * 100}cqh`,
            color: rgbToHex(item.color),
            fontWeight: item.bold ? 700 : 400,
            fontFamily: "sans-serif",
          }}
        >
          {item.text}
        </div>
      </div>
    </PreviewFrame>
  );
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
