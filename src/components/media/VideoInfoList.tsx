import { useRef, useState } from "react";
import { formatFileSize } from "@/core/files";
import type { SelectedFile } from "@/core/files";
import { Icon } from "@/components/ui/Icon";
import { reorderByInsertion } from "@/components/pdf/pageReorder";
import { formatTimecode, type MediaInfo } from "@/core/media/types";
import { describeVideo } from "./describeVideo";

/**
 * Carte d'identité d'un fichier vidéo : ce que ffprobe a réellement lu.
 *
 * Elle sert de point de comparaison honnête avec le résultat (« avant / après »)
 * et évite les réglages absurdes : on voit tout de suite qu'une source est en
 * 720p avant de demander du 1080p.
 */

export function VideoInfoList({
  files,
  infos,
  onMove,
  onReorder,
  onRemove,
  disabled = false,
}: {
  files: SelectedFile[];
  infos: MediaInfo[];
  /** Réordonner (fusion) : `undefined` masque les flèches. */
  onMove?: (id: string, direction: -1 | 1) => void;
  /** Réordonnancement par glisser-déposer ; reçoit la liste réordonnée. */
  onReorder?: (files: SelectedFile[]) => void;
  onRemove?: (id: string) => void;
  disabled?: boolean;
}) {
  const dragIndex = useRef<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const draggable = Boolean(onReorder) && !disabled && files.length > 1;

  if (files.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1">
      {files.map((file, index) => {
        const info = infos[index];
        return (
          <li
            key={file.id}
            draggable={draggable}
            onDragStart={() => {
              dragIndex.current = index;
            }}
            onDragOver={(event) => {
              if (!draggable || dragIndex.current === null) return;
              event.preventDefault();
              setOverIndex(index);
            }}
            onDragEnd={() => {
              dragIndex.current = null;
              setOverIndex(null);
            }}
            onDrop={(event) => {
              if (!draggable || dragIndex.current === null) return;
              event.preventDefault();
              event.stopPropagation();
              const from = dragIndex.current;
              dragIndex.current = null;
              setOverIndex(null);
              if (from !== index) onReorder?.(reorderByInsertion(files, from, index > from ? index + 1 : index));
            }}
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-[var(--ft-surface)] px-2.5 py-1.5 text-xs ${
              overIndex === index ? "border-[var(--ft-accent)]" : "border-[var(--ft-border)]"
            } ${draggable ? "cursor-grab" : ""}`}
          >
            <Icon name={draggable ? "ArrowUpDown" : "Film"} size={14} className="shrink-0 text-[var(--ft-text-faint)]" />
            <span className="shrink-0 tabular-nums text-[var(--ft-text-faint)]">{index + 1}.</span>
            <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
            {info?.durationMs ? (
              <span className="tabular-nums text-[var(--ft-text-muted)]">
                {formatTimecode(info.durationMs)}
              </span>
            ) : null}
            <span className="text-[var(--ft-text-muted)]">{formatFileSize(file.size)}</span>
            <span className="w-full text-[11px] text-[var(--ft-text-faint)] sm:w-auto sm:basis-full">
              {describeVideo(info)}
              {info?.subtitles.length ? ` · ${info.subtitles.length} piste(s) de sous-titres` : ""}
            </span>
            {!disabled && (onMove || onRemove) && (
              <span className="flex gap-0.5">
                {onMove && files.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => onMove(file.id, -1)}
                      className="rounded p-0.5 hover:text-[var(--ft-accent)]"
                      aria-label={`Monter ${file.name}`}
                    >
                      <Icon name="ChevronUp" size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMove(file.id, 1)}
                      className="rounded p-0.5 hover:text-[var(--ft-accent)]"
                      aria-label={`Descendre ${file.name}`}
                    >
                      <Icon name="ChevronDown" size={13} />
                    </button>
                  </>
                )}
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(file.id)}
                    className="rounded p-0.5 hover:text-[var(--ft-danger)]"
                    aria-label={`Retirer ${file.name}`}
                  >
                    <Icon name="X" size={13} />
                  </button>
                )}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
