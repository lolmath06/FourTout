import clsx from "clsx";
import { Icon } from "./Icon";
import type { NetworkReach } from "@/core/tools/types";

/**
 * Rappel local-first, affiché en pied de page d'un outil.
 *
 * Le message dépend de **jusqu'où l'outil va sur le réseau**, et pas seulement
 * de savoir s'il y touche. La nuance n'est pas cosmétique : annoncer « Internet
 * requis » sous un outil qui cherche une imprimante sur le réseau local est
 * faux, et un rappel de confidentialité qui se trompe ne rassure plus sur les
 * autres.
 */
const MESSAGES: Record<NetworkReach, { icon: string; tone: string; text: string }> = {
  none: {
    icon: "ShieldCheck",
    tone: "text-[var(--ft-text-faint)]",
    text: "Traitement local — vos fichiers restent sur votre appareil.",
  },
  "local-network": {
    icon: "Network",
    tone: "text-[var(--ft-text-muted)]",
    text: "Cet outil utilise votre réseau local. Rien n'est envoyé sur Internet.",
  },
  network: {
    icon: "Network",
    tone: "text-[var(--ft-text-muted)]",
    text: "Cet outil utilise le réseau. Il n'a pas besoin d'Internet pour joindre une machine de votre réseau.",
  },
  internet: {
    icon: "Wifi",
    tone: "text-[var(--ft-warn)]",
    text: "Cet outil nécessite une connexion Internet.",
  },
};

export function PrivacyNote({
  className,
  reach = "none",
}: {
  className?: string;
  reach?: NetworkReach;
}) {
  const message = MESSAGES[reach];
  return (
    <p className={clsx("inline-flex items-center gap-1.5 text-xs", message.tone, className)}>
      <Icon name={message.icon} size={13} />
      {message.text}
    </p>
  );
}
