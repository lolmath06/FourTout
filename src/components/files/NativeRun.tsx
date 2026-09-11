import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Callout, ProgressBar } from "@/components/ui/Callout";
import { NATIVE_REQUIRED } from "@/core/files/native";

/**
 * Présentation commune aux outils Fichiers qui composent eux-mêmes leur
 * sélection : bouton d'action, annulation, progression, message d'erreur.
 * La mécanique d'exécution vit dans `useNativeAction`.
 */

/**
 * Exécution d'une opération native dans un outil qui compose lui-même sa
 * sélection.
 *
 * `NativeToolShell` couvre le cas courant — un sélecteur, un bouton, un
 * résultat. Les outils de la phase 9 ont souvent deux sélections (comparaison,
 * synchronisation) ou deux étapes (plan puis exécution) ; ils ont donc besoin
 * de la même mécanique — progression réelle, annulation réelle, erreur lisible —
 * sans la mise en page imposée. C'est exactement ce que ce module fournit, et
 * rien de plus.
 */
/** Repli explicite quand l'outil exige l'application installée. */
export function NativeRequired() {
  return (
    <Callout tone="info" title="Application installée requise">
      {NATIVE_REQUIRED}
    </Callout>
  );
}

/**
 * Barre d'action : bouton principal, annulation pendant l'exécution,
 * progression et message d'erreur.
 */
export function RunBar({
  label,
  icon = "Play",
  onRun,
  running,
  progress,
  disabled = false,
  cancel,
  danger = false,
  secondary,
  status,
  error,
}: {
  label: string;
  icon?: string;
  onRun: () => void;
  running: boolean;
  progress: { ratio?: number; label?: string };
  disabled?: boolean;
  cancel: () => void;
  /** Une action destructrice se distingue visuellement, toujours. */
  danger?: boolean;
  secondary?: ReactNode;
  status?: "idle" | "running" | "success" | "error" | "cancelled";
  error?: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--ft-rule)] pt-3">
        {secondary}
        {running && (
          <Button size="sm" variant="ghost" onClick={cancel}>
            Annuler
          </Button>
        )}
        <Button
          size="md"
          variant={danger ? "danger" : "primary"}
          onClick={onRun}
          disabled={disabled || running}
        >
          {running ? (
            <>
              <Icon name="Loader" size={15} className="animate-spin" />
              {progress.label ?? "Traitement…"}
            </>
          ) : (
            <>
              <Icon name={icon} size={15} />
              {label}
            </>
          )}
        </Button>
      </div>

      {running && <ProgressBar ratio={progress.ratio} label={progress.label} />}

      {status === "cancelled" && (
        <Callout tone="neutral" title="Opération annulée">
          Le traitement s'est arrêté à votre demande.
        </Callout>
      )}
      {error && (
        <Callout tone="error" title="L'opération a échoué">
          {error}
        </Callout>
      )}
    </div>
  );
}
