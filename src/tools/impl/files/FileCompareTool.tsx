import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { NativeToolShell } from "@/components/files/NativeToolShell";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize } from "@/core/files";
import { compareFiles, readTextFile, type CompareResult } from "@/core/files/native";
import { baseName } from "@/core/files/paths";
import { setHandoff } from "@/features/handoff/store";
import { toolRoute } from "@/core/tools/types";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Comparaison de deux fichiers.
 *
 * Deux réponses distinctes, et c'est volontaire : l'identité **binaire** (même
 * taille, même SHA-256, position du premier octet différent) et, quand les
 * deux fichiers sont du texte, un renvoi vers l'outil de comparaison de textes
 * déjà chargé avec leur contenu.
 */
export function FileCompareTool(_props: ToolComponentProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const navigate = useNavigate();

  const openTextDiff = async () => {
    try {
      const [left, right] = await Promise.all([
        readTextFile(paths[0], 8 * 1024 * 1024),
        readTextFile(paths[1], 8 * 1024 * 1024),
      ]);
      setHandoff({ toolId: "text-compare", preset: { left, right } });
      navigate(toolRoute("text-compare"));
    } catch (error) {
      notify.error(
        "Ouverture impossible",
        error instanceof Error ? error.message : "Ces fichiers ne peuvent pas être lus comme du texte.",
      );
    }
  };

  return (
    <NativeToolShell<CompareResult>
      picker={{
        mode: "files",
        paths,
        onChange: (next) => setPaths(next.slice(-2)),
        multiple: true,
        label: "Choisissez les deux fichiers à comparer",
        hint: "Sélectionnez-les ensemble, ou l'un après l'autre",
      }}
      actionLabel="Comparer"
      actionIcon="GitCompare"
      actionDisabled={paths.length !== 2}
      run={(context) => compareFiles(paths[0], paths[1], context)}
      renderResult={(result) => (
        <div
          data-testid="compare-result"
          className={`rounded-[var(--radius-card)] border p-4 ${
            result.identical
              ? "border-[color-mix(in_oklch,var(--ft-ok)_45%,var(--ft-border))] bg-[color-mix(in_oklch,var(--ft-ok)_6%,transparent)]"
              : "border-[color-mix(in_oklch,var(--ft-warn)_45%,var(--ft-border))] bg-[color-mix(in_oklch,var(--ft-warn)_6%,transparent)]"
          }`}
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <Icon
              name={result.identical ? "CircleCheck" : "CircleAlert"}
              size={17}
              className={result.identical ? "text-[var(--ft-ok)]" : "text-[var(--ft-warn)]"}
            />
            {result.identical ? "Fichiers identiques" : "Fichiers différents"}
          </p>

          <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[14rem_1fr]">
            <dt className="text-[var(--ft-text-muted)]">Tailles</dt>
            <dd className="tabular-nums">
              {formatFileSize(result.sizeA)} · {formatFileSize(result.sizeB)}
              {result.sizeA !== result.sizeB && " — différentes"}
            </dd>
            <dt className="text-[var(--ft-text-muted)]">SHA-256 — {baseName(paths[0] ?? "")}</dt>
            <dd className="break-all font-mono">{result.sha256A}</dd>
            <dt className="text-[var(--ft-text-muted)]">SHA-256 — {baseName(paths[1] ?? "")}</dt>
            <dd className="break-all font-mono">{result.sha256B}</dd>
            {result.firstDifference !== null && (
              <>
                <dt className="text-[var(--ft-text-muted)]">Premier octet différent</dt>
                <dd className="tabular-nums">
                  position {result.firstDifference.toLocaleString("fr-FR")} (0x
                  {result.firstDifference.toString(16)})
                </dd>
              </>
            )}
          </dl>

          {!result.identical && result.bothText && (
            <div className="mt-3">
              <Button size="sm" variant="primary" onClick={openTextDiff}>
                <Icon name="GitCompare" size={14} /> Voir les différences ligne par ligne
              </Button>
            </div>
          )}
        </div>
      )}
    />
  );
}
