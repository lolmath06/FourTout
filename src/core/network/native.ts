/**
 * Client des sondes réseau natives.
 *
 * Le frontend ne décide d'aucune étendue : il transmet un hôte, une liste de
 * ports ou une interface, et c'est le moteur natif qui borne, refuse et
 * exécute. Les plages ne sont jamais reprises telles quelles depuis l'interface
 * graphique — elles sont recalculées côté natif à chaque lancement.
 *
 * Rien de ce qui est observé n'est conservé : ni les adresses, ni les noms, ni
 * les adresses matérielles. Les outils réseau ne nourrissent pas les récents
 * avec la topologie du réseau de l'utilisateur.
 */

import { isTauri } from "@/core/platform";
import type { OperationContext } from "@/core/pdf/types";
import { JobCancelledError } from "@/core/jobs/types";

export const NETWORK_NATIVE_REQUIRED =
  "Les outils réseau ouvrent de vraies connexions : ils nécessitent l'application FourTout " +
  "installée et ne sont pas disponibles dans l'aperçu navigateur.";

const NATIVE_CANCELLED = "cancelled";

export interface NetworkProgress {
  jobId: string;
  ratio: number;
  label: string;
  done: number;
  total: number;
}

/* ------------------------------------------------------------------------ */
/* Ping                                                                      */
/* ------------------------------------------------------------------------ */

export interface PingAttempt {
  sequence: number;
  rttMs: number | null;
  from: string | null;
}

export interface PingSummary {
  host: string;
  resolved: string;
  /** Méthode réellement employée : l'affichage ne peut donc pas la travestir. */
  method: string;
  sent: number;
  received: number;
  lost: number;
  lossPercent: number;
  minMs: number | null;
  avgMs: number | null;
  maxMs: number | null;
  attempts: PingAttempt[];
}

export const PING_DEFAULT_COUNT = 4;
export const PING_MAX_COUNT = 20;
export const PING_DEFAULT_TIMEOUT_MS = 1000;

/* ------------------------------------------------------------------------ */
/* Ports                                                                     */
/* ------------------------------------------------------------------------ */

export type PortStatus = "open" | "closed" | "filtered";

export interface PortResult {
  port: number;
  status: PortStatus;
  elapsedMs: number;
  /** Service **habituellement** associé au numéro. Jamais une détection. */
  usualService: string | null;
}

export interface PortScanSummary {
  host: string;
  resolved: string;
  tested: number;
  open: number;
  closed: number;
  filtered: number;
  results: PortResult[];
  cancelled: boolean;
}

export const MAX_PORTS = 256;
export const PORT_DEFAULT_TIMEOUT_MS = 1000;

export const PORT_STATUS_LABELS: Record<PortStatus, string> = {
  open: "OUVERT",
  closed: "FERMÉ",
  filtered: "AUCUNE RÉPONSE",
};

export const PORT_STATUS_EXPLANATIONS: Record<PortStatus, string> = {
  open: "La connexion a abouti : un service écoute sur ce port.",
  closed: "La machine a refusé la connexion : rien n'écoute sur ce port.",
  filtered:
    "Aucune réponse avant le délai : le port est filtré par un pare-feu, ou l'hôte est injoignable.",
};

export const SERVICE_DISCLAIMER =
  "« Service habituellement associé » vient d'une table de numéros, pas d'une détection : " +
  "n'importe quel logiciel peut écouter sur n'importe quel port.";

/* ------------------------------------------------------------------------ */
/* Réseau local                                                              */
/* ------------------------------------------------------------------------ */

export interface NetworkInterface {
  name: string;
  address: string;
  netmask: string;
  prefix: number;
  cidr: string;
  loopback: boolean;
}

export interface ScanRange {
  declaredCidr: string;
  scannedCidr: string;
  first: string;
  last: string;
  targetCount: number;
  narrowed: boolean;
  note: string | null;
}

export interface DiscoveryPlan {
  interface: NetworkInterface;
  range: ScanRange;
  summary: string;
}

export interface Device {
  address: string;
  hostname: string | null;
  mac: string | null;
  latencyMs: number | null;
  evidence: string[];
  isSelf: boolean;
}

export interface DiscoveryResult {
  range: ScanRange;
  examined: number;
  devices: Device[];
  cancelled: boolean;
  methods: string[];
  note: string;
}

/* ------------------------------------------------------------------------ */
/* Pont natif                                                                */
/* ------------------------------------------------------------------------ */

export function isNetworkEngineAvailable(): boolean {
  return isTauri();
}

let sequence = 0;
function nextJobId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
}

async function runProbe<T>(
  prefix: string,
  command: string,
  args: (jobId: string) => Record<string, unknown>,
  context?: OperationContext,
): Promise<T> {
  if (!isTauri()) throw new Error(NETWORK_NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");

  const jobId = nextJobId(prefix);
  const unlisten = await listen<NetworkProgress>("network://progress", (event) => {
    if (event.payload.jobId !== jobId) return;
    context?.report?.({
      ratio: event.payload.ratio >= 0 ? event.payload.ratio : undefined,
      label: event.payload.label,
    });
  });

  const onAbort = () => {
    void invoke("network_cancel", { jobId });
  };
  context?.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    return await invoke<T>(command, args(jobId));
  } catch (error) {
    const message =
      typeof error === "string" ? error : error instanceof Error ? error.message : "";
    if (message === NATIVE_CANCELLED || context?.signal?.aborted) throw new JobCancelledError();
    throw new Error(message || "La sonde réseau a échoué.");
  } finally {
    unlisten();
    context?.signal?.removeEventListener("abort", onAbort);
  }
}

/** Ping ICMP d'un hôte. */
export function ping(
  host: string,
  options: { count?: number; timeoutMs?: number } = {},
  context?: OperationContext,
): Promise<PingSummary> {
  return runProbe<PingSummary>(
    "ping",
    "network_ping",
    (jobId) => ({
      jobId,
      host,
      count: options.count ?? PING_DEFAULT_COUNT,
      timeoutMs: options.timeoutMs ?? PING_DEFAULT_TIMEOUT_MS,
    }),
    context,
  );
}

/** Test d'une liste de ports sur un hôte. */
export function checkPorts(
  host: string,
  portsSpec: string,
  options: { timeoutMs?: number } = {},
  context?: OperationContext,
): Promise<PortScanSummary> {
  return runProbe<PortScanSummary>(
    "ports",
    "network_check_ports",
    (jobId) => ({
      jobId,
      host,
      portsSpec,
      timeoutMs: options.timeoutMs ?? PORT_DEFAULT_TIMEOUT_MS,
    }),
    context,
  );
}

/** Interprète une liste de ports sans rien sonder, pour l'afficher avant. */
export async function parsePorts(spec: string): Promise<number[]> {
  if (!isTauri()) throw new Error(NETWORK_NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<number[]>("network_parse_ports", { spec });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "Liste de ports illisible.");
  }
}

/** Interfaces IPv4 de la machine. */
export async function listInterfaces(): Promise<NetworkInterface[]> {
  if (!isTauri()) throw new Error(NETWORK_NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<NetworkInterface[]>("network_interfaces", {});
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "Interfaces réseau illisibles.");
  }
}

/** Ce qu'une découverte examinerait, **avant** de l'examiner. */
export async function planDiscovery(target: NetworkInterface): Promise<DiscoveryPlan> {
  if (!isTauri()) throw new Error(NETWORK_NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<DiscoveryPlan>("network_lan_plan", {
      name: target.name,
      address: target.address,
      netmask: target.netmask,
    });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "Plage de découverte incalculable.");
  }
}

/** Lance la découverte, dans la plage annoncée et pas ailleurs. */
export function discoverLan(
  target: NetworkInterface,
  context?: OperationContext,
): Promise<DiscoveryResult> {
  return runProbe<DiscoveryResult>(
    "lan",
    "network_lan_discover",
    (jobId) => ({
      jobId,
      name: target.name,
      address: target.address,
      netmask: target.netmask,
    }),
    context,
  );
}

/* ------------------------------------------------------------------------ */
/* Mise en forme                                                             */
/* ------------------------------------------------------------------------ */

export function formatLatency(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  return `${ms.toFixed(ms < 10 ? 2 : 1).replace(".", ",")} ms`;
}

export function formatLoss(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  return `${String(rounded).replace(".", ",")} %`;
}
