import { useEffect, useState } from "react";
import type { SelectedFile } from "@/core/files";
import { readBytes } from "@/core/media/client";

/**
 * URL objet locale d'un fichier sélectionné (glisser-déposer ou disque).
 *
 * Un fichier choisi par la boîte de dialogue native n'a pas de handle
 * navigateur : ses octets sont alors relus localement. L'URL est révoquée dès
 * que le fichier change ou que le composant disparaît — aucune fuite mémoire
 * entre deux aperçus.
 */
export function useFileUrl(file: SelectedFile | undefined, mimeType?: string): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    let revoked = false;
    let current: string | undefined;
    if (!file) {
      setUrl(undefined);
      return;
    }

    (async () => {
      const blob =
        file.file ??
        new Blob([(await readBytes(file)).slice().buffer as ArrayBuffer], {
          type: mimeType ?? `video/${file.extension || "mp4"}`,
        });
      if (revoked) return;
      current = URL.createObjectURL(blob);
      setUrl(current);
    })().catch(() => setUrl(undefined));

    return () => {
      revoked = true;
      if (current) URL.revokeObjectURL(current);
      setUrl(undefined);
    };
  }, [file, mimeType]);

  return url;
}
