import { useEffect, useRef, useState } from "react";
import type { RasterCanvas } from "@/core/pdf/raster/types";

/**
 * Régénère l'aperçu d'un traitement à chaque changement de réglage.
 *
 * On applique la transformation sur le canvas d'aperçu (réduit), on encode en
 * PNG et on expose une URL objet affichée dans un simple <img> — conformément à
 * l'approche anti-artefacts WebKitGTK : aucune surface canvas visible et
 * persistante. Les URL précédentes sont révoquées, et un court anti-rebond
 * évite d'encoder à chaque pixel de déplacement d'un curseur.
 */
export function useProcessedPreview(
  source: RasterCanvas | undefined,
  transform: (canvas: RasterCanvas) => RasterCanvas | Promise<RasterCanvas>,
  deps: readonly unknown[],
  delay = 60,
): string | undefined {
  const [url, setUrl] = useState<string | undefined>();
  const urlRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await transform(source);
        const bytes = await result.encode("png");
        if (cancelled) return;
        const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "image/png" });
        const next = URL.createObjectURL(blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = next;
        setUrl(next);
      } catch {
        // Un aperçu qui échoue ne doit jamais bloquer l'outil.
      }
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, ...deps]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  return url;
}
