import { useEffect, useState, type ReactNode } from "react";
import type { ToolDefinition } from "@/core/tools/types";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useJob } from "@/core/jobs";
import type { OperationContext } from "@/core/pdf/types";
import { notify } from "@/features/notifications/store";
import { ResultPanel, type OperationOutcome } from "@/components/pdf/ResultPanel";
import { AudioPreview } from "./AudioPreview";
import { isMediaAvailable, probeFile } from "@/core/media/client";
import { emptyMediaInfo, formatTimecode, type MediaInfo } from "@/core/media/types";
import { useHandoff } from "@/features/handoff/store";

/**
 * Ossature commune aux outils média (audio et petits ponts vidéo), au-dessus du
 * socle FFmpeg. Elle gère le dépôt, l'inspection ffprobe (durée, codec), les
 * réglages propres à l'outil, l'exécution avec progression et annulation
 * réelles, puis le résultat. FFmpeg étant natif, l'outil indique clairement
 * quand l'application installée est requise.
 */
export interface MediaRunArgs {
  files: SelectedFile[];
  infos: MediaInfo[];
  context: OperationContext;
}

export function MediaToolShell({
  tool,
  selection = "single",
  children,
  actionLabel,
  actionDisabled = false,
  run,
  hint,
  reorderable = false,
}: {
  tool: ToolDefinition;
  selection?: "single" | "multiple";
  children?: (infos: MediaInfo[], files: SelectedFile[]) => ReactNode;
  actionLabel: string;
  actionDisabled?: boolean;
  run: (args: MediaRunArgs) => Promise<OperationOutcome>;
  hint?: string;
  reorderable?: boolean;
}) {
  // Le convertisseur universel (et tout autre outil qui passe le relais) peut
  // nous transmettre le fichier déjà choisi : l'utilisateur ne le redépose pas.
  const handoff = useHandoff(tool.id);
  const [files, setFiles] = useState<SelectedFile[]>(() => handoff?.files ?? []);
  const [infos, setInfos] = useState<MediaInfo[]>([]);
  const [available, setAvailable] = useState<boolean | undefined>(undefined);
  const [outcome, setOutcome] = useState<OperationOutcome | null>(null);
  const job = useJob<OperationOutcome>();

  useEffect(() => {
    isMediaAvailable().then(setAvailable);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (files.length === 0 || !available) {
      setInfos([]);
      return;
    }
    (async () => {
      const results: MediaInfo[] = [];
      for (const file of files) {
        try {
          results.push(await probeFile(file));
        } catch {
          results.push(emptyMediaInfo());
        }
      }
      if (!cancelled) setInfos(results);
    })();
    return () => {
      cancelled = true;
    };
  }, [files, available]);

  const constraints = { ...constraintsForTool(tool), maxFiles: selection === "single" ? 1 : undefined };

  const move = (id: string, dir: -1 | 1) =>
    setFiles((cur) => {
      const i = cur.findIndex((f) => f.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const execute = async () => {
    setOutcome(null);
    const result = await job.run((context) =>
      run({ files, infos, context: { report: context.report, signal: context.signal } }),
    );
    if (result) {
      setOutcome(result);
      notify.success("Fichier prêt", result.summary);
    }
  };

  const errorMessage =
    job.status === "error" && job.error
      ? job.error.cause instanceof Error
        ? job.error.cause.message
        : job.error.message
      : undefined;

  if (available === false) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] p-4 text-sm text-[var(--ft-text-muted)]">
        <p className="flex items-center gap-2 font-medium text-[var(--ft-text)]">
          <Icon name="Info" size={16} /> Traitement local requis
        </p>
        <p className="mt-1.5">
          Cet outil s'appuie sur le moteur média local (FFmpeg) et nécessite l'application FourTout installée. Il n'est pas
          disponible dans l'aperçu navigateur.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FileDropZone
        constraints={constraints}
        files={files}
        onChange={setFiles}
        label={selection === "multiple" ? "Déposez vos fichiers ici" : "Déposez votre fichier ici"}
        hint={hint}
        disabled={job.isRunning}
      />

      {files.length > 0 && infos.length > 0 && (
        <ul className="flex flex-col gap-1">
          {files.map((file, index) => (
            <li key={file.id} className="flex items-center gap-2 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface)] px-2.5 py-1.5 text-xs">
              <Icon name="AudioLines" size={14} className="shrink-0 text-[var(--ft-text-faint)]" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              {infos[index]?.durationMs > 0 && <span className="tabular-nums text-[var(--ft-text-muted)]">{formatTimecode(infos[index].durationMs)}</span>}
              {infos[index]?.audioCodec && <span className="font-mono uppercase text-[var(--ft-text-faint)]">{infos[index].audioCodec}</span>}
              {reorderable && files.length > 1 && !job.isRunning && (
                <span className="flex gap-0.5">
                  <button onClick={() => move(file.id, -1)} className="rounded p-0.5 hover:text-[var(--ft-accent)]" aria-label="Monter"><Icon name="ChevronUp" size={13} /></button>
                  <button onClick={() => move(file.id, 1)} className="rounded p-0.5 hover:text-[var(--ft-accent)]" aria-label="Descendre"><Icon name="ChevronDown" size={13} /></button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {files.length > 0 && children?.(infos, files)}

      {files.length > 0 && (
        <div className="flex items-center justify-end gap-2 border-t border-[var(--ft-border)] pt-4">
          {job.isRunning && <Button size="sm" variant="ghost" onClick={job.cancel}>Annuler</Button>}
          <Button size="md" variant="primary" onClick={execute} disabled={actionDisabled || job.isRunning}>
            {job.isRunning ? (
              <><Icon name="Loader" size={15} className="animate-spin" />{job.progress.label ?? "Traitement…"}</>
            ) : (
              <><Icon name="Play" size={15} />{actionLabel}</>
            )}
          </Button>
        </div>
      )}

      {job.isRunning && (
        <div className="h-1 overflow-hidden rounded-full bg-[var(--ft-surface-2)]">
          <div className="h-full rounded-full bg-[var(--ft-accent)] transition-[width]" style={{ width: `${Math.round((job.progress.ratio ?? 0) * 100)}%` }} />
        </div>
      )}

      {errorMessage && (
        <p className="flex items-center gap-2 rounded-md border border-[var(--ft-danger)] px-3 py-2 text-sm text-[var(--ft-danger)]">
          <Icon name="CircleAlert" size={16} /> {errorMessage}
        </p>
      )}

      {outcome && (
        <>
          <ResultPanel outcome={outcome} />
          {outcome.files[0]?.mimeType.startsWith("audio/") && (
            <AudioPreview bytes={outcome.files[0].bytes} mimeType={outcome.files[0].mimeType} label="Écouter le résultat" />
          )}
          {outcome.files[0]?.mimeType.startsWith("image/") && <ResultImage file={outcome.files[0]} />}
        </>
      )}
    </div>
  );
}

function ResultImage({ file }: { file: { bytes: Uint8Array; mimeType: string; name: string } }) {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([file.bytes.slice().buffer as ArrayBuffer], { type: file.mimeType }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  if (!url) return null;
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)]">
      <img src={url} alt={file.name} className="max-h-80 w-full object-contain" />
    </div>
  );
}

