import { useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { readSelectedFile, decodeOriented } from "@/core/image/codec";
import { resize } from "@/core/image/operations";
import { squareResize, ICON_SIZES } from "@/core/image/favicon";
import { baseName } from "@/core/pdf/filenames";
import type { OutputFile } from "@/core/pdf/types";
import type { ToolComponentProps } from "@/tools/implementations";

export function ImageIconSizesTool({ tool }: ToolComponentProps) {
  const [selected, setSelected] = useState<number[]>([32, 64, 128, 256, 512]);
  const [mode, setMode] = useState<"square" | "fit">("square");

  const toggle = (size: number) => setSelected((s) => (s.includes(size) ? s.filter((x) => x !== size) : [...s, size]));

  return (
    <ImageToolShell
      tool={tool}
      selection="single"
      actionLabel="Générer les tailles"
      actionDisabled={selected.length === 0}
      run={async ({ files, context }) => {
        const bytes = await readSelectedFile(files[0]);
        const { canvas } = await decodeOriented(bytes, files[0].extension);
        const stem = baseName(files[0].name) || "icone";
        const sizes = [...selected].sort((a, b) => a - b);
        const outputs: OutputFile[] = [];
        for (const [index, size] of sizes.entries()) {
          context.report?.({ ratio: index / sizes.length, label: `${size}px` });
          const scaled =
            mode === "square"
              ? squareResize(canvas, size)
              : resize(canvas, size, Math.round((size * canvas.height) / canvas.width));
          outputs.push({ name: `${stem}-${size}.png`, bytes: await scaled.encode("png"), mimeType: "image/png" });
        }
        return { files: outputs, summary: `${outputs.length} tailles générées.`, zipName: `${stem}-tailles.zip` };
      }}
    >
      {() => (
        <Fieldset columns={1}>
          <Field label="Tailles (px)">
            <div className="flex flex-wrap gap-1.5">
              {ICON_SIZES.map((size) => (
                <Button key={size} size="sm" variant={selected.includes(size) ? "primary" : "secondary"} onClick={() => toggle(size)}>
                  {size}
                </Button>
              ))}
            </div>
          </Field>
          <Field label="Cadrage">
            <OptionGroup ariaLabel="Cadrage" value={mode} onChange={setMode} options={[{ value: "square", label: "Carré (recadré)" }, { value: "fit", label: "Proportionnel (largeur)" }]} />
          </Field>
        </Fieldset>
      )}
    </ImageToolShell>
  );
}
