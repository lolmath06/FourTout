import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { Field, Fieldset, TextInput } from "@/components/pdf/Field";
import { CheckOption } from "@/components/text/TextToolShell";
import { RunBar } from "@/components/files/NativeRun";
import { useNativeAction } from "@/components/files/useNativeAction";
import { StatGrid } from "@/components/files/Summary";
import {Contacts, NativeGate, SavedFile, UrlField } from "@/components/internet/parts";
import { errorMessage } from "@/core/internet/errors";
import { downloadUrl, probeUrl, type Probe, type TransferProgress } from "@/core/internet/native";
import { formatTransferRate, looksLikeWebUrl } from "@/core/internet/format";
import { pickSavePath } from "@/core/files/native";
import type { ToolComponentProps } from "@/tools/implementations";
import { formatDecimalSize, t } from "@/i18n";

/**
 * Télécharger un fichier depuis une adresse HTTP ou HTTPS.
 *
 * L'adresse est d'abord **inspectée** (type, taille, nom, reprise possible)
 * sans rien télécharger ; le transfert ne démarre qu'une fois la destination
 * choisie. Le fichier n'apparaît sous son nom définitif qu'une fois complet.
 */
export function UrlDownloadTool(_props: ToolComponentProps) {
  const [url, setUrl] = useState("");
  const [probe, setProbe] = useState<Probe | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | undefined>();
  const [resume, setResume] = useState(true);
  const [sha, setSha] = useState("");
  const [transfer, setTransfer] = useState<{ done: number; total: number; rate: number } | null>(null);
  const rate = useRef<{ at: number; done: number }>({ at: 0, done: 0 });
  const action = useNativeAction<Awaited<ReturnType<typeof downloadUrl>>>();

  const inspect = async () => {
    setProbing(true);
    setProbeError(undefined);
    setProbe(null);
    action.setResult(null);
    try {
      setProbe(await probeUrl(url));
    } catch (error) {
      setProbeError(errorMessage(error));
    } finally {
      setProbing(false);
    }
  };

  const onTransfer = (progress: TransferProgress) => {
    const now = Date.now();
    const previous = rate.current;
    if (previous.at === 0 || now - previous.at >= 700) {
      const speed = previous.at === 0 ? 0 : ((progress.done - previous.done) * 1000) / Math.max(1, now - previous.at);
      rate.current = { at: now, done: progress.done };
      setTransfer({ done: progress.done, total: progress.total, rate: speed });
    }
  };

  const start = async () => {
    if (!probe) return;
    const destination = await pickSavePath(probe.filename);
    if (!destination) return;
    rate.current = { at: 0, done: 0 };
    setTransfer(null);
    await action.execute((context) =>
      downloadUrl(
        { url: probe.finalUrl, destination, overwrite: true, resume, expectedSha256: sha.trim() || undefined },
        context,
        onTransfer,
      ),
    );
  };

  const busy = action.job.isRunning;
  const result = action.result;

  return (
    <NativeGate>
      <div className="space-y-4">
        <Contacts>{t("FourTout contacte l'adresse que vous indiquez, et elle seule.")}</Contacts>

        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <UrlField value={url} onChange={(v) => { setUrl(v); setProbe(null); }} onSubmit={inspect} disabled={busy || probing} />
          </div>
          <Button size="md" onClick={inspect} disabled={!looksLikeWebUrl(url) || busy || probing}>
            {probing ? <Icon name="Loader" size={14} className="animate-spin" /> : <Icon name="ScanSearch" size={14} />} {t("Inspecter")}
          </Button>
        </div>

        {probeError && <Callout tone="error" title={t("Adresse inaccessible")}>{probeError}</Callout>}

        {probe && (
          <div className="space-y-3" data-testid="probe-result">
            <StatGrid
              columns={4}
              stats={[
                { label: t("Taille"), value: probe.size === null ? t("Inconnue") : formatDecimalSize(probe.size) },
                { label: t("Type"), value: probe.mime ?? "—" },
                { label: t("Reprise possible"), value: probe.acceptsRanges ? t("Oui") : t("Non"), tone: probe.acceptsRanges ? "ok" : "neutral" },
                { label: t("Redirections"), value: probe.redirects },
              ]}
            />
            <Fieldset columns={1}>
              <Field label={t("Adresse finale")}>
                <span className="break-all font-mono text-[12px]" data-testid="final-url">{probe.finalUrl}</span>
              </Field>
              <Field label={t("Nom du fichier")} hint={t("Proposé d'après le serveur, puis l'adresse ; vous pourrez le changer en choisissant l'emplacement.")}>
                <TextInput value={probe.filename} readOnly />
              </Field>
              <Field label={t("Empreinte SHA-256 attendue (facultatif)")} hint={t("Si vous la fournissez, le fichier est supprimé quand elle ne correspond pas.")}>
                <TextInput value={sha} onChange={(e) => setSha(e.target.value)} className="font-mono" spellCheck={false} placeholder="e3b0c442…" />
              </Field>
              <CheckOption
                checked={resume}
                onChange={setResume}
                label={t("Reprendre un téléchargement interrompu")}
                hint={t("Seulement si le serveur le permet et confirme que le fichier n'a pas changé.")}
              />
            </Fieldset>
            <RunBar
              label={t("Télécharger…")}
              icon="ArrowDownToLine"
              onRun={start}
              running={busy}
              progress={{ ratio: transfer && transfer.total > 0 ? transfer.done / transfer.total : action.job.progress.ratio, label: transfer ? progressLabel(transfer) : undefined }}
              cancel={action.job.cancel}
              status={action.job.status}
              error={action.error}
            />
          </div>
        )}

        {result && (
          <SavedFile path={result.path} bytes={result.bytes} title={t("Téléchargement terminé")}>
            <span className="mt-1 block text-[11px] text-[var(--ft-text-muted)]">
              {t("SHA-256 : {value}", { value: result.sha256 })}
            </span>
            {result.resumedFrom > 0 && (
              <span className="block text-[11px] text-[var(--ft-text-muted)]">
                {t("Repris à partir de {size}.", { size: formatDecimalSize(result.resumedFrom) })}
              </span>
            )}
            {result.restarted && (
              <span className="block text-[11px] text-[var(--ft-warn)]">
                {t("Le serveur n'a pas accepté la reprise : le fichier a été retéléchargé depuis le début.")}
              </span>
            )}
          </SavedFile>
        )}
      </div>
    </NativeGate>
  );
}

function progressLabel(transfer: { done: number; total: number; rate: number }): string {
  const parts = [transfer.total > 0 ? `${formatDecimalSize(transfer.done)} / ${formatDecimalSize(transfer.total)}` : formatDecimalSize(transfer.done)];
  if (transfer.rate > 0) parts.push(formatTransferRate(transfer.rate));
  return parts.join(" · ");
}
