import { useState } from "react";
import clsx from "clsx";
import { Button } from "@/components/ui/Button";
import { Callout, ProgressBar } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { Field, Fieldset, NumberInput, TextInput } from "@/components/pdf/Field";
import {
  checkPorts,
  isNetworkEngineAvailable,
  MAX_PORTS,
  NETWORK_NATIVE_REQUIRED,
  PORT_STATUS_EXPLANATIONS,
  PORT_STATUS_LABELS,
  SERVICE_DISCLAIMER,
  type PortScanSummary,
  type PortStatus,
} from "@/core/network/native";
import { JobCancelledError } from "@/core/jobs/types";
import type { ToolComponentProps } from "@/tools/implementations";

const STATUS_CLASS: Record<PortStatus, string> = {
  open: "text-[var(--ft-success)] font-semibold",
  closed: "text-[var(--ft-text-muted)]",
  filtered: "text-[var(--ft-warning)]",
};

/**
 * Test de ports TCP sur un hôte choisi.
 *
 * Un outil de diagnostic, et les limites qui vont avec : un seul hôte, 256
 * ports au maximum par lancement, une connexion TCP ordinaire refermée aussitôt
 * qu'elle aboutit. Rien n'est envoyé sur la connexion, aucune bannière n'est
 * lue, et le nom de service affiché vient d'une table de numéros — pas d'une
 * détection.
 */
export function PortCheckTool(_props: ToolComponentProps) {
  const [host, setHost] = useState("127.0.0.1");
  const [spec, setSpec] = useState("22, 80, 443, 8000-8010");
  const [timeout, setTimeoutMs] = useState(1000);
  const [summary, setSummary] = useState<PortScanSummary | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [progress, setProgress] = useState<{ ratio?: number; label: string } | undefined>();
  const [running, setRunning] = useState(false);
  const [controller, setController] = useState<AbortController | undefined>();

  const available = isNetworkEngineAvailable();

  const run = async () => {
    const abort = new AbortController();
    setController(abort);
    setRunning(true);
    setError(undefined);
    setSummary(undefined);
    setProgress({ label: "Test des ports…" });
    try {
      setSummary(
        await checkPorts(
          host,
          spec,
          { timeoutMs: timeout },
          { signal: abort.signal, report: (update) => setProgress({ ...update, label: update.label ?? "Test des ports…" }) },
        ),
      );
    } catch (failure) {
      if (failure instanceof JobCancelledError) setError("Test interrompu.");
      else setError(failure instanceof Error ? failure.message : "Test impossible.");
    } finally {
      setRunning(false);
      setProgress(undefined);
      setController(undefined);
    }
  };

  return (
    <div className="space-y-4">
      {!available && <Callout tone="warning">{NETWORK_NATIVE_REQUIRED}</Callout>}

      <Callout tone="neutral" title="Un outil de diagnostic, pas un scanner">
        Un seul hôte à la fois, {MAX_PORTS} ports au maximum par lancement, par connexion TCP
        ordinaire. Une demande du type « 1-65535 » est refusée : ce n'est pas l'usage de cet outil.
      </Callout>

      <Fieldset columns={1}>
        <Field label="Hôte ou adresse IP">
          <TextInput
            value={host}
            onChange={(event) => setHost(event.target.value)}
            aria-label="Hôte ou adresse IP"
            placeholder="192.168.1.1"
            autoFocus
          />
        </Field>
      </Fieldset>

      <Fieldset columns={2}>
        <Field
          label="Ports"
          hint="Liste et plages séparées par des virgules : 22, 80, 443, 8000-8010."
        >
          <TextInput
            value={spec}
            onChange={(event) => setSpec(event.target.value)}
            aria-label="Ports à tester"
          />
        </Field>
        <Field label="Délai d'attente (ms)" hint="De 100 à 10 000.">
          <NumberInput
            value={timeout}
            min={100}
            max={10000}
            step={100}
            onChange={(event) => setTimeoutMs(Number(event.target.value))}
            aria-label="Délai d'attente"
          />
        </Field>
      </Fieldset>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={run}
          disabled={!available || running || host.trim().length === 0}
        >
          <Icon name="PlugZap" size={14} /> {running ? "Test en cours…" : "Tester les ports"}
        </Button>
        {running && (
          <Button variant="ghost" onClick={() => controller?.abort()}>
            <Icon name="X" size={14} /> Arrêter
          </Button>
        )}
      </div>

      {progress && <ProgressBar ratio={progress.ratio} label={progress.label} />}

      {error && <Callout tone="error">{error}</Callout>}

      {summary && (
        <>
          <p className="ft-value">
            {summary.host} ({summary.resolved}) · {summary.tested} port
            {summary.tested > 1 ? "s" : ""} testé{summary.tested > 1 ? "s" : ""} ·{" "}
            <strong>{summary.open} ouvert{summary.open > 1 ? "s" : ""}</strong> ·{" "}
            {summary.closed} fermé{summary.closed > 1 ? "s" : ""} · {summary.filtered} sans réponse
            {summary.cancelled && " · interrompu avant la fin"}
          </p>

          <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
            <div className="max-h-[28rem] overflow-auto">
              <table className="ft-table">
                <thead>
                  <tr>
                    <th scope="col">Port</th>
                    <th scope="col">État</th>
                    <th scope="col">Service habituellement associé</th>
                    <th scope="col" className="text-right">
                      Durée
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.results.map((result) => (
                    <tr key={result.port}>
                      <th scope="row" className="ft-value font-normal tabular-nums">
                        {result.port}
                      </th>
                      <td
                        className={clsx("ft-value", STATUS_CLASS[result.status])}
                        title={PORT_STATUS_EXPLANATIONS[result.status]}
                      >
                        {PORT_STATUS_LABELS[result.status]}
                      </td>
                      <td className="ft-value text-[var(--ft-text-muted)]">
                        {result.usualService ?? "—"}
                      </td>
                      <td className="ft-value text-right tabular-nums">
                        {result.elapsedMs.toFixed(0)} ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ft-meta border-t border-[var(--ft-rule)] px-3 py-1.5">
              {SERVICE_DISCLAIMER}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
