import { useState } from "react";
import { NativeToolShell } from "@/components/files/NativeToolShell";
import { CheckOption } from "@/components/text/TextToolShell";
import { Field, Fieldset, Select } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize } from "@/core/files";
import { findDuplicates, type DuplicateReport } from "@/core/files/native";
import { directoryName, shortenPath } from "@/core/files/paths";
import { revealFile } from "@/core/output/save";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Détection des fichiers en double.
 *
 * FourTout **ne supprime rien** : il rend un rapport groupé par contenu
 * identique, avec l'espace récupérable, et permet d'ouvrir l'emplacement de
 * chaque fichier. La suppression reste un geste de l'utilisateur, dans son
 * explorateur — c'est la seule façon honnête de traiter des données qu'on ne
 * peut pas restaurer.
 */
const MIN_SIZES = [
  { value: "1", label: "Tous les fichiers" },
  { value: "1024", label: "À partir de 1 Ko" },
  { value: "102400", label: "À partir de 100 Ko" },
  { value: "1048576", label: "À partir de 1 Mo" },
  { value: "10485760", label: "À partir de 10 Mo" },
];

export function FileDuplicatesTool(_props: ToolComponentProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const [minSize, setMinSize] = useState("1024");
  const [includeHidden, setIncludeHidden] = useState(false);

  return (
    <NativeToolShell<DuplicateReport>
      picker={{
        mode: "directory",
        paths,
        onChange: setPaths,
        label: "Choisissez le dossier à analyser",
        hint: "L'analyse est récursive ; les liens symboliques ne sont pas suivis.",
      }}
      actionLabel="Chercher les doublons"
      actionIcon="CopyMinus"
      run={(context) =>
        findDuplicates(paths[0], { minSize: Number(minSize), includeHidden }, context)
      }
      successMessage={(report) =>
        report.groups.length === 0
          ? "Aucun doublon trouvé"
          : `${report.groups.length} groupe(s), ${formatFileSize(report.reclaimable)} récupérables`
      }
      renderResult={(report) => (
        <div className="space-y-3" data-testid="duplicates-report">
          <div className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] p-3 text-sm">
            <p className="tabular-nums">
              {report.scanned} fichiers analysés · <strong>{report.groups.length}</strong> groupe(s)
              de doublons · {report.duplicateFiles} fichier(s) en trop ·{" "}
              <strong>{formatFileSize(report.reclaimable)}</strong> récupérables
            </p>
            {report.groups.length > 0 && (
              <p className="mt-1 flex items-start gap-1.5 text-xs text-[var(--ft-text-muted)]">
                <Icon name="ShieldCheck" size={13} className="mt-px shrink-0" />
                FourTout ne supprime aucun fichier : utilisez « Ouvrir l'emplacement » pour décider
                vous-même de ce qui doit rester.
              </p>
            )}
          </div>

          {report.groups.map((group) => (
            <div
              key={group.hash}
              className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3"
            >
              <p className="text-sm font-medium tabular-nums">
                {group.files.length} fichiers identiques — {formatFileSize(group.size)} chacun ·{" "}
                {formatFileSize(group.reclaimable)} récupérables
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {group.files.map((file, index) => (
                  <li key={file.path} className="flex items-center gap-2 text-xs">
                    <Icon
                      name={index === 0 ? "Star" : "File"}
                      size={13}
                      className={index === 0 ? "shrink-0 text-[var(--ft-accent)]" : "shrink-0 text-[var(--ft-text-faint)]"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{file.name}</span>
                      <span className="block truncate text-[11px] text-[var(--ft-text-faint)]" title={file.path}>
                        {shortenPath(directoryName(file.path), 3)}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => revealFile(file.path)}
                      aria-label={`Ouvrir l'emplacement de ${file.name}`}
                    >
                      <Icon name="FolderTree" size={14} /> Ouvrir l'emplacement
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    >
      <Fieldset columns={2}>
        <Field label="Taille minimale" hint="Ignorer les petits fichiers accélère beaucoup l'analyse.">
          <Select
            aria-label="Taille minimale"
            value={minSize}
            onChange={setMinSize}
            options={MIN_SIZES}
          />
        </Field>
        <Field label="Options">
          <CheckOption
            checked={includeHidden}
            onChange={setIncludeHidden}
            label="Inclure les fichiers et dossiers cachés"
          />
        </Field>
      </Fieldset>
    </NativeToolShell>
  );
}
