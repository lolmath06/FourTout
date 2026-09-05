import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { SelectedFile } from "@/core/files";
import { useFileUrl } from "./useFileUrl";

/**
 * Lecteur vidéo local réutilisable.
 *
 * Les outils interactifs (découpage, rognage) ont besoin de voir la vidéo et de
 * connaître l'instant courant ; ils n'ont pas besoin d'un logiciel de montage.
 * Ce composant s'en tient donc au lecteur natif, à la position de lecture, et à
 * un calque libre superposé à l'image (sélection de rognage, repères).
 *
 * L'URL objet est révoquée au démontage : aucune fuite entre deux fichiers.
 */

export function VideoPreview({
  file,
  videoRef,
  onTime,
  overlay,
  maxHeight = 340,
}: {
  file: SelectedFile;
  /** Référence exposée à l'outil (recherche d'un instant, lecture/pause). */
  videoRef?: RefObject<HTMLVideoElement | null>;
  /** Appelé à chaque changement de position, en millisecondes. */
  onTime?: (ms: number) => void;
  /** Calque superposé à l'image, dimensionné exactement comme la vidéo. */
  overlay?: ReactNode;
  maxHeight?: number;
}) {
  const url = useFileUrl(file);
  const localRef = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? localRef;

  if (!url) {
    return (
      <div
        className="flex items-center justify-center rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] text-xs text-[var(--ft-text-muted)]"
        style={{ height: maxHeight }}
      >
        Préparation de l'aperçu…
      </div>
    );
  }

  return (
    <div className="flex justify-center rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-black/85 p-2">
      <div className="relative inline-block">
        <video
          ref={ref}
          src={url}
          controls
          preload="metadata"
          playsInline
          className="block max-w-full object-contain"
          style={{ maxHeight }}
          onTimeUpdate={(event) => onTime?.(Math.round(event.currentTarget.currentTime * 1000))}
          onSeeked={(event) => onTime?.(Math.round(event.currentTarget.currentTime * 1000))}
        />
        {overlay}
      </div>
    </div>
  );
}

/** Lecteur d'un résultat déjà produit (octets en mémoire). */
export function OutputVideoPreview({
  bytes,
  mimeType,
  label,
}: {
  bytes: Uint8Array;
  mimeType: string;
  label?: string;
}) {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    const next = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeType }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes, mimeType]);

  if (!url) return null;
  return (
    <div className="space-y-1">
      {label && <p className="text-xs text-[var(--ft-text-muted)]">{label}</p>}
      <video src={url} controls preload="metadata" className="max-h-80 w-full rounded-md bg-black" />
    </div>
  );
}
