import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Field, Fieldset, Select } from "@/components/pdf/Field";
import { FileDropZone } from "@/components/files/FileDropZone";
import { cleanMessage } from "./message";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { formatSrtTime, toPlainText, toSrt, toVtt, type TranscriptSegment } from "@/core/speech/subtitles";
import { STT_LANGUAGES, STT_MODELS, transcribe, type SttModelId } from "@/core/speech/stt";
import type { SpeechAsset } from "@/core/speech/models";
import { saveFile } from "@/core/output/save";
import {
  cancelSpeechJob,
  clearSpeechJob,
  speechJobResult,
  startSpeechJob,
  SPEECH_CANCELLED,
} from "@/features/jobs/speech";
import { useToolJob } from "@/features/jobs/hooks";
import { notify } from "@/features/notifications/store";
import type { ToolDefinition } from "@/core/tools/types";

/**
 * Atelier commun à la transcription et aux sous-titres.
 *
 * Le moteur produit des passages horodatés ; l'utilisateur peut les corriger un
 * par un **avant** export. Les horodatages ne bougent pas : un SRT exporté
 * après correction porte donc le texte corrigé, aux temps d'origine.
 */

export interface TranscriptResult {
  segments: TranscriptSegment[];
  language: string;
  modelId: SttModelId;
  fileName: string;
}

export function TranscriptWorkbench({
  tool,
  assets,
  focus,
  dropLabel,
  renderExtras,
}: {
  tool: ToolDefinition;
  assets: SpeechAsset[];
  /** `text` met en avant le texte, `subtitles` les fichiers de sous-titres. */
  focus: "text" | "subtitles";
  /** Libellé de la zone de dépôt, quand l'outil n'accepte pas tout. */
  dropLabel?: string;
  /**
   * Actions supplémentaires proposées une fois la transcription obtenue, à
   * partir des passages **corrigés** et du fichier source (incrustation dans la
   * vidéo, par exemple). Rendues sous la liste des passages.
   */
  renderExtras?: (context: {
    segments: TranscriptSegment[];
    file: SelectedFile | undefined;
  }) => ReactNode;
}) {
  const installedModels = useMemo(
    () => STT_MODELS.filter((model) => assets.find((asset) => asset.id === model.id)?.installed),
    [assets],
  );
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [modelId, setModelId] = useState<SttModelId>(installedModels[0]?.id ?? "stt-base");
  const [language, setLanguage] = useState<string>("auto");
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [editedFor, setEditedFor] = useState<string | undefined>(undefined);
  const startingRef = useRef(false);

  const job = useToolJob(tool.id);
  const result = speechJobResult<TranscriptResult>(job?.status === "done" ? job.id : undefined);
  const running = job?.status === "running" || job?.status === "cancelling";

  useEffect(() => {
    if (installedModels.length > 0 && !installedModels.some((model) => model.id === modelId)) {
      setModelId(installedModels[0].id);
    }
  }, [installedModels, modelId]);

  // Le résultat d'un nouveau job remplace les corrections du précédent.
  useEffect(() => {
    if (result && job && editedFor !== job.id) {
      setSegments(result.segments);
      setEditedFor(job.id);
    }
  }, [result, job, editedFor]);

  const start = async () => {
    const file = files[0];
    if (startingRef.current || running || !file) return;
    startingRef.current = true;
    try {
      if (job && !running) clearSpeechJob(job.id);
      setSegments([]);
      setEditedFor(undefined);
      await startSpeechJob<TranscriptResult>({
        toolId: tool.id,
        kind: "speech-transcription",
        title: file.name,
        run: async (context) => {
          const outcome = await transcribe({ file, modelId, language }, context);
          return {
            segments: outcome.segments,
            language: outcome.language,
            modelId: outcome.modelId,
            fileName: file.name,
          };
        },
      });
    } catch (error) {
      notify.error("Lancement impossible", cleanMessage(error));
    } finally {
      startingRef.current = false;
    }
  };

  const editSegment = (index: number, text: string) =>
    setSegments((current) => current.map((segment, i) => (i === index ? { ...segment, text } : segment)));

  const baseName = (result?.fileName ?? "transcription").replace(/\.[^.]+$/, "");

  const download = async (extension: "txt" | "srt" | "vtt") => {
    const content =
      extension === "srt" ? toSrt(segments) : extension === "vtt" ? toVtt(segments) : toPlainText(segments);
    const outcome = await saveFile({
      name: `${baseName}.${extension}`,
      bytes: new TextEncoder().encode(content),
      mimeType: extension === "txt" ? "text/plain" : `text/${extension}`,
    });
    if (outcome.saved) notify.success("Fichier enregistré", outcome.path);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toPlainText(segments));
      notify.success("Transcription copiée");
    } catch {
      notify.error("Copie impossible");
    }
  };

  const exports: { format: "txt" | "srt" | "vtt"; label: string; icon: "FileText" | "Subtitles" }[] =
    focus === "subtitles"
      ? [
          { format: "srt", label: "Sous-titres SRT", icon: "Subtitles" },
          { format: "vtt", label: "Sous-titres VTT", icon: "Subtitles" },
          { format: "txt", label: "Texte brut", icon: "FileText" },
        ]
      : [
          { format: "txt", label: "Texte brut", icon: "FileText" },
          { format: "srt", label: "Sous-titres SRT", icon: "Subtitles" },
          { format: "vtt", label: "Sous-titres VTT", icon: "Subtitles" },
        ];

  return (
    <div className="space-y-4">
      <FileDropZone
        constraints={{ ...constraintsForTool(tool), maxFiles: 1 }}
        files={files}
        onChange={setFiles}
        label={dropLabel ?? "Déposez un fichier audio ou vidéo"}
        hint="La bande son d'une vidéo est extraite automatiquement."
        disabled={running}
      />

      {files.length > 0 && (
        <Fieldset>
          <Field label="Modèle" hint={STT_MODELS.find((m) => m.id === modelId)?.detail}>
            <Select
              value={modelId}
              onChange={setModelId}
              disabled={running}
              options={installedModels.map((model) => ({ value: model.id, label: model.label }))}
            />
          </Field>
          <Field label="Langue parlée">
            <Select
              value={language}
              onChange={setLanguage}
              disabled={running}
              options={STT_LANGUAGES.map((entry) => ({ value: entry.value, label: entry.label }))}
            />
          </Field>
        </Fieldset>
      )}


      {files.length > 0 && (
        <div className="flex items-center justify-end gap-2 border-t border-[var(--ft-border)] pt-4">
          {running && (
            <Button size="sm" variant="ghost" onClick={() => job && cancelSpeechJob(job.id)}>
              Annuler
            </Button>
          )}
          <Button size="md" variant="primary" onClick={() => void start()} disabled={running}>
            {running ? (
              <><Icon name="Loader" size={15} className="animate-spin" /> {job?.step ?? "Transcription…"}</>
            ) : (
              <><Icon name="Play" size={15} /> {focus === "subtitles" ? "Générer les sous-titres" : "Transcrire"}</>
            )}
          </Button>
        </div>
      )}

      {running && (
        <div className="space-y-1">
          <div className="h-1 overflow-hidden rounded-full bg-[var(--ft-surface-2)]">
            <div
              className="h-full rounded-full bg-[var(--ft-accent)] transition-[width]"
              style={{ width: `${Math.round((job?.ratio ?? 0) * 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-[var(--ft-text-faint)]">
            {job?.step ?? "Transcription en cours"} — vous pouvez quitter cet outil, le traitement continue.
          </p>
        </div>
      )}

      {job?.status === "error" && job.error && (
        // Une annulation demandée par l'utilisateur n'est pas une panne.
        job.error === SPEECH_CANCELLED ? (
          <p className="flex items-center gap-2 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-sm text-[var(--ft-text-muted)]">
            <Icon name="Info" size={15} /> {job.error}
          </p>
        ) : (
          <p className="flex items-center gap-2 rounded-md border border-[var(--ft-danger)] px-3 py-2 text-sm text-[var(--ft-danger)]">
            <Icon name="CircleAlert" size={16} /> {job.error}
          </p>
        )
      )}

      {segments.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[var(--ft-text-muted)]">
              {segments.length} passage{segments.length > 1 ? "s" : ""}
              {result?.language && ` · langue détectée : ${result.language}`}
              {result && ` · modèle ${STT_MODELS.find((m) => m.id === result.modelId)?.label ?? result.modelId}`}
            </p>
            <span className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void copy()}>
                <Icon name="Copy" size={14} /> Copier
              </Button>
              {exports.map((entry) => (
                <Button key={entry.format} size="sm" onClick={() => void download(entry.format)}>
                  <Icon name={entry.icon} size={14} /> {entry.label}
                </Button>
              ))}
            </span>
          </div>

          <ul className="flex max-h-[26rem] flex-col gap-1.5 overflow-y-auto rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-2">
            {segments.map((segment, index) => (
              <li key={`${segment.start}-${index}`} className="flex items-start gap-2">
                <span className="mt-1.5 shrink-0 font-mono text-[11px] tabular-nums text-[var(--ft-text-faint)]">
                  {formatSrtTime(segment.start).slice(0, 8)}
                </span>
                <textarea
                  value={segment.text}
                  onChange={(event) => editSegment(index, event.target.value)}
                  rows={Math.max(1, Math.ceil(segment.text.length / 70))}
                  className="min-w-0 flex-1 resize-y rounded-md border border-transparent bg-transparent px-2 py-1 text-sm outline-none hover:border-[var(--ft-border)] focus:border-[var(--ft-accent)]"
                />
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-[var(--ft-text-faint)]">
            Corrigez librement un passage : les horodatages restent inchangés et les fichiers
            exportés reprennent le texte affiché.
          </p>

          {renderExtras?.({ segments, file: files[0] })}
        </div>
      )}
    </div>
  );
}
