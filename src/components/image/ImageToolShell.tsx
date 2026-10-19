import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
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
import { Callout, ProgressBar } from "@/components/ui/Callout";
import { detectAnimation } from "@/core/image/native";
import { setHandoff, useHandoff } from "@/features/handoff/store";
import { toolRoute } from "@/core/tools/types";
import { t, tx } from "@/i18n";

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
  const animated = useAnimatedFiles(files);
  const navigate = useNavigate();

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
        result.files.length > 1 ? t("{count} fichiers prêts", { count: result.files.length }) : t("Fichier prêt"),
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
        label={selection === "multiple" ? t("Déposez vos images ici") : t("Déposez votre image ici")}
        hint={tx(hint)}
        disabled={job.isRunning}
      />

      {animated.length > 0 && (
        <Callout
          tone="warning"
          title={t("Image animée : seule la première image sera traitée")}
          data-testid="animated-warning"
          actions={
            <Button
              size="sm"
              onClick={() => {
                setHandoff({ toolId: "animated-image-convert" });
                navigate(toolRoute("animated-image-convert"));
              }}
            >
              {t("Convertir en gardant l'animation")}
            </Button>
          }
        >
          {t("{names} contient plusieurs images. Cet outil travaille sur une image fixe : l'animation serait perdue. Pour la garder, utilisez « Convertir une image animée ».", { names: animated.join(", ") })}
        </Callout>
      )}

      {files.length > 0 && children?.(files)}

      {files.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ft-border)] pt-4">
          <p className="text-xs text-[var(--ft-text-muted)]">
            {t("{count} {count, plural, one {image} other {images}} · {size}", { count: files.length, size: formatFileSize(totalBytes) })}
          </p>
          <div className="flex items-center gap-2">
            {job.isRunning && (
              <Button size="sm" variant="ghost" onClick={job.cancel}>
                {t("Annuler")}
              </Button>
            )}
            <Button size="md" variant="primary" onClick={execute} disabled={!canRun}>
              {job.isRunning ? (
                <>
                  <Icon name="Loader" size={15} className="animate-spin" />
                  {job.progress.label ?? t("Traitement…")}
                </>
              ) : (
                <>
                  <Icon name="Play" size={15} />
                  {tx(actionLabel)}
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {job.isRunning && <ProgressBar ratio={job.progress.ratio} label={tx(job.progress.label)} />}

      {errorMessage && job.status === "error" && (
        <Callout tone="error" title={t("L'opération a échoué")}>
          {errorMessage}
        </Callout>
      )}

      {outcome && <ResultPanel outcome={outcome} />}
    </div>
  );
}

/** Noms des fichiers déposés qui sont des WebP ou PNG animés (lecture des premiers octets). */
function useAnimatedFiles(files: SelectedFile[]): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const found: string[] = [];
      for (const file of files) {
        if (!file.file || (file.extension !== "webp" && file.extension !== "png" && file.extension !== "apng")) continue;
        try {
          const head = new Uint8Array(await file.file.slice(0, 65536).arrayBuffer());
          if (detectAnimation(head)) found.push(file.name);
        } catch {
          /* illisible : le traitement le dira */
        }
      }
      if (alive) setNames(found);
    })();
    return () => {
      alive = false;
    };
  }, [files]);
  return names;
}
