import { useState } from "react";
import { NativeRequired, RunBar } from "@/components/files/NativeRun";
import { isNativeAvailable, useNativeAction } from "@/components/files/useNativeAction";
import { PathPicker } from "@/components/files/PathPicker";
import { Panel, StatGrid, Warnings } from "@/components/files/Summary";
import { Field, Fieldset, OptionGroup, TextInput } from "@/components/pdf/Field";
import { CheckOption } from "@/components/text/TextToolShell";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize, formatSizeWithExact } from "@/core/files";
import {
  buildSyncPlan,
  DEFAULT_WALK_OPTIONS,
  executeSyncPlan,
  syncIsComplete,
  type SyncAction,
  type SyncChangeTest,
  type SyncMode,
  type SyncOutcome,
  type SyncPlan,
} from "@/core/files/native";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Synchronisation d'un dossier source vers un dossier destination.
 *
 * L'outil est construit autour d'une contrainte : **rien ne s'écrit avant que
 * l'utilisateur ait lu ce qui va s'écrire.** Le bouton d'exécution n'existe pas
 * tant qu'un plan n'a pas été calculé, et le plan exécuté est exactement celui
 * qui a été affiché — pas un recalcul silencieux au moment du clic.
 *
 * Le mode miroir supprime. Il est donc traité comme ce qu'il est : une action
 * destructrice, annoncée avec le nombre de fichiers concernés, et confirmée par
 * une phrase tapée à la main lorsqu'il y a réellement quelque chose à effacer.
 */
const MODES: { value: SyncMode; label: string; hint: string }[] = [
  {
    value: "update",
    label: "Mettre à jour",
    hint: "Copie les nouveaux fichiers et remplace les modifiés. Ce que la destination a en plus est conservé.",
  },
  {
    value: "mirror",
    label: "Miroir",
    hint: "Comme « Mettre à jour », mais supprime aussi de la destination ce qui n'existe plus dans la source.",
  },
];

const TESTS: { value: SyncChangeTest; label: string; hint: string }[] = [
  {
    value: "size-and-date",
    label: "Taille et date",
    hint: "Rapide. Un fichier réécrit avec le même contenu et la même date passera pour inchangé.",
  },
  {
    value: "content",
    label: "Contenu",
    hint: "Compare les empreintes des fichiers de même taille. Plus lent, sans ambiguïté.",
  },
];

const ACTION_LABEL: Record<SyncAction, string> = {
  "create-directory": "Créer le dossier",
  copy: "Copier",
  replace: "Remplacer",
  delete: "Supprimer",
  "delete-directory": "Supprimer le dossier",
};

const ACTION_ICON: Record<SyncAction, string> = {
  "create-directory": "FolderTree",
  copy: "Plus",
  replace: "ArrowRightLeft",
  delete: "Trash2",
  "delete-directory": "Trash2",
};

/** Phrase exigée avant toute suppression : un clic ne suffit pas. */
const DELETE_CONFIRMATION = "SUPPRIMER";

export function FolderSyncTool(_props: ToolComponentProps) {
  const [source, setSource] = useState<string[]>([]);
  const [destination, setDestination] = useState<string[]>([]);
  const [mode, setMode] = useState<SyncMode>("update");
  const [test, setTest] = useState<SyncChangeTest>("size-and-date");
  const [includeHidden, setIncludeHidden] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [filter, setFilter] = useState<SyncAction | "all">("all");

  const planning = useNativeAction<SyncPlan>();
  const applying = useNativeAction<SyncOutcome>();

  if (!isNativeAvailable()) return <NativeRequired />;

  const plan = planning.result;
  const outcome = applying.result;
  const ready = source.length > 0 && destination.length > 0;
  const running = planning.job.isRunning || applying.job.isRunning;

  const forget = () => {
    planning.setResult(null);
    applying.setResult(null);
    setConfirmation("");
  };

  const deletions = plan?.deletions ?? 0;
  const confirmed = deletions === 0 || confirmation.trim().toUpperCase() === DELETE_CONFIRMATION;

  const compute = () =>
    void planning.execute((context) =>
      buildSyncPlan(
        {
          source: source[0],
          destination: destination[0],
          mode,
          test,
          walk: { ...DEFAULT_WALK_OPTIONS, includeHidden },
        },
        context,
      ),
    );

  const apply = async () => {
    if (!plan) return;
    const result = await applying.execute((context) => executeSyncPlan(plan, context));
    if (!result) return;
    planning.setResult(null);
    setConfirmation("");
    if (syncIsComplete(result)) {
      notify.success(
        "Synchronisation terminée",
        `${result.copied} copiés · ${result.replaced} remplacés · ${result.deleted} supprimés`,
      );
    } else {
      notify.error(
        "Synchronisation incomplète",
        `${result.completed} opérations sur ${result.total} terminées`,
      );
    }
  };

  const visible =
    plan?.operations.filter((operation) => filter === "all" || operation.action === filter) ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <PathPicker
          mode="directory"
          paths={source}
          onChange={(next) => {
            setSource(next);
            forget();
          }}
          label="Source"
          hint="ne sera jamais modifiée"
          disabled={running}
        />
        <PathPicker
          mode="directory"
          paths={destination}
          onChange={(next) => {
            setDestination(next);
            forget();
          }}
          label="Destination"
          hint="sera mise à jour"
          disabled={running}
        />
      </div>

      {ready && (
        <Fieldset columns={2} title="Réglages">
          <Field label="Mode" hint={MODES.find((entry) => entry.value === mode)?.hint}>
            <OptionGroup
              ariaLabel="Mode de synchronisation"
              value={mode}
              onChange={(next) => {
                setMode(next);
                forget();
              }}
              options={MODES}
              disabled={running}
            />
          </Field>
          <Field
            label="Détection des modifications"
            hint={TESTS.find((entry) => entry.value === test)?.hint}
          >
            <OptionGroup
              ariaLabel="Détection des modifications"
              value={test}
              onChange={(next) => {
                setTest(next);
                forget();
              }}
              options={TESTS}
              disabled={running}
            />
          </Field>
          <Field label="Portée" full>
            <CheckOption
              checked={includeHidden}
              onChange={(next) => {
                setIncludeHidden(next);
                forget();
              }}
              label="Inclure les fichiers cachés"
              hint="Les liens symboliques ne sont ni suivis, ni copiés, ni supprimés."
            />
          </Field>
        </Fieldset>
      )}

      {mode === "mirror" && ready && !plan && (
        <Callout tone="warning" title="Le mode miroir supprime des fichiers">
          Tout ce que la destination contient et que la source n'a pas sera effacé. Le plan vous
          dira exactement quoi, avant que quoi que ce soit ne soit touché.
        </Callout>
      )}

      {ready && !plan && !outcome && (
        <RunBar
          label="Calculer le plan"
          icon="ListChecks"
          running={planning.job.isRunning}
          progress={planning.job.progress}
          status={planning.job.status}
          error={planning.error}
          cancel={planning.job.cancel}
          onRun={compute}
        />
      )}

      {plan && (
        <div className="space-y-3" data-testid="sync-plan">
          <StatGrid
            columns={5}
            stats={[
              { label: "Fichiers à copier", value: plan.copies },
              {
                label: "Fichiers à remplacer",
                value: plan.replacements,
                tone: plan.replacements > 0 ? "warn" : "neutral",
              },
              {
                label: "À supprimer",
                value: plan.deletions,
                tone: plan.deletions > 0 ? "danger" : "neutral",
              },
              { label: "Dossiers à créer", value: plan.directories },
              { label: "Fichiers inchangés", value: plan.unchanged },
            ]}
          />

          {/*
            Le total d'opérations est dit à part, et sa composition avec lui.
            Sans cela, un résumé annonçant « 5 à copier » devant une liste de
            sept lignes laisse croire à une incohérence — alors que les deux
            chiffres comptent simplement deux choses différentes.
          */}
          <p className="ft-meta tabular-nums" data-testid="sync-plan-total">
            <strong className="text-[var(--ft-text)]">
              {plan.operations.length.toLocaleString("fr-FR")} opération
              {plan.operations.length > 1 ? "s" : ""}
            </strong>{" "}
            au total : {plan.directories} création(s) de dossier, {plan.copies} copie(s),{" "}
            {plan.replacements} remplacement(s)
            {plan.deletions > 0 && `, ${plan.deletions} suppression(s)`}. Volume à écrire :{" "}
            {formatSizeWithExact(plan.bytes)}.
            {plan.unchanged > 0 &&
              ` ${plan.unchanged} fichier(s) déjà conforme(s) ne seront pas touchés.`}
          </p>

          {plan.operations.length === 0 ? (
            <Callout tone="success" title="Rien à faire">
              La destination est déjà conforme à la source. Aucune écriture n'est nécessaire.
            </Callout>
          ) : (
            <Callout tone="info" title="Aucun fichier n'a encore été touché">
              Ce plan décrit ce qui se produira si vous l'exécutez. Il sera appliqué tel quel : si
              un fichier de la source change d'ici là, l'opération concernée sera refusée et
              signalée plutôt qu'appliquée à l'aveugle.
            </Callout>
          )}

          {plan.deletions > 0 && (
            <Callout tone="error" title={`${plan.deletions} suppression(s) dans la destination`}>
              {formatFileSize(plan.freedBytes)} seront définitivement effacés de{" "}
              <code className="font-mono">{plan.destination}</code>. Cette opération ne passe pas
              par la corbeille.
            </Callout>
          )}

          <div className="flex flex-wrap gap-1.5">
            {(["all", "copy", "replace", "delete", "delete-directory", "create-directory"] as const)
              .filter(
                (value) =>
                  value === "all" ||
                  plan.operations.some((operation) => operation.action === value),
              )
              .map((value) => {
                const count =
                  value === "all"
                    ? plan.operations.length
                    : plan.operations.filter((operation) => operation.action === value).length;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    aria-pressed={filter === value}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                      filter === value
                        ? "border-[var(--ft-accent)] bg-[var(--ft-accent-quiet)] text-[var(--ft-text)]"
                        : "border-[var(--ft-border)] text-[var(--ft-text-muted)] hover:bg-[var(--ft-hover)]"
                    }`}
                  >
                    {value === "all" ? "Tout" : ACTION_LABEL[value]} ({count})
                  </button>
                );
              })}
          </div>

          <Panel title="Opérations prévues" count={visible.length} testId="sync-operations">
            <ul className="max-h-96 divide-y divide-[var(--ft-rule)] overflow-y-auto text-xs">
              {visible.slice(0, 500).map((operation) => {
                const destructive =
                  operation.action === "delete" || operation.action === "delete-directory";
                return (
                  <li
                    key={`${operation.action}:${operation.relative}`}
                    className="flex items-start gap-2 px-3 py-1.5"
                    style={destructive ? { background: "color-mix(in oklch, var(--ft-danger) 5%, transparent)" } : undefined}
                  >
                    <span
                      className="mt-px shrink-0"
                      style={{ color: destructive ? "var(--ft-danger)" : "var(--ft-text-faint)" }}
                    >
                      <Icon name={ACTION_ICON[operation.action]} size={13} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono" title={operation.relative}>
                        {operation.relative}
                      </span>
                      <span className="block text-[11px] text-[var(--ft-text-faint)]">
                        {ACTION_LABEL[operation.action]} — {operation.reason}
                      </span>
                    </span>
                    {operation.size > 0 && (
                      <span className="shrink-0 tabular-nums text-[var(--ft-text-muted)]">
                        {formatFileSize(operation.size)}
                      </span>
                    )}
                  </li>
                );
              })}
              {visible.length > 500 && (
                <li className="px-3 py-1 text-[var(--ft-text-faint)]">
                  … et {(visible.length - 500).toLocaleString("fr-FR")} de plus
                </li>
              )}
            </ul>
          </Panel>

          <Warnings title="À savoir avant d'exécuter" items={plan.warnings} />
          <Warnings
            title="Dossiers illisibles (ignorés)"
            items={[...plan.sourceNotes.unreadable, ...plan.destinationNotes.unreadable]}
          />

          {plan.deletions > 0 && (
            <Field
              label={`Tapez « ${DELETE_CONFIRMATION} » pour autoriser les suppressions`}
              hint="Cette confirmation n'est demandée que parce que des fichiers vont être effacés."
            >
              <TextInput
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder={DELETE_CONFIRMATION}
                aria-label="Confirmation de suppression"
                autoComplete="off"
              />
            </Field>
          )}

          {plan.operations.length > 0 && (
            <RunBar
              label={
                plan.deletions > 0
                  ? `Exécuter — ${plan.operations.length} opérations dont ${plan.deletions} suppressions`
                  : `Exécuter — ${plan.operations.length} opérations`
              }
              icon="FolderSync"
              danger={plan.deletions > 0}
              disabled={!confirmed}
              running={applying.job.isRunning}
              progress={applying.job.progress}
              status={applying.job.status}
              error={applying.error}
              cancel={applying.job.cancel}
              onRun={() => void apply()}
              secondary={
                <button
                  type="button"
                  onClick={forget}
                  className="text-xs text-[var(--ft-text-muted)] underline-offset-2 hover:underline"
                >
                  Abandonner ce plan
                </button>
              }
            />
          )}
        </div>
      )}

      {outcome && <Outcome outcome={outcome} />}
    </div>
  );
}

function Outcome({ outcome }: { outcome: SyncOutcome }) {
  const complete = syncIsComplete(outcome);
  return (
    <div className="space-y-3" data-testid="sync-outcome">
      <StatGrid
        columns={5}
        stats={[
          { label: "Fichiers copiés", value: outcome.copied },
          { label: "Fichiers remplacés", value: outcome.replaced },
          {
            label: "Supprimés",
            value: outcome.deleted,
            tone: outcome.deleted > 0 ? "danger" : "neutral",
          },
          { label: "Dossiers créés", value: outcome.directoriesCreated },
          { label: "Opérations", value: `${outcome.completed} / ${outcome.total}` },
        ]}
      />

      <p className="ft-meta tabular-nums">
        Volume écrit : {formatSizeWithExact(outcome.bytes)}.
      </p>

      {complete ? (
        <Callout tone="success" title="Synchronisation terminée">
          Les {outcome.total} opérations du plan ont été appliquées.
        </Callout>
      ) : (
        <Callout
          tone="warning"
          title={
            outcome.interrupted
              ? `Synchronisation interrompue : ${outcome.completed} opérations sur ${outcome.total} terminées`
              : `Synchronisation partielle : ${outcome.completed} opérations sur ${outcome.total} terminées`
          }
        >
          Les fichiers déjà copiés sont complets et valides — chaque copie est écrite dans un
          fichier temporaire puis renommée d'un bloc. La destination n'est en revanche pas conforme
          à la source : relancez un plan pour voir ce qu'il reste à faire.
        </Callout>
      )}

      {outcome.changedSincePlan.length > 0 && (
        <Warnings
          title="Sources modifiées depuis le calcul du plan — non écrasées"
          items={outcome.changedSincePlan}
        />
      )}
      <Warnings title="Opérations en échec" items={outcome.failed} />
    </div>
  );
}
