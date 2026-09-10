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
  /**
   * Fichiers produits. La liste peut être **vide** : certaines opérations
   * aboutissent à un résultat que l'on relit et corrige à l'écran avant de
   * choisir quoi exporter — l'extraction de tableaux, par exemple. Le panneau
   * annonce alors la réussite sans proposer d'enregistrement, l'export étant
   * offert par l'outil lui-même.
   */
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
  const empty = outcome.files.length === 0;

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
    <div
      className="rounded-[var(--radius-card)] border border-l-2 border-[var(--ft-border)] bg-[var(--ft-surface)]"
      style={{ borderLeftColor: "var(--ft-ok)" }}
    >
      <div className="flex items-start gap-2 border-b border-[var(--ft-rule)] px-3 py-2">
        <span className="mt-px shrink-0 text-[var(--ft-ok)]">
          <Icon name="CircleCheck" size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-5">
            {empty
              ? "Opération terminée"
              : many
                ? `${outcome.files.length} fichiers produits`
                : "Fichier produit"}
          </p>
          {outcome.summary && <p className="ft-meta mt-0.5">{outcome.summary}</p>}
          {outcome.warning && (
            <p className="mt-1 flex items-start gap-1.5 text-[11.5px] leading-4 text-[var(--ft-warn)]">
              <Icon name="TriangleAlert" size={12} className="mt-0.5 shrink-0" />
              {outcome.warning}
            </p>
          )}
        </div>
        {!empty && (
          <span className="ft-value shrink-0 text-[var(--ft-text-faint)]">
            {formatFileSize(total)}
          </span>
        )}
      </div>

      {/* Les fichiers produits sont une donnée technique : une table, pas des cartes. */}
      <ul className="max-h-52 divide-y divide-[var(--ft-rule)] overflow-y-auto">
        {outcome.files.map((file) => (
          <li key={file.name} className="ft-row-py flex items-center gap-2.5 px-3">
            <Icon name="File" size={13} className="shrink-0 text-[var(--ft-text-faint)]" />
            <span className="min-w-0 flex-1 truncate text-[13px]">{file.name}</span>
            <span className="ft-value shrink-0 text-[var(--ft-text-muted)]">
              {formatFileSize(file.bytes.length)}
            </span>
          </li>
        ))}
      </ul>

      {!empty && (
      <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--ft-rule)] px-3 py-2">
        <Button size="sm" variant="primary" onClick={() => persist(false)} disabled={busy}>
          <Icon name="HardDrive" size={13} />
          {many ? "Enregistrer dans un dossier" : "Enregistrer"}
        </Button>

        {many && (
          <Button size="sm" onClick={() => persist(true)} disabled={busy}>
            <Icon name="FolderArchive" size={13} />
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
              <Icon name="FolderTree" size={13} />
              Ouvrir le dossier
            </Button>
            {!many && (
              <Button size="sm" variant="ghost" onClick={() => void openFile(savedPath)}>
                <Icon name="Play" size={13} />
                Ouvrir le fichier
              </Button>
            )}
          </>
        )}
      </div>
      )}
    </div>
  );
}
