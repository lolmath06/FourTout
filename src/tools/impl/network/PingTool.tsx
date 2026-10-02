import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout, ProgressBar } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { Field, Fieldset, NumberInput, TextInput } from "@/components/pdf/Field";
import { ValueTable } from "@/components/calc/CalcShell";
import {
  formatLatency,
  formatLoss,
  isNetworkEngineAvailable,
  NETWORK_NATIVE_REQUIRED,
  ping,
  PING_DEFAULT_COUNT,
  PING_MAX_COUNT,
  type PingSummary,
} from "@/core/network/native";
import { JobCancelledError } from "@/core/jobs/types";
import type { ToolComponentProps } from "@/tools/implementations";
import { t, tx } from "@/i18n";

/**
 * Ping.
 *
 * L'outil envoie de vrais paquets ICMP — il ne lit pas la sortie de `ping`,
 * qui est traduite et change de forme d'un système à l'autre. Si le système
 * refuse d'ouvrir un socket ICMP, l'écran le dit et s'arrête : il ne remplace
 * pas la mesure par une connexion TCP, parce que « l'hôte répond au ping » et
 * « le port 80 est ouvert » ne veulent pas dire la même chose.
 */
export function PingTool(_props: ToolComponentProps) {
  const [host, setHost] = useState("127.0.0.1");
  const [count, setCount] = useState(PING_DEFAULT_COUNT);
  const [timeout, setTimeoutMs] = useState(1000);
  const [summary, setSummary] = useState<PingSummary | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [running, setRunning] = useState(false);
  const [controller, setController] = useState<AbortController | undefined>();

  const available = isNetworkEngineAvailable();

  const run = async () => {
    const abort = new AbortController();
    setController(abort);
    setRunning(true);
    setError(undefined);
    setSummary(undefined);
    try {
      setSummary(
        await ping(host, { count, timeoutMs: timeout }, { signal: abort.signal }),
      );
    } catch (failure) {
      if (failure instanceof JobCancelledError) setError(t("Ping interrompu."));
      else setError(failure instanceof Error ? failure.message : t("Ping impossible."));
    } finally {
      setRunning(false);
      setController(undefined);
    }
  };

  return (
    <div className="space-y-4">
      {!available && <Callout tone="warning">{NETWORK_NATIVE_REQUIRED}</Callout>}

      <Fieldset columns={3}>
        <Field label={t("Hôte ou adresse IP")}>
          <TextInput
            value={host}
            onChange={(event) => setHost(event.target.value)}
            aria-label={t("Hôte ou adresse IP")}
            placeholder="192.168.1.1"
            autoFocus
          />
        </Field>
        <Field label={t("Paquets")} hint={t("De 1 à {PING_MAX_COUNT}.", { PING_MAX_COUNT })}>
          <NumberInput
            value={count}
            min={1}
            max={PING_MAX_COUNT}
            onChange={(event) => setCount(Number(event.target.value))}
            aria-label={t("Nombre de paquets")}
          />
        </Field>
        <Field label={t("Délai d'attente (ms)")} hint={t("De 100 à 10 000.")}>
          <NumberInput
            value={timeout}
            min={100}
            max={10000}
            step={100}
            onChange={(event) => setTimeoutMs(Number(event.target.value))}
            aria-label={t("Délai d'attente")}
          />
        </Field>
      </Fieldset>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={run}
          disabled={!available || running || host.trim().length === 0}
        >
          <Icon name="Activity" size={14} /> {running ? t("Ping en cours…") : t("Envoyer les paquets")}
        </Button>
        {running && (
          <Button variant="ghost" onClick={() => controller?.abort()}>
            <Icon name="X" size={14} />{" "}{t("Arrêter")}
          </Button>
        )}
      </div>

      {running && <ProgressBar label={t("Envoi de {count} paquets vers {host}…", { count, host })} />}

      {error && <Callout tone="error">{tx(error)}</Callout>}

      {summary && (
        <>
          <ValueTable
            caption={t("Résultat")}
            rows={[
              { label: t("Résolu vers"), value: summary.resolved },
              { label: t("Méthode"), value: summary.method },
              { label: t("Paquets envoyés"), value: String(summary.sent) },
              { label: t("Reçus"), value: String(summary.received), highlight: true },
              { label: t("Perdus"), value: `${summary.lost} (${formatLoss(summary.lossPercent)})` },
              { label: t("Minimum"), value: formatLatency(summary.minMs) },
              { label: t("Moyenne"), value: formatLatency(summary.avgMs), highlight: true },
              { label: t("Maximum"), value: formatLatency(summary.maxMs) },
            ]}
          />

          <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
            <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">
              {t("Paquet par paquet")}
            </h3>
            <ul className="divide-y divide-[var(--ft-rule)]">
              {summary.attempts.map((attempt) => (
                <li key={attempt.sequence} className="ft-row-py flex items-baseline gap-2 px-3">
                  <span className="ft-meta w-12 shrink-0">n° {attempt.sequence + 1}</span>
                  <span
                    className={`ft-value flex-1 ${
                      attempt.rttMs === null ? "text-[var(--ft-danger)]" : ""
                    }`}
                  >
                    {attempt.rttMs === null
                      ? t("aucune réponse avant le délai")
                      : t("réponse de {value} en {value2}", { value: attempt.from ?? summary.resolved, value2: formatLatency(attempt.rttMs) })}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {summary.received === 0 && (
            <Callout tone="warning" title={t("Aucune réponse")}>
              {t("L'absence de réponse ne signifie pas toujours que la machine est éteinte : beaucoup d'hôtes et de pare-feux sont configurés pour ignorer les échos ICMP.")}
            </Callout>
          )}
        </>
      )}
    </div>
  );
}
