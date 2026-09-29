import { useState } from "react";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useJob } from "@/core/jobs";
import { recognizeImages, OCR_LANGUAGE_LABELS, type OcrItem, type OcrLanguage } from "@/core/ocr";
import { toImageError } from "@/core/image/errors";
import { saveFile } from "@/core/output/save";
import { outputName } from "@/core/pdf/filenames";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

const LANGS: { value: OcrLanguage; label: string }[] = [
  { value: "fra", label: OCR_LANGUAGE_LABELS.fra },
  { value: "eng", label: OCR_LANGUAGE_LABELS.eng },
  { value: "fra+eng", label: OCR_LANGUAGE_LABELS["fra+eng"] },
];

export function ImageOcrTool({ tool }: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [language, setLanguage] = useState<OcrLanguage>("fra");
  const [items, setItems] = useState<OcrItem[]>([]);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const job = useJob<OcrItem[]>();

  const run = async () => {
    setItems([]);
    setEdited({});
    const result = await job.run((context) =>
      recognizeImages(files, { language }, { report: context.report, signal: context.signal }),
    );
    if (result) {
      setItems(result);
      const map: Record<string, string> = {};
      result.forEach((item, index) => (map[key(item, index)] = item.text));
      setEdited(map);
      notify.success("Texte extrait", `${result.length} image${result.length > 1 ? "s" : ""} analysée${result.length > 1 ? "s" : ""}.`);
    }
  };

  const errorMessage = job.error ? toImageError(job.error.cause).message : undefined;

  return (
    <div className="space-y-4">
      <FileDropZone
        constraints={constraintsForTool(tool)}
        files={files}
        onChange={setFiles}
        label="Déposez une ou plusieurs images"
        hint="Reconnaissance 100 % locale. Formats : PNG, JPG, WebP, BMP, TIFF."
        disabled={job.isRunning}
      />

      {files.length > 0 && (
        <Fieldset columns={1}>
          <Field label="Langue" hint="Modèles français et anglais embarqués dans l'application.">
            <OptionGroup ariaLabel="Langue" value={language} onChange={setLanguage} options={LANGS} disabled={job.isRunning} />
          </Field>
        </Fieldset>
      )}

      {files.length > 0 && (
        <div className="flex items-center justify-end gap-2">
          {job.isRunning && (
            <Button size="sm" variant="ghost" onClick={job.cancel}>Annuler</Button>
          )}
          <Button size="md" variant="primary" onClick={run} disabled={job.isRunning}>
            {job.isRunning ? (
              <><Icon name="Loader" size={15} className="animate-spin" />{job.progress.label ?? "Analyse…"}</>
            ) : (
              <><Icon name="ScanText" size={15} />Extraire le texte</>
            )}
          </Button>
        </div>
      )}

      {job.isRunning && (
        <div className="h-1 overflow-hidden rounded-full bg-[var(--ft-surface-2)]">
          <div className="h-full rounded-full bg-[var(--ft-accent)] transition-[width]" style={{ width: `${Math.round((job.progress.ratio ?? 0) * 100)}%` }} />
        </div>
      )}

      {errorMessage && job.status === "error" && (
        <p className="flex items-center gap-2 rounded-md border border-[var(--ft-danger)] px-3 py-2 text-sm text-[var(--ft-danger)]">
          <Icon name="CircleAlert" size={16} /> {errorMessage}
        </p>
      )}

      {items.map((item, index) => (
        <OcrResultCard
          key={key(item, index)}
          item={item}
          index={index}
          multi={items.length > 1}
          value={edited[key(item, index)] ?? item.text}
          onChange={(text) => setEdited((map) => ({ ...map, [key(item, index)]: text }))}
        />
      ))}
    </div>
  );
}

function key(item: OcrItem, index: number): string {
  return `${index}-${item.name}`;
}

function OcrResultCard({
  item,
  index,
  multi,
  value,
  onChange,
}: {
  item: OcrItem;
  index: number;
  multi: boolean;
  value: string;
  onChange: (text: string) => void;
}) {
  const chars = value.replace(/\s/g, "").length;
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      notify.success("Texte copié");
    } catch {
      notify.error("Copie impossible");
    }
  };

  const save = async () => {
    const bytes = new TextEncoder().encode(value);
    const result = await saveFile({ name: outputName(item.name, "ocr", "txt"), bytes, mimeType: "text/plain" });
    if (result.saved) notify.success("Fichier enregistré", result.path);
  };

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3">
      {multi && (
        <p className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Icon name="Image" size={14} className="text-[var(--ft-text-faint)]" />
          Image {index + 1} · <span className="truncate text-[var(--ft-text-muted)]">{item.name}</span>
        </p>
      )}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={Math.min(16, Math.max(4, value.split("\n").length + 1))}
        className="w-full resize-y rounded-md border border-[var(--ft-border)] bg-[var(--ft-bg)] p-2.5 font-mono text-sm outline-none focus:border-[var(--ft-accent)]"
        placeholder="Aucun texte détecté."
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={copy}><Icon name="Copy" size={14} />Copier</Button>
        <Button size="sm" onClick={save}><Icon name="HardDrive" size={14} />Enregistrer .txt</Button>
        <span className="ml-auto text-xs tabular-nums text-[var(--ft-text-muted)]">
          {words} mot{words > 1 ? "s" : ""} · {chars} caractère{chars > 1 ? "s" : ""} · confiance {item.confidence} %
        </span>
      </div>
    </div>
  );
}
