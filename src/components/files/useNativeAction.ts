import { useState } from "react";
import { useJob } from "@/core/jobs";
import type { OperationContext } from "@/core/pdf/types";
import { isFilesEngineAvailable } from "@/core/files/native";

/**
 * Exécution d'une opération native dans un outil qui compose lui-même sa
 * sélection.
 *
 * `NativeToolShell` couvre le cas courant — un sélecteur, un bouton, un
 * résultat. Les outils de la phase 9 ont souvent deux sélections (comparaison,
 * synchronisation) ou deux étapes (plan puis exécution) ; ils ont donc besoin
 * de la même mécanique — progression réelle, annulation réelle, erreur lisible —
 * sans la mise en page imposée. C'est exactement ce que ce module fournit, et
 * rien de plus.
 */
export function useNativeAction<TResult>() {
  const job = useJob<TResult>();
  const [result, setResult] = useState<TResult | null>(null);

  const execute = async (
    runner: (context: OperationContext) => Promise<TResult>,
  ): Promise<TResult | undefined> => {
    setResult(null);
    const outcome = await job.run((context) =>
      runner({ report: context.report, signal: context.signal }),
    );
    if (outcome !== undefined) setResult(outcome);
    return outcome;
  };

  const message =
    job.status === "error" && job.error
      ? job.error.cause instanceof Error
        ? job.error.cause.message
        : job.error.message
      : undefined;

  return { job, result, setResult, execute, error: message };
}

/** Les outils de cette famille exigent l'application installée. */
export function isNativeAvailable(): boolean {
  return isFilesEngineAvailable();
}
