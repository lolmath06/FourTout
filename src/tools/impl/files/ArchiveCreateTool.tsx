import { useState } from "react";
import { NativeToolShell } from "@/components/files/NativeToolShell";
import { Field, Fieldset, OptionGroup, Slider, TextInput } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize } from "@/core/files";
import {
  createArchive,
  pickDirectory,
  type ArchiveFormat,
  type ArchiveSummary,
} from "@/core/files/native";
import { baseName, directoryName, joinPath, stemOf } from "@/core/files/paths";
import { revealFile } from "@/core/output/save";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Création d'archives ZIP, TAR et TAR.GZ.
 *
 * L'arborescence relative est conservée : déposer un dossier produit une
 * archive qui, une fois extraite, redonne ce dossier — pas ses fichiers en
 * vrac. Les noms écrits dans l'archive passent par la même validation que
 * ceux acceptés à l'extraction : FourTout ne fabrique pas d'archive piégée.
 */
const FORMATS: { value: ArchiveFormat; label: string; hint: string }[] = [
  { value: "zip", label: "ZIP", hint: "Le plus universel : Windows, macOS et Linux l'ouvrent sans rien installer." },
  { value: "tar-gz", label: "TAR.GZ", hint: "Standard sous Linux ; conserve mieux les arborescences profondes." },
  { value: "tar", label: "TAR", hint: "Sans compression : rapide, utile pour regrouper des fichiers déjà compressés." },
];

export function ArchiveCreateTool(_props: ToolComponentProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const [format, setFormat] = useState<ArchiveFormat>("zip");
  const [level, setLevel] = useState(6);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");

  const defaultName = paths[0] ? stemOf(baseName(paths[0])) : "archive";
  const finalName = `${(name.trim() || defaultName).replace(/\.(zip|tar|tar\.gz|tgz)$/i, "")}.${
    format === "tar-gz" ? "tar.gz" : format
  }`;
  const target = destination || (paths[0] ? directoryName(paths[0]) : "");
  const output = target ? joinPath(target, finalName) : "";

  return (
    <NativeToolShell<ArchiveSummary>
      picker={{
        mode: "files",
        paths,
        onChange: (next) => {
          setPaths(next);
          setDestination("");
        },
        multiple: true,
        label: "Choisissez les fichiers à archiver",
        hint: "Déposez aussi des dossiers sur la fenêtre : leur arborescence est conservée.",
      }}
      actionLabel="Créer l'archive"
      actionIcon="FolderArchive"
      actionDisabled={output.length === 0}
      run={(context) => createArchive(paths, output, format, format === "tar" ? 0 : level, context)}
      successMessage={(summary) => `${summary.files} fichiers → ${formatFileSize(summary.outputBytes)}`}
      renderResult={(summary) => (
        <div className="rounded-[var(--radius-card)] border border-[color-mix(in_oklch,var(--ft-ok)_45%,var(--ft-border))] bg-[color-mix(in_oklch,var(--ft-ok)_6%,transparent)] p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Icon name="CircleCheck" size={17} className="text-[var(--ft-ok)]" />
            Archive créée — {summary.files} fichier(s)
          </p>
          <p className="mt-1 break-all text-xs text-[var(--ft-text-muted)]">{summary.path}</p>
          <p className="mt-1 text-xs tabular-nums">
            {formatFileSize(summary.inputBytes)} → {formatFileSize(summary.outputBytes)}
            {summary.inputBytes > 0 &&
              ` (${Math.round((1 - summary.outputBytes / summary.inputBytes) * 100)} % de gain)`}
          </p>
          <div className="mt-3">
            <Button size="sm" onClick={() => revealFile(summary.path)}>
              <Icon name="FolderTree" size={14} /> Ouvrir l'emplacement
            </Button>
          </div>
        </div>
      )}
      footer={
        <p className="flex items-start gap-2 text-xs text-[var(--ft-text-muted)]">
          <Icon name="Info" size={13} className="mt-px shrink-0" />
          Les archives protégées par mot de passe et le format 7z ne sont pas encore proposés :
          voir la note de l'outil « Archive protégée par mot de passe ».
        </p>
      }
    >
      <Fieldset columns={2}>
        <Field label="Format" hint={FORMATS.find((entry) => entry.value === format)?.hint}>
          <OptionGroup
            ariaLabel="Format d'archive"
            value={format}
            onChange={setFormat}
            options={FORMATS.map((entry) => ({ value: entry.value, label: entry.label, hint: entry.hint }))}
          />
        </Field>
        <Field
          label={format === "tar" ? "Compression (sans objet pour TAR)" : `Compression : ${level}`}
          hint="0 = stocké sans compression, 9 = plus lent mais plus petit"
        >
          <Slider
            min={0}
            max={9}
            step={1}
            value={level}
            onChange={setLevel}
          />
        </Field>
        <Field label="Nom de l'archive">
          <TextInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={defaultName}
            aria-label="Nom de l'archive"
          />
        </Field>
        <Field label="Dossier de destination">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate rounded-md border border-[var(--ft-border)] bg-[var(--ft-bg)] px-2.5 py-2 text-xs">
              {target || "—"}
            </span>
            <Button
              size="sm"
              onClick={async () => {
                const chosen = await pickDirectory("Dossier de destination");
                if (chosen) setDestination(chosen);
              }}
            >
              Choisir…
            </Button>
          </div>
        </Field>
      </Fieldset>

      {output && (
        <p className="break-all text-xs text-[var(--ft-text-muted)]">
          Archive à créer : <code className="font-mono">{output}</code>
        </p>
      )}
    </NativeToolShell>
  );
}
