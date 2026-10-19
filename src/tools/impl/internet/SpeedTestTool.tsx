import { useState } from "react";
import { Callout } from "@/components/ui/Callout";
import { RunBar } from "@/components/files/NativeRun";
import { useNativeAction } from "@/components/files/useNativeAction";
import { StatGrid } from "@/components/files/Summary";
import { Contacts, NativeGate } from "@/components/internet/parts";
import { runSpeedTest, type SpeedProgress, type SpeedResult } from "@/core/internet/native";
import { formatMbps, formatMs } from "@/core/internet/format";
import type { ToolComponentProps } from "@/tools/implementations";
import { formatDecimal, formatDecimalSize, localized, t, tx } from "@/i18n";

const PHASES = localized(() => ({
  latency: t("Mesure de la latence…"),
  download: t("Débit descendant…"),
  upload: t("Débit montant…"),
}));

/**
 * Test de débit : latence, gigue, débit descendant et montant.
 *
 * Du trafic de test, généré par FourTout, est échangé avec un service de
 * mesure public. Aucun fichier de l'utilisateur n'est jamais envoyé. Les
 * chiffres sont donnés en mégabits par seconde décimaux — l'unité des
 * opérateurs — avec l'équivalent en mégaoctets par seconde.
 */
export function SpeedTestTool(_props: ToolComponentProps) {
  const [live, setLive] = useState<SpeedProgress | null>(null);
  const action = useNativeAction<SpeedResult>();

  const run = () => {
    setLive(null);
    return action.execute((context) => runSpeedTest(context, setLive));
  };
  const result = action.result;
  const busy = action.job.isRunning;

  return (
    <NativeGate>
      <div className="space-y-4">
        <Contacts>
          {t("Du trafic de test généré par FourTout est échangé avec le service de mesure de Cloudflare (speed.cloudflare.com). Aucun de vos fichiers n'est envoyé.")}
        </Contacts>

        <RunBar
          label={result ? t("Refaire le test") : t("Lancer le test")}
          icon="Gauge"
          onRun={run}
          running={busy}
          progress={{ ratio: live?.ratio, label: live ? tx(PHASES[live.phase]) : undefined }}
          cancel={action.job.cancel}
          status={action.job.status}
          error={action.error}
        />

        {busy && live && live.phase !== "latency" && (
          <p className="text-center text-3xl font-semibold tabular-nums" data-testid="speed-live" aria-live="polite">
            {formatMbps(live.mbps)}
          </p>
        )}

        {result && (
          <div className="space-y-3" data-testid="speed-result">
            <StatGrid
              columns={4}
              stats={[
                { label: t("Débit descendant"), value: formatMbps(result.downloadMbps) },
                { label: t("Débit montant"), value: formatMbps(result.uploadMbps) },
                { label: t("Latence"), value: formatMs(result.latencyMs) },
                { label: t("Gigue"), value: formatMs(result.jitterMs) },
              ]}
            />
            <p className="ft-meta">
              {result.downloadMbps !== null && result.uploadMbps !== null
                ? t("Soit environ {down} Mo/s en réception et {up} Mo/s en envoi.", {
                    down: formatDecimal(result.downloadMbps / 8, 1),
                    up: formatDecimal(result.uploadMbps / 8, 1),
                  })
                : null}
              {" "}
              {t("{down} reçus et {up} envoyés pour la mesure, en {seconds} s.", {
                down: formatDecimalSize(result.downloadBytes),
                up: formatDecimalSize(result.uploadBytes),
                seconds: Math.round(result.durationMs / 1000),
              })}
              {result.server ? ` ${t("Serveur : {value}.", { value: result.server })}` : ""}
            </p>
          </div>
        )}

        <Callout tone="neutral" title={t("Comment lire ces chiffres")}>
          {t("Mégabits par seconde (1 Mb/s = 1 000 000 de bits/s), comme sur votre abonnement. Latence : médiane de plusieurs allers-retours minuscules ; gigue : variation moyenne entre deux mesures consécutives. Le débit retenu est le 90ᵉ centile des transferts assez longs pour être fiables. Les résultats varient : VPN, Wi-Fi, distance du serveur et trafic concurrent les modifient.")}
        </Callout>
      </div>
    </NativeGate>
  );
}
