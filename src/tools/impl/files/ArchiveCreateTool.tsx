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
import { Trans, localized, t, tx } from "@/i18n";

/**
 * Création d'archives ZIP, 7z, TAR, TAR.GZ et TAR.XZ.
 *
 * L'arborescence relative est conservée : déposer un dossier produit une
 * archive qui, une fois extraite, redonne ce dossier — pas ses fichiers en
 * vrac. Les noms écrits dans l'archive passent par la même validation que
 * ceux acceptés à l'extraction : FourTout ne fabrique pas d'archive piégée.
 */
const FORMATS: { value: ArchiveFormat; label: string; hint: string; extension: string }[] = localized(() => [
  { value: "zip", label: "ZIP", extension: "zip", hint: t("Le plus universel : Windows, macOS et Linux l'ouvrent sans rien installer.") },
  { value: "seven-z", label: "7z", extension: "7z", hint: t("Compression nettement meilleure que ZIP. Non chiffré ici : voir « Archive protégée » pour un mot de passe.") },
  { value: "tar-gz", label: "TAR.GZ", extension: "tar.gz", hint: t("Standard sous Linux ; conserve mieux les arborescences profondes.") },
  { value: "tar-xz", label: "TAR.XZ", extension: "tar.xz", hint: t("Même principe que TAR.GZ, compression plus forte et plus lente.") },
  { value: "tar", label: "TAR", extension: "tar", hint: t("Sans compression : rapide, utile pour regrouper des fichiers déjà compressés.") },
]);

export function ArchiveCreateTool(_props: ToolComponentProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const [format, setFormat] = useState<ArchiveFormat>("zip");
  const [level, setLevel] = useState(6);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");

  const defaultName = paths[0] ? stemOf(baseName(paths[0])) : "archive";
  const extension = FORMATS.find((entry) => entry.value === format)?.extension ?? "zip";
  const finalName = `${(name.trim() || defaultName).replace(
    /\.(zip|7z|tar|tar\.gz|tgz|tar\.xz|txz)$/i,
    "",
  )}.${extension}`;
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
        label: t("Choisissez les fichiers à archiver"),
        hint: t("Déposez aussi des dossiers sur la fenêtre : leur arborescence est conservée."),
      }}
      actionLabel={t("Créer l'archive")}
      actionIcon="FolderArchive"
      actionDisabled={output.length === 0}
      run={(context) => createArchive(paths, output, format, format === "tar" ? 0 : level, context)}
      successMessage={(summary) => t("{files} fichiers → {size}", { files: summary.files, size: formatFileSize(summary.outputBytes) })}
      renderResult={(summary) => (
        <div className="rounded-[var(--radius-card)] border border-[color-mix(in_oklch,var(--ft-ok)_45%,var(--ft-border))] bg-[color-mix(in_oklch,var(--ft-ok)_6%,transparent)] p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Icon name="CircleCheck" size={17} className="text-[var(--ft-ok)]" />
            {t("Archive créée — {files} fichier(s)", { files: summary.files })}
          </p>
          <p className="mt-1 break-all text-xs text-[var(--ft-text-muted)]">{summary.path}</p>
          <p className="mt-1 text-xs tabular-nums">
            {formatFileSize(summary.inputBytes)} → {formatFileSize(summary.outputBytes)}
            {summary.inputBytes > 0 &&
              ` (${Math.round((1 - summary.outputBytes / summary.inputBytes) * 100)} % de gain)`}
          </p>
          <div className="mt-3">
            <Button size="sm" onClick={() => revealFile(summary.path)}>
              <Icon name="FolderTree" size={14} />{" "}{t("Ouvrir l'emplacement")}
            </Button>
          </div>
        </div>
      )}
      footer={
        <p className="flex items-start gap-2 text-xs text-[var(--ft-text-muted)]">
          <Icon name="Info" size={13} className="mt-px shrink-0" />
          {t("Pour une archive protégée par mot de passe, utilisez « Archive protégée » : son ZIP AES-256 s'ouvre avec 7-Zip, WinRAR, Keka et l'Explorateur Windows. Le 7z produit ici n'est pas chiffré.")}
        </p>
      }
    >
      <Fieldset columns={2}>
        <Field label={t("Format")} hint={tx(FORMATS.find((entry) => entry.value === format)?.hint)}>
          <OptionGroup
            ariaLabel={t("Format d'archive")}
            value={format}
            onChange={setFormat}
            options={FORMATS.map((entry) => ({ value: entry.value, label: entry.label, hint: entry.hint }))}
          />
        </Field>
        <Field
          label={format === "tar" ? t("Compression (sans objet pour TAR)") : `Compression : ${level}`}
          hint={t("0 = stocké sans compression, 9 = plus lent mais plus petit")}
        >
          <Slider
            min={0}
            max={9}
            step={1}
            value={level}
            onChange={setLevel}
          />
        </Field>
        <Field label={t("Nom de l'archive")}>
          <TextInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={defaultName}
            aria-label={t("Nom de l'archive")}
          />
        </Field>
        <Field label={t("Dossier de destination")}>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate rounded-md border border-[var(--ft-border)] bg-[var(--ft-bg)] px-2.5 py-2 text-xs">
              {target || "—"}
            </span>
            <Button
              size="sm"
              onClick={async () => {
                const chosen = await pickDirectory(t("Dossier de destination"));
                if (chosen) setDestination(chosen);
              }}
            >
              {t("Choisir…")}
            </Button>
          </div>
        </Field>
      </Fieldset>

      {output && (
        <p className="break-all text-xs text-[var(--ft-text-muted)]">
          <Trans source={"Archive à créer : <0>{output}</0>"} values={{ output }} components={[<code className="font-mono" />]} />
        </p>
      )}
    </NativeToolShell>
  );
}
