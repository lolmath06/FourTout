import { useCallback, useState, type ReactNode } from "react";
import type { ToolDefinition } from "@/core/tools/types";
import { constraintsForTool, formatFileSize, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useJob } from "@/core/jobs";
import { toPdfError } from "@/core/pdf/errors";
import type { OperationContext } from "@/core/pdf/types";
import { notify } from "@/features/notifications/store";
import { usePdfSources, type LoadedPdf } from "./usePdfSources";
import { PdfSourceList } from "./PdfSourceList";
import { ResultPanel, type OperationOutcome } from "./ResultPanel";
import { useHandoff } from "@/features/handoff/store";

/**
 * Ossature commune à tous les outils PDF.
 *
 * Elle prend en charge ce qui est identique partout — dépôt des fichiers,
 * ouverture et description des documents, mot de passe, exécution avec
 * progression et annulation, erreurs, affichage du résultat — et laisse à
 * chaque outil uniquement ses propres réglages. C'est ce qui garantit une
 * expérience cohérente d'un outil à l'autre, et ce qui rend l'ajout d'une
 * nouvelle opération rapide.
 */

export interface PdfToolRunArgs {
  documents: LoadedPdf[];
  context: OperationContext;
}

export interface PdfToolShellProps {
  tool: ToolDefinition;
  /** Nombre de fichiers attendus ; `multiple` autorise le lot. */
  selection?: "single" | "multiple";
  /** Réglages propres à l'outil, affichés une fois les fichiers valides. */
  children?: (documents: LoadedPdf[]) => ReactNode;
  /** Libellé du bouton principal. */
  actionLabel: string;
  /** Désactive l'action, par exemple si un réglage est incomplet. */
  actionDisabled?: boolean;
  /** L'opération elle-même. */
  run: (args: PdfToolRunArgs) => Promise<OperationOutcome>;
  /** Autorise le lancement même si certains documents sont en erreur. */
  allowPartial?: boolean;
  /** Consigne affichée sous la zone de dépôt. */
  hint?: string;
  /** L'ordre des fichiers compte-t-il ? Affiche alors les flèches de tri. */
  reorderable?: boolean;
  /**
   * Accepte un document encore protégé. Réservé aux outils qui gèrent
   * eux-mêmes le mot de passe, comme le déverrouillage : ailleurs, un document
   * chiffré doit être ouvert avant toute opération.
   */
  acceptProtected?: boolean;
}

export function PdfToolShell({
  tool,
  selection = "single",
  children,
  actionLabel,
  actionDisabled = false,
  run,
  allowPartial = false,
  hint,
  reorderable = false,
  acceptProtected = false,
}: PdfToolShellProps) {
  // Le convertisseur universel (et tout autre outil qui passe le relais) peut
  // nous transmettre le fichier déjà choisi : l'utilisateur ne le redépose pas.
  const handoff = useHandoff(tool.id);
  const [files, setFiles] = useState<SelectedFile[]>(() => handoff?.files ?? []);
  const [outcome, setOutcome] = useState<OperationOutcome | null>(null);
  const { loaded, isLoading, unlock } = usePdfSources(files);
  const job = useJob<OperationOutcome>();

  const constraints = {
    ...constraintsForTool(tool),
    maxFiles: selection === "single" ? 1 : undefined,
  };

  const usable = loaded.filter(
    (item) => !item.error && (acceptProtected || !item.needsPassword),
  );
  const blocked = loaded.filter(
    (item) => item.error || (!acceptProtected && item.needsPassword),
  );
  const canRun =
    usable.length > 0 &&
    (allowPartial || blocked.length === 0) &&
    (selection === "single" || usable.length >= 1) &&
    !actionDisabled &&
    !isLoading;

  const move = useCallback((id: string, direction: -1 | 1) => {
    setFiles((current) => {
      const index = current.findIndex((file) => file.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setFiles((current) => current.filter((file) => file.id !== id));
  }, []);

  const execute = async () => {
    setOutcome(null);
    const result = await job.run(async (context) =>
      run({
        documents: usable,
        context: { report: context.report, signal: context.signal },
      }),
    );
    if (result) {
      setOutcome(result);
      notify.success(
        result.files.length > 1
          ? `${result.files.length} fichiers prêts`
          : "Fichier prêt",
        result.summary,
      );
    }
  };

  const errorMessage = job.error ? toPdfError(job.error.cause).message : undefined;

  return (
    <div className="space-y-4">
      <FileDropZone
        constraints={constraints}
        files={files}
        onChange={setFiles}
        label={selection === "multiple" ? "Déposez vos PDF ici" : "Déposez votre PDF ici"}
        hint={hint}
        disabled={job.isRunning}
      />

      {loaded.length > 0 && (
        <PdfSourceList
          documents={loaded}
          onMove={reorderable && files.length > 1 ? move : undefined}
          onRemove={job.isRunning ? undefined : remove}
          onUnlock={acceptProtected ? undefined : unlock}
        />
      )}

      {usable.length > 0 && children?.(usable)}

      {usable.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ft-border)] pt-4">
          <p className="text-xs text-[var(--ft-text-muted)]">
            {usable.length} document{usable.length > 1 ? "s" : ""} ·{" "}
            {formatFileSize(usable.reduce((total, item) => total + item.source.bytes.length, 0))}
          </p>
          <div className="flex items-center gap-2">
            {job.isRunning && (
              <Button size="sm" variant="ghost" onClick={job.cancel}>
                Annuler
              </Button>
            )}
            <Button size="md" variant="primary" onClick={execute} disabled={!canRun || job.isRunning}>
              {job.isRunning ? (
                <>
                  <Icon name="Loader" size={15} className="animate-spin" />
                  {job.progress.label ?? "Traitement…"}
                </>
              ) : (
                <>
                  <Icon name="Play" size={15} />
                  {actionLabel}
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {job.isRunning && (
        <div className="h-1 overflow-hidden rounded-full bg-[var(--ft-surface-2)]">
          <div
            className="h-full rounded-full bg-[var(--ft-accent)] transition-[width]"
            style={{ width: `${Math.round((job.progress.ratio ?? 0) * 100)}%` }}
          />
        </div>
      )}

      {errorMessage && job.status === "error" && (
        <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-[var(--ft-danger)] bg-[color-mix(in_oklch,var(--ft-danger)_8%,transparent)] px-3 py-2.5 text-sm text-[var(--ft-danger)]">
          <Icon name="CircleAlert" size={16} className="mt-0.5 shrink-0" />
          {errorMessage}
        </p>
      )}

      {outcome && <ResultPanel outcome={outcome} />}
    </div>
  );
}
