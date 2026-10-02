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
import { localized, t, tx } from "@/i18n";

/**
 * Scans et photos → un seul PDF.
 *
 * Cet outil n'invente **aucun** moteur : il enchaîne le nettoyage documentaire
 * (`core/image/scan`) et l'assemblage existant (`imagesToPdf`). Sa raison
 * d'être est le trajet complet — plusieurs pages, dans le bon ordre, nettoyées
 * de la même façon — qui demanderait sinon de passer par trois outils et de
 * gérer soi-même les fichiers intermédiaires.
 */
const PAGE_MODES: { value: ImagePageMode; label: string; hint: string }[] = localized(() => [
  { value: "a4-portrait", label: t("A4 portrait"), hint: t("Chaque image est centrée sur une page A4") },
  { value: "a4-landscape", label: t("A4 paysage"), hint: t("Pages A4 à l'italienne") },
  { value: "fit-image", label: t("Taille de l'image"), hint: t("La page épouse exactement l'image") },
]);

const RENDERINGS: { value: ScanRendering; label: string; hint: string }[] = localized(() => [
  { value: "color", label: t("Couleur"), hint: t("Conserve les couleurs d'origine") },
  { value: "grayscale", label: t("Niveaux de gris"), hint: t("Allège le fichier, garde les nuances") },
  { value: "bw", label: t("Noir et blanc"), hint: t("Texte très contrasté, fichier le plus léger") },
]);

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
          label: t("Page {value} sur {count} — préparation", { value: index + 1, count: files.length }),
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

      context.report({ ratio: 0.85, label: t("Assemblage du PDF") });
      const file = await imagesToPdf(pages, { mode }, { signal: context.signal });
      return {
        files: [file],
        summary: t("{count} {count, plural, one {page} other {pages}} {count, plural, one {assemblée} other {assemblées}} dans un seul PDF.", { count: files.length }),
      };
    });

    if (result) {
      setOutcome(result);
      notify.success(t("PDF prêt"), result.summary);
    }
  };

  const errorMessage = job.error ? toImageError(job.error.cause).message : undefined;

  return (
    <div className="space-y-4">
      <FileDropZone
        constraints={constraintsForTool(tool)}
        files={files}
        onChange={setFiles}
        label={t("Déposez vos pages numérisées ou photographiées")}
        hint={t("L'ordre de la liste est celui des pages du PDF.")}
        disabled={job.isRunning}
        showFileList={false}
      />

      {files.length > 0 && (
        <PageList files={files} onMove={move} onRemove={(index) => setFiles((c) => c.filter((_, i) => i !== index))} disabled={job.isRunning} />
      )}

      {files.length > 0 && (
        <>
          <Fieldset columns={2} title={t("Mise en page")}>
            <Field label={t("Format des pages")}>
              <OptionGroup ariaLabel={t("Format des pages")} value={mode} onChange={setMode} options={PAGE_MODES} disabled={job.isRunning} />
            </Field>
            <Field label={t("Rendu")}>
              <OptionGroup ariaLabel={t("Rendu")} value={rendering} onChange={setRendering} options={RENDERINGS} disabled={job.isRunning} />
            </Field>
          </Fieldset>

          <Fieldset columns={2} title={t("Nettoyage (facultatif)")}>
            <Field label={t("Contraste")} hint={t("Relève un scan pâle ou une photo terne.")}>
              <Slider value={contrast} onChange={setContrast} min={-50} max={80} suffix="" />
            </Field>
            <Field label={t("Blanchir le fond")} hint={t("Efface un fond gris ou jauni sans toucher au texte.")}>
              <Slider value={whiten} onChange={setWhiten} min={0} max={100} suffix=" %" />
            </Field>
          </Fieldset>

          {!cleaning && (
            <Callout tone="info">
              {t("Aucun traitement n'est demandé : vos images seront intégrées telles quelles, sans réencodage ni perte de qualité.")}
            </Callout>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ft-border)] pt-4">
            <p className="text-xs text-[var(--ft-text-muted)]">
              {t("{count} {count, plural, one {page} other {pages}} · {size}", { count: files.length, size: formatFileSize(files.reduce((total, file) => total + file.size, 0)) })}
            </p>
            <div className="flex items-center gap-2">
              {job.isRunning && (
                <Button size="sm" variant="ghost" onClick={job.cancel}>
                  {t("Annuler")}
                </Button>
              )}
              <Button size="md" variant="primary" onClick={run} disabled={job.isRunning}>
                {job.isRunning ? (
                  <>
                    <Icon name="Loader" size={15} className="animate-spin" />
                    {job.progress.label ?? t("Traitement…")}
                  </>
                ) : (
                  <>
                    <Icon name="Play" size={15} />
                    {t("Créer le PDF")}
                  </>
                )}
              </Button>
            </div>
          </div>
        </>
      )}

      {job.isRunning && <ProgressBar ratio={job.progress.ratio} label={tx(job.progress.label)} />}

      {errorMessage && job.status === "error" && (
        <Callout tone="error" title={t("L'opération a échoué")}>
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
            aria-label={t("Monter {name}", { name: file.name })}
            disabled={disabled || index === 0}
            onClick={() => onMove(index, -1)}
          >
            <Icon name="ChevronUp" size={14} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("Descendre {name}", { name: file.name })}
            disabled={disabled || index === files.length - 1}
            onClick={() => onMove(index, 1)}
          >
            <Icon name="ChevronDown" size={14} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("Retirer {name}", { name: file.name })}
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
