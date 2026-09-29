import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Callout, ProgressBar } from "@/components/ui/Callout";
import { PathPicker } from "@/components/files/PathPicker";
import { CheckOption } from "@/components/text/TextToolShell";
import { Field, Fieldset } from "@/components/pdf/Field";
import { useJob } from "@/core/jobs";
import { formatFileSize } from "@/core/files";
import {
  isFilesEngineAvailable,
  NATIVE_REQUIRED,
  organizeApply,
  organizePlan,
  type OrganizePlan,
  type OrganizeSummary,
} from "@/core/files/native";
import { revealFile } from "@/core/output/save";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Rangement d'un dossier par type de fichier.
 *
 * L'outil fonctionne en **deux temps, séparés par un clic explicite** :
 * il analyse et propose un plan, puis — et seulement si l'utilisateur le
 * demande — il l'applique. Un outil qui déplace des fichiers dès qu'on
 * sélectionne un dossier serait inutilisable : personne n'ose l'essayer.
 *
 * Aucun écrasement : une collision produit « nom (2).ext ». Les fichiers
 * cachés, les liens symboliques et les dossiers de rangement existants sont
 * laissés en place.
 */
export function OrganizeFolderTool(_props: ToolComponentProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const [recursive, setRecursive] = useState(false);
  const [plan, setPlan] = useState<OrganizePlan | undefined>();
  const [summary, setSummary] = useState<OrganizeSummary | undefined>();
  const planJob = useJob<OrganizePlan>();
  const applyJob = useJob<OrganizeSummary>();

  if (!isFilesEngineAvailable()) {
    return (
      <Callout tone="info" title="Application installée requise">
        {NATIVE_REQUIRED}
      </Callout>
    );
  }

  const root = paths[0];
  const running = planJob.isRunning || applyJob.isRunning;

  const analyse = async () => {
    setPlan(undefined);
    setSummary(undefined);
    const result = await planJob.run((context) =>
      organizePlan(root, recursive, { report: context.report, signal: context.signal }),
    );
    if (result) setPlan(result);
  };

  const apply = async () => {
    if (!plan) return;
    const result = await applyJob.run((context) =>
      organizeApply(
        plan.root,
        plan.moves.map((move) => ({ from: move.from, to: move.to })),
        { report: context.report, signal: context.signal },
      ),
    );
    if (result) {
      setSummary(result);
      setPlan(undefined);
      notify.success(
        "Dossier rangé",
        `${result.moved} fichier${result.moved > 1 ? "s" : ""} déplacé${result.moved > 1 ? "s" : ""}`,
      );
    }
  };

  const error =
    planJob.status === "error" && planJob.error
      ? planJob.error.message
      : applyJob.status === "error" && applyJob.error
        ? applyJob.error.message
        : undefined;

  return (
    <div className="space-y-4">
      <PathPicker
        mode="directory"
        paths={paths}
        onChange={(next) => {
          setPaths(next);
          setPlan(undefined);
          setSummary(undefined);
        }}
        label="Choisissez le dossier à ranger"
        hint="Rien n'est déplacé avant votre validation."
        disabled={running}
      />

      {root && (
        <Fieldset columns={1} title="Analyse">
          <Field label="Portée">
            <CheckOption
              checked={recursive}
              onChange={(value) => {
                setRecursive(value);
                setPlan(undefined);
              }}
              label="Descendre dans les sous-dossiers"
              hint="Désactivé par défaut : ranger récursivement un dossier déjà organisé le désorganiserait."
            />
          </Field>
        </Fieldset>
      )}

      {root && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--ft-rule)] pt-3">
          {running && (
            <Button size="sm" variant="ghost" onClick={planJob.isRunning ? planJob.cancel : applyJob.cancel}>
              Annuler
            </Button>
          )}
          <Button size="md" variant="primary" onClick={() => void analyse()} disabled={running}>
            <Icon name="Search" size={15} /> Analyser le dossier
          </Button>
        </div>
      )}

      {planJob.isRunning && (
        <ProgressBar ratio={planJob.progress.ratio} label={planJob.progress.label} />
      )}
      {applyJob.isRunning && (
        <ProgressBar ratio={applyJob.progress.ratio} label={applyJob.progress.label} />
      )}

      {error && (
        <Callout tone="error" title="L'opération a échoué">
          {error}
        </Callout>
      )}

      {plan && plan.moves.length === 0 && (
        <Callout tone="neutral" title="Rien à ranger">
          Aucun fichier à déplacer à la racine de ce dossier.
          {plan.skipped.length > 0 &&
            ` ${plan.skipped.length} élément${plan.skipped.length > 1 ? "s ont" : " a"} été laissé${plan.skipped.length > 1 ? "s" : ""} en place.`}
        </Callout>
      )}

      {plan && plan.moves.length > 0 && (
        <>
          <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
            <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">
              Plan proposé — {plan.moves.length} fichier{plan.moves.length > 1 ? "s" : ""}
            </h3>
            <table className="ft-table">
              <tbody>
                {plan.categories.map((category) => (
                  <tr key={category.name}>
                    <th scope="row" className="font-normal">
                      <span className="inline-flex items-center gap-1.5">
                        <Icon name="FolderTree" size={13} className="text-[var(--ft-text-faint)]" />
                        {category.name}/
                      </span>
                    </th>
                    <td className="ft-value text-right">
                      {category.files} fichier{category.files > 1 ? "s" : ""} ·{" "}
                      {formatFileSize(category.bytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
            <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">
              Détail des déplacements
            </h3>
            <ul className="max-h-72 divide-y divide-[var(--ft-rule)] overflow-y-auto">
              {plan.moves.map((move) => (
                <li key={move.from} className="ft-row-py flex flex-wrap items-baseline gap-x-2 px-3">
                  <span className="ft-value min-w-0 flex-1 truncate">{move.name}</span>
                  <Icon name="ArrowRight" size={12} className="shrink-0 text-[var(--ft-text-faint)]" />
                  <span className="ft-value shrink-0 text-[var(--ft-accent-text)]">{move.to}</span>
                  <span className="ft-value shrink-0 text-[var(--ft-text-faint)]">
                    {formatFileSize(move.size)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {plan.skipped.length > 0 && (
            <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
              <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">
                Laissés en place — {plan.skipped.length}
              </h3>
              <ul className="max-h-40 divide-y divide-[var(--ft-rule)] overflow-y-auto">
                {plan.skipped.map((entry) => (
                  <li key={entry} className="ft-meta ft-row-py px-3">
                    {entry}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ft-rule)] pt-3">
            <p className="ft-meta">
              Aucun fichier n'a encore bougé. En cas de nom déjà pris, le fichier est renommé
              « nom (2).ext » — rien n'est jamais écrasé.
            </p>
            <Button size="md" variant="primary" onClick={() => void apply()} disabled={running}>
              <Icon name="FolderTree" size={15} /> Organiser {plan.moves.length} fichier
              {plan.moves.length > 1 ? "s" : ""}
            </Button>
          </div>
        </>
      )}

      {summary && (
        <div
          className="rounded-[var(--radius-card)] border border-l-2 border-[var(--ft-border)] bg-[var(--ft-surface)]"
          style={{ borderLeftColor: "var(--ft-ok)" }}
        >
          <div className="flex items-start gap-2 border-b border-[var(--ft-rule)] px-3 py-2">
            <Icon name="CircleCheck" size={15} className="mt-px shrink-0 text-[var(--ft-ok)]" />
            <p className="text-[13px] font-medium leading-5">
              {summary.moved} fichier{summary.moved > 1 ? "s" : ""} déplacé
              {summary.moved > 1 ? "s" : ""}
              {summary.renamed > 0 &&
                `, dont ${summary.renamed} renommé${summary.renamed > 1 ? "s" : ""} pour éviter un écrasement`}
            </p>
          </div>
          {summary.failed.length > 0 && (
            <ul className="divide-y divide-[var(--ft-rule)]">
              {summary.failed.map((entry) => (
                <li key={entry} className="ft-meta ft-row-py px-3 text-[var(--ft-warn)]">
                  {entry}
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-[var(--ft-rule)] px-3 py-2">
            <Button size="sm" variant="ghost" onClick={() => revealFile(root)}>
              <Icon name="FolderTree" size={13} /> Ouvrir le dossier
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
