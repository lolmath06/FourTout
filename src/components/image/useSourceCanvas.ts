import { useEffect, useState } from "react";
import type { SelectedFile } from "@/core/files";
import type { RasterCanvas } from "@/core/pdf/raster/types";
import { decodeOriented, readSelectedFile } from "@/core/image/codec";
import { resize } from "@/core/image/operations";
import { toImageError } from "@/core/image/errors";

/**
 * Décode une image (redressée EXIF) en deux canvas : la pleine résolution pour
 * l'export, et une version réduite pour les aperçus en temps réel. Régénérer un
 * aperçu à chaque déplacement de curseur sur une réduction à ~1200 px reste
 * fluide, tandis que le fichier produit garde la résolution d'origine.
 */
const PREVIEW_MAX = 1200;

export interface SourceCanvasState {
  full?: RasterCanvas;
  preview?: RasterCanvas;
  width: number;
  height: number;
  loading: boolean;
  error?: string;
}

export function useSourceCanvas(file: SelectedFile | undefined): SourceCanvasState {
  const [state, setState] = useState<SourceCanvasState>({ width: 0, height: 0, loading: false });

  useEffect(() => {
    let cancelled = false;
    if (!file) {
      setState({ width: 0, height: 0, loading: false });
      return;
    }
    setState({ width: 0, height: 0, loading: true });
    (async () => {
      try {
        const bytes = await readSelectedFile(file);
        const { canvas } = await decodeOriented(bytes, file.extension);
        if (cancelled) return;
        const scale = Math.min(1, PREVIEW_MAX / Math.max(canvas.width, canvas.height));
        const preview = scale < 1 ? resize(canvas, canvas.width * scale, canvas.height * scale) : canvas;
        setState({ full: canvas, preview, width: canvas.width, height: canvas.height, loading: false });
      } catch (error) {
        if (!cancelled) setState({ width: 0, height: 0, loading: false, error: toImageError(error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  return state;
}
