import { useState } from "react";
import { constraintsForTool, formatFileSize, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { Field, Fieldset, OptionGroup, Slider } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Callout, ProgressBar } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { ResultPanel, type OperationOutcome } from "@/components/pdf/ResultPanel";
import { useJob } from "@/core/jobs";
import { JobCancelledError } from "@/core/jobs/types";
import { decodeOriented, encodeCanvas, readSelectedFile } from "@/core/image/codec";
import { cleanScan, type ScanRendering } from "@/core/image/scan";
import { toImageError } from "@/core/image/errors";
import { imagesToPdf, type ImagePageMode } from "@/core/pdf/operations/imagesToPdf";
import { notify } from "@/features/notifications/store";
import { useHandoff } from "@/features/handoff/store";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Scans et photos → un seul PDF.
 *
 * Cet outil n'invente **aucun** moteur : il enchaîne le nettoyage documentaire
 * (`core/image/scan`) et l'assemblage existant (`imagesToPdf`). Sa raison
 * d'être est le trajet complet — plusieurs pages, dans le bon ordre, nettoyées
 * de la même façon — qui demanderait sinon de passer par trois outils et de
 * gérer soi-même les fichiers intermédiaires.
 */
const PAGE_MODES: { value: ImagePageMode; label: string; hint: string }[] = [
  { value: "a4-portrait", label: "A4 portrait", hint: "Chaque image est centrée sur une page A4" },
  { value: "a4-landscape", label: "A4 paysage", hint: "Pages A4 à l'italienne" },
  { value: "fit-image", label: "Taille de l'image", hint: "La page épouse exactement l'image" },
];

const RENDERINGS: { value: ScanRendering; label: string; hint: string }[] = [
  { value: "color", label: "Couleur", hint: "Conserve les couleurs d'origine" },
  { value: "grayscale", label: "Niveaux de gris", hint: "Allège le fichier, garde les nuances" },
  { value: "bw", label: "Noir et blanc", hint: "Texte très contrasté, fichier le plus léger" },
];

export function ScansToPdfTool({ tool }: ToolComponentProps) {
  const handoff = useHandoff(tool.id);
  const [files, setFiles] = useState<SelectedFile[]>(() => handoff?.files ?? []);
  const [mode, setMode] = useState<ImagePageMode>("a4-portrait");
  const [rendering, setRendering] = useState<ScanRendering>("color");
  const [contrast, setContrast] = useState(0);
  const [whiten, setWhiten] = useState(0);
  const [outcome, setOutcome] = useState<OperationOutcome | null>(null);
  const job = useJob<OperationOutcome>();

  const move = (index: number, direction: -1 | 1) => {
    setFiles((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const cleaning = contrast !== 0 || whiten !== 0 || rendering !== "color";

  const run = async () => {
    setOutcome(null);
    const result = await job.run(async (context) => {
      const pages: { name: string; bytes: Uint8Array; mimeType: string }[] = [];

      for (const [index, file] of files.entries()) {
        if (context.signal.aborted) throw new JobCancelledError();
        context.report({
          ratio: (index / files.length) * 0.8,
          label: `Page ${index + 1} sur ${files.length} — préparation`,
        });

        const bytes = await readSelectedFile(file);
        if (!cleaning) {
          // Aucun traitement demandé : on transmet les octets d'origine, sans
          // décoder ni réencoder. C'est ce qui préserve exactement la qualité.
          pages.push({ name: file.name, bytes, mimeType: file.mimeType });
          continue;
        }

        const { canvas } = await decodeOriented(bytes, file.extension);
        const cleaned = cleanScan(canvas, { contrast, whiten, rendering });
        pages.push({
          name: file.name,
          // JPEG pour la couleur et le gris (fichier compact), PNG en noir et
          // blanc où la compression sans perte est à la fois meilleure et plus
          // nette sur des aplats.
          bytes: await encodeCanvas(cleaned, rendering === "bw" ? "png" : "jpeg", { quality: 0.85 }),
          mimeType: rendering === "bw" ? "image/png" : "image/jpeg",
        });
      }

      context.report({ ratio: 0.85, label: "Assemblage du PDF" });
      const file = await imagesToPdf(pages, { mode }, { signal: context.signal });
      return {
        files: [file],
        summary: `${files.length} page${files.length > 1 ? "s" : ""} assemblée${
          files.length > 1 ? "s" : ""
        } dans un seul PDF.`,
      };
    });

    if (result) {
      setOutcome(result);
      notify.success("PDF prêt", result.summary);
    }
  };

  const errorMessage = job.error ? toImageError(job.error.cause).message : undefined;

  return (
    <div className="space-y-4">
      <FileDropZone
        constraints={constraintsForTool(tool)}
        files={files}
        onChange={setFiles}
        label="Déposez vos pages numérisées ou photographiées"
        hint="L'ordre de la liste est celui des pages du PDF."
        disabled={job.isRunning}
        showFileList={false}
      />

      {files.length > 0 && (
        <PageList files={files} onMove={move} onRemove={(index) => setFiles((c) => c.filter((_, i) => i !== index))} disabled={job.isRunning} />
      )}

      {files.length > 0 && (
        <>
          <Fieldset columns={2} title="Mise en page">
            <Field label="Format des pages">
              <OptionGroup ariaLabel="Format des pages" value={mode} onChange={setMode} options={PAGE_MODES} disabled={job.isRunning} />
            </Field>
            <Field label="Rendu">
              <OptionGroup ariaLabel="Rendu" value={rendering} onChange={setRendering} options={RENDERINGS} disabled={job.isRunning} />
            </Field>
          </Fieldset>

          <Fieldset columns={2} title="Nettoyage (facultatif)">
            <Field label="Contraste" hint="Relève un scan pâle ou une photo terne.">
              <Slider value={contrast} onChange={setContrast} min={-50} max={80} suffix="" />
            </Field>
            <Field label="Blanchir le fond" hint="Efface un fond gris ou jauni sans toucher au texte.">
              <Slider value={whiten} onChange={setWhiten} min={0} max={100} suffix=" %" />
            </Field>
          </Fieldset>

          {!cleaning && (
            <Callout tone="info">
              Aucun traitement n'est demandé : vos images seront intégrées telles quelles, sans
              réencodage ni perte de qualité.
            </Callout>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ft-border)] pt-4">
            <p className="text-xs text-[var(--ft-text-muted)]">
              {files.length} page{files.length > 1 ? "s" : ""} ·{" "}
              {formatFileSize(files.reduce((total, file) => total + file.size, 0))}
            </p>
            <div className="flex items-center gap-2">
              {job.isRunning && (
                <Button size="sm" variant="ghost" onClick={job.cancel}>
                  Annuler
                </Button>
              )}
              <Button size="md" variant="primary" onClick={run} disabled={job.isRunning}>
                {job.isRunning ? (
                  <>
                    <Icon name="Loader" size={15} className="animate-spin" />
                    {job.progress.label ?? "Traitement…"}
                  </>
                ) : (
                  <>
                    <Icon name="Play" size={15} />
                    Créer le PDF
                  </>
                )}
              </Button>
            </div>
          </div>
        </>
      )}

      {job.isRunning && <ProgressBar ratio={job.progress.ratio} label={job.progress.label} />}

      {errorMessage && job.status === "error" && (
        <Callout tone="error" title="L'opération a échoué">
          {errorMessage}
        </Callout>
      )}

      {outcome && <ResultPanel outcome={outcome} />}
    </div>
  );
}

/** Liste ordonnée des pages, avec réordonnancement. */
function PageList({
  files,
  onMove,
  onRemove,
  disabled,
}: {
  files: SelectedFile[];
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
  disabled: boolean;
}) {
  return (
    <ul className="divide-y divide-[var(--ft-rule)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)]">
      {files.map((file, index) => (
        <li key={file.id} className="ft-row-py flex items-center gap-2.5 px-3">
          <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-[var(--ft-text-faint)]">
            {index + 1}
          </span>
          <Icon name="FileImage" size={13} className="shrink-0 text-[var(--ft-text-faint)]" />
          <span className="min-w-0 flex-1 truncate text-[13px]">{file.name}</span>
          <span className="ft-value shrink-0 text-[var(--ft-text-muted)]">
            {formatFileSize(file.size)}
          </span>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Monter ${file.name}`}
            disabled={disabled || index === 0}
            onClick={() => onMove(index, -1)}
          >
            <Icon name="ChevronUp" size={14} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Descendre ${file.name}`}
            disabled={disabled || index === files.length - 1}
            onClick={() => onMove(index, 1)}
          >
            <Icon name="ChevronDown" size={14} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Retirer ${file.name}`}
            disabled={disabled}
            onClick={() => onRemove(index)}
          >
            <Icon name="X" size={14} />
          </Button>
        </li>
      ))}
    </ul>
  );
}
