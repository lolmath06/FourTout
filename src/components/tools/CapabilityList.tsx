import clsx from "clsx";
import type { ToolCapability, ToolDefinition } from "@/core/tools/types";
import { Icon } from "@/components/ui/Icon";

/**
 * Propriétés d'un outil, en **ligne de métadonnées** plutôt qu'en pastilles.
 *
 * Trois badges colorés côte à côte (« 100 % local », « Peut être long »,
 * « Moteur embarqué ») pèsent visuellement autant que le nom de l'outil, pour
 * une information secondaire. Une icône fine suivie d'un mot, en gris, dit la
 * même chose sans occuper le premier plan.
 *
 * Seul l'accès réseau garde une couleur : c'est la seule propriété qui
 * contredit la promesse de FourTout, donc la seule qui doit accrocher l'œil.
 */
interface Descriptor {
  label: string;
  icon: string;
  tone?: "warn" | "danger";
  title: string;
}

const DESCRIPTORS: Partial<Record<ToolCapability, Descriptor>> = {
  local: { label: "Local", icon: "ShieldCheck", title: "Traitement entièrement local" },
  network: {
    label: "Internet requis",
    icon: "Wifi",
    tone: "warn",
    title: "Cet outil a besoin d'une connexion",
  },
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
  const visible = tool.capabilities
    .map((capability) => DESCRIPTORS[capability])
    .filter((descriptor): descriptor is Descriptor => descriptor !== undefined);
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
