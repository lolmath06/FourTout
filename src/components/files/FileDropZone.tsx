import clsx from "clsx";
import { useCallback, useId, useState } from "react";
import {
  acceptAttribute,
  formatFileSize,
  validateSelection,
  type FileConstraints,
  type SelectedFile,
} from "@/core/files";
import { notify } from "@/features/notifications/store";
import { Icon } from "@/components/ui/Icon";
import { PrivacyNote } from "@/components/ui/PrivacyNote";

interface FileDropZoneProps {
  /** Contraintes issues de la définition de l'outil (`constraintsForTool`). */
  constraints: FileConstraints;
  files: SelectedFile[];
  onChange: (files: SelectedFile[]) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Zone de dépôt réutilisable par tous les futurs outils manipulant des fichiers.
 *
 * Elle gère le glisser-déposer, la sélection via l'explorateur, la validation
 * des types selon les entrées déclarées par l'outil, l'affichage nom/taille/type
 * et le multi-fichiers lorsque l'outil l'autorise. Elle ne fait aucun
 * traitement : c'est l'outil qui décide ce qu'il en fait.
 */
export function FileDropZone({
  constraints,
  files,
  onChange,
  label = "Déposez vos fichiers ici",
  hint,
  disabled = false,
  className,
}: FileDropZoneProps) {
  const inputId = useId();
  const [isDragging, setDragging] = useState(false);
  const multiple = (constraints.maxFiles ?? Number.POSITIVE_INFINITY) > 1;

  const addFiles = useCallback(
    (incoming: FileList | null) => {
      if (!incoming || incoming.length === 0) return;
      const { accepted, rejected } = validateSelection(
        Array.from(incoming),
        constraints,
        multiple ? files.length : 0,
      );

      if (rejected.length > 0) {
        notify.warning(
          rejected.length === 1
            ? `« ${rejected[0].name} » n'a pas été ajouté`
            : `${rejected.length} fichiers ignorés`,
          rejected[0].reason,
        );
      }
      if (accepted.length === 0) return;
      onChange(multiple ? [...files, ...accepted] : accepted.slice(0, 1));
    },
    [constraints, files, multiple, onChange],
  );

  const removeAt = (id: string) => onChange(files.filter((file) => file.id !== id));

  return (
    <div className={className}>
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) addFiles(event.dataTransfer.files);
        }}
        className={clsx(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-card)]",
          "border border-dashed px-6 py-10 text-center transition-colors",
          disabled && "pointer-events-none opacity-50",
          isDragging
            ? "border-[var(--ft-accent)] bg-[var(--ft-accent-soft)]"
            : "border-[var(--ft-border-strong)] bg-[var(--ft-surface)] hover:border-[var(--ft-accent)]",
        )}
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-[var(--ft-surface-2)] text-[var(--ft-text-muted)]">
          <Icon name="UploadCloud" size={20} />
        </span>
        <span className="text-sm font-medium text-[var(--ft-text)]">{label}</span>
        <span className="text-xs text-[var(--ft-text-muted)]">
          ou <span className="text-[var(--ft-accent-text)] underline">parcourir vos fichiers</span>
        </span>
        {hint && <span className="text-xs text-[var(--ft-text-faint)]">{hint}</span>}
        <input
          id={inputId}
          type="file"
          className="sr-only"
          multiple={multiple}
          accept={acceptAttribute(constraints.inputs)}
          disabled={disabled}
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </label>

      {files.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-2.5 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface)] px-2.5 py-2"
            >
              <Icon name="File" size={15} className="shrink-0 text-[var(--ft-text-faint)]" />
              <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
              <span className="shrink-0 font-mono text-xs uppercase text-[var(--ft-text-faint)]">
                {file.extension || file.kind}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-[var(--ft-text-muted)]">
                {formatFileSize(file.size)}
              </span>
              <button
                type="button"
                aria-label={`Retirer ${file.name}`}
                onClick={() => removeAt(file.id)}
                className="shrink-0 rounded p-0.5 text-[var(--ft-text-faint)] hover:text-[var(--ft-danger)]"
              >
                <Icon name="X" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <PrivacyNote className="mt-3" />
    </div>
  );
}
