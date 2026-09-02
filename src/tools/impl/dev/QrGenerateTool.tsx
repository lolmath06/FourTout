import { useState } from "react";
import { Field, Fieldset, OptionGroup, Slider } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { generateQrPng, generateQrSvg, type QrErrorCorrection } from "@/core/image/qr";
import { PreviewFrame } from "@/components/image/ImagePreview";
import { saveFile } from "@/core/output/save";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

export function QrGenerateTool(_props: ToolComponentProps) {
  const [text, setText] = useState("https://example.com/fourtout-test");
  const [ecc, setEcc] = useState<QrErrorCorrection>("M");
  const [width, setWidth] = useState(512);
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const preview = async () => {
    const png = await generateQrPng(text, { width, errorCorrection: ecc });
    if (url) URL.revokeObjectURL(url);
    setUrl(URL.createObjectURL(new Blob([png.slice().buffer as ArrayBuffer], { type: "image/png" })));
  };

  const save = async (format: "png" | "svg") => {
    setBusy(true);
    try {
      const bytes = format === "png" ? await generateQrPng(text, { width, errorCorrection: ecc }) : await generateQrSvg(text, { width, errorCorrection: ecc });
      const res = await saveFile({ name: `qr-code.${format}`, bytes, mimeType: format === "png" ? "image/png" : "image/svg+xml" });
      if (res.saved) notify.success("QR code enregistré", res.path);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Fieldset columns={1}>
        <Field label="Texte ou URL">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="w-full resize-y rounded-md border border-[var(--ft-border)] bg-[var(--ft-bg)] p-2.5 text-sm outline-none focus:border-[var(--ft-accent)]" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Correction d'erreur" hint="Plus élevé = plus robuste, QR plus dense.">
            <OptionGroup ariaLabel="Correction" value={ecc} onChange={setEcc} options={[{ value: "L", label: "L" }, { value: "M", label: "M" }, { value: "Q", label: "Q" }, { value: "H", label: "H" }]} />
          </Field>
          <Field label={`Taille (${width} px)`}><Slider value={width} onChange={setWidth} min={128} max={1024} step={64} /></Field>
        </div>
      </Fieldset>

      <div className="flex flex-wrap gap-2">
        <Button size="md" variant="primary" onClick={preview} disabled={!text.trim()}><Icon name="Eye" size={15} /> Aperçu</Button>
        <Button size="md" onClick={() => save("png")} disabled={busy || !text.trim()}><Icon name="HardDrive" size={14} /> PNG</Button>
        <Button size="md" onClick={() => save("svg")} disabled={busy || !text.trim()}><Icon name="HardDrive" size={14} /> SVG</Button>
      </div>

      {url && (
        <PreviewFrame maxHeight={360}>
          <img src={url} alt="QR code" className="max-h-[340px] bg-white p-2" />
        </PreviewFrame>
      )}
    </div>
  );
}
