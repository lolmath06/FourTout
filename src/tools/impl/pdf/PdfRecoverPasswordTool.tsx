import { useCallback, useEffect, useState } from "react";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { OptionGroup } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { readEncryptionInfo, type EncryptionInfo } from "@/core/pdf/encryptionInfo";
import { toPdfError } from "@/core/pdf/errors";
import { unlockPdf } from "@/core/pdf/operations/protect";
import { saveFile } from "@/core/output/save";
import { isRecoveryAvailable, type RecoveryProgress, type RecoveryTier } from "@/core/recovery/client";
import {
  cancelRecoveryJob,
  clearRecoveryJob,
  recoverySource,
  startRecoveryJob,
} from "@/features/jobs/recovery";
import { useToolJob } from "@/features/jobs/hooks";
import type { Job } from "@/features/jobs/store";
import { notify } from "@/features/notifications/store";
import type { PdfSource } from "@/core/pdf/types";
import type { ToolComponentProps } from "@/tools/implementations";

const WARNING =
  "Cette fonction teste automatiquement des mots de passe probables sur le fichier que vous avez sélectionné. Utilisez-la uniquement sur un document auquel vous êtes autorisé à accéder.";

const TIERS: { value: RecoveryTier; label: string; hint: string }[] = [
  { value: "quick", label: "Rapide", hint: "~60 000 mots de passe très fréquents. Quelques secondes." },
  { value: "extended", label: "Étendu", hint: "~1,4 million de candidats. Plus long, meilleures chances." },
  { value: "full", label: "Complet", hint: "~14 millions de candidats (dictionnaire + règles). Peut être long." },
];

/** Traduit l'état du job global en phase d'affichage. */
type Phase = "idle" | "running" | "cancelling" | "found" | "exhausted" | "cancelled" | "error";

function phaseOf(job: Job | undefined): Phase {
  if (!job) return "idle";
  if (job.status === "running") return "running";
  if (job.status === "cancelling") return "cancelling";
  if (job.status === "error") return "error";
  // status === "done" : le détail vient du résultat natif.
  switch (job.result?.status) {
    case "found":
      return "found";
    case "exhausted":
      return "exhausted";
    case "cancelled":
      return "cancelled";
    default:
      return "error";
  }
}

export function PdfRecoverPasswordTool({ tool }: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [source, setSource] = useState<PdfSource | null>(null);
  const [info, setInfo] = useState<EncryptionInfo | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [tier, setTier] = useState<RecoveryTier>("quick");

  // Le traitement appartient au gestionnaire global, pas à ce composant :
  // quitter la page ne l'arrête pas et n'en perd pas la trace. On s'y reconnecte.
  const job = useToolJob(tool.id);
  const phase = phaseOf(job);
  const busy = phase === "running" || phase === "cancelling";

  const available = isRecoveryAvailable();

  // Charge le fichier et lit son type de chiffrement dès le dépôt.
  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setInfo(null);
    setInspectError(null);

    const file = files[0];
    if (!file?.file) return;

    void (async () => {
      try {
        const bytes = new Uint8Array(await file.file!.arrayBuffer());
        const next: PdfSource = { name: file.name, bytes };
        const encryption = await readEncryptionInfo(next);
        if (cancelled) return;
        setSource(next);
        setInfo(encryption ?? null);
        if (!encryption) setInspectError("Ce PDF n'est pas protégé par un mot de passe.");
      } catch (error) {
        if (!cancelled) setInspectError(toPdfError(error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [files]);

  const start = useCallback(async () => {
    if (!source || !info) return;
    try {
      await startRecoveryJob({ source, params: info.params, tier });
    } catch (error) {
      notify.error("Recherche impossible", error instanceof Error ? error.message : String(error));
    }
  }, [source, info, tier]);

  const cancel = useCallback(() => {
    if (job) void cancelRecoveryJob(job.id);
  }, [job]);

  const dismiss = useCallback(() => {
    if (job) clearRecoveryJob(job.id);
  }, [job]);

  const unlockAndSave = useCallback(async () => {
    const password = job?.result?.password;
    // Le document est retrouvé via le job (fonctionne même après navigation).
    const doc = (job && recoverySource(job.id)) ?? source;
    if (!doc || !password) return;
    try {
      const output = await unlockPdf(doc, password);
      const saved = await saveFile(output);
      if (saved.saved) notify.success("Copie déverrouillée enregistrée", saved.path);
    } catch (error) {
      notify.error("Déverrouillage impossible", toPdfError(error).message);
    }
  }, [job, source]);

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-[color-mix(in_oklch,var(--ft-warn)_45%,var(--ft-border))] bg-[color-mix(in_oklch,var(--ft-warn)_8%,transparent)] px-3 py-2.5 text-xs text-[var(--ft-text)]">
        <Icon name="TriangleAlert" size={15} className="mt-px shrink-0 text-[var(--ft-warn)]" />
        {WARNING}
      </p>

      {!available && (
        <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2.5 text-xs text-[var(--ft-text-muted)]">
          <Icon name="Info" size={14} className="mt-px shrink-0" />
          La récupération s'appuie sur le moteur natif de FourTout : elle n'est disponible que
          dans l'application installée, pas dans l'aperçu navigateur.
        </p>
      )}

      {/* Une recherche relancée depuis un autre appareil/onglet peut déjà tourner
          sans qu'un fichier soit déposé ici : on affiche alors le job seul. */}
      {job && busy && !info && (
        <div className="flex items-center gap-2.5 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] px-3 py-2.5 text-sm">
          <Icon name="Loader" size={16} className="shrink-0 animate-spin text-[var(--ft-accent)]" />
          <span>
            Recherche en cours sur <span className="font-medium">{job.title}</span>.
          </span>
        </div>
      )}

      <FileDropZone
        constraints={constraintsForTool(tool)}
        files={files}
        onChange={setFiles}
        label="Déposez le PDF protégé"
        hint="Le document et les mots de passe testés restent sur votre appareil."
        disabled={busy}
      />

      {inspectError && (
        <p className="flex items-start gap-2 text-sm text-[var(--ft-text-muted)]">
          <Icon name="Info" size={15} className="mt-0.5 shrink-0" />
          {inspectError}
        </p>
      )}

      {info && (
        <>
          <div className="flex items-center gap-2.5 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] px-3 py-2.5">
            <Icon name="Lock" size={16} className="shrink-0 text-[var(--ft-warn)]" />
            <span className="text-sm">
              Document protégé — chiffrement <span className="font-medium">{info.label}</span>.
            </span>
          </div>

          <div className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-4">
            <p className="mb-2 text-xs font-medium text-[var(--ft-text-muted)]">Niveau de recherche</p>
            <OptionGroup
              ariaLabel="Niveau de recherche"
              value={tier}
              onChange={setTier}
              options={TIERS}
              disabled={busy}
            />
            <p className="mt-2 text-xs text-[var(--ft-text-faint)]">
              {TIERS.find((t) => t.value === tier)?.hint}
              {info.handler === "AES-256" &&
                " Le chiffrement AES-256 est volontairement lent à tester : privilégiez d'abord le niveau Rapide."}
            </p>

            <div className="mt-4 flex items-center gap-2">
              {busy ? (
                <Button variant="secondary" onClick={cancel} disabled={phase === "cancelling"}>
                  <Icon name={phase === "cancelling" ? "Loader" : "X"} size={15} className={phase === "cancelling" ? "animate-spin" : undefined} />
                  {phase === "cancelling" ? "Arrêt en cours…" : "Arrêter"}
                </Button>
              ) : (
                <Button variant="primary" onClick={start} disabled={!available}>
                  <Icon name="Play" size={15} />
                  Lancer la recherche
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      {(busy || job?.progress) && <StatsPanel phase={phase} progress={job?.progress ?? null} total={job?.total ?? 0} />}

      {phase === "found" && job?.result?.password && (
        <ResultFound password={job.result.password} tested={job.result.tested} onUnlock={unlockAndSave} onDismiss={dismiss} />
      )}
      {phase === "exhausted" && (
        <ResultBanner
          icon="CircleAlert"
          tone="warn"
          title="Mot de passe non trouvé dans ce niveau"
          detail={`${formatInt(job?.result?.tested ?? 0)} candidats testés. Essayez un niveau plus large, ou ce mot de passe n'est pas dans le corpus.`}
          onDismiss={dismiss}
        />
      )}
      {phase === "cancelled" && (
        <ResultBanner
          icon="Info"
          tone="muted"
          title="Recherche arrêtée"
          detail={`${formatInt(job?.result?.tested ?? 0)} candidats testés avant l'arrêt.`}
          onDismiss={dismiss}
        />
      )}
      {phase === "error" && (
        <ResultBanner icon="CircleAlert" tone="danger" title="Échec" detail={job?.error ?? job?.result?.message ?? ""} onDismiss={dismiss} />
      )}
    </div>
  );
}

function StatsPanel({
  phase,
  progress,
  total,
}: {
  phase: Phase;
  progress: RecoveryProgress | null;
  total: number;
}) {
  const tested = progress?.tested ?? 0;
  const knownTotal = progress?.total || total;
  const rate = progress?.rate ?? 0;
  const elapsed = progress?.elapsedMs ?? 0;
  const remaining = rate > 0 && knownTotal > tested ? (knownTotal - tested) / rate : undefined;
  const ratio = knownTotal > 0 ? Math.min(1, tested / knownTotal) : 0;
  const active = phase === "running" || phase === "cancelling";

  return (
    <div className="space-y-2 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 font-medium">
          {active && <Icon name="Loader" size={14} className="animate-spin text-[var(--ft-accent)]" />}
          {formatInt(tested)} / {formatInt(knownTotal)} candidats
        </span>
        <span className="tabular-nums text-[var(--ft-text-muted)]">{Math.round(ratio * 100)} %</span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ft-surface-2)]">
        <div
          className="h-full rounded-full bg-[var(--ft-accent)] transition-[width]"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>

      <div className="grid grid-cols-3 gap-2 pt-1 text-center">
        <Stat label="Débit" value={`${formatInt(Math.round(rate))}/s`} />
        <Stat label="Écoulé" value={formatDuration(elapsed / 1000)} />
        <Stat label="Restant" value={remaining !== undefined ? `~${formatDuration(remaining)}` : "—"} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-[var(--ft-text-muted)]">{label}</p>
    </div>
  );
}

function ResultFound({
  password,
  tested,
  onUnlock,
  onDismiss,
}: {
  password: string;
  tested: number;
  onUnlock: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[color-mix(in_oklch,var(--ft-ok)_45%,var(--ft-border))] bg-[color-mix(in_oklch,var(--ft-ok)_6%,transparent)] p-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Icon name="CircleCheck" size={18} className="text-[var(--ft-ok)]" />
          Mot de passe trouvé
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-[var(--ft-text-muted)] hover:text-[var(--ft-text)]"
        >
          Fermer
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface)] px-3 py-2 font-mono text-sm">
          {password}
        </code>
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(password).then(
              () => notify.success("Mot de passe copié"),
              () => notify.error("Copie impossible"),
            );
          }}
        >
          <Icon name="Check" size={13} />
          Copier
        </Button>
      </div>
      <p className="mt-2 text-xs text-[var(--ft-text-muted)]">Trouvé après {formatInt(tested)} essais.</p>
      <Button size="sm" variant="primary" className="mt-3" onClick={onUnlock}>
        <Icon name="LockOpen" size={14} />
        Enregistrer une copie déverrouillée
      </Button>
    </div>
  );
}

function ResultBanner({
  icon,
  tone,
  title,
  detail,
  onDismiss,
}: {
  icon: string;
  tone: "warn" | "danger" | "muted";
  title: string;
  detail: string;
  onDismiss?: () => void;
}) {
  const color =
    tone === "danger"
      ? "text-[var(--ft-danger)]"
      : tone === "warn"
        ? "text-[var(--ft-warn)]"
        : "text-[var(--ft-text-muted)]";
  return (
    <div className="flex items-start gap-2.5 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-4">
      <Icon name={icon} size={16} className={`mt-0.5 shrink-0 ${color}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {detail && <p className="mt-0.5 text-xs text-[var(--ft-text-muted)]">{detail}</p>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-xs text-[var(--ft-text-muted)] hover:text-[var(--ft-text)]"
        >
          Fermer
        </button>
      )}
    </div>
  );
}

function formatInt(value: number): string {
  return Math.round(value).toLocaleString("fr-FR");
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
