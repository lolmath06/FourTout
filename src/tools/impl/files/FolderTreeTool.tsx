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
import { Trans, t, tx } from "@/i18n";

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
        label: t("Choisissez le dossier"),
      }}
      actionLabel={t("Générer l'arborescence")}
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
      successMessage={(result) => t("{directories} dossiers, {files} fichiers", { directories: result.directories, files: result.files })}
      renderResult={(result) => (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-sm">
            <Trans source={"<0>{directories} {directories, plural, one {dossier} other {dossiers}} · {files} {files, plural, one {fichier} other {fichiers}}</0>"} values={{ directories: result.directories, files: result.files }} components={[<span className="tabular-nums" />]} />
            {result.truncated && (
              <span className="flex items-center gap-1.5 text-xs text-[var(--ft-warn)]">
                <Icon name="TriangleAlert" size={13} />{" "}{t("profondeur maximale atteinte")}
              </span>
            )}
            <div className="flex-1" />
            <Button
              size="sm"
              onClick={async () => {
                const saved = await saveFile({
                  name: t("{value}-arborescence.txt", { value: baseName(paths[0] ?? "arborescence") }),
                  bytes: new TextEncoder().encode(result.text),
                  mimeType: "text/plain",
                });
                if (saved.saved) notify.success(t("Fichier enregistré"), saved.path);
              }}
            >
              <Icon name="Download" size={14} />{" "}{t("Télécharger")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                await navigator.clipboard.writeText(result.text);
                notify.success(t("Arborescence copiée"));
              }}
            >
              <Icon name="Copy" size={14} />{" "}{t("Copier")}
            </Button>
          </div>
          <pre
            data-testid="folder-tree"
            className="max-h-[32rem] overflow-auto rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3 font-mono text-xs leading-relaxed"
          >
            {tx(result.text)}
          </pre>
        </div>
      )}
    >
      <Fieldset columns={2}>
        <Field label={t("Profondeur maximale")}>
          <NumberInput
            min={1}
            max={20}
            value={maxDepth}
            onChange={(event) => setMaxDepth(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
            aria-label={t("Profondeur maximale")}
          />
        </Field>
        <Field label={t("Dossiers ignorés")} hint={t("Séparés par des virgules")}>
          <TextInput
            value={ignore}
            onChange={(event) => setIgnore(event.target.value)}
            aria-label={t("Dossiers ignorés")}
          />
        </Field>
        <Field label={t("Options")} full>
          <div className="grid gap-0.5 sm:grid-cols-3">
            <CheckOption
              checked={includeHidden}
              onChange={setIncludeHidden}
              label={t("Inclure les fichiers cachés")}
            />
            <CheckOption
              checked={directoriesOnly}
              onChange={setDirectoriesOnly}
              label={t("Dossiers seulement")}
            />
            <CheckOption checked={showSizes} onChange={setShowSizes} label={t("Afficher les tailles")} />
          </div>
        </Field>
      </Fieldset>
    </NativeToolShell>
  );
}
