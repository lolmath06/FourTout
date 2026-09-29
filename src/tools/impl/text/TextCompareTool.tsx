import { useMemo, useState } from "react";
import { TextPane } from "@/components/text/TextToolShell";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { diffLines, toUnifiedDiff } from "@/core/text/diff";
import { DiffSideBySide, DiffUnified } from "@/components/text/DiffView";
import { notify } from "@/features/notifications/store";
import { presetString, useHandoff } from "@/features/handoff/store";
import { saveFile } from "@/core/output/save";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Comparaison de deux textes.
 *
 * Deux vues du même calcul : côte à côte (pour lire) et unifiée (pour coller
 * dans un ticket ou un message). Les fichiers déposés sur l'une ou l'autre
 * zone remplissent le panneau correspondant.
 */
type View = "side" | "unified";

export function TextCompareTool(_props: ToolComponentProps) {
  // « Comparer deux fichiers » peut nous transmettre directement les deux
  // contenus : l'utilisateur arrive sur un diff déjà prêt.
  const handoff = useHandoff("text-compare");
  const [left, setLeft] = useState(() => presetString(handoff, "left") ?? "");
  const [right, setRight] = useState(() => presetString(handoff, "right") ?? "");
  const [view, setView] = useState<View>("side");
  const [onlyChanges, setOnlyChanges] = useState(false);

  const result = useMemo(() => diffLines(left, right), [left, right]);
  const rows = onlyChanges ? result.rows.filter((row) => row.op !== "equal") : result.rows;
  const empty = left.length === 0 && right.length === 0;

  const copyUnified = async () => {
    try {
      await navigator.clipboard.writeText(toUnifiedDiff(result));
      notify.success("Diff copié");
    } catch {
      notify.error("Copie impossible");
    }
  };

  const downloadUnified = async () => {
    const bytes = new TextEncoder().encode(toUnifiedDiff(result));
    const saved = await saveFile({ name: "comparaison.diff", bytes, mimeType: "text/plain" });
    if (saved.saved) notify.success("Fichier enregistré", saved.path);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row">
        <TextPane label="Texte de gauche (avant)" value={left} onChange={setLeft} placeholder="Collez ou déposez le premier texte…" />
        <TextPane label="Texte de droite (après)" value={right} onChange={setRight} placeholder="Collez ou déposez le second texte…" />
      </div>

      <Fieldset columns={2}>
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
        <Field label="Filtre">
          <OptionGroup
            ariaLabel="Filtre"
            value={onlyChanges ? "changes" : "all"}
            onChange={(value) => setOnlyChanges(value === "changes")}
            options={[
              { value: "all", label: "Tout le texte" },
              { value: "changes", label: "Différences seules" },
            ]}
          />
        </Field>
      </Fieldset>

      {!empty && (
        <div
          data-testid="diff-summary"
          className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-sm"
        >
          {result.identical ? (
            <span className="flex items-center gap-1.5 text-[var(--ft-ok)]">
              <Icon name="CircleCheck" size={15} /> Les deux textes sont identiques
            </span>
          ) : (
            <>
              <span className="tabular-nums text-[var(--ft-ok)]">+{result.stats.added} ajoutée(s)</span>
              <span className="tabular-nums text-[var(--ft-danger)]">−{result.stats.removed} supprimée(s)</span>
              <span className="tabular-nums text-[var(--ft-warn)]">~{result.stats.modified} modifiée(s)</span>
              <span className="tabular-nums text-[var(--ft-text-muted)]">
                {result.stats.unchanged} inchangée(s)
              </span>
            </>
          )}
          <div className="flex-1" />
          <Button size="sm" onClick={downloadUnified} disabled={result.identical}>
            <Icon name="Download" size={14} /> Télécharger le diff
          </Button>
          <Button size="sm" variant="primary" onClick={copyUnified} disabled={result.identical}>
            <Icon name="Copy" size={14} /> Copier le diff
          </Button>
        </div>
      )}

      {result.truncated && (
        <p className="flex items-start gap-2 rounded-md border border-[var(--ft-border)] px-3 py-2 text-xs text-[var(--ft-warn)]">
          <Icon name="TriangleAlert" size={14} className="mt-px shrink-0" />
          Textes très longs : la comparaison est faite ligne à ligne, sans alignement fin.
        </p>
      )}

      {!empty && (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--ft-border)]">
          {view === "side" ? <DiffSideBySide rows={rows} /> : <DiffUnified rows={rows} />}
        </div>
      )}
    </div>
  );
}
