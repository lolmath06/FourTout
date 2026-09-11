import { useState } from "react";
import { NativeRequired, RunBar } from "@/components/files/NativeRun";
import { isNativeAvailable, useNativeAction } from "@/components/files/useNativeAction";
import { PathPicker } from "@/components/files/PathPicker";
import { Panel, StatGrid, Warnings } from "@/components/files/Summary";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize } from "@/core/files";
import {
  backupIsIntact,
  previewRestore,
  restoreBackup,
  verifyBackup,
  type BackupVerifyReport,
  type RestoreMode,
  type RestorePreview,
  type RestoreSummary,
} from "@/core/files/native";
import { revealFile } from "@/core/output/save";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";
import { VerifyReport } from "./FolderBackupTool";

/**
 * Restauration d'une sauvegarde FourTout.
 *
 * L'ordre des étapes est le contenu de l'outil : **lire le manifeste**, dire
 * ce qu'il contient et quelles collisions attendent dans la destination,
 * proposer de **vérifier l'intégrité**, puis seulement restaurer.
 *
 * Restaurer ne supprime jamais rien : ce que la destination contient en plus,
 * elle le garde. Un fichier de la sauvegarde dont l'empreinte ne correspond
 * plus est restauré **et nommé** — le taire serait remettre en place un fichier
 * abîmé en laissant croire que tout va bien.
 */
const MODES: { value: RestoreMode; label: string; hint: string }[] = [
  {
    value: "skip",
    label: "Ne pas écraser",
    hint: "Les fichiers déjà présents dans la destination sont conservés tels quels.",
  },
  {
    value: "overwrite",
    label: "Remplacer",
    hint: "Les fichiers déjà présents sont remplacés par ceux de la sauvegarde.",
  },
];

export function FolderRestoreTool(_props: ToolComponentProps) {
  const [backup, setBackup] = useState<string[]>([]);
  const [destination, setDestination] = useState<string[]>([]);
  const [mode, setMode] = useState<RestoreMode>("skip");

  const inspecting = useNativeAction<RestorePreview>();
  const verifying = useNativeAction<BackupVerifyReport>();
  const restoring = useNativeAction<RestoreSummary>();

  if (!isNativeAvailable()) return <NativeRequired />;

  const ready = backup.length > 0 && destination.length > 0;
  const preview = inspecting.result;
  const verification = verifying.result;
  const outcome = restoring.result;

  const forget = () => {
    inspecting.setResult(null);
    verifying.setResult(null);
    restoring.setResult(null);
  };

  const restore = async () => {
    const result = await restoring.execute((context) =>
      restoreBackup(backup[0], destination[0], mode, context),
    );
    if (!result) return;
    if (result.corrupted.length > 0 || result.failed.length > 0 || result.interrupted) {
      notify.error("Restauration incomplète", `${result.restored} fichier(s) restauré(s)`);
    } else {
      notify.success("Restauration terminée", `${result.restored} fichier(s)`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <PathPicker
          mode="directory"
          paths={backup}
          onChange={(next) => {
            setBackup(next);
            forget();
          }}
          label="Dossier de la sauvegarde"
          hint="celui qui contient « manifeste.json »"
        />
        <PathPicker
          mode="directory"
          paths={destination}
          onChange={(next) => {
            setDestination(next);
            forget();
          }}
          label="Où restaurer"
          hint="rien n'y sera supprimé"
        />
      </div>

      {ready && !preview && (
        <RunBar
          label="Lire la sauvegarde"
          icon="ArchiveRestore"
          running={inspecting.job.isRunning}
          progress={inspecting.job.progress}
          status={inspecting.job.status}
          error={inspecting.error}
          cancel={inspecting.job.cancel}
          onRun={() =>
            void inspecting.execute((context) =>
              previewRestore(backup[0], destination[0], context),
            )
          }
        />
      )}

      {preview && (
        <div className="space-y-3" data-testid="restore-preview">
          <StatGrid
            columns={4}
            stats={[
              { label: "Fichiers", value: preview.files },
              { label: "Dossiers", value: preview.directories },
              { label: "Volume", value: formatFileSize(preview.bytes) },
              {
                label: "Collisions",
                value: preview.collisions.length,
                tone: preview.collisions.length > 0 ? "warn" : "neutral",
              },
            ]}
          />

          <Callout tone="info" title={`Sauvegarde de « ${preview.sourceName} »`}>
            Créée le {new Date(preview.createdAt).toLocaleString("fr-FR")}. Rien n'a encore été
            écrit dans la destination.
          </Callout>

          <Warnings title="Avertissements enregistrés lors de la sauvegarde" items={preview.warnings} />

          {preview.collisions.length > 0 && (
            <Panel
              title="Fichiers déjà présents dans la destination"
              count={preview.collisions.length}
            >
              <ul className="max-h-56 divide-y divide-[var(--ft-rule)] overflow-y-auto text-xs">
                {preview.collisions.slice(0, 300).map((path) => (
                  <li key={path} className="truncate px-3 py-1 font-mono" title={path}>
                    {path}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <RunBar
            label="Vérifier l'intégrité avant de restaurer"
            icon="ShieldCheck"
            running={verifying.job.isRunning}
            progress={verifying.job.progress}
            status={verifying.job.status}
            error={verifying.error}
            cancel={verifying.job.cancel}
            onRun={() => void verifying.execute((context) => verifyBackup(backup[0], context))}
          />

          {verification && <VerifyReport report={verification} />}

          {verification && !backupIsIntact(verification) && (
            <Callout tone="error" title="Restaurer une sauvegarde abîmée">
              Vous pouvez restaurer malgré tout : les fichiers en défaut seront copiés **et
              signalés** dans le bilan, pour que vous sachiez exactement lesquels ne sont plus
              d'origine.
            </Callout>
          )}

          <Fieldset columns={1} title="En cas de collision">
            <Field label="Mode" hint={MODES.find((entry) => entry.value === mode)?.hint}>
              <OptionGroup
                ariaLabel="Mode de restauration"
                value={mode}
                onChange={setMode}
                options={MODES}
              />
            </Field>
          </Fieldset>

          {mode === "overwrite" && preview.collisions.length > 0 && (
            <Callout tone="warning" title={`${preview.collisions.length} fichier(s) seront remplacés`}>
              Leur contenu actuel dans la destination sera perdu.
            </Callout>
          )}

          <RunBar
            label={`Restaurer ${preview.files} fichier(s)`}
            icon="ArchiveRestore"
            danger={mode === "overwrite" && preview.collisions.length > 0}
            running={restoring.job.isRunning}
            progress={restoring.job.progress}
            status={restoring.job.status}
            error={restoring.error}
            cancel={restoring.job.cancel}
            onRun={() => void restore()}
          />
        </div>
      )}

      {outcome && (
        <div className="space-y-3" data-testid="restore-summary">
          <StatGrid
            columns={4}
            stats={[
              { label: "Restaurés", value: outcome.restored, tone: "ok" },
              { label: "Conservés", value: outcome.skipped.length },
              {
                label: "Abîmés",
                value: outcome.corrupted.length,
                tone: outcome.corrupted.length > 0 ? "danger" : "neutral",
              },
              { label: "Écrit", value: formatFileSize(outcome.bytes) },
            ]}
          />

          {outcome.corrupted.length === 0 && outcome.failed.length === 0 && !outcome.interrupted ? (
            <Callout
              tone="success"
              title="Restauration terminée"
              actions={
                <Button size="sm" onClick={() => revealFile(outcome.destination)}>
                  <Icon name="FolderTree" size={13} /> Ouvrir
                </Button>
              }
            >
              Tous les fichiers restaurés correspondent aux empreintes du manifeste.
            </Callout>
          ) : (
            <Callout
              tone="warning"
              title={outcome.interrupted ? "Restauration interrompue" : "Restauration à vérifier"}
            >
              Les fichiers déjà écrits sont complets. La destination n'est en revanche pas
              intégralement conforme à la sauvegarde.
            </Callout>
          )}

          <Warnings
            title="Restaurés mais ne correspondant plus au manifeste"
            items={outcome.corrupted}
          />
          <Warnings title="En échec" items={outcome.failed} />
          {outcome.skipped.length > 0 && (
            <Panel title="Conservés (déjà présents dans la destination)" count={outcome.skipped.length}>
              <ul className="max-h-56 divide-y divide-[var(--ft-rule)] overflow-y-auto text-xs">
                {outcome.skipped.slice(0, 300).map((path) => (
                  <li key={path} className="truncate px-3 py-1 font-mono" title={path}>
                    {path}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
