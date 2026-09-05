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

interface FileDropZoneProps {
  /** Contraintes issues de la définition de l'outil (`constraintsForTool`). */
  constraints: FileConstraints;
  files: SelectedFile[];
  onChange: (files: SelectedFile[]) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
  /**
   * `standard` quand le dépôt est le cœur de l'outil ; `compact` dès qu'il
   * n'est qu'une étape parmi d'autres — une zone haute de 120 px répétée sur
   * cent écrans finit par pousser tous les réglages sous la ligne de flottaison.
   */
  variant?: "standard" | "compact";
  /**
   * Masque la liste des fichiers retenus, quand l'écran en affiche déjà une
   * plus riche (pages, réordonnancement, déverrouillage). Deux listes du même
   * fichier l'une sous l'autre ne disent pas deux fois plus de choses.
   */
  showFileList?: boolean;
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
  variant = "standard",
  showFileList = true,
}: FileDropZoneProps) {
  const inputId = useId();
  const [isDragging, setDragging] = useState(false);
  const multiple = (constraints.maxFiles ?? Number.POSITIVE_INFINITY) > 1;
  // Une fois le fichier choisi, la zone a fait son travail : elle se réduit
  // pour laisser la place aux réglages et au résultat.
  const compact = variant === "compact" || files.length > 0;

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
          "flex cursor-pointer rounded-[var(--radius-card)] border border-dashed transition-colors",
          disabled && "pointer-events-none opacity-50",
          compact
            ? "items-center gap-2.5 px-3 py-2.5 text-left"
            : "flex-col items-center justify-center gap-1.5 px-6 py-6 text-center",
          isDragging
            ? "border-[var(--ft-accent)] bg-[var(--ft-accent-quiet)]"
            : "border-[var(--ft-border-strong)] bg-[var(--ft-surface)] hover:border-[var(--ft-accent)] hover:bg-[var(--ft-hover)]",
        )}
      >
        <span className="shrink-0 text-[var(--ft-text-faint)]">
          <Icon name="UploadCloud" size={compact ? 15 : 18} />
        </span>
        <span className={compact ? "min-w-0 flex-1" : "contents"}>
          <span className="block text-[13px] font-medium text-[var(--ft-text)]">{label}</span>
          <span className="ft-meta block">
            ou <span className="text-[var(--ft-accent-text)]">parcourir vos fichiers</span>
            {compact && hint && <span className="text-[var(--ft-text-faint)]"> · {hint}</span>}
          </span>
        </span>
        {!compact && hint && (
          <span className="text-[11.5px] text-[var(--ft-text-faint)]">{hint}</span>
        )}
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

      {showFileList && files.length > 0 && (
        <ul className="mt-2 divide-y divide-[var(--ft-rule)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-2.5 px-2.5 py-1.5">
              <Icon name="File" size={14} className="shrink-0 text-[var(--ft-text-faint)]" />
              <span className="min-w-0 flex-1 truncate text-[13px]">{file.name}</span>
              <span className="ft-value shrink-0 uppercase text-[var(--ft-text-faint)]">
                {file.extension || file.kind}
              </span>
              <span className="ft-value shrink-0 text-[var(--ft-text-muted)]">
                {formatFileSize(file.size)}
              </span>
              <button
                type="button"
                aria-label={`Retirer ${file.name}`}
                onClick={() => removeAt(file.id)}
                className="shrink-0 rounded-[var(--radius-sm)] p-0.5 text-[var(--ft-text-faint)] hover:text-[var(--ft-danger)]"
              >
                <Icon name="X" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

    </div>
  );
}
