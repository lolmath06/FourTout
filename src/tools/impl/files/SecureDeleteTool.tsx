import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Callout, ProgressBar } from "@/components/ui/Callout";
import { PathPicker } from "@/components/files/PathPicker";
import { Field, Fieldset, OptionGroup, TextInput } from "@/components/pdf/Field";
import { useJob } from "@/core/jobs";
import { formatFileSize } from "@/core/files";
import {
  isFilesEngineAvailable,
  NATIVE_REQUIRED,
  secureDelete,
  WIPE_CONFIRMATION,
  type WipeMode,
  type WipeSummary,
} from "@/core/files/native";
import { baseName } from "@/core/files/paths";
import type { ToolComponentProps } from "@/tools/implementations";

const MODES: { value: WipeMode; label: string; hint: string }[] = [
  {
    value: "random",
    label: "1 passe aléatoire",
    hint: "Suffisant face à une récupération logicielle sur un disque classique.",
  },
  {
    value: "three-pass",
    label: "3 passes",
    hint: "Zéros, uns, puis aléatoire. Plus long, sans garantie supplémentaire sur un support moderne.",
  },
  {
    value: "none",
    label: "Aucune réécriture",
    hint: "Suppression simple, sans écrasement du contenu.",
  },
];

/**
 * Effacement logiciel renforcé.
 *
 * Le catalogue nomme cet outil « Suppression sécurisée », mais l'écran ne
 * promet **que ce qui est tenable** : écraser le contenu à l'emplacement
 * actuel du fichier, forcer l'écriture sur le support, puis supprimer.
 *
 * Sur un SSD, une carte mémoire, un système à copie sur écriture, en présence
 * d'instantanés ou de sauvegardes, aucun logiciel ne peut garantir la
 * disparition physique des copies antérieures — c'est le contrôleur ou le
 * système de fichiers qui décide où les données ont été écrites. Cet
 * avertissement est affiché avant l'action, pas après.
 *
 * Deux garde-fous : la phrase de confirmation doit être tapée à l'identique,
 * et elle est revérifiée par la couche native. Un clic égaré ne peut rien
 * déclencher.
 */
export function SecureDeleteTool(_props: ToolComponentProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const [mode, setMode] = useState<WipeMode>("random");
  const [typed, setTyped] = useState("");
  const [summary, setSummary] = useState<WipeSummary | undefined>();
  const job = useJob<WipeSummary>();

  if (!isFilesEngineAvailable()) {
    return (
      <Callout tone="info" title="Application installée requise">
        {NATIVE_REQUIRED}
      </Callout>
    );
  }

  const confirmed = typed.trim().toUpperCase() === WIPE_CONFIRMATION;

  const execute = async () => {
    setSummary(undefined);
    const result = await job.run((context) =>
      secureDelete(paths, mode, WIPE_CONFIRMATION, {
        report: context.report,
        signal: context.signal,
      }),
    );
    if (result) {
      setSummary(result);
      setPaths([]);
      setTyped("");
    }
  };

  const error = job.status === "error" && job.error ? job.error.message : undefined;

  return (
    <div className="space-y-4">
      <Callout tone="warning" title="Ce que cet outil peut promettre, et ce qu'il ne peut pas">
        Sur un SSD, une carte mémoire, un système de fichiers à copie sur écriture (Btrfs, ZFS,
        APFS), en présence d'instantanés, d'un journal, d'une corbeille ou d'une sauvegarde, aucun
        logiciel ne peut garantir la disparition physique de toutes les copies antérieures : le
        contrôleur ou le système décide seul où les données ont été écrites.
        <br />
        <br />
        FourTout écrase le contenu à l'emplacement actuel du fichier, force l'écriture sur le
        support, renomme l'entrée puis la supprime. C'est un <strong>effacement logiciel
        renforcé</strong>, pas un effacement physique. Pour un secret critique sur un SSD, le
        chiffrement intégral du disque est la seule réponse fiable.
      </Callout>

      <PathPicker
        mode="files"
        paths={paths}
        onChange={(next) => {
          setPaths(next);
          setTyped("");
          setSummary(undefined);
        }}
        multiple
        label="Choisissez les fichiers à effacer"
        hint="Fichiers uniquement. Les dossiers et les liens symboliques ne sont pas traités."
        disabled={job.isRunning}
      />

      {paths.length > 0 && (
        <>
          <Fieldset columns={1} title="Méthode">
            <Field
              label="Réécriture"
              hint={MODES.find((entry) => entry.value === mode)?.hint}
            >
              <OptionGroup
                ariaLabel="Méthode de réécriture"
                value={mode}
                onChange={setMode}
                disabled={job.isRunning}
                options={MODES.map((entry) => ({ value: entry.value, label: entry.label }))}
              />
            </Field>
          </Fieldset>

          <Fieldset columns={1} title="Confirmation">
            <Field
              label={`Tapez « ${WIPE_CONFIRMATION} » pour débloquer l'effacement`}
              hint="Cette opération est irréversible : les fichiers ne passent pas par la corbeille."
            >
              <TextInput
                value={typed}
                autoComplete="off"
                spellCheck={false}
                placeholder={WIPE_CONFIRMATION}
                onChange={(event) => setTyped(event.target.value)}
                aria-label="Phrase de confirmation"
                data-testid="wipe-confirmation"
                className="font-mono"
              />
            </Field>
          </Fieldset>

          <section className="overflow-hidden rounded-[var(--radius-card)] border border-[color-mix(in_oklch,var(--ft-danger)_35%,var(--ft-border))] bg-[var(--ft-surface)]">
            <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">
              {paths.length} fichier{paths.length > 1 ? "s" : ""} sera
              {paths.length > 1 ? "ont" : ""} définitivement effacé{paths.length > 1 ? "s" : ""}
            </h3>
            <ul className="max-h-56 divide-y divide-[var(--ft-rule)] overflow-y-auto">
              {paths.map((path) => (
                <li key={path} className="ft-row-py flex items-center gap-2 px-3">
                  <Icon name="File" size={13} className="shrink-0 text-[var(--ft-danger)]" />
                  <span className="ft-value min-w-0 flex-1 truncate" title={path}>
                    {baseName(path)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--ft-rule)] pt-3">
            {job.isRunning && (
              <Button size="sm" variant="ghost" onClick={job.cancel}>
                Annuler
              </Button>
            )}
            <Button
              size="md"
              variant="danger"
              onClick={() => void execute()}
              disabled={!confirmed || job.isRunning}
            >
              <Icon name="Trash2" size={15} />
              {job.isRunning ? "Effacement…" : "Effacer définitivement"}
            </Button>
          </div>
        </>
      )}

      {job.isRunning && <ProgressBar ratio={job.progress.ratio} label={job.progress.label} />}

      {error && (
        <Callout tone="error" title="L'opération a échoué">
          {error}
        </Callout>
      )}

      {summary && (
        <>
          <div
            className="rounded-[var(--radius-card)] border border-l-2 border-[var(--ft-border)] bg-[var(--ft-surface)]"
            style={{ borderLeftColor: summary.failed > 0 ? "var(--ft-warn)" : "var(--ft-ok)" }}
          >
            <div className="flex items-start gap-2 border-b border-[var(--ft-rule)] px-3 py-2">
              <Icon
                name={summary.failed > 0 ? "TriangleAlert" : "CircleCheck"}
                size={15}
                className={`mt-px shrink-0 ${summary.failed > 0 ? "text-[var(--ft-warn)]" : "text-[var(--ft-ok)]"}`}
              />
              <p className="text-[13px] font-medium leading-5">
                {summary.deleted} fichier{summary.deleted > 1 ? "s" : ""} effacé
                {summary.deleted > 1 ? "s" : ""} — {formatFileSize(summary.bytes)} réécrit
                {summary.failed > 0 && ` · ${summary.failed} en échec`}
              </p>
            </div>
            <ul className="divide-y divide-[var(--ft-rule)]">
              {summary.results.map((entry) => (
                <li key={entry.path} className="ft-row-py flex items-center gap-2 px-3">
                  <Icon
                    name={entry.error ? "CircleAlert" : "Check"}
                    size={13}
                    className={`shrink-0 ${entry.error ? "text-[var(--ft-danger)]" : "text-[var(--ft-ok)]"}`}
                  />
                  <span className="ft-value min-w-0 flex-1 truncate">{baseName(entry.path)}</span>
                  <span className="ft-meta shrink-0">
                    {entry.error ?? `${entry.passes} passe${entry.passes > 1 ? "s" : ""}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <Callout tone="neutral" title="Rappel">
            {summary.notice}
          </Callout>
        </>
      )}
    </div>
  );
}
