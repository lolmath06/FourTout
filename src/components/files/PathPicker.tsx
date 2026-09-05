import { useEffect, useState } from "react";
import clsx from "clsx";
import { Icon } from "@/components/ui/Icon";
import { notify } from "@/features/notifications/store";
import { isTauri } from "@/core/platform";
import { pickDirectory, pickFiles } from "@/core/files/native";
import { baseName, directoryName, shortenPath } from "@/core/files/paths";

/**
 * Sélection de **chemins** pour les outils Fichiers.
 *
 * Les outils qui hachent, archivent ou analysent travaillent sur des chemins,
 * pas sur des octets : cette zone remplace donc `FileDropZone` pour eux. Elle
 * ouvre les boîtes de dialogue natives et accepte le glisser-déposer de
 * l'application (qui, lui, fournit de vrais chemins — contrairement au
 * glisser-déposer HTML, qui n'expose que le contenu).
 */
export interface PathPickerProps {
  mode: "files" | "directory";
  paths: string[];
  onChange: (paths: string[]) => void;
  multiple?: boolean;
  label?: string;
  hint?: string;
  disabled?: boolean;
  filters?: { name: string; extensions: string[] }[];
}

export function PathPicker({
  mode,
  paths,
  onChange,
  multiple = false,
  label,
  hint,
  disabled = false,
  filters,
}: PathPickerProps) {
  const [dragging, setDragging] = useState(false);

  // Glisser-déposer natif : Tauri fournit les chemins réels des fichiers
  // déposés sur la fenêtre, ce que le navigateur ne fait jamais.
  useEffect(() => {
    if (!isTauri() || disabled) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type === "over") setDragging(true);
          else if (event.payload.type === "leave") setDragging(false);
          else if (event.payload.type === "drop") {
            setDragging(false);
            const dropped = event.payload.paths;
            if (dropped.length === 0) return;
            onChange(multiple ? [...new Set([...paths, ...dropped])] : dropped.slice(0, 1));
          }
        });
        if (cancelled) unlisten();
        else dispose = unlisten;
      } catch {
        // Le glisser-déposer natif reste un confort : son absence n'empêche
        // pas d'utiliser l'outil par la boîte de dialogue.
      }
    })();

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [disabled, multiple, onChange, paths]);

  const browse = async () => {
    try {
      if (mode === "directory") {
        const directory = await pickDirectory(label);
        if (directory) onChange(multiple ? [...new Set([...paths, directory])] : [directory]);
        return;
      }
      const selection = await pickFiles({ multiple, title: label, filters });
      if (selection.length > 0) {
        onChange(multiple ? [...new Set([...paths, ...selection])] : selection.slice(0, 1));
      }
    } catch (error) {
      notify.error("Sélection impossible", error instanceof Error ? error.message : undefined);
    }
  };

  const defaultLabel =
    mode === "directory"
      ? "Choisissez un dossier"
      : multiple
        ? "Choisissez des fichiers"
        : "Choisissez un fichier";

  return (
    <div>
      <button
        type="button"
        onClick={browse}
        disabled={disabled}
        data-testid="path-picker"
        className={clsx(
          "flex w-full cursor-pointer rounded-[var(--radius-card)] border border-dashed transition-colors",
          disabled && "pointer-events-none opacity-50",
          // Une fois la sélection faite, la cible se réduit : les réglages
          // deviennent l'objet de l'écran.
          paths.length > 0
            ? "items-center gap-2.5 px-3 py-2.5 text-left"
            : "flex-col items-center justify-center gap-1.5 px-6 py-6 text-center",
          dragging
            ? "border-[var(--ft-accent)] bg-[var(--ft-accent-quiet)]"
            : "border-[var(--ft-border-strong)] bg-[var(--ft-surface)] hover:border-[var(--ft-accent)] hover:bg-[var(--ft-hover)]",
        )}
      >
        <span className="shrink-0 text-[var(--ft-text-faint)]">
          <Icon name={mode === "directory" ? "FolderTree" : "File"} size={paths.length > 0 ? 15 : 18} />
        </span>
        <span className={paths.length > 0 ? "min-w-0 flex-1" : "contents"}>
          <span className="block text-[13px] font-medium text-[var(--ft-text)]">
            {label ?? defaultLabel}
          </span>
          <span className="ft-meta block">
            {isTauri() ? "ou déposez-les sur la fenêtre" : "boîte de dialogue du système"}
            {hint && <span className="text-[var(--ft-text-faint)]"> · {hint}</span>}
          </span>
        </span>
      </button>

      {paths.length > 0 && (
        <ul className="mt-2 divide-y divide-[var(--ft-rule)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
          {paths.map((path) => (
            <li key={path} className="ft-row-py flex items-center gap-2.5 px-2.5">
              <Icon
                name={mode === "directory" ? "FolderTree" : "File"}
                size={14}
                className="shrink-0 text-[var(--ft-text-faint)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">{baseName(path)}</span>
                <span className="ft-value block truncate text-[var(--ft-text-faint)]" title={path}>
                  {shortenPath(directoryName(path), 3)}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Retirer ${baseName(path)}`}
                onClick={() => onChange(paths.filter((entry) => entry !== path))}
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
