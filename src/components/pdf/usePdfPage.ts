import { useEffect, useRef, useState } from "react";
import type { PdfSource } from "@/core/pdf/types";
import { renderPageForEditor } from "@/core/pdf/operations/toImages";
import { toPdfError } from "@/core/pdf/errors";

/**
 * Rend une page de PDF en image affichable, avec ses dimensions en points.
 *
 * Réutilisé par les outils visuels (caviardage, ajout de texte, ajout d'image).
 * Le rendu est un PNG statique affiché via un `<img>` — conformément à
 * l'approche anti-artefacts WebKitGTK, aucune surface canvas persistante.
 */
export interface PdfPageState {
  url?: string;
  widthPx: number;
  heightPx: number;
  widthPts: number;
  heightPts: number;
  loading: boolean;
  error?: string;
}

export function usePdfPage(source: PdfSource | undefined, page: number, targetWidth = 900): PdfPageState {
  const [state, setState] = useState<PdfPageState>({ widthPx: 0, heightPx: 0, widthPts: 0, heightPts: 0, loading: false });
  const urlRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (!source || source.bytes.length === 0) {
      setState({ widthPx: 0, heightPx: 0, widthPts: 0, heightPts: 0, loading: false });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: undefined }));
    (async () => {
      try {
        const render = await renderPageForEditor(source, page, targetWidth);
        if (cancelled) return;
        const blob = new Blob([render.png.slice().buffer as ArrayBuffer], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = url;
        setState({
          url,
          widthPx: render.widthPx,
          heightPx: render.heightPx,
          widthPts: render.widthPts,
          heightPts: render.heightPts,
          loading: false,
        });
      } catch (error) {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: toPdfError(error).message }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, page, targetWidth]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  return state;
}
