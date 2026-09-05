import { useState } from "react";
import { NativeToolShell } from "@/components/files/NativeToolShell";
import { CheckOption } from "@/components/text/TextToolShell";
import { Field, Fieldset, TextInput } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize } from "@/core/files";
import { hashFiles, type FileHashes, type HashAlgorithm } from "@/core/files/native";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Empreintes de fichiers, et vérification d'une empreinte annoncée.
 *
 * Un seul composant sert « Calculer une empreinte » et « Vérifier une
 * empreinte » : la seule différence est le champ de comparaison, ouvert par
 * défaut dans le second. Le fichier est lu en flux par le socle natif : sa
 * taille n'a pas d'importance.
 */
const ALGORITHMS: { value: HashAlgorithm; label: string; legacy?: boolean }[] = [
  { value: "sha256", label: "SHA-256" },
  { value: "sha512", label: "SHA-512" },
  { value: "sha1", label: "SHA-1", legacy: true },
  { value: "md5", label: "MD5", legacy: true },
];

export function FileHashTool({ tool }: ToolComponentProps) {
  const verifyMode = tool.id === "file-verify-hash";
  const [paths, setPaths] = useState<string[]>([]);
  const [selected, setSelected] = useState<HashAlgorithm[]>(["sha256"]);
  const [expected, setExpected] = useState("");

  const toggle = (algorithm: HashAlgorithm, on: boolean) =>
    setSelected((current) =>
      on ? [...ALGORITHMS.map((a) => a.value).filter((v) => current.includes(v) || v === algorithm)] : current.filter((v) => v !== algorithm),
    );

  const normalizedExpected = expected.trim().toLowerCase();

  return (
    <NativeToolShell<FileHashes[]>
      picker={{
        mode: "files",
        paths,
        onChange: setPaths,
        multiple: !verifyMode,
        label: verifyMode ? "Choisissez le fichier à vérifier" : "Choisissez un ou plusieurs fichiers",
      }}
      actionLabel={verifyMode ? "Vérifier l'empreinte" : "Calculer l'empreinte"}
      actionIcon="Fingerprint"
      actionDisabled={selected.length === 0}
      run={(context) => hashFiles(paths, selected, context)}
      successMessage={(results) =>
        results.length === 1 ? results[0].name : `${results.length} fichiers traités`
      }
      renderResult={(results) => (
        <div className="space-y-3">
          {results.map((result) => (
            <div
              key={result.path}
              className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3"
            >
              <p className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium">{result.name}</span>
                <span className="text-xs tabular-nums text-[var(--ft-text-muted)]">
                  {formatFileSize(result.size)}
                </span>
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {result.digests.map(([label, digest]) => {
                  const matches =
                    normalizedExpected.length > 0 && normalizedExpected === digest.toLowerCase();
                  const mismatches = normalizedExpected.length > 0 && !matches;
                  return (
                    <div key={label} className="flex flex-wrap items-center gap-2">
                      <span className="w-20 shrink-0 text-xs font-medium">{label}</span>
                      <code className="min-w-0 flex-1 break-all font-mono text-xs text-[var(--ft-text-muted)]">
                        {digest}
                      </code>
                      {matches && (
                        <span className="flex items-center gap-1 text-xs text-[var(--ft-ok)]">
                          <Icon name="CircleCheck" size={14} /> correspond
                        </span>
                      )}
                      {mismatches && (
                        <span className="flex items-center gap-1 text-xs text-[var(--ft-danger)]">
                          <Icon name="CircleAlert" size={14} /> diffère
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Copier ${label}`}
                        onClick={async () => {
                          await navigator.clipboard.writeText(digest);
                          notify.success("Empreinte copiée");
                        }}
                      >
                        <Icon name="Copy" size={14} />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    >
      <Fieldset columns={1}>
        <Field label="Algorithmes" full>
          <div className="grid gap-0.5 sm:grid-cols-4">
            {ALGORITHMS.map((algorithm) => (
              <CheckOption
                key={algorithm.value}
                checked={selected.includes(algorithm.value)}
                onChange={(on) => toggle(algorithm.value, on)}
                label={algorithm.label}
                hint={algorithm.legacy ? "somme de contrôle uniquement" : undefined}
              />
            ))}
          </div>
        </Field>
        <Field
          label="Empreinte attendue (facultatif)"
          hint="Collez l'empreinte publiée par la source pour la comparer automatiquement."
          full
        >
          <TextInput
            value={expected}
            onChange={(event) => setExpected(event.target.value)}
            placeholder="ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
            aria-label="Empreinte attendue"
            className="font-mono"
          />
        </Field>
      </Fieldset>

      {(selected.includes("md5") || selected.includes("sha1")) && (
        <p className="flex items-start gap-2 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-xs text-[var(--ft-warn)]">
          <Icon name="TriangleAlert" size={14} className="mt-px shrink-0" />
          MD5 et SHA-1 ne sont pas adaptés à la sécurité cryptographique : deux fichiers différents
          peuvent produire la même empreinte. Ils restent utiles pour vérifier qu'un téléchargement
          n'est pas corrompu, pas pour prouver qu'un fichier n'a pas été modifié volontairement.
        </p>
      )}
    </NativeToolShell>
  );
}
