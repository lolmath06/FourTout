import clsx from "clsx";
import type { ReactNode } from "react";
import { formatFileSize } from "@/core/files";
import type { SelectedFile } from "@/core/files";
import { useImagePreview } from "./useImagePreview";

/**
 * Aperçu d'image partagé : fond en damier (pour voir la transparence),
 * dimensions, poids, et un emplacement pour superposer des contrôles
 * (sélection de recadrage, zone de flou, texte…).
 */
const CHECKERBOARD =
  "repeating-conic-gradient(var(--ft-surface-2) 0% 25%, var(--ft-surface) 0% 50%) 50% / 20px 20px";

export function ImagePreview({
  file,
  overlay,
  maxHeight = 460,
  children,
}: {
  file: SelectedFile;
  overlay?: ReactNode;
  maxHeight?: number;
  children?: (state: { width: number; height: number; url?: string }) => ReactNode;
}) {
  const preview = useImagePreview(file);

  return (
    <div className="space-y-2">
      <div
        className="relative flex items-center justify-center overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)]"
        style={{ background: CHECKERBOARD, maxHeight }}
      >
        {preview.url && (
          <img
            src={preview.url}
            alt={file.name}
            className="max-h-full max-w-full object-contain"
            style={{ maxHeight }}
            draggable={false}
          />
        )}
        {overlay}
        {children?.({ width: preview.width, height: preview.height, url: preview.url })}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--ft-text-muted)]">
        <span className="truncate font-medium text-[var(--ft-text)]">{file.name}</span>
        {preview.width > 0 && (
          <span className="tabular-nums">
            {preview.width} × {preview.height} px
          </span>
        )}
        <span className="tabular-nums">{formatFileSize(file.size)}</span>
        {preview.error && <span className="text-[var(--ft-warn)]">{preview.error}</span>}
      </p>
    </div>
  );
}

export function PreviewFrame({
  className,
  children,
  maxHeight = 460,
}: {
  className?: string;
  children: ReactNode;
  maxHeight?: number;
}) {
  return (
    <div
      className={clsx(
        "relative flex items-center justify-center overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)]",
        className,
      )}
      style={{ background: CHECKERBOARD, maxHeight }}
    >
      {children}
    </div>
  );
}
