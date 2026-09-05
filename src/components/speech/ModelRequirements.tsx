import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Callout } from "@/components/ui/Callout";
import { isTauri } from "@/core/platform";
import {
  formatSize,
  installAsset,
  listAssets,
  missingAssets,
  modelsDirectory,
  removeAsset,
  type SpeechAsset,
} from "@/core/speech/models";
import { notify } from "@/features/notifications/store";

/**
 * Installation explicite des moteurs et modèles de parole.
 *
 * FourTout ne télécharge jamais rien de sa propre initiative : tant qu'un
 * élément requis manque, l'outil affiche ce qu'il lui faut, sa taille, sa
 * licence et sa provenance, et attend une action. L'installation est
 * vérifiée par empreinte, annulable, et réversible.
 */

/** Message affiché hors application (aucun moteur natif dans un navigateur). */
function NativeOnly() {
  return (
    <Callout tone="info" title="Traitement local requis">
      La synthèse et la transcription vocales s'appuient sur des moteurs locaux et nécessitent
      l'application FourTout installée. Elles ne sont pas disponibles dans l'aperçu navigateur.
    </Callout>
  );
}

export interface ModelRequirementsProps {
  /** Identifiants du catalogue nécessaires à l'outil. */
  required: readonly string[];
  /** Éléments proposés en option (autres voix, modèle plus précis). */
  optional?: readonly string[];
  children: (assets: SpeechAsset[]) => ReactNode;
}

export function ModelRequirements({ required, optional = [], children }: ModelRequirementsProps) {
  const [assets, setAssets] = useState<SpeechAsset[] | undefined>(undefined);
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [progress, setProgress] = useState<{ received: number; total: number } | undefined>();
  const [manage, setManage] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) {
      setAssets([]);
      return;
    }
    const [list, dir] = await Promise.all([listAssets(), modelsDirectory()]);
    setAssets(list);
    setDirectory(dir);
  }, []);

  useEffect(() => {
    void refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  if (!isTauri()) return <NativeOnly />;
  if (!assets) return null;

  const missing = missingAssets(assets, required);
  const shown = assets.filter((asset) => required.includes(asset.id) || optional.includes(asset.id));

  const install = async (asset: SpeechAsset) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(asset.id);
    setProgress({ received: 0, total: asset.size });
    try {
      await installAsset(asset.id, { onProgress: setProgress, signal: controller.signal });
      notify.success("Installation terminée", asset.label);
    } catch (error) {
      const message = String(error);
      if (message.includes("cancelled")) notify.info("Installation annulée", asset.label);
      else notify.error("Installation impossible", message.replace(/^Error:\s*/, ""));
    } finally {
      abortRef.current = null;
      setBusy(undefined);
      setProgress(undefined);
      await refresh();
    }
  };

  const uninstall = async (asset: SpeechAsset) => {
    try {
      await removeAsset(asset.id);
      notify.success("Élément supprimé", asset.label);
    } catch (error) {
      notify.error("Suppression impossible", String(error));
    }
    await refresh();
  };

  const row = (asset: SpeechAsset) => {
    const running = busy === asset.id;
    const ratio = progress && progress.total > 0 ? progress.received / progress.total : 0;
    return (
      <li
        key={asset.id}
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface)] px-3 py-2.5 text-sm"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2 font-medium">
            {asset.installed && <Icon name="Check" size={14} className="text-[var(--ft-ok)]" />}
            {asset.label}
          </span>
          <span className="text-xs text-[var(--ft-text-muted)]">{asset.detail}</span>
          <span className="text-[11px] text-[var(--ft-text-faint)]">
            {formatSize(asset.size)} · {asset.license}
          </span>
        </span>

        {running ? (
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-28 overflow-hidden rounded-full bg-[var(--ft-surface-2)]">
              <span
                className="block h-full rounded-full bg-[var(--ft-accent)] transition-[width]"
                style={{ width: `${Math.round(ratio * 100)}%` }}
              />
            </span>
            <span className="tabular-nums text-xs text-[var(--ft-text-muted)]">
              {Math.round(ratio * 100)} %
            </span>
            <Button size="sm" variant="ghost" onClick={() => abortRef.current?.abort()}>
              Annuler
            </Button>
          </span>
        ) : asset.installed ? (
          <Button size="sm" variant="ghost" onClick={() => void uninstall(asset)} disabled={!!busy}>
            <Icon name="Trash2" size={14} /> Supprimer
          </Button>
        ) : asset.available ? (
          <Button size="sm" variant="primary" onClick={() => void install(asset)} disabled={!!busy}>
            <Icon name="Download" size={14} /> Installer
          </Button>
        ) : (
          <span className="text-xs text-[var(--ft-text-faint)]">Indisponible sur ce système</span>
        )}
      </li>
    );
  };

  if (missing.length > 0) {
    return (
      <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Icon name="Download" size={16} /> Installation nécessaire
        </p>
        <p className="text-sm text-[var(--ft-text-muted)]">
          Cet outil a besoin des éléments ci-dessous. Ils sont téléchargés une seule fois depuis
          leur source officielle, vérifiés par empreinte, puis fonctionnent hors ligne.
        </p>
        <ul className="flex flex-col gap-2">{shown.map(row)}</ul>
        {directory && (
          <p className="text-[11px] text-[var(--ft-text-faint)]">Stockés dans {directory}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {children(assets)}
      <div className="border-t border-[var(--ft-border)] pt-3">
        <button
          type="button"
          onClick={() => setManage((value) => !value)}
          className="flex items-center gap-1.5 text-xs text-[var(--ft-text-muted)] hover:text-[var(--ft-text)]"
        >
          <Icon name={manage ? "ChevronDown" : "ChevronRight"} size={13} />
          Gérer les moteurs, voix et modèles
        </button>
        {manage && (
          <div className="mt-2 space-y-2">
            <ul className="flex flex-col gap-2">{shown.map(row)}</ul>
            {directory && (
              <p className="text-[11px] text-[var(--ft-text-faint)]">Stockés dans {directory}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

