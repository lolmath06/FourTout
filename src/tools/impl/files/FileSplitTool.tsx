import { useState } from "react";
import { NativeToolShell } from "@/components/files/NativeToolShell";
import { Field, Fieldset, NumberInput, Select } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize } from "@/core/files";
import { pickDirectory, splitFile, type SplitSummary } from "@/core/files/native";
import { baseName, directoryName } from "@/core/files/paths";
import { openFolder } from "@/core/output/save";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Découpage d'un gros fichier en morceaux numérotés.
 *
 * Un manifeste JSON est écrit à côté des morceaux : il porte le nom d'origine,
 * la taille et l'empreinte SHA-256. C'est lui qui permettra au réassemblage de
 * **vérifier** le résultat au lieu de l'espérer.
 */
const UNITS = [
  { value: "1048576", label: "Mo" },
  { value: "1073741824", label: "Go" },
  { value: "1024", label: "Ko" },
];

const PRESETS = [
  { value: "100", label: "100 Mo" },
  { value: "500", label: "500 Mo" },
  { value: "700", label: "700 Mo (CD)" },
  { value: "4000", label: "4 000 Mo (FAT32)" },
];

export function FileSplitTool(_props: ToolComponentProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const [size, setSize] = useState(100);
  const [unit, setUnit] = useState(UNITS[0].value);
  const [destination, setDestination] = useState("");

  const partSize = Math.max(1, Math.round(size * Number(unit)));
  const target = destination || (paths[0] ? directoryName(paths[0]) : "");

  return (
    <NativeToolShell<SplitSummary>
      picker={{
        mode: "files",
        paths,
        onChange: (next) => {
          setPaths(next);
          setDestination("");
        },
        label: "Choisissez le fichier à découper",
      }}
      actionLabel="Découper le fichier"
      actionIcon="Scissors"
      actionDisabled={partSize < 1024 || target.length === 0}
      run={(context) => splitFile(paths[0], target, partSize, context)}
      successMessage={(summary) => `${summary.parts.length} morceaux écrits`}
      renderResult={(summary) => (
        <div className="rounded-[var(--radius-card)] border border-[color-mix(in_oklch,var(--ft-ok)_45%,var(--ft-border))] bg-[color-mix(in_oklch,var(--ft-ok)_6%,transparent)] p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Icon name="CircleCheck" size={17} className="text-[var(--ft-ok)]" />
            {summary.parts.length} morceaux écrits — {formatFileSize(summary.totalSize)} au total
          </p>
          <p className="mt-1 break-all text-xs text-[var(--ft-text-muted)]">
            SHA-256 de l'original : <code className="font-mono">{summary.sha256}</code>
          </p>
          <ul className="mt-2 max-h-48 overflow-y-auto text-xs">
            {summary.parts.map((part) => (
              <li key={part} className="truncate font-mono text-[var(--ft-text-muted)]">
                {baseName(part)}
              </li>
            ))}
            <li className="truncate font-mono text-[var(--ft-accent-text)]">
              {baseName(summary.manifestPath)} — manifeste de vérification
            </li>
          </ul>
          <div className="mt-3">
            <Button size="sm" onClick={() => openFolder(summary.directory)}>
              <Icon name="FolderTree" size={14} /> Ouvrir le dossier
            </Button>
          </div>
        </div>
      )}
    >
      <Fieldset columns={3}>
        <Field label="Taille d'un morceau">
          <NumberInput
            min={1}
            value={size}
            onChange={(event) => setSize(Math.max(1, Number(event.target.value) || 1))}
            aria-label="Taille d'un morceau"
          />
        </Field>
        <Field label="Unité">
          <Select aria-label="Unité" value={unit} onChange={setUnit} options={UNITS} />
        </Field>
        <Field label="Tailles courantes">
          <Select
            aria-label="Tailles courantes"
            value={String(size)}
            onChange={(value) => {
              setSize(Number(value));
              setUnit(UNITS[0].value);
            }}
            options={[{ value: String(size), label: `${size} ${unit === "1048576" ? "Mo" : ""}` }, ...PRESETS]}
          />
        </Field>
        <Field label="Dossier de destination" full hint="Par défaut, à côté du fichier d'origine.">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate rounded-md border border-[var(--ft-border)] bg-[var(--ft-bg)] px-2.5 py-2 text-xs">
              {target || "—"}
            </span>
            <Button
              size="sm"
              onClick={async () => {
                const chosen = await pickDirectory("Dossier de destination");
                if (chosen) setDestination(chosen);
                else notify.info("Destination inchangée");
              }}
            >
              Choisir…
            </Button>
          </div>
        </Field>
      </Fieldset>

      <p className="text-xs text-[var(--ft-text-muted)]">
        Chaque morceau fera {formatFileSize(partSize)}. Les fichiers produits seront nommés
        <code className="mx-1 font-mono">{baseName(paths[0] ?? "fichier")}.part001</code>, etc.
      </p>
    </NativeToolShell>
  );
}
