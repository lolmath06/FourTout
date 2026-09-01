import { useState } from "react";
import { formatFileSize } from "@/core/files";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { isTauri } from "@/core/platform";
import {
  openFile,
  openFolder,
  revealFile,
  saveFile,
  saveFilesAsZip,
  saveFilesToFolder,
} from "@/core/output/save";
import { notify } from "@/features/notifications/store";
import type { OutputFile } from "@/core/pdf/types";

/**
 * Résultat d'une opération.
 *
 * Objectif : que l'utilisateur ne cherche jamais son fichier. Le panneau
 * annonce ce qui a été produit, permet de l'enregistrer, puis d'ouvrir
 * directement le fichier ou son dossier.
 */

export interface OperationOutcome {
  files: OutputFile[];
  /** Phrase récapitulative, propre à l'outil. */
  summary?: string;
  /** Avertissement à afficher malgré la réussite. */
  warning?: string;
  /** Nom de l'archive proposée quand il y a beaucoup de fichiers. */
  zipName?: string;
}

export function ResultPanel({ outcome }: { outcome: OperationOutcome }) {
  const [savedPath, setSavedPath] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const total = outcome.files.reduce((sum, file) => sum + file.bytes.length, 0);
  const many = outcome.files.length > 1;

  const persist = async (asZip: boolean) => {
    setBusy(true);
    try {
      const result = asZip
        ? await saveFilesAsZip(outcome.files, outcome.zipName ?? "fourtout-resultats.zip")
        : many
          ? await saveFilesToFolder(outcome.files)
          : await saveFile(outcome.files[0]);

      if (result.saved) {
        setSavedPath(result.path);
        notify.success(
          result.count > 1 ? `${result.count} fichiers enregistrés` : "Fichier enregistré",
          result.path,
        );
      }
    } catch (error) {
      notify.error(
        "Enregistrement impossible",
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[var(--radius-card)] border border-[color-mix(in_oklch,var(--ft-ok)_45%,var(--ft-border))] bg-[color-mix(in_oklch,var(--ft-ok)_6%,transparent)] p-4">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-[var(--ft-ok)]">
          <Icon name="CircleCheck" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {many ? `${outcome.files.length} fichiers produits` : "Fichier produit"}
          </p>
          {outcome.summary && (
            <p className="mt-0.5 text-xs text-[var(--ft-text-muted)]">{outcome.summary}</p>
          )}
          {outcome.warning && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-[var(--ft-warn)]">
              <Icon name="TriangleAlert" size={13} className="mt-px shrink-0" />
              {outcome.warning}
            </p>
          )}
        </div>
      </div>

      <ul className="mt-3 flex max-h-56 flex-col gap-1 overflow-y-auto">
        {outcome.files.map((file) => (
          <li
            key={file.name}
            className="flex items-center gap-2.5 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface)] px-2.5 py-1.5"
          >
            <Icon name="File" size={14} className="shrink-0 text-[var(--ft-text-faint)]" />
            <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
            <span className="shrink-0 text-xs tabular-nums text-[var(--ft-text-muted)]">
              {formatFileSize(file.bytes.length)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={() => persist(false)} disabled={busy}>
          <Icon name="HardDrive" size={14} />
          {many ? "Enregistrer dans un dossier" : "Enregistrer"}
        </Button>

        {many && (
          <Button size="sm" onClick={() => persist(true)} disabled={busy}>
            <Icon name="FolderArchive" size={14} />
            Enregistrer en ZIP
          </Button>
        )}

        {savedPath && isTauri() && (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => (many ? openFolder(savedPath) : revealFile(savedPath))}
            >
              <Icon name="FolderTree" size={14} />
              Ouvrir le dossier
            </Button>
            {!many && (
              <Button size="sm" variant="ghost" onClick={() => void openFile(savedPath)}>
                <Icon name="Play" size={14} />
                Ouvrir le fichier
              </Button>
            )}
          </>
        )}

        <span className="ml-auto text-xs text-[var(--ft-text-faint)]">
          {formatFileSize(total)} au total
        </span>
      </div>
    </div>
  );
}
