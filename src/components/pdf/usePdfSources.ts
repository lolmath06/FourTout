import { useCallback, useEffect, useRef, useState } from "react";
import type { SelectedFile } from "@/core/files";
import { inspectPdf } from "@/core/pdf/document";
import { isPdfError, toPdfError } from "@/core/pdf/errors";
import type { PdfInfo, PdfSource } from "@/core/pdf/types";

/**
 * Charge les fichiers déposés en mémoire et les décrit.
 *
 * Chaque PDF est réellement ouvert dès son ajout : l'utilisateur apprend
 * immédiatement combien de pages il contient, ou qu'il est protégé, au lieu de
 * découvrir le problème après avoir réglé toute l'opération.
 */

export interface LoadedPdf {
  id: string;
  name: string;
  source: PdfSource;
  info?: PdfInfo;
  /** Message d'erreur si le fichier n'est pas exploitable. */
  error?: string;
  /** Un mot de passe est nécessaire pour aller plus loin. */
  needsPassword: boolean;
}

export function usePdfSources(files: SelectedFile[]) {
  const [loaded, setLoaded] = useState<LoadedPdf[]>([]);
  const [isLoading, setLoading] = useState(false);
  const cache = useRef(new Map<string, LoadedPdf>());

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (files.length === 0) {
        setLoaded([]);
        return;
      }
      setLoading(true);

      const results: LoadedPdf[] = [];
      for (const file of files) {
        const cached = cache.current.get(file.id);
        if (cached) {
          results.push(cached);
          continue;
        }

        const entry = await describe(file);
        cache.current.set(file.id, entry);
        results.push(entry);
      }

      if (!cancelled) {
        setLoaded(results);
        setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [files]);

  /** Réessaie l'ouverture d'un document protégé avec le mot de passe fourni. */
  const unlock = useCallback(async (id: string, password: string): Promise<boolean> => {
    const entry = cache.current.get(id);
    if (!entry) return false;

    try {
      const source = { ...entry.source, password };
      const info = await inspectPdf(source);
      const updated: LoadedPdf = { ...entry, source, info, needsPassword: false, error: undefined };
      cache.current.set(id, updated);
      setLoaded((current) => current.map((item) => (item.id === id ? updated : item)));
      return true;
    } catch (error) {
      const message = toPdfError(error).shortMessage;
      setLoaded((current) =>
        current.map((item) => (item.id === id ? { ...item, error: message } : item)),
      );
      return false;
    }
  }, []);

  const reset = useCallback(() => {
    cache.current.clear();
    setLoaded([]);
  }, []);

  return { loaded, isLoading, unlock, reset };
}

async function describe(file: SelectedFile): Promise<LoadedPdf> {
  const base = { id: file.id, name: file.name };
  try {
    const bytes = new Uint8Array(await readBytes(file));
    const source: PdfSource = { name: file.name, bytes };
    const info = await inspectPdf(source);
    return { ...base, source, info, needsPassword: info.encrypted };
  } catch (error) {
    const pdfError = toPdfError(error);
    return {
      ...base,
      source: { name: file.name, bytes: new Uint8Array(0) },
      error: pdfError.shortMessage,
      needsPassword: isPdfError(error) && error.code === "encrypted",
    };
  }
}

async function readBytes(file: SelectedFile): Promise<ArrayBuffer> {
  if (file.file) return file.file.arrayBuffer();
  throw new Error("Fichier illisible");
}
