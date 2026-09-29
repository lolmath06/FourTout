import { useState } from "react";
import { NativeToolShell } from "@/components/files/NativeToolShell";
import { CheckOption } from "@/components/text/TextToolShell";
import { Field, Fieldset, NumberInput, TextInput } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { folderTree, type TreeResult } from "@/core/files/native";
import { baseName } from "@/core/files/paths";
import { saveFile } from "@/core/output/save";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Arborescence texte d'un dossier, prête à coller dans un README ou un ticket.
 */
export function FolderTreeTool(_props: ToolComponentProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const [maxDepth, setMaxDepth] = useState(3);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [directoriesOnly, setDirectoriesOnly] = useState(false);
  const [showSizes, setShowSizes] = useState(false);
  const [ignore, setIgnore] = useState("node_modules, .git, target, dist");

  return (
    <NativeToolShell<TreeResult>
      picker={{
        mode: "directory",
        paths,
        onChange: setPaths,
        label: "Choisissez le dossier",
      }}
      actionLabel="Générer l'arborescence"
      actionIcon="FolderTree"
      run={(context) =>
        folderTree(
          paths[0],
          {
            maxDepth: Math.max(1, maxDepth),
            includeHidden,
            directoriesOnly,
            showSizes,
            ignore: ignore
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean),
          },
          context,
        )
      }
      successMessage={(result) => `${result.directories} dossiers, ${result.files} fichiers`}
      renderResult={(result) => (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-sm">
            <span className="tabular-nums">
              {result.directories} dossier(s) · {result.files} fichier(s)
            </span>
            {result.truncated && (
              <span className="flex items-center gap-1.5 text-xs text-[var(--ft-warn)]">
                <Icon name="TriangleAlert" size={13} /> profondeur maximale atteinte
              </span>
            )}
            <div className="flex-1" />
            <Button
              size="sm"
              onClick={async () => {
                const saved = await saveFile({
                  name: `${baseName(paths[0] ?? "arborescence")}-arborescence.txt`,
                  bytes: new TextEncoder().encode(result.text),
                  mimeType: "text/plain",
                });
                if (saved.saved) notify.success("Fichier enregistré", saved.path);
              }}
            >
              <Icon name="Download" size={14} /> Télécharger
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                await navigator.clipboard.writeText(result.text);
                notify.success("Arborescence copiée");
              }}
            >
              <Icon name="Copy" size={14} /> Copier
            </Button>
          </div>
          <pre
            data-testid="folder-tree"
            className="max-h-[32rem] overflow-auto rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3 font-mono text-xs leading-relaxed"
          >
            {result.text}
          </pre>
        </div>
      )}
    >
      <Fieldset columns={2}>
        <Field label="Profondeur maximale">
          <NumberInput
            min={1}
            max={20}
            value={maxDepth}
            onChange={(event) => setMaxDepth(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
            aria-label="Profondeur maximale"
          />
        </Field>
        <Field label="Dossiers ignorés" hint="Séparés par des virgules">
          <TextInput
            value={ignore}
            onChange={(event) => setIgnore(event.target.value)}
            aria-label="Dossiers ignorés"
          />
        </Field>
        <Field label="Options" full>
          <div className="grid gap-0.5 sm:grid-cols-3">
            <CheckOption
              checked={includeHidden}
              onChange={setIncludeHidden}
              label="Inclure les fichiers cachés"
            />
            <CheckOption
              checked={directoriesOnly}
              onChange={setDirectoriesOnly}
              label="Dossiers seulement"
            />
            <CheckOption checked={showSizes} onChange={setShowSizes} label="Afficher les tailles" />
          </div>
        </Field>
      </Fieldset>
    </NativeToolShell>
  );
}
