import { useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { Field, Fieldset, OptionGroup, Slider, TextInput } from "@/components/pdf/Field";
import { ColorField } from "@/components/image/ColorField";
import { FileDropZone } from "@/components/files/FileDropZone";
import { processImages } from "@/core/image/pipeline";
import { readSelectedFile, decodeImage } from "@/core/image/codec";
import { rgbToHex, type Rgb } from "@/core/image/types";
import type { RasterCanvas } from "@/core/pdf/raster/types";
import type { SelectedFile } from "@/core/files";
import type { ToolComponentProps } from "@/tools/implementations";

type Position = "center" | "bottom-right" | "bottom-left" | "top-right" | "top-left";

const POSITIONS: { value: Position; label: string }[] = [
  { value: "bottom-right", label: "Bas droite" },
  { value: "bottom-left", label: "Bas gauche" },
  { value: "center", label: "Centre" },
  { value: "top-right", label: "Haut droite" },
  { value: "top-left", label: "Haut gauche" },
];

function anchor(position: Position, w: number, h: number, margin: number): { x: number; y: number; align: CanvasTextAlign; baseline: CanvasTextBaseline } {
  const right = w - margin, bottom = h - margin;
  switch (position) {
    case "center": return { x: w / 2, y: h / 2, align: "center", baseline: "middle" };
    case "bottom-right": return { x: right, y: bottom, align: "right", baseline: "bottom" };
    case "bottom-left": return { x: margin, y: bottom, align: "left", baseline: "bottom" };
    case "top-right": return { x: right, y: margin, align: "right", baseline: "top" };
    case "top-left": return { x: margin, y: margin, align: "left", baseline: "top" };
  }
}

export function ImageWatermarkTool({ tool }: ToolComponentProps) {
  const [text, setText] = useState("© FourTout");
  const [size, setSize] = useState(5); // % de la hauteur
  const [color, setColor] = useState<Rgb>({ r: 255, g: 255, b: 255 });
  const [opacity, setOpacity] = useState(60);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState<Position>("bottom-right");
  const [logoFiles, setLogoFiles] = useState<SelectedFile[]>([]);

  return (
    <ImageToolShell
      tool={tool}
      actionLabel="Appliquer le filigrane"
      hint="Filigrane texte et/ou logo (PNG transparent), à l'unité ou par lot."
      actionDisabled={text.trim().length === 0 && logoFiles.length === 0}
      run={async ({ files, context }) => {
        let logo: RasterCanvas | undefined;
        if (logoFiles[0]) logo = await decodeImage(await readSelectedFile(logoFiles[0]), logoFiles[0].extension);

        const transform = (canvas: RasterCanvas): RasterCanvas => {
          const ctx = canvas.context as CanvasRenderingContext2D;
          const margin = Math.round(Math.min(canvas.width, canvas.height) * 0.03);
          const a = anchor(position, canvas.width, canvas.height, margin);
          ctx.save();
          ctx.globalAlpha = opacity / 100;
          if (logo) {
            const lw = canvas.width * (size / 100) * 4;
            const lh = (lw * logo.height) / logo.width;
            let lx = a.x, ly = a.y;
            if (a.align === "right") lx -= lw; else if (a.align === "center") lx -= lw / 2;
            if (a.baseline === "bottom") ly -= lh; else if (a.baseline === "middle") ly -= lh / 2;
            ctx.drawImage(logo.handle as CanvasImageSource, lx, ly, lw, lh);
          }
          if (text.trim()) {
            const fontPx = Math.max(8, (size / 100) * canvas.height);
            ctx.translate(a.x, a.y);
            if (rotation) ctx.rotate((rotation * Math.PI) / 180);
            ctx.font = `bold ${fontPx}px sans-serif`;
            ctx.textAlign = a.align;
            ctx.textBaseline = a.baseline;
            ctx.fillStyle = rgbToHex(color);
            ctx.fillText(text, 0, 0);
          }
          ctx.restore();
          return canvas;
        };

        const outputs = await processImages(files, transform, { format: "same", suffix: "filigrane" }, context);
        return { files: outputs, summary: `Filigrane appliqué à ${outputs.length} image${outputs.length > 1 ? "s" : ""}.`, zipName: "images-filigranees.zip" };
      }}
    >
      {() => (
        <div className="space-y-3">
          <Fieldset>
            <Field label="Texte" full><TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder="Texte du filigrane (facultatif)" /></Field>
            <Field label={`Taille (${size} %)`}><Slider value={size} onChange={setSize} min={2} max={20} /></Field>
            <Field label={`Opacité (${opacity} %)`}><Slider value={opacity} onChange={setOpacity} min={10} max={100} /></Field>
            <Field label="Couleur du texte"><ColorField value={color} onChange={setColor} /></Field>
            <Field label={`Rotation (${rotation}°)`}><Slider value={rotation} onChange={setRotation} min={-90} max={90} /></Field>
            <Field label="Position"><OptionGroup ariaLabel="Position" value={position} onChange={setPosition} options={POSITIONS} /></Field>
          </Fieldset>
          <div>
            <p className="mb-1 text-xs font-medium text-[var(--ft-text-muted)]">Logo (facultatif, PNG transparent)</p>
            <FileDropZone constraints={{ inputs: [{ kind: "image", extensions: ["png", "webp", "jpg", "jpeg"] }], maxFiles: 1 }} files={logoFiles} onChange={setLogoFiles} label="Déposez un logo" />
          </div>
        </div>
      )}
    </ImageToolShell>
  );
}
