import { useEffect, useRef, useState } from "react";
import type { SelectedFile } from "@/core/files";

/**
 * Lecteur audio réutilisable : contrôles natifs (lecture, pause, timeline,
 * volume) via l'élément `<audio>`, alimenté par une URL objet locale.
 */
export function AudioPreview({
  file,
  bytes,
  mimeType = "audio/wav",
  label,
}: {
  file?: SelectedFile;
  bytes?: Uint8Array;
  mimeType?: string;
  label?: string;
}) {
  const [url, setUrl] = useState<string | undefined>(undefined);
  const urlRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const blob = file?.file ?? (bytes ? new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeType }) : undefined);
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(blob);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = next;
    setUrl(next);
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = undefined;
    };
  }, [file, bytes, mimeType]);

  if (!url) return null;
  return (
    <div className="space-y-1">
      {label && <p className="text-xs text-[var(--ft-text-muted)]">{label}</p>}
      <audio controls src={url} className="w-full" />
    </div>
  );
}
