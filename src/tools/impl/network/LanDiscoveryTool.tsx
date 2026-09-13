import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout, ProgressBar } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { Field, Fieldset, Select } from "@/components/pdf/Field";
import { ValueTable } from "@/components/calc/CalcShell";
import {
  discoverLan,
  formatLatency,
  isNetworkEngineAvailable,
  listInterfaces,
  NETWORK_NATIVE_REQUIRED,
  planDiscovery,
  type DiscoveryPlan,
  type DiscoveryResult,
  type NetworkInterface,
} from "@/core/network/native";
import { JobCancelledError } from "@/core/jobs/types";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Découverte des appareils du réseau local.
 *
 * Deux temps, délibérément séparés : l'écran montre d'abord **ce qu'il ferait**
 * — interface, adresse locale, plage exacte, nombre d'adresses — et n'envoie
 * rien tant que le bouton n'est pas cliqué. Une découverte réseau qui
 * démarrerait au chargement de la page serait une mauvaise surprise sur un
 * réseau d'entreprise.
 *
 * La plage est bornée côté natif, jamais ici : une interface en `/16` est
 * ramenée au `/24` qui entoure l'adresse locale plutôt qu'étendue à 65 000
 * adresses, et le plafond de 256 s'applique dans tous les cas. Rien de ce qui
 * est observé n'est conservé après la fermeture de l'écran.
 */
export function LanDiscoveryTool(_props: ToolComponentProps) {
  const [interfaces, setInterfaces] = useState<NetworkInterface[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  const [plan, setPlan] = useState<DiscoveryPlan | undefined>();
  const [result, setResult] = useState<DiscoveryResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [progress, setProgress] = useState<{ ratio?: number; label: string } | undefined>();
  const [running, setRunning] = useState(false);
  const [controller, setController] = useState<AbortController | undefined>();

  const available = isNetworkEngineAvailable();

  // Lister les interfaces ne fait qu'interroger le système : aucun paquet n'est
  // émis, et c'est la seule chose qui se produise sans action de votre part.
  useEffect(() => {
    if (!available) return;
    listInterfaces()
      .then((found) => {
        setInterfaces(found);
        const usable = found.find((entry) => !entry.loopback) ?? found[0];
        setSelected(usable?.name);
      })
      .catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : "Interfaces illisibles."),
      );
  }, [available]);

  const current = interfaces.find((entry) => entry.name === selected);

  useEffect(() => {
    setResult(undefined);
    if (!current) {
      setPlan(undefined);
      return;
    }
    let cancelled = false;
    planDiscovery(current)
      .then((computed) => {
        if (!cancelled) setPlan(computed);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setPlan(undefined);
        setError(failure instanceof Error ? failure.message : "Plage incalculable.");
      });
    return () => {
      cancelled = true;
    };
  }, [current]);

  const run = async () => {
    if (!current) return;
    const abort = new AbortController();
    setController(abort);
    setRunning(true);
    setError(undefined);
    setResult(undefined);
    setProgress({ label: "Examen des adresses…" });
    try {
      setResult(
        await discoverLan(current, {
          signal: abort.signal,
          report: (update) =>
            setProgress({ ...update, label: update.label ?? "Examen des adresses…" }),
        }),
      );
    } catch (failure) {
      if (failure instanceof JobCancelledError) setError("Découverte interrompue.");
      else setError(failure instanceof Error ? failure.message : "Découverte impossible.");
    } finally {
      setRunning(false);
      setProgress(undefined);
      setController(undefined);
    }
  };

  return (
    <div className="space-y-4">
      {!available && <Callout tone="warning">{NETWORK_NATIVE_REQUIRED}</Callout>}

      <Fieldset columns={1}>
        <Field label="Interface réseau" hint="Seul le sous-réseau directement connecté est exploré.">
          <Select
            value={selected ?? ""}
            onChange={setSelected}
            aria-label="Interface réseau"
            options={interfaces.map((entry) => ({
              value: entry.name,
              label: `${entry.name} — ${entry.address}/${entry.prefix}${entry.loopback ? " (boucle locale)" : ""}`,
            }))}
          />
        </Field>
      </Fieldset>

      {error && <Callout tone="error">{error}</Callout>}

      {plan && current && (
        <>
          <ValueTable
            caption="Ce qui sera examiné"
            rows={[
              { label: "Interface", value: current.name },
              { label: "Adresse locale", value: `${current.address}/${current.prefix}` },
              { label: "Réseau annoncé par l'interface", value: plan.range.declaredCidr },
              { label: "Réseau réellement parcouru", value: plan.range.scannedCidr, highlight: true },
              { label: "Première adresse", value: plan.range.first },
              { label: "Dernière adresse", value: plan.range.last },
              {
                label: "Nombre d'adresses",
                value: String(plan.range.targetCount),
                highlight: true,
              },
            ]}
          />

          {plan.range.narrowed && plan.range.note && (
            <Callout tone="info" title="Plage volontairement réduite">
              {plan.range.note}
            </Callout>
          )}

          <Callout tone="warning" title="Rien n'a encore été envoyé">
            {plan.summary} La découverte lit d'abord la table de voisinage du système — ce qui
            n'émet aucun paquet — puis envoie un écho ICMP par adresse.
          </Callout>

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={run} disabled={!available || running}>
              <Icon name="Radar" size={14} />{" "}
              {running ? "Découverte en cours…" : "Lancer la découverte"}
            </Button>
            {running && (
              <Button variant="ghost" onClick={() => controller?.abort()}>
                <Icon name="X" size={14} /> Arrêter
              </Button>
            )}
          </div>
        </>
      )}

      {progress && <ProgressBar ratio={progress.ratio} label={progress.label} />}

      {result && (
        <>
          <p className="ft-value">
            {result.devices.length} appareil{result.devices.length > 1 ? "s" : ""} observé
            {result.devices.length > 1 ? "s" : ""} sur {result.examined} adresse
            {result.examined > 1 ? "s" : ""} examinée{result.examined > 1 ? "s" : ""}
            {result.cancelled && " · interrompu avant la fin"}
          </p>

          {result.devices.length > 0 && (
            <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
              <div className="max-h-[28rem] overflow-auto">
                <table className="ft-table">
                  <thead>
                    <tr>
                      <th scope="col">Adresse</th>
                      <th scope="col">Nom</th>
                      <th scope="col">Adresse matérielle</th>
                      <th scope="col" className="text-right">
                        Latence
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.devices.map((device) => (
                      <tr key={device.address}>
                        <th scope="row" className="ft-value font-normal">
                          {device.address}
                          {device.isSelf && (
                            <span className="ml-1.5 text-[10.5px] text-[var(--ft-text-faint)]">
                              cette machine
                            </span>
                          )}
                        </th>
                        <td className="ft-value">{device.hostname ?? "—"}</td>
                        <td className="ft-value font-mono text-[var(--ft-text-muted)]">
                          {device.mac ?? "—"}
                        </td>
                        <td className="ft-value text-right tabular-nums">
                          {formatLatency(device.latencyMs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ft-meta border-t border-[var(--ft-rule)] px-3 py-1.5">
                Méthodes employées : {result.methods.join(" · ")}.
              </p>
            </section>
          )}

          <Callout tone="info" title="Appareils observés, pas inventaire complet">
            {result.note} Aucun fabricant n'est affiché : le déduire demanderait d'interroger une
            base en ligne, ce que FourTout ne fait pas. Ces résultats ne sont pas enregistrés.
          </Callout>
        </>
      )}
    </div>
  );
}
