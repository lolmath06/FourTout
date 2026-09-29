import { useState } from "react";
import { NativeRequired, RunBar } from "@/components/files/NativeRun";
import { isNativeAvailable, useNativeAction } from "@/components/files/useNativeAction";
import { PathPicker } from "@/components/files/PathPicker";
import { Panel, StatGrid, Warnings } from "@/components/files/Summary";
import { Field, Fieldset } from "@/components/pdf/Field";
import { CheckOption } from "@/components/text/TextToolShell";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize } from "@/core/files";
import {
  backupIsIntact,
  createBackup,
  DEFAULT_WALK_OPTIONS,
  verifyBackup,
  type BackupSummary,
  type BackupVerifyReport,
} from "@/core/files/native";
import { revealFile } from "@/core/output/save";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Sauvegarde d'un dossier.
 *
 * Le format est délibérément **lisible sans FourTout** : un dossier `donnees`
 * qui reproduit l'arborescence, et un `manifeste.json` qui l'inventorie avec
 * les tailles, les dates et les SHA-256. Le coût est connu — la sauvegarde
 * occupe autant que la source — et il achète quelque chose qu'aucun conteneur
 * propriétaire ne donne : si l'application disparaît, les fichiers restent
 * accessibles avec un simple explorateur.
 *
 * Le manifeste ne contient aucun chemin absolu : une sauvegarde faite sous
 * `C:\Users\…` se restaure sous `/home/…` sans rien réécrire.
 */
export function FolderBackupTool(_props: ToolComponentProps) {
  const [source, setSource] = useState<string[]>([]);
  const [destination, setDestination] = useState<string[]>([]);
  const [includeHidden, setIncludeHidden] = useState(false);

  const backup = useNativeAction<BackupSummary>();
  const verify = useNativeAction<BackupVerifyReport>();

  if (!isNativeAvailable()) return <NativeRequired />;

  const ready = source.length > 0 && destination.length > 0;
  const summary = backup.result;

  const run = async () => {
    verify.setResult(null);
    const result = await backup.execute((context) =>
      createBackup(
        source[0],
        destination[0],
        { ...DEFAULT_WALK_OPTIONS, includeHidden },
        context,
      ),
    );
    if (!result) return;
    if (result.interrupted || result.failed.length > 0) {
      notify.error(
        "Sauvegarde incomplète",
        `${result.files} fichier(s) copié(s), ${result.failed.length} en échec`,
      );
    } else {
      notify.success("Sauvegarde terminée", `${result.files} fichiers · ${formatFileSize(result.bytes)}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <PathPicker
          mode="directory"
          paths={source}
          onChange={(next) => {
            setSource(next);
            backup.setResult(null);
            verify.setResult(null);
          }}
          label="Dossier à sauvegarder"
          hint="il n'est jamais modifié"
          disabled={backup.job.isRunning}
        />
        <PathPicker
          mode="directory"
          paths={destination}
          onChange={(next) => {
            setDestination(next);
            backup.setResult(null);
          }}
          label="Où écrire la sauvegarde"
          hint="un dossier vide, ou une sauvegarde FourTout à remplacer"
          disabled={backup.job.isRunning}
        />
      </div>

      {ready && (
        <>
          <Fieldset columns={1} title="Contenu">
            <Field label="Portée">
              <CheckOption
                checked={includeHidden}
                onChange={setIncludeHidden}
                label="Inclure les fichiers cachés"
                hint="Les liens symboliques ne sont pas suivis : leur cible n'est pas sauvegardée, et le manifeste le dit."
              />
            </Field>
          </Fieldset>

          <Callout tone="info" title="Ce que cette sauvegarde est, et ce qu'elle n'est pas">
            Une copie complète et datée, vérifiable par empreinte. Ce n'est pas un historique de
            versions : elle ne conserve pas les états précédents et ne fait pas de sauvegarde
            incrémentale. Chaque sauvegarde occupe la taille de la source.
          </Callout>

          <RunBar
            label="Créer la sauvegarde"
            icon="DatabaseBackup"
            running={backup.job.isRunning}
            progress={backup.job.progress}
            status={backup.job.status}
            error={backup.error}
            cancel={backup.job.cancel}
            onRun={() => void run()}
          />
        </>
      )}

      {summary && (
        <div className="space-y-3" data-testid="backup-summary">
          <StatGrid
            columns={4}
            stats={[
              { label: "Fichiers", value: summary.files },
              { label: "Dossiers", value: summary.directories },
              { label: "Copié", value: formatFileSize(summary.bytes) },
              {
                label: "Échecs",
                value: summary.failed.length,
                tone: summary.failed.length > 0 ? "danger" : "neutral",
              },
            ]}
          />

          {summary.interrupted ? (
            <Callout tone="warning" title="Sauvegarde interrompue">
              Le manifeste ne décrit que les fichiers réellement copiés — il ne prétend pas que la
              sauvegarde est complète. Relancez-la pour obtenir une copie entière.
            </Callout>
          ) : summary.failed.length > 0 ? (
            <Callout tone="warning" title="Sauvegarde incomplète">
              Certains fichiers n'ont pas pu être copiés. Ils ne figurent pas au manifeste.
            </Callout>
          ) : (
            <Callout
              tone="success"
              title="Sauvegarde terminée"
              actions={
                <Button size="sm" onClick={() => revealFile(summary.destination)}>
                  <Icon name="FolderTree" size={13} /> Ouvrir
                </Button>
              }
            >
              Manifeste : <code className="font-mono">{summary.manifestPath}</code>
            </Callout>
          )}

          <Warnings title="Avertissements" items={summary.warnings} />
          <Warnings title="Fichiers non copiés" items={summary.failed} />

          <RunBar
            label="Vérifier l'intégrité de la sauvegarde"
            icon="ShieldCheck"
            running={verify.job.isRunning}
            progress={verify.job.progress}
            status={verify.job.status}
            error={verify.error}
            cancel={verify.job.cancel}
            onRun={() =>
              void verify.execute((context) => verifyBackup(summary.destination, context))
            }
          />
        </div>
      )}

      {verify.result && <VerifyReport report={verify.result} />}
    </div>
  );
}

/** Bilan de vérification, partagé avec l'outil de restauration. */
export function VerifyReport({ report }: { report: BackupVerifyReport }) {
  const intact = backupIsIntact(report);
  const problems = report.checks.filter((check) => check.state !== "ok");

  return (
    <div className="space-y-3" data-testid="backup-verify">
      <StatGrid
        columns={4}
        stats={[
          { label: "Intacts", value: report.ok, tone: "ok" },
          { label: "Modifiés", value: report.modified, tone: report.modified > 0 ? "danger" : "neutral" },
          { label: "Manquants", value: report.missing, tone: report.missing > 0 ? "danger" : "neutral" },
          {
            label: "Illisibles",
            value: report.unreadable,
            tone: report.unreadable > 0 ? "danger" : "neutral",
          },
        ]}
      />

      {intact ? (
        <Callout tone="success" title="Sauvegarde intacte">
          Les {report.ok} fichiers correspondent exactement aux empreintes du manifeste, écrit le{" "}
          {new Date(report.createdAt).toLocaleString("fr-FR")}.
        </Callout>
      ) : (
        <Callout tone="error" title="Cette sauvegarde est abîmée">
          Restaurer maintenant remettrait en place des fichiers qui ne sont plus ceux d'origine.
          Les fichiers concernés sont nommés ci-dessous.
        </Callout>
      )}

      {problems.length > 0 && (
        <Panel title="Fichiers en défaut" count={problems.length}>
          <ul className="max-h-72 divide-y divide-[var(--ft-rule)] overflow-y-auto text-xs">
            {problems.slice(0, 300).map((check) => (
              <li key={check.path} className="flex items-start gap-2 px-3 py-1">
                <span className="mt-px shrink-0 text-[var(--ft-danger)]">
                  <Icon name="TriangleAlert" size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono" title={check.path}>
                    {check.path}
                  </span>
                  <span className="block text-[11px] text-[var(--ft-text-muted)]">
                    {check.state === "missing"
                      ? "Absent de la sauvegarde"
                      : check.state === "modified"
                        ? "Contenu différent de celui enregistré au manifeste"
                        : "Illisible"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {report.unexpected.length > 0 && (
        <Warnings
          title="Fichiers présents dans la copie mais absents du manifeste"
          items={report.unexpected}
        />
      )}
    </div>
  );
}
