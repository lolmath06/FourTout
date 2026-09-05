import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { PathPicker, type PathPickerProps } from "./PathPicker";
import { useJob } from "@/core/jobs";
import type { OperationContext } from "@/core/pdf/types";
import { isFilesEngineAvailable, NATIVE_REQUIRED } from "@/core/files/native";
import { notify } from "@/features/notifications/store";
import { Callout, ProgressBar } from "@/components/ui/Callout";

/**
 * Ossature commune aux outils Fichiers travaillant sur des chemins.
 *
 * Elle apporte ce qui est identique partout : la sélection native, l'exécution
 * avec progression et annulation **réelles** (le travail natif s'arrête, il
 * n'est pas simplement ignoré), le message d'erreur, et le repli explicite
 * quand l'application installée est requise.
 */
export interface NativeToolShellProps<TResult> {
  picker: Omit<PathPickerProps, "disabled">;
  /** Réglages propres à l'outil, affichés une fois la sélection faite. */
  children?: ReactNode;
  actionLabel: string;
  actionIcon?: string;
  actionDisabled?: boolean;
  run: (context: OperationContext) => Promise<TResult>;
  /** Rendu du résultat. */
  renderResult: (result: TResult) => ReactNode;
  /** Message de succès affiché en notification. */
  successMessage?: (result: TResult) => string;
  /** Contenu affiché même sans sélection (aide, avertissement). */
  footer?: ReactNode;
}

export function NativeToolShell<TResult>({
  picker,
  children,
  actionLabel,
  actionIcon = "Play",
  actionDisabled = false,
  run,
  renderResult,
  successMessage,
  footer,
}: NativeToolShellProps<TResult>) {
  const job = useJob<TResult>();
  const [result, setResult] = useState<TResult | null>(null);

  if (!isFilesEngineAvailable()) {
    return (
      <Callout tone="info" title="Application installée requise">
        {NATIVE_REQUIRED}
      </Callout>
    );
  }

  const execute = async () => {
    setResult(null);
    const outcome = await job.run((context) =>
      run({ report: context.report, signal: context.signal }),
    );
    if (outcome !== undefined) {
      setResult(outcome);
      if (successMessage) notify.success("Terminé", successMessage(outcome));
    }
  };

  const errorMessage =
    job.status === "error" && job.error
      ? job.error.cause instanceof Error
        ? job.error.cause.message
        : job.error.message
      : undefined;

  return (
    <div className="space-y-4">
      <PathPicker {...picker} disabled={job.isRunning} />

      {picker.paths.length > 0 && children}

      {picker.paths.length > 0 && (
        <div className="flex items-center justify-end gap-2 border-t border-[var(--ft-border)] pt-4">
          {job.isRunning && (
            <Button size="sm" variant="ghost" onClick={job.cancel}>
              Annuler
            </Button>
          )}
          <Button
            size="md"
            variant="primary"
            onClick={execute}
            disabled={actionDisabled || job.isRunning}
          >
            {job.isRunning ? (
              <>
                <Icon name="Loader" size={15} className="animate-spin" />
                {job.progress.label ?? "Traitement…"}
              </>
            ) : (
              <>
                <Icon name={actionIcon} size={15} />
                {actionLabel}
              </>
            )}
          </Button>
        </div>
      )}

      {job.isRunning && <ProgressBar ratio={job.progress.ratio} label={job.progress.label} />}

      {job.status === "cancelled" && (
        <Callout tone="neutral" title="Opération annulée">
          Aucun résultat n'a été produit.
        </Callout>
      )}

      {errorMessage && (
        <Callout tone="error" title="L'opération a échoué">
          {errorMessage}
        </Callout>
      )}

      {result !== null && renderResult(result)}
      {footer}
    </div>
  );
}
