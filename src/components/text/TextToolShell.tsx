import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { notify } from "@/features/notifications/store";
import { measureText } from "@/core/text/clean";
import { saveFile } from "@/core/output/save";

/**
 * Ossature commune aux outils Texte.
 *
 * Les quinze outils Texte partagent exactement les mêmes gestes : coller ou
 * déposer un texte, régler quelques options, lire le résultat, le copier, le
 * télécharger, recommencer. Les factoriser ici évite que chaque écran
 * réinvente sa zone de saisie, son compteur et ses boutons — et garantit que
 * « Copier » se comporte pareil partout.
 */

/** Extensions acceptées par le dépôt de fichier des outils Texte. */
const TEXT_EXTENSIONS = ["txt", "md", "markdown", "csv", "log", "json", "xml", "html", "htm", "srt", "vtt"];

/** Au-delà, on refuse : une zone de saisie n'est pas un éditeur de gros fichiers. */
const MAX_TEXT_BYTES = 8 * 1024 * 1024;

export interface TextPaneProps {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  minHeight?: string;
  /** Autoriser le dépôt d'un fichier texte sur cette zone. */
  droppable?: boolean;
  monospace?: boolean;
}

/** Zone de texte unique, avec dépôt de fichier et compteur. */
export function TextPane({
  label,
  value,
  onChange,
  placeholder,
  readOnly = false,
  minHeight = "14rem",
  droppable = true,
  monospace = true,
}: TextPaneProps) {
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const size = measureText(value);

  const readFile = useCallback(
    async (file: File) => {
      if (!onChange) return;
      if (file.size > MAX_TEXT_BYTES) {
        notify.error(
          "Fichier trop volumineux",
          "Cette zone accepte jusqu'à 8 Mo de texte. Pour un fichier plus gros, utilisez les outils Fichiers.",
        );
        return;
      }
      try {
        onChange(await file.text());
        notify.success("Fichier chargé", file.name);
      } catch {
        notify.error("Lecture impossible", "Ce fichier ne peut pas être lu comme du texte.");
      }
    },
    [onChange],
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-[var(--ft-text-muted)]">
          {label}
        </label>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--ft-text-faint)]">
          {size.characters} car. · {size.words} mots · {size.lines} lignes
        </span>
      </div>
      <textarea
        id={id}
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        onDragOver={(event) => {
          if (!droppable || readOnly) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (!droppable || readOnly) return;
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void readFile(file);
        }}
        style={{ minHeight }}
        className={clsx(
          "w-full resize-y rounded-[var(--radius-card)] border p-3 text-sm outline-none transition-colors",
          monospace && "font-mono",
          readOnly ? "bg-[var(--ft-surface-2)]" : "bg-[var(--ft-surface)]",
          dragging
            ? "border-[var(--ft-accent)] bg-[var(--ft-accent-soft)]"
            : "border-[var(--ft-border)] focus:border-[var(--ft-accent)]",
        )}
      />
    </div>
  );
}

export interface TextToolShellProps {
  /** Texte saisi par l'utilisateur. */
  input: string;
  onInputChange: (value: string) => void;
  /** Résultat produit ; absent pour les outils qui ne rendent pas de texte. */
  output?: string;
  inputLabel?: string;
  outputLabel?: string;
  placeholder?: string;
  /** Réglages propres à l'outil, entre l'entrée et la sortie. */
  children?: ReactNode;
  /** Ligne de récapitulatif affichée au-dessus du résultat. */
  summary?: ReactNode;
  /** Message d'erreur (regex invalide, décodage impossible…). */
  error?: string;
  /** Nom proposé au téléchargement du résultat. */
  downloadName?: string;
  /** Boutons additionnels, à droite de la barre d'actions. */
  actions?: ReactNode;
  /** Disposition côte à côte (comparaison, conversions). */
  layout?: "stacked" | "side-by-side";
  /** Contenu affiché à la place de la zone de résultat (aperçu, tableau…). */
  outputSlot?: ReactNode;
  /** Exemple inséré par le bouton « Exemple ». */
  sample?: string;
}

export function TextToolShell({
  input,
  onInputChange,
  output,
  inputLabel = "Texte",
  outputLabel = "Résultat",
  placeholder = "Collez votre texte, ou déposez un fichier .txt / .md ici…",
  children,
  summary,
  error,
  downloadName = "fourtout.txt",
  actions,
  layout = "stacked",
  outputSlot,
  sample,
}: TextToolShellProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasOutput = output !== undefined || outputSlot !== undefined;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify.success("Copié dans le presse-papiers");
    } catch {
      notify.error("Copie impossible", "Le presse-papiers n'est pas accessible.");
    }
  };

  const download = async (value: string) => {
    try {
      const bytes = new TextEncoder().encode(value);
      const result = await saveFile({ name: downloadName, bytes, mimeType: "text/plain" });
      if (result.saved) notify.success("Fichier enregistré", result.path);
    } catch (error_) {
      notify.error("Enregistrement impossible", error_ instanceof Error ? error_.message : undefined);
    }
  };

  return (
    <div className="space-y-4">
      <div className={clsx("flex gap-4", layout === "side-by-side" ? "flex-col lg:flex-row" : "flex-col")}>
        <TextPane label={inputLabel} value={input} onChange={onInputChange} placeholder={placeholder} />
        {layout === "side-by-side" && output !== undefined && (
          <TextPane label={outputLabel} value={output} readOnly droppable={false} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={TEXT_EXTENSIONS.map((extension) => `.${extension}`).join(",")}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            if (file.size > MAX_TEXT_BYTES) {
              notify.error("Fichier trop volumineux", "Cette zone accepte jusqu'à 8 Mo de texte.");
              return;
            }
            onInputChange(await file.text());
          }}
        />
        <Button size="sm" onClick={() => inputRef.current?.click()}>
          <Icon name="UploadCloud" size={14} /> Ouvrir un fichier
        </Button>
        {sample && (
          <Button size="sm" variant="ghost" onClick={() => onInputChange(sample)}>
            <Icon name="Sparkles" size={14} /> Exemple
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onInputChange("")} disabled={input.length === 0}>
          <Icon name="Eraser" size={14} /> Effacer
        </Button>
        <div className="flex-1" />
        {actions}
      </div>

      {children && <div className="space-y-3">{children}</div>}

      {error && (
        <p className="flex items-start gap-2 rounded-md border border-[var(--ft-danger)] px-3 py-2 text-sm text-[var(--ft-danger)]">
          <Icon name="CircleAlert" size={16} className="mt-px shrink-0" />
          {error}
        </p>
      )}

      {summary && (
        <div className="rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-sm">
          {summary}
        </div>
      )}

      {outputSlot}

      {layout === "stacked" && output !== undefined && (
        <TextPane label={outputLabel} value={output} readOnly droppable={false} />
      )}

      {hasOutput && output !== undefined && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => onInputChange(output)} disabled={!output}>
            <Icon name="Undo2" size={14} /> Reprendre comme entrée
          </Button>
          <Button size="sm" onClick={() => download(output)} disabled={!output}>
            <Icon name="Download" size={14} /> Télécharger
          </Button>
          <Button size="sm" variant="primary" onClick={() => copy(output)} disabled={!output}>
            <Icon name="Copy" size={14} /> Copier
          </Button>
        </div>
      )}
    </div>
  );
}

/** Case à cocher alignée sur le style des réglages FourTout. */
export function CheckOption({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={clsx(
        "flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-[var(--ft-surface-2)]",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-3.5 shrink-0 accent-[var(--ft-accent)]"
      />
      <span className="min-w-0">
        <span className="block leading-tight">{label}</span>
        {hint && <span className="block text-[11px] text-[var(--ft-text-faint)]">{hint}</span>}
      </span>
    </label>
  );
}
