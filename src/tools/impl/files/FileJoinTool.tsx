import { useState } from "react";
import { NativeToolShell } from "@/components/files/NativeToolShell";
import { Field, Fieldset } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize } from "@/core/files";
import { joinFile, pickDirectory, type JoinSummary } from "@/core/files/native";
import { directoryName } from "@/core/files/paths";
import { revealFile } from "@/core/output/save";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Réassemblage d'un fichier découpé.
 *
 * Il suffit de désigner **un** morceau : FourTout retrouve les autres, vérifie
 * que la suite est complète (un trou est une erreur, pas un avertissement) et
 * compare le résultat au manifeste. Un fichier reconstruit faux serait pire
 * qu'une erreur : il est supprimé plutôt que livré.
 */
export function FileJoinTool(_props: ToolComponentProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const [destination, setDestination] = useState("");

  const target = destination || (paths[0] ? directoryName(paths[0]) : "");

  return (
    <NativeToolShell<JoinSummary>
      picker={{
        mode: "files",
        paths,
        onChange: (next) => setPaths(next.slice(-1)),
        label: "Choisissez un morceau (.part001, .part002…)",
        hint: "Les autres morceaux sont retrouvés automatiquement dans le même dossier.",
      }}
      actionLabel="Réassembler le fichier"
      actionIcon="Combine"
      actionDisabled={target.length === 0}
      run={(context) => joinFile(paths[0], target, context)}
      successMessage={(summary) => `${summary.parts} morceaux réassemblés`}
      renderResult={(summary) => (
        <div className="rounded-[var(--radius-card)] border border-[color-mix(in_oklch,var(--ft-ok)_45%,var(--ft-border))] bg-[color-mix(in_oklch,var(--ft-ok)_6%,transparent)] p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Icon name="CircleCheck" size={17} className="text-[var(--ft-ok)]" />
            Fichier reconstruit — {summary.parts} morceaux, {formatFileSize(summary.totalSize)}
          </p>
          <p className="mt-1 break-all text-xs text-[var(--ft-text-muted)]">{summary.path}</p>
          <p className="mt-1 break-all text-xs">
            {summary.verified ? (
              <span className="text-[var(--ft-ok)]">
                Empreinte SHA-256 vérifiée : le fichier est identique à l'original.
              </span>
            ) : (
              <span className="text-[var(--ft-warn)]">{summary.warning}</span>
            )}
          </p>
          <code className="mt-1 block break-all font-mono text-[11px] text-[var(--ft-text-faint)]">
            {summary.sha256}
          </code>
          <div className="mt-3">
            <Button size="sm" onClick={() => revealFile(summary.path)}>
              <Icon name="FolderTree" size={14} /> Ouvrir l'emplacement
            </Button>
          </div>
        </div>
      )}
    >
      <Fieldset columns={1}>
        <Field label="Dossier de destination" hint="Par défaut, le dossier contenant les morceaux.">
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
    </NativeToolShell>
  );
}
