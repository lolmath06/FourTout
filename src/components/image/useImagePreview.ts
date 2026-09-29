import { useEffect, useRef, useState } from "react";
import type { SelectedFile } from "@/core/files";

/**
 * Charge un fichier image en URL objet et renvoie ses dimensions naturelles.
 *
 * Objectif : que chaque outil n'ait pas à réécrire le chargement, la lecture
 * des dimensions, la libération de l'URL et la gestion d'erreur. L'URL est
 * révoquée dès que le fichier change ou que le composant est démonté.
 */
export interface ImagePreviewState {
  url?: string;
  width: number;
  height: number;
  loading: boolean;
  error?: string;
}

export function useImagePreview(file: SelectedFile | undefined): ImagePreviewState {
  const [state, setState] = useState<ImagePreviewState>({ width: 0, height: 0, loading: false });
  const urlRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = undefined;
    }
    if (!file?.file) {
      setState({ width: 0, height: 0, loading: false });
      return;
    }
    const url = URL.createObjectURL(file.file);
    urlRef.current = url;
    setState({ url, width: 0, height: 0, loading: true });

    const image = new Image();
    image.onload = () => {
      setState({ url, width: image.naturalWidth, height: image.naturalHeight, loading: false });
    };
    image.onerror = () => {
      setState({ url, width: 0, height: 0, loading: false, error: "Aperçu indisponible" });
    };
    image.src = url;

    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = undefined;
      }
    };
  }, [file]);

  return state;
}
