import { useState } from "react";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Callout, ProgressBar } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { DiffSideBySide, DiffStatsBar, DiffUnified } from "@/components/text/DiffView";
import { useJob } from "@/core/jobs";
import { readSelectedFile } from "@/core/image/codec";
import { toUnifiedDiff } from "@/core/text/diff";
import { toTextError } from "@/core/text/errors";
import {
  compareDocuments,
  COMPARE_MODE_LABELS,
  DOCUMENT_FORMAT_LABELS,
  type CompareMode,
  type DocumentComparison,
} from "@/core/text/documents";
import { saveFile } from "@/core/output/save";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Comparaison de deux documents.
 *
 * L'outil n'apporte **aucun** algorithme de différence : il amène deux
 * documents — quel que soit leur format — à du texte comparable
 * (`core/text/documents`), puis affiche le résultat du moteur de diff déjà
 * utilisé par « Comparer deux textes », avec les mêmes composants.
 */
type View = "side" | "unified";

export function DocumentCompareTool({ tool }: ToolComponentProps) {
  const [left, setLeft] = useState<SelectedFile[]>([]);
  const [right, setRight] = useState<SelectedFile[]>([]);
  const [mode, setMode] = useState<CompareMode>("normalized");
  const [view, setView] = useState<View>("side");
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [result, setResult] = useState<DocumentComparison | null>(null);
  const job = useJob<DocumentComparison>();

  const constraints = { ...constraintsForTool(tool), maxFiles: 1 };

  const run = async () => {
    if (!left[0] || !right[0]) return;
    setResult(null);
    const [a, b] = await Promise.all([
      readSelectedFile(left[0]),
      readSelectedFile(right[0]),
    ]);
    const comparison = await job.run((context) =>
      compareDocuments(
        { name: left[0].name, bytes: a, extension: left[0].extension },
        { name: right[0].name, bytes: b, extension: right[0].extension },
        { mode },
        { report: context.report, signal: context.signal },
      ),
    );
    if (comparison) {
      setResult(comparison);
      notify.success(
        comparison.diff.identical ? "Documents identiques" : "Comparaison terminée",
        `${comparison.left.name} ↔ ${comparison.right.name}`,
      );
    }
  };

  const download = async () => {
    if (!result) return;
    const text = toUnifiedDiff(result.diff, result.left.name, result.right.name);
    const saved = await saveFile({
      name: "comparaison.diff",
      bytes: new TextEncoder().encode(text),
      mimeType: "text/plain;charset=utf-8",
    });
    if (saved.saved) notify.success("Fichier enregistré", saved.path);
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(
        toUnifiedDiff(result.diff, result.left.name, result.right.name),
      );
      notify.success("Diff copié");
    } catch {
      notify.error("Copie impossible");
    }
  };

  const rows = result
    ? onlyChanges
      ? result.diff.rows.filter((row) => row.op !== "equal")
      : result.diff.rows
    : [];
  const errorMessage = job.error ? toTextError(job.error.cause).message : undefined;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <p className="ft-section">Document de référence (avant)</p>
          <FileDropZone
            constraints={constraints}
            files={left}
            onChange={setLeft}
            label="Déposez le premier document"
            hint="PDF, Word (.docx), texte, Markdown ou HTML."
            disabled={job.isRunning}
          />
        </div>
        <div className="space-y-1.5">
          <p className="ft-section">Document à comparer (après)</p>
          <FileDropZone
            constraints={constraints}
            files={right}
            onChange={setRight}
            label="Déposez le second document"
            hint="Les deux documents peuvent être de formats différents."
            disabled={job.isRunning}
          />
        </div>
      </div>

      <Fieldset columns={2}>
        <Field
          label="Mode de comparaison"
          hint="« Normalisé » ignore les espaces multiples, les fins de ligne et les césures de PDF. Aucun mot n'est jamais masqué."
        >
          <OptionGroup
            ariaLabel="Mode de comparaison"
            value={mode}
            onChange={setMode}
            options={(["exact", "normalized"] as CompareMode[]).map((value) => ({
              value,
              label: COMPARE_MODE_LABELS[value],
            }))}
            disabled={job.isRunning}
          />
        </Field>
        <Field label="Affichage">
          <OptionGroup
            ariaLabel="Affichage"
            value={view}
            onChange={setView}
            options={[
              { value: "side", label: "Côte à côte" },
              { value: "unified", label: "Diff unifié" },
            ]}
          />
        </Field>
      </Fieldset>

      <div className="flex items-center justify-end gap-2 border-t border-[var(--ft-border)] pt-4">
        {job.isRunning && (
          <Button size="sm" variant="ghost" onClick={job.cancel}>
            Annuler
          </Button>
        )}
        <Button
          size="md"
          variant="primary"
          onClick={run}
          disabled={!left[0] || !right[0] || job.isRunning}
        >
          {job.isRunning ? (
            <>
              <Icon name="Loader" size={15} className="animate-spin" />
              {job.progress.label ?? "Comparaison…"}
            </>
          ) : (
            <>
              <Icon name="FileDiff" size={15} />
              Comparer
            </>
          )}
        </Button>
      </div>

      {job.isRunning && <ProgressBar ratio={job.progress.ratio} label={job.progress.label} />}

      {errorMessage && job.status === "error" && (
        <Callout tone="error" title="La comparaison a échoué">
          {errorMessage}
        </Callout>
      )}

      {result && (
        <>
          <p className="ft-meta">
            {DOCUMENT_FORMAT_LABELS[result.left.format]} « {result.left.name} » ↔{" "}
            {DOCUMENT_FORMAT_LABELS[result.right.format]} « {result.right.name} » · comparaison sur
            le contenu textuel, pas sur la mise en page.
          </p>

          <DiffStatsBar stats={result.diff.stats} identical={result.diff.identical}>
            <Button size="sm" onClick={() => setOnlyChanges((value) => !value)}>
              <Icon name="Eye" size={14} />
              {onlyChanges ? "Tout le texte" : "Différences seules"}
            </Button>
            <Button size="sm" onClick={download} disabled={result.diff.identical}>
              <Icon name="Download" size={14} /> Télécharger le diff
            </Button>
            <Button size="sm" variant="primary" onClick={copy} disabled={result.diff.identical}>
              <Icon name="Copy" size={14} /> Copier le diff
            </Button>
          </DiffStatsBar>

          {result.diff.truncated && (
            <Callout tone="warning">
              Documents très longs : la comparaison est faite ligne à ligne, sans alignement fin.
            </Callout>
          )}

          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--ft-border)]">
            {view === "side" ? <DiffSideBySide rows={rows} /> : <DiffUnified rows={rows} />}
          </div>
        </>
      )}
    </div>
  );
}
