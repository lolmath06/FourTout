import { useEffect, useState } from "react";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Icon } from "@/components/ui/Icon";
import { useSourceCanvas } from "@/components/image/useSourceCanvas";
import { extractPalette, type PaletteColor } from "@/core/image/palette";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

export function ImagePaletteTool({ tool }: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [count, setCount] = useState(8);
  const [colors, setColors] = useState<PaletteColor[]>([]);
  const source = useSourceCanvas(files[0]);

  useEffect(() => {
    if (source.preview) setColors(extractPalette(source.preview.getPixels(), count));
    else setColors([]);
  }, [source.preview, count]);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => notify.success("Copié", text)).catch(() => {});
  };

  return (
    <div className="space-y-4">
      <FileDropZone constraints={{ ...constraintsForTool(tool), maxFiles: 1 }} files={files} onChange={setFiles} label="Déposez une image" />
      {files[0] && (
        <>
          <Fieldset columns={1}>
            <Field label="Nombre de couleurs">
              <OptionGroup ariaLabel="Nombre" value={String(count)} onChange={(v) => setCount(Number(v))} options={[{ value: "5", label: "5" }, { value: "8", label: "8" }, { value: "12", label: "12" }]} />
            </Field>
          </Fieldset>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {colors.map((color, i) => (
              <button key={i} onClick={() => copy(color.hex)} className="flex flex-col overflow-hidden rounded-md border border-[var(--ft-border)] text-left">
                <span className="h-16" style={{ background: color.hex }} />
                <span className="flex items-center justify-between gap-1 px-2 py-1.5 text-xs">
                  <span className="font-mono">{color.hex}</span>
                  <Icon name="Copy" size={12} className="text-[var(--ft-text-faint)]" />
                </span>
                <span className="px-2 pb-1.5 font-mono text-[10px] text-[var(--ft-text-muted)]">
                  rgb({color.rgb.r}, {color.rgb.g}, {color.rgb.b}) · {Math.round(color.weight * 100)}%
                </span>
              </button>
            ))}
          </div>
          <button onClick={() => copy(colors.map((c) => c.hex).join(", "))} className="text-xs text-[var(--ft-accent-text)] underline">
            Copier toute la palette
          </button>
        </>
      )}
    </div>
  );
}
