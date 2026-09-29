import { useCallback, useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Button } from "@/components/ui/Button";
import { Callout, ProgressBar } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { PathPicker } from "@/components/files/PathPicker";
import {
  DIAGNOSTICS_NATIVE_REQUIRED,
  HEALTH_LABELS,
  inspectFile,
  isDiagnosticsAvailable,
  REPAIRABILITY_LABELS,
  sha256,
  unchanged,
  type DiagnosticReport,
  type Finding,
  type Health,
  type RepairAction,
  type Severity,
} from "@/core/diagnostics/native";
import { formatSize } from "@/core/disks/native";

/**
 * Ossature commune aux quatre écrans de diagnostic.
 *
 * Elle impose l'ordre dans lequel l'utilisateur découvre les choses, et cet
 * ordre est le fond du sujet : **ce qui est cassé**, **ce qui est intact**, **ce
 * que FourTout peut faire**, **ce que cela coûtera**, et seulement ensuite le
 * bouton. Un écran de réparation qui met le bouton en premier obtient des clics
 * sans consentement.
 *
 * Elle porte aussi la preuve qui fonde toute la phase : l'empreinte du fichier
 * source est calculée avant l'opération et recalculée après, et le résultat est
 * affiché. La promesse « votre fichier n'a pas été touché » n'est pas une
 * phrase rassurante, c'est une vérification.
 */

const SEVERITY_STYLE: Record<Severity, { icon: string; className: string; label: string }> = {
  info: { icon: "CircleCheck", className: "text-[var(--ft-text-muted)]", label: "Constat" },
  warning: { icon: "CircleAlert", className: "text-[var(--ft-warn)]", label: "Anomalie" },
  error: { icon: "TriangleAlert", className: "text-[var(--ft-danger)]", label: "Dommage" },
};

const HEALTH_TONE: Record<Health, "success" | "warning" | "error"> = {
  healthy: "success",
  suspicious: "warning",
  damaged: "error",
  unreadable: "error",
};

/** Ce qu'une action a produit, tel que l'écran doit le raconter. */
export interface ActionOutcome {
  title: string;
  tone: "success" | "warning" | "error";
  /** Phrase au sens strict : « réparé », « partiellement récupéré »… */
  summary: string;
  /** Ce qui a été conservé, mesuré. */
  kept: string[];
  /** Ce qui a été perdu, mesuré. */
  lost: string[];
  /** Chemin du fichier ou du dossier produit. */
  output?: string;
  /** Bloc libre : vérification, aperçu, tableau. */
  extra?: ReactNode;
}

export interface DiagnosticShellProps {
  /** Extensions proposées par la boîte de dialogue. */
  filters?: { name: string; extensions: string[] }[];
  label: string;
  hint: string;
  /** Chemin reçu d'un autre outil. */
  initialPath?: string;
  /** Constats propres au format, sous le tableau commun. */
  structure?: (report: DiagnosticReport) => ReactNode;
  /** Exécute une action. Renvoie ce qu'il faut afficher. */
  onAction: (
    action: RepairAction,
    report: DiagnosticReport,
    context: { signal: AbortSignal; report: (update: { ratio?: number; label: string }) => void },
  ) => Promise<ActionOutcome>;
  /** Message affiché quand le format n'est pas celui de cet outil. */
  wrongFormat?: (report: DiagnosticReport) => string | undefined;
}

export function DiagnosticShell({
  filters,
  label,
  hint,
  initialPath,
  structure,
  onAction,
  wrongFormat,
}: DiagnosticShellProps) {
  const [paths, setPaths] = useState<string[]>(initialPath ? [initialPath] : []);
  const [report, setReport] = useState<DiagnosticReport | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionOutcome | undefined>();
  const [sourceIntact, setSourceIntact] = useState<boolean | undefined>();
  const [progress, setProgress] = useState<{ ratio?: number; label: string } | undefined>();
  const [controller, setController] = useState<AbortController | undefined>();

  const path = paths[0];
  const available = isDiagnosticsAvailable();

  useEffect(() => {
    if (!path) {
      setReport(undefined);
      setOutcome(undefined);
      setError(undefined);
      setSourceIntact(undefined);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(undefined);
    setOutcome(undefined);
    setSourceIntact(undefined);
    inspectFile(path)
      .then((result) => {
        if (!cancelled) setReport(result);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setReport(undefined);
        setError(failure instanceof Error ? failure.message : "Diagnostic impossible.");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const run = useCallback(
    async (action: RepairAction) => {
      if (!report) return;
      const abort = new AbortController();
      setController(abort);
      setBusy(true);
      setError(undefined);
      setOutcome(undefined);
      setSourceIntact(undefined);
      setProgress({ label: action.title });
      try {
        const result = await onAction(action, report, {
          signal: abort.signal,
          report: (update) => setProgress(update),
        });
        setOutcome(result);
        // La preuve, pas la promesse : on recalcule l'empreinte de la source.
        const after = await sha256(report.path);
        setSourceIntact(unchanged(report.sha256, after));
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Opération impossible.");
        try {
          const after = await sha256(report.path);
          setSourceIntact(unchanged(report.sha256, after));
        } catch {
          setSourceIntact(undefined);
        }
      } finally {
        setBusy(false);
        setProgress(undefined);
        setController(undefined);
      }
    },
    [onAction, report],
  );

  const mismatch = report && wrongFormat ? wrongFormat(report) : undefined;

  return (
    <div className="space-y-4">
      {!available && <Callout tone="warning">{DIAGNOSTICS_NATIVE_REQUIRED}</Callout>}

      <PathPicker mode="files" paths={paths} onChange={setPaths} label={label} hint={hint} filters={filters} />

      {error && <Callout tone="error">{error}</Callout>}

      {busy && !progress && report === undefined && (
        <p className="ft-meta flex items-center gap-2">
          <Icon name="Loader" size={13} className="animate-spin" /> Lecture du fichier…
        </p>
      )}

      {report && (
        <>
          <section className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2">
            <p className="ft-value">
              <strong>{report.name}</strong> · {formatSize(report.size)} ·{" "}
              {report.detectedLabel}
              {report.extension && ` · nom en « .${report.extension} »`}
            </p>
            <p className="ft-meta">
              Empreinte SHA-256 avant toute opération : <code>{report.sha256.slice(0, 32)}…</code>
            </p>
          </section>

          {mismatch ? (
            <Callout tone="warning" title="Ce n'est pas le format de cet outil">
              {mismatch}
            </Callout>
          ) : (
            <>
              <Callout
                tone={HEALTH_TONE[report.health]}
                title={HEALTH_LABELS[report.health]}
              >
                {report.findings.length === 1
                  ? "Un constat."
                  : `${report.findings.length} constats, du plus anodin au plus sérieux.`}
              </Callout>

              <FindingList findings={report.findings} />

              {structure?.(report)}

              <ActionList
                actions={report.actions}
                busy={busy}
                onRun={(action) => void run(action)}
              />
            </>
          )}

          {progress && (
            <div className="space-y-2">
              <ProgressBar ratio={progress.ratio} label={progress.label} />
              {controller && (
                <Button size="sm" variant="ghost" onClick={() => controller.abort()}>
                  <Icon name="X" size={13} /> Arrêter
                </Button>
              )}
            </div>
          )}

          {outcome && <Outcome outcome={outcome} />}

          {sourceIntact !== undefined && (
            <Callout
              tone={sourceIntact ? "success" : "error"}
              title={
                sourceIntact
                  ? "Fichier source inchangé — vérifié"
                  : "L'empreinte de la source a changé"
              }
            >
              {sourceIntact
                ? "L'empreinte SHA-256 du fichier d'origine a été recalculée après l'opération : elle est identique. Rien n'a été écrit dessus."
                : "L'empreinte du fichier d'origine n'est plus la même qu'avant l'opération. Cela ne devrait jamais arriver : signalez-le."}
            </Callout>
          )}
        </>
      )}
    </div>
  );
}

/** Les constats, du plus grave au plus anodin. */
function FindingList({ findings }: { findings: Finding[] }) {
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity]);

  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
      <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">Constats</h3>
      <ul className="divide-y divide-[var(--ft-rule)]">
        {sorted.map((finding) => {
          const style = SEVERITY_STYLE[finding.severity];
          return (
            <li key={finding.code} className="ft-row-py px-3">
              <div className="flex items-baseline gap-2">
                <Icon name={style.icon} size={13} className={clsx("shrink-0", style.className)} />
                <span className="ft-value font-medium">{finding.title}</span>
                <span className="ft-meta shrink-0">{style.label}</span>
              </div>
              <p className="ft-meta mt-0.5">{finding.detail}</p>
              {finding.repairability !== "none" && (
                <p className="ft-meta mt-0.5 text-[var(--ft-text-faint)]">
                  {REPAIRABILITY_LABELS[finding.repairability]}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Les actions, chacune avec ce qu'elle coûte. */
function ActionList({
  actions,
  busy,
  onRun,
}: {
  actions: RepairAction[];
  busy: boolean;
  onRun: (action: RepairAction) => void;
}) {
  if (actions.length === 0) {
    return (
      <Callout tone="neutral" title="Aucune correction automatique">
        FourTout n'a pas de réparation qu'il puisse justifier sur ce fichier. Plutôt qu'un bouton
        qui produirait quelque chose de douteux, il préfère s'en tenir au diagnostic ci-dessus.
      </Callout>
    );
  }

  return (
    <section className="space-y-2">
      <h3 className="ft-section">Ce que FourTout peut faire</h3>
      {actions.map((action) => (
        <div
          key={action.id}
          className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3"
        >
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="ft-value font-medium">{action.title}</span>
            <span className="ft-meta">{REPAIRABILITY_LABELS[action.repairability]}</span>
          </div>
          <p className="ft-meta mt-1">{action.detail}</p>
          {action.costs.length > 0 && (
            <div className="mt-2">
              <p className="ft-meta font-medium text-[var(--ft-warn)]">Ce qui sera perdu :</p>
              <ul className="ft-meta list-disc pl-4">
                {action.costs.map((cost) => (
                  <li key={cost}>{cost}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="ft-meta mt-2">
            Le fichier d'origine n'est pas modifié : le résultat est écrit à côté, sous un nouveau
            nom.
          </p>
          <div className="mt-2">
            <Button size="sm" variant="primary" disabled={busy} onClick={() => onRun(action)}>
              <Icon name="Wrench" size={13} /> {action.title}
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}

function Outcome({ outcome }: { outcome: ActionOutcome }) {
  return (
    <div className="space-y-2">
      <Callout tone={outcome.tone} title={outcome.title}>
        {outcome.summary}
      </Callout>

      {(outcome.kept.length > 0 || outcome.lost.length > 0) && (
        <section className="grid gap-3 sm:grid-cols-2">
          {outcome.kept.length > 0 && (
            <div className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3">
              <h4 className="ft-section">Conservé</h4>
              <ul className="ft-meta mt-1 list-disc pl-4">
                {outcome.kept.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {outcome.lost.length > 0 && (
            <div className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3">
              <h4 className="ft-section">Perdu</h4>
              <ul className="ft-meta mt-1 list-disc pl-4">
                {outcome.lost.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {outcome.output && (
        <p className="ft-meta">
          Écrit dans <code>{outcome.output}</code>
        </p>
      )}

      {outcome.extra}
    </div>
  );
}

/** Tableau de propriétés techniques, partagé par les volets « Structure ». */
export function StructureTable({
  caption,
  rows,
}: {
  caption: string;
  rows: { label: string; value: string }[];
}) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
      <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">{caption}</h3>
      <div className="overflow-x-auto">
        <table className="ft-table">
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="w-1/2 font-normal">
                  {row.label}
                </th>
                <td className="ft-value text-right">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
