import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { PathPicker, type PathPickerProps } from "./PathPicker";
import { useJob } from "@/core/jobs";
import type { OperationContext } from "@/core/pdf/types";
import { isFilesEngineAvailable, NATIVE_REQUIRED } from "@/core/files/native";
import { notify } from "@/features/notifications/store";

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
      <div className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] p-4 text-sm text-[var(--ft-text-muted)]">
        <p className="flex items-center gap-2 font-medium text-[var(--ft-text)]">
          <Icon name="Info" size={16} /> Application installée requise
        </p>
        <p className="mt-1.5">{NATIVE_REQUIRED}</p>
      </div>
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

      {job.isRunning && (
        <div className="space-y-1">
          <div className="h-1 overflow-hidden rounded-full bg-[var(--ft-surface-2)]">
            <div
              className="h-full rounded-full bg-[var(--ft-accent)] transition-[width]"
              style={{ width: `${Math.round((job.progress.ratio ?? 0) * 100)}%` }}
            />
          </div>
          {job.progress.label && (
            <p className="text-xs text-[var(--ft-text-muted)]">{job.progress.label}</p>
          )}
        </div>
      )}

      {job.status === "cancelled" && (
        <p className="flex items-center gap-2 rounded-md border border-[var(--ft-border)] px-3 py-2 text-sm text-[var(--ft-text-muted)]">
          <Icon name="Info" size={15} /> Opération annulée. Aucun résultat n'a été produit.
        </p>
      )}

      {errorMessage && (
        <p className="flex items-start gap-2 rounded-md border border-[var(--ft-danger)] px-3 py-2 text-sm text-[var(--ft-danger)]">
          <Icon name="CircleAlert" size={16} className="mt-px shrink-0" /> {errorMessage}
        </p>
      )}

      {result !== null && renderResult(result)}
      {footer}
    </div>
  );
}
