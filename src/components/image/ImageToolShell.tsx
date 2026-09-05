import { useState, type ReactNode } from "react";
import type { ToolDefinition } from "@/core/tools/types";
import { constraintsForTool, formatFileSize, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useJob } from "@/core/jobs";
import { toImageError } from "@/core/image/errors";
import type { OperationContext } from "@/core/pdf/types";
import { notify } from "@/features/notifications/store";
import { ResultPanel, type OperationOutcome } from "@/components/pdf/ResultPanel";
import { useHandoff } from "@/features/handoff/store";

/**
 * Ossature commune aux outils Image « par lot » (conversion, compression,
 * redimensionnement, rotation, niveaux de gris, métadonnées…).
 *
 * Elle reprend le contrat éprouvé des outils PDF : dépôt des fichiers, réglages
 * propres à l'outil, exécution avec progression et annulation, erreurs et
 * panneau de résultat — pour une expérience identique d'un outil à l'autre.
 */
export interface ImageToolRunArgs {
  files: SelectedFile[];
  context: OperationContext;
}

export interface ImageToolShellProps {
  tool: ToolDefinition;
  selection?: "single" | "multiple";
  children?: (files: SelectedFile[]) => ReactNode;
  actionLabel: string;
  actionDisabled?: boolean;
  run: (args: ImageToolRunArgs) => Promise<OperationOutcome>;
  hint?: string;
}

export function ImageToolShell({
  tool,
  selection = "multiple",
  children,
  actionLabel,
  actionDisabled = false,
  run,
  hint,
}: ImageToolShellProps) {
  // Le convertisseur universel (et tout autre outil qui passe le relais) peut
  // nous transmettre le fichier déjà choisi : l'utilisateur ne le redépose pas.
  const handoff = useHandoff(tool.id);
  const [files, setFiles] = useState<SelectedFile[]>(() => handoff?.files ?? []);
  const [outcome, setOutcome] = useState<OperationOutcome | null>(null);
  const job = useJob<OperationOutcome>();

  const constraints = {
    ...constraintsForTool(tool),
    maxFiles: selection === "single" ? 1 : undefined,
  };
  const canRun = files.length > 0 && !actionDisabled && !job.isRunning;

  const execute = async () => {
    setOutcome(null);
    const result = await job.run((context) =>
      run({ files, context: { report: context.report, signal: context.signal } }),
    );
    if (result) {
      setOutcome(result);
      notify.success(
        result.files.length > 1 ? `${result.files.length} fichiers prêts` : "Fichier prêt",
        result.summary,
      );
    }
  };

  const errorMessage = job.error ? toImageError(job.error.cause).message : undefined;
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="space-y-4">
      <FileDropZone
        constraints={constraints}
        files={files}
        onChange={setFiles}
        label={selection === "multiple" ? "Déposez vos images ici" : "Déposez votre image ici"}
        hint={hint}
        disabled={job.isRunning}
      />

      {files.length > 0 && children?.(files)}

      {files.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ft-border)] pt-4">
          <p className="text-xs text-[var(--ft-text-muted)]">
            {files.length} image{files.length > 1 ? "s" : ""} · {formatFileSize(totalBytes)}
          </p>
          <div className="flex items-center gap-2">
            {job.isRunning && (
              <Button size="sm" variant="ghost" onClick={job.cancel}>
                Annuler
              </Button>
            )}
            <Button size="md" variant="primary" onClick={execute} disabled={!canRun}>
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
