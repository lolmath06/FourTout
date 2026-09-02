import { useCallback, useEffect, useRef, useState } from "react";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { OptionGroup } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { readEncryptionInfo, type EncryptionInfo } from "@/core/pdf/encryptionInfo";
import { toPdfError } from "@/core/pdf/errors";
import { unlockPdf } from "@/core/pdf/operations/protect";
import { saveFile } from "@/core/output/save";
import {
  isRecoveryAvailable,
  startRecovery,
  type RecoveryDone,
  type RecoveryProgress,
  type RecoverySession,
  type RecoveryTier,
} from "@/core/recovery/client";
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

type Phase = "idle" | "running" | "found" | "exhausted" | "cancelled" | "error";

export function PdfRecoverPasswordTool({ tool }: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [source, setSource] = useState<PdfSource | null>(null);
  const [info, setInfo] = useState<EncryptionInfo | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [tier, setTier] = useState<RecoveryTier>("quick");

  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<RecoveryProgress | null>(null);
  const [result, setResult] = useState<RecoveryDone | null>(null);
  const [total, setTotal] = useState(0);
  const sessionRef = useRef<RecoverySession | null>(null);

  const available = isRecoveryAvailable();

  // Charge le fichier et lit son type de chiffrement dès le dépôt.
  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setInfo(null);
    setInspectError(null);
    setPhase("idle");
    setResult(null);
    setProgress(null);

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

  // Au démontage : arrête la recherche en cours (sinon le fil natif continue
  // sans personne pour l'écouter) puis se désabonne.
  useEffect(
    () => () => {
      void sessionRef.current?.cancel();
      sessionRef.current?.dispose();
    },
    [],
  );

  const start = useCallback(async () => {
    if (!source || !info) return;
    setPhase("running");
    setResult(null);
    setProgress(null);

    try {
      const session = await startRecovery(info.params, tier, {
        onProgress: (p) => setProgress(p),
        onDone: (done) => {
          setResult(done);
          setPhase(
            done.status === "found"
              ? "found"
              : done.status === "exhausted"
                ? "exhausted"
                : done.status === "cancelled"
                  ? "cancelled"
                  : "error",
          );
          sessionRef.current?.dispose();
          sessionRef.current = null;
        },
      });
      sessionRef.current = session;
      setTotal(session.total);
    } catch (error) {
      setPhase("error");
      setResult({
        status: "error",
        tested: 0,
        elapsedMs: 0,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [source, info, tier]);

  const cancel = useCallback(() => {
    void sessionRef.current?.cancel();
  }, []);

  const unlockAndSave = useCallback(async () => {
    if (!source || !result?.password) return;
    try {
      const output = await unlockPdf(source, result.password);
      const saved = await saveFile(output);
      if (saved.saved) notify.success("Copie déverrouillée enregistrée", saved.path);
    } catch (error) {
      notify.error("Déverrouillage impossible", toPdfError(error).message);
    }
  }, [source, result]);

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

      <FileDropZone
        constraints={constraintsForTool(tool)}
        files={files}
        onChange={setFiles}
        label="Déposez le PDF protégé"
        hint="Le document et les mots de passe testés restent sur votre appareil."
        disabled={phase === "running"}
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
            />
            <p className="mt-2 text-xs text-[var(--ft-text-faint)]">
              {TIERS.find((t) => t.value === tier)?.hint}
              {info.handler === "AES-256" &&
                " Le chiffrement AES-256 est volontairement lent à tester : privilégiez d'abord le niveau Rapide."}
            </p>

            <div className="mt-4 flex items-center gap-2">
              {phase === "running" ? (
                <Button variant="secondary" onClick={cancel}>
                  <Icon name="X" size={15} />
                  Arrêter
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

      {(phase === "running" || progress) && <StatsPanel phase={phase} progress={progress} total={total} />}

      {phase === "found" && result?.password && (
        <ResultFound password={result.password} tested={result.tested} onUnlock={unlockAndSave} />
      )}
      {phase === "exhausted" && (
        <ResultBanner
          icon="CircleAlert"
          tone="warn"
          title="Mot de passe non trouvé dans ce niveau"
          detail={`${formatInt(result?.tested ?? 0)} candidats testés. Essayez un niveau plus large, ou ce mot de passe n'est pas dans le corpus.`}
        />
      )}
      {phase === "cancelled" && (
        <ResultBanner
          icon="Info"
          tone="muted"
          title="Recherche arrêtée"
          detail={`${formatInt(result?.tested ?? 0)} candidats testés avant l'arrêt.`}
        />
      )}
      {phase === "error" && (
        <ResultBanner icon="CircleAlert" tone="danger" title="Échec" detail={result?.message ?? ""} />
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

  return (
    <div className="space-y-2 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 font-medium">
          {phase === "running" && <Icon name="Loader" size={14} className="animate-spin text-[var(--ft-accent)]" />}
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
}: {
  password: string;
  tested: number;
  onUnlock: () => void;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[color-mix(in_oklch,var(--ft-ok)_45%,var(--ft-border))] bg-[color-mix(in_oklch,var(--ft-ok)_6%,transparent)] p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Icon name="CircleCheck" size={18} className="text-[var(--ft-ok)]" />
        Mot de passe trouvé
      </p>
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
}: {
  icon: string;
  tone: "warn" | "danger" | "muted";
  title: string;
  detail: string;
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
      <div>
        <p className="text-sm font-medium">{title}</p>
        {detail && <p className="mt-0.5 text-xs text-[var(--ft-text-muted)]">{detail}</p>}
      </div>
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
