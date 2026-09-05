import { useRef, useState } from "react";
import { ModelRequirements } from "@/components/speech/ModelRequirements";
import { TranscriptWorkbench } from "@/components/speech/TranscriptWorkbench";
import { ResultPanel, type OperationOutcome } from "@/components/pdf/ResultPanel";
import { Field, Fieldset, OptionGroup, Slider } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { STT_ENGINE } from "@/core/speech/stt";
import { toSrt, type TranscriptSegment } from "@/core/speech/subtitles";
import { runMedia } from "@/core/media/client";
import { mediaCapabilities } from "@/core/media/capabilities";
import { burnPipeline } from "@/core/media/video/pipelines";
import { describeMediaError, MEDIA_CANCELLED } from "@/core/media/errors";
import { DEFAULT_BURN_STYLE, type BurnStyle, type SubtitlePosition } from "@/core/media/operations/video";
import { probeFile } from "@/core/media/client";
import { outputName } from "@/core/pdf/filenames";
import type { SelectedFile } from "@/core/files";
import {
  cancelMediaJob,
  clearMediaJob,
  mediaJobResult,
  startMediaJob,
} from "@/features/jobs/media";
import { useToolJob } from "@/features/jobs/hooks";
import { notify } from "@/features/notifications/store";
import { fallbackTracker } from "./shared";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Sous-titres automatiques d'une vidéo.
 *
 * Aucun second moteur de reconnaissance n'est introduit : c'est **exactement**
 * la chaîne de la phase 4C qui est réutilisée — extraction de la bande son par
 * FFmpeg, transcription locale par whisper.cpp, passages horodatés corrigeables,
 * export SRT/VTT. Le modèle déjà téléchargé sert tel quel.
 *
 * Le seul ajout propre à la vidéo : incruster directement le résultat corrigé
 * dans l'image, sans repasser par un fichier intermédiaire.
 */
export function VideoGenerateSubtitlesTool({ tool }: ToolComponentProps) {
  return (
    <ModelRequirements required={[STT_ENGINE, "stt-base"]} optional={["stt-small"]}>
      {(assets) => (
        <TranscriptWorkbench
          tool={tool}
          assets={assets}
          focus="subtitles"
          dropLabel="Déposez votre vidéo"
          renderExtras={({ segments, file }) => (
            <BurnPanel toolId={tool.id} segments={segments} file={file} />
          )}
        />
      )}
    </ModelRequirements>
  );
}

/**
 * Incrustation du résultat dans la vidéo.
 *
 * Le traitement tourne dans son **propre** job (`<outil>:burn`) : la
 * transcription reste affichée et modifiable, et les deux ne se chassent pas
 * l'une l'autre dans le gestionnaire de travaux.
 */
function BurnPanel({
  toolId,
  segments,
  file,
}: {
  toolId: string;
  segments: TranscriptSegment[];
  file: SelectedFile | undefined;
}) {
  const burnToolId = `${toolId}:burn`;
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<BurnStyle>(DEFAULT_BURN_STYLE);
  const startingRef = useRef(false);

  const job = useToolJob(burnToolId);
  const running = job?.status === "running" || job?.status === "cancelling";
  const outcome: OperationOutcome | undefined = mediaJobResult(
    job?.status === "done" ? job.id : undefined,
  );

  if (!file || file.kind !== "video") return null;

  const start = async () => {
    if (startingRef.current || running) return;
    startingRef.current = true;
    try {
      if (job && !running) clearMediaJob(job.id);
      await startMediaJob({
        toolId: burnToolId,
        title: file.name,
        run: async (context) => {
          const caps = await mediaCapabilities();
          const info = await probeFile(file);
          const pipeline = burnPipeline({ caps, info, extension: file.extension }, { style });
          const tracker = fallbackTracker(pipeline);

          const produced = await runMedia(
            {
              files: [file],
              extraInputs: [{ bytes: new TextEncoder().encode(toSrt(segments)), ext: "srt" }],
              operation: pipeline.operation,
              alternatives: pipeline.alternatives,
              onFallback: tracker.onFallback,
              outputName: outputName(file.name, "sous-titres-incrustes", pipeline.container),
              totalMs: info.durationMs,
              label: "Incrustation…",
            },
            context,
          );
          notify.success("Vidéo sous-titrée prête");
          return {
            files: [produced],
            summary: `${segments.length} passages incrustés dans l'image.`,
            warning: tracker.warning(),
          };
        },
      });
    } catch (error) {
      notify.error("Lancement impossible", describeMediaError(error).message);
    } finally {
      startingRef.current = false;
    }
  };

  const patch = (values: Partial<BurnStyle>) => setStyle((current) => ({ ...current, ...values }));
  const failed = job?.status === "error" && job.error;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] p-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 text-sm font-medium"
      >
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={15} />
        Incruster ces sous-titres dans la vidéo
      </button>
      <p className="mt-1 pl-6 text-[11px] text-[var(--ft-text-faint)]">
        Le texte affiché ci-dessus, corrections comprises, est gravé dans l'image. La vidéo est
        réencodée ; l'audio est recopié tel quel.
      </p>

      {open && (
        <div className="mt-3 space-y-3">
          <Fieldset columns={2}>
            <Field label="Taille du texte">
              <Slider value={style.fontSize} onChange={(fontSize) => patch({ fontSize })} min={10} max={60} />
            </Field>
            <Field label="Position">
              <OptionGroup
                ariaLabel="Position"
                value={style.position}
                onChange={(position) => patch({ position: position as SubtitlePosition })}
                options={[
                  { value: "bottom", label: "En bas" },
                  { value: "center", label: "Au centre" },
                  { value: "top", label: "En haut" },
                ]}
              />
            </Field>
            <Field label="Lisibilité" full>
              <OptionGroup
                ariaLabel="Lisibilité"
                value={style.outline}
                onChange={(outline) => patch({ outline: outline as BurnStyle["outline"] })}
                options={[
                  { value: "outline", label: "Contour noir" },
                  { value: "box", label: "Bandeau" },
                  { value: "none", label: "Aucun" },
                ]}
              />
            </Field>
          </Fieldset>

          <div className="flex items-center justify-end gap-2">
            {running && (
              <Button size="sm" variant="ghost" onClick={() => job && cancelMediaJob(job.id)}>
                Annuler
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              onClick={() => void start()}
              disabled={running || segments.length === 0}
            >
              {running ? (
                <>
                  <Icon name="Loader" size={14} className="animate-spin" /> {job?.step ?? "Incrustation…"}
                </>
              ) : (
                <>
                  <Icon name="Subtitles" size={14} /> Incruster dans la vidéo
                </>
              )}
            </Button>
          </div>

          {running && (
            <div className="h-1 overflow-hidden rounded-full bg-[var(--ft-surface)]">
              <div
                className="h-full rounded-full bg-[var(--ft-accent)] transition-[width]"
                style={{ width: `${Math.round((job?.ratio ?? 0) * 100)}%` }}
              />
            </div>
          )}

          {failed && (
            <p
              className={`rounded-md border px-3 py-2 text-xs ${
                failed === MEDIA_CANCELLED
                  ? "border-[var(--ft-border)] text-[var(--ft-text-muted)]"
                  : "border-[var(--ft-danger)] text-[var(--ft-danger)]"
              }`}
            >
              {describeMediaError(new Error(failed)).message}
            </p>
          )}

          {outcome && <ResultPanel outcome={outcome} />}
        </div>
      )}
    </div>
  );
}
