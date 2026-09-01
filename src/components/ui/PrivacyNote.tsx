import clsx from "clsx";
import { Icon } from "./Icon";

/**
 * Rappel local-first. Affiché là où l'utilisateur manipule des fichiers,
 * discrètement mais explicitement.
 */
export function PrivacyNote({
  className,
  requiresNetwork = false,
}: {
  className?: string;
  requiresNetwork?: boolean;
}) {
  if (requiresNetwork) {
    return (
      <p
        className={clsx(
          "inline-flex items-center gap-1.5 text-xs text-[var(--ft-warn)]",
          className,
        )}
      >
        <Icon name="Wifi" size={13} />
        Cet outil nécessite une connexion Internet.
      </p>
    );
  }
  return (
    <p
      className={clsx(
        "inline-flex items-center gap-1.5 text-xs text-[var(--ft-text-faint)]",
        className,
      )}
    >
      <Icon name="ShieldCheck" size={13} />
      Traitement local — vos fichiers restent sur votre appareil.
    </p>
  );
}
