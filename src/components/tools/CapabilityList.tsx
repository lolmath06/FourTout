import clsx from "clsx";
import type { NetworkReach, ToolCapability, ToolDefinition } from "@/core/tools/types";
import { networkReach } from "@/core/tools/types";
import { Icon } from "@/components/ui/Icon";

/**
 * Propriétés d'un outil, en **ligne de métadonnées** plutôt qu'en pastilles.
 *
 * Trois badges colorés côte à côte (« 100 % local », « Peut être long »,
 * « Moteur embarqué ») pèsent visuellement autant que le nom de l'outil, pour
 * une information secondaire. Une icône fine suivie d'un mot, en gris, dit la
 * même chose sans occuper le premier plan.
 *
 * Seul le recours à Internet garde une couleur : c'est la seule propriété qui
 * contredit la promesse de FourTout, donc la seule qui doit accrocher l'œil.
 * Utiliser le réseau **local** ne la contredit pas, et ne s'affiche donc pas
 * sur le même ton.
 */
interface Descriptor {
  label: string;
  icon: string;
  tone?: "warn" | "danger";
  title: string;
}

const DESCRIPTORS: Partial<Record<ToolCapability, Descriptor>> = {
  local: { label: "Local", icon: "ShieldCheck", title: "Traitement entièrement local" },
  batch: { label: "Par lots", icon: "Layers", title: "Accepte plusieurs fichiers" },
  "long-running": {
    label: "Peut être long",
    icon: "Clock3",
    title: "Opération potentiellement longue, avec progression et annulation",
  },
  destructive: {
    label: "Irréversible",
    icon: "TriangleAlert",
    tone: "danger",
    title: "Cette opération modifie ou supprime des données de façon définitive",
  },
  "needs-sidecar": {
    label: "Moteur embarqué",
    icon: "Cpu",
    title: "S'appuie sur un moteur fourni avec l'application",
  },
  "needs-device": {
    label: "Micro / caméra",
    icon: "Mic",
    title: "Demande l'accès à un périphérique",
  },
};

/**
 * Une seule mention réseau par outil, dérivée de `networkReach`.
 *
 * Les trois capacités réseau se cumulent dans le catalogue (`network` +
 * `internet`, `network` + `local-network`) : les rendre une par une afficherait
 * « Réseau » et « Internet requis » côte à côte, pour dire une seule chose.
 */
const REACH_DESCRIPTORS: Record<Exclude<NetworkReach, "none">, Descriptor> = {
  "local-network": {
    label: "Réseau local",
    icon: "Network",
    title: "Ouvre des connexions sur votre réseau local, jamais vers Internet",
  },
  network: {
    label: "Réseau",
    icon: "Network",
    title: "Ouvre de vraies connexions réseau, sans exiger Internet",
  },
  internet: {
    label: "Internet requis",
    icon: "Wifi",
    tone: "warn",
    title: "Cet outil ne fonctionne pas sans connexion Internet",
  },
};

const TONE_CLASS = {
  warn: "text-[var(--ft-warn)]",
  danger: "text-[var(--ft-danger)]",
} as const;

export function CapabilityList({
  tool,
  className,
}: {
  tool: ToolDefinition;
  className?: string;
}) {
  const reach = networkReach(tool);
  const visible = [
    ...tool.capabilities
      .map((capability) => DESCRIPTORS[capability])
      .filter((descriptor): descriptor is Descriptor => descriptor !== undefined),
    ...(reach === "none" ? [] : [REACH_DESCRIPTORS[reach]]),
  ];
  if (visible.length === 0) return null;

  return (
    <div className={clsx("ft-meta flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {visible.map((descriptor) => (
        <span
          key={descriptor.label}
          title={descriptor.title}
          className={clsx(
            "inline-flex items-center gap-1",
            descriptor.tone ? TONE_CLASS[descriptor.tone] : "text-[var(--ft-text-faint)]",
          )}
        >
          <Icon name={descriptor.icon} size={12} />
          {descriptor.label}
        </span>
      ))}
    </div>
  );
}
