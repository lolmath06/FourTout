import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ToolDefinition } from "@/core/tools/types";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { notify } from "@/features/notifications/store";
import { ResultPanel, type OperationOutcome } from "@/components/pdf/ResultPanel";
import { isMediaAvailable, probeFile } from "@/core/media/client";
import { mediaCapabilities, type MediaCapabilities } from "@/core/media/capabilities";
import { describeMediaError, MEDIA_CANCELLED } from "@/core/media/errors";
import { emptyMediaInfo, type MediaInfo } from "@/core/media/types";
import {
  cancelMediaJob,
  clearMediaJob,
  mediaJobResult,
  startMediaJob,
} from "@/features/jobs/media";
import { useToolJob } from "@/features/jobs/hooks";
import { useHandoff } from "@/features/handoff/store";
import { VideoInfoList } from "./VideoInfoList";
import { OutputVideoPreview } from "./VideoPreview";
import { AudioPreview } from "./AudioPreview";

/**
 * Ossature commune aux outils de la suite Vidéo.
 *
 * Elle prend en charge tout ce qui se répéterait sinon quinze fois : dépôt des
 * fichiers, inspection ffprobe (une seule fois par fichier), capacités réelles
 * du FFmpeg installé, lancement d'un job **global** — donc qui survit à la
 * navigation — avec progression et annulation véritables, traduction des
 * erreurs FFmpeg, puis présentation du résultat.
 *
 * L'outil ne fournit que ses réglages et sa fonction de traitement.
 */

export interface VideoRunArgs {
  files: SelectedFile[];
  infos: MediaInfo[];
  caps: MediaCapabilities;
  context: { report: (p: { ratio?: number; label?: string }) => void; signal: AbortSignal };
}

export interface VideoToolShellProps {
  tool: ToolDefinition;
  selection?: "single" | "multiple";
  actionLabel: string;
  actionDisabled?: boolean;
  /** Réglages propres à l'outil, rendus une fois les fichiers déposés. */
  children?: (context: {
    files: SelectedFile[];
    infos: MediaInfo[];
    caps: MediaCapabilities;
  }) => ReactNode;
  run: (args: VideoRunArgs) => Promise<OperationOutcome>;
  hint?: string;
  /** Affiche les flèches de réordonnancement (fusion). */
  reorderable?: boolean;
  /** Masque la liste récapitulative quand l'outil montre déjà la vidéo. */
  showFileList?: boolean;
  /** Message d'aide affiché sous le bouton d'action. */
  footnote?: ReactNode;
}

export function VideoToolShell({
  tool,
  selection = "single",
  actionLabel,
  actionDisabled = false,
  children,
  run,
  hint,
  reorderable = false,
  showFileList = true,
  footnote,
}: VideoToolShellProps) {
  // Le convertisseur universel (et tout autre outil qui passe le relais) peut
  // nous transmettre le fichier déjà choisi : l'utilisateur ne le redépose pas.
  const handoff = useHandoff(tool.id);
  const [files, setFiles] = useState<SelectedFile[]>(() => handoff?.files ?? []);
  const [infos, setInfos] = useState<MediaInfo[]>([]);
  const [probing, setProbing] = useState(false);
  const [available, setAvailable] = useState<boolean | undefined>(undefined);
  const [caps, setCaps] = useState<MediaCapabilities | undefined>(undefined);
  const [showDetail, setShowDetail] = useState(false);
  const startingRef = useRef(false);
  // ffprobe est coûteux : on garde le résultat de chaque fichier déjà inspecté.
  const probeCache = useRef(new Map<string, MediaInfo>());

  const job = useToolJob(tool.id);
  const running = job?.status === "running" || job?.status === "cancelling";
  const outcome = mediaJobResult(job?.status === "done" ? job.id : undefined);

  useEffect(() => {
    void isMediaAvailable().then(async (ok) => {
      setAvailable(ok);
      if (ok) setCaps(await mediaCapabilities());
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (files.length === 0 || !available) {
      setInfos([]);
      return;
    }
    setProbing(true);
    (async () => {
      const results: MediaInfo[] = [];
      for (const file of files) {
        const cached = probeCache.current.get(file.id);
        if (cached) {
          results.push(cached);
          continue;
        }
        let info: MediaInfo;
        try {
          info = await probeFile(file);
        } catch {
          info = emptyMediaInfo();
        }
        probeCache.current.set(file.id, info);
        results.push(info);
      }
      if (!cancelled) {
        setInfos(results);
        setProbing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [files, available]);

  const move = useCallback(
    (id: string, direction: -1 | 1) =>
      setFiles((current) => {
        const i = current.findIndex((f) => f.id === id);
        const j = i + direction;
        if (i < 0 || j < 0 || j >= current.length) return current;
        const next = [...current];
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      }),
    [],
  );

  const remove = useCallback(
    (id: string) => setFiles((current) => current.filter((file) => file.id !== id)),
    [],
  );

  const execute = async () => {
    if (startingRef.current || running || !caps) return;
    startingRef.current = true;
    try {
      if (job && !running) clearMediaJob(job.id);
      await startMediaJob({
        toolId: tool.id,
        title: files[0]?.name ?? tool.name,
        run: async (context) => {
          const result = await run({ files, infos, caps, context });
          notify.success("Fichier prêt", result.summary);
          return result;
        },
      });
    } catch (error) {
      notify.error("Lancement impossible", describeMediaError(error).message);
    } finally {
      startingRef.current = false;
    }
  };

  if (available === false) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] p-4 text-sm text-[var(--ft-text-muted)]">
        <p className="flex items-center gap-2 font-medium text-[var(--ft-text)]">
          <Icon name="Info" size={16} /> Traitement local requis
        </p>
        <p className="mt-1.5">
          Cet outil s'appuie sur le moteur média local (FFmpeg) et nécessite l'application FourTout
          installée. Il n'est pas disponible dans l'aperçu navigateur.
        </p>
      </div>
    );
  }

  const constraints = {
    ...constraintsForTool(tool),
    maxFiles: selection === "single" ? 1 : undefined,
  };

  const failed = job?.status === "error" && job.error;
  const cancelledByUser = failed === MEDIA_CANCELLED;

  return (
    <div className="space-y-4">
      <FileDropZone
        constraints={constraints}
        files={files}
        onChange={setFiles}
        label={selection === "multiple" ? "Déposez vos vidéos ici" : "Déposez votre vidéo ici"}
        hint={hint}
        disabled={running}
      />

      {showFileList && (
        <VideoInfoList
          files={files}
          infos={infos}
          onMove={reorderable ? move : undefined}
          onReorder={reorderable ? setFiles : undefined}
          onRemove={files.length > 1 ? remove : undefined}
          disabled={running}
        />
      )}

      {files.length > 0 && (probing || !caps) && (
        <p className="flex items-center gap-2 text-xs text-[var(--ft-text-muted)]">
          <Icon name="Loader" size={13} className="animate-spin" />
          {probing ? "Analyse du fichier…" : "Vérification des encodeurs disponibles sur cette machine…"}
        </p>
      )}

      {files.length > 0 && !probing && caps && children?.({ files, infos, caps })}

      <p className="flex items-center gap-1.5 text-[11px] text-[var(--ft-text-faint)]">
        <Icon name="ShieldCheck" size={13} /> 100 % local — le fichier ne quitte pas votre appareil.
      </p>

      {files.length > 0 && (
        <div className="flex items-center justify-end gap-2 border-t border-[var(--ft-border)] pt-4">
          {running && (
            <Button size="sm" variant="ghost" onClick={() => job && cancelMediaJob(job.id)}>
              Annuler
            </Button>
          )}
          <Button
            size="md"
            variant="primary"
            onClick={() => void execute()}
            disabled={actionDisabled || running || probing || !caps}
          >
            {running ? (
              <>
                <Icon name="Loader" size={15} className="animate-spin" />
                {job?.step ?? "Traitement…"}
              </>
            ) : (
              <>
                <Icon name="Play" size={15} />
                {actionLabel}
              </>
            )}
          </Button>
        </div>
      )}

      {footnote && <div className="text-[11px] text-[var(--ft-text-faint)]">{footnote}</div>}

      {running && (
        <div className="space-y-1">
          <div className="h-1 overflow-hidden rounded-full bg-[var(--ft-surface-2)]">
            <div
              className="h-full rounded-full bg-[var(--ft-accent)] transition-[width]"
              style={{ width: `${Math.round((job?.ratio ?? 0) * 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-[var(--ft-text-faint)]">
            {job?.step ?? "Traitement en cours"} — vous pouvez quitter cet outil, le traitement
            continue.
          </p>
        </div>
      )}

      {failed &&
        (cancelledByUser ? (
          <p className="flex items-center gap-2 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-sm text-[var(--ft-text-muted)]">
            <Icon name="Info" size={15} /> {failed}
          </p>
        ) : (
          <div className="rounded-md border border-[var(--ft-danger)] px-3 py-2 text-sm text-[var(--ft-danger)]">
            <p className="flex items-start gap-2">
              <Icon name="CircleAlert" size={16} className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1">{friendly(failed)}</span>
            </p>
            {friendly(failed) !== failed && (
              <>
                <button
                  type="button"
                  onClick={() => setShowDetail((v) => !v)}
                  className="mt-1 text-[11px] underline opacity-80"
                >
                  {showDetail ? "Masquer le détail technique" : "Détail technique"}
                </button>
                {showDetail && (
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--ft-surface-2)] p-2 text-[11px] text-[var(--ft-text-muted)]">
                    {failed}
                  </pre>
                )}
              </>
            )}
          </div>
        ))}

      {outcome && (
        <>
          <ResultPanel outcome={outcome} />
          <ResultMedia outcome={outcome} />
        </>
      )}
    </div>
  );
}

/** Aperçu du premier fichier produit, selon sa nature. */
function ResultMedia({ outcome }: { outcome: OperationOutcome }) {
  const file = outcome.files[0];
  const preview = useMemo(() => file, [file]);
  if (!preview || outcome.files.length > 1) return null;
  if (preview.mimeType.startsWith("video/")) {
    return <OutputVideoPreview bytes={preview.bytes} mimeType={preview.mimeType} label="Aperçu du résultat" />;
  }
  if (preview.mimeType.startsWith("audio/")) {
    return <AudioPreview bytes={preview.bytes} mimeType={preview.mimeType} label="Écouter le résultat" />;
  }
  return null;
}

function friendly(message: string): string {
  return describeMediaError(new Error(message)).message;
}
