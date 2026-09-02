import { useMemo, useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { Field, Fieldset, Slider } from "@/components/pdf/Field";
import { ColorField } from "@/components/image/ColorField";
import { PreviewFrame } from "@/components/image/ImagePreview";
import { useSourceCanvas } from "@/components/image/useSourceCanvas";
import { useProcessedPreview } from "@/components/image/useProcessedPreview";
import { processImage } from "@/core/image/pipeline";
import { colorToTransparent } from "@/core/image/operations";
import { rgbToHex, type Rgb } from "@/core/image/types";
import type { SelectedFile } from "@/core/files";
import type { ToolComponentProps } from "@/tools/implementations";

export function ImageColorTransparentTool({ tool }: ToolComponentProps) {
  const [color, setColor] = useState<Rgb>({ r: 255, g: 255, b: 255 });
  const [tolerance, setTolerance] = useState(15);

  return (
    <ImageToolShell
      tool={tool}
      selection="single"
      actionLabel="Rendre transparent"
      hint="La sortie est en PNG pour préserver la transparence."
      run={async ({ files, context }) => {
        const output = await processImage(
          files[0],
          (canvas) => colorToTransparent(canvas, color, tolerance),
          { format: "png", suffix: "transparent" },
          context,
        );
        return { files: [output], summary: `Couleur ${rgbToHex(color)} rendue transparente (tolérance ${tolerance} %).` };
      }}
    >
      {(files) => (
        <ColorTransparentStage
          key={files[0].id}
          fileId={files[0].id}
          color={color}
          setColor={setColor}
          tolerance={tolerance}
          setTolerance={setTolerance}
          file={files[0]}
        />
      )}
    </ImageToolShell>
  );
}

function ColorTransparentStage({
  file,
  color,
  setColor,
  tolerance,
  setTolerance,
}: {
  file: SelectedFile;
  fileId: string;
  color: Rgb;
  setColor: (c: Rgb) => void;
  tolerance: number;
  setTolerance: (n: number) => void;
}) {
  const source = useSourceCanvas(file);
  const pixels = useMemo(() => source.preview?.getPixels(), [source.preview]);
  const url = useProcessedPreview(
    source.preview,
    (c) => colorToTransparent(c, color, tolerance),
    [color.r, color.g, color.b, tolerance],
  );

  const pick = (event: React.MouseEvent<HTMLImageElement>) => {
    if (!pixels) return;
    const box = event.currentTarget.getBoundingClientRect();
    const fx = (event.clientX - box.left) / box.width;
    const fy = (event.clientY - box.top) / box.height;
    const x = Math.min(pixels.width - 1, Math.max(0, Math.round(fx * pixels.width)));
    const y = Math.min(pixels.height - 1, Math.max(0, Math.round(fy * pixels.height)));
    const i = (y * pixels.width + x) * 4;
    setColor({ r: pixels.data[i], g: pixels.data[i + 1], b: pixels.data[i + 2] });
  };

  return (
    <div className="space-y-3">
      <Fieldset columns={1}>
        <Field label="Couleur à effacer" hint="Cliquez dans l'image pour piocher une couleur.">
          <ColorField value={color} onChange={setColor} />
        </Field>
        <Field label={`Tolérance (${tolerance} %)`}>
          <Slider value={tolerance} onChange={setTolerance} min={0} max={80} />
        </Field>
      </Fieldset>
      <PreviewFrame maxHeight={420}>
        {url && (
          <img
            src={url}
            alt="Aperçu"
            onClick={pick}
            className="max-h-[400px] max-w-full cursor-crosshair object-contain"
            draggable={false}
          />
        )}
      </PreviewFrame>
    </div>
  );
}
