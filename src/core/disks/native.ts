/**
 * Client de l'inventaire de stockage natif.
 *
 * Rien de ce que ce module lit n'est enregistré. Les numéros de série et les
 * identifiants de système de fichiers sont affichés pendant la session et
 * disparaissent avec elle : ils ne vont ni dans les récents, ni dans les
 * paramètres, ni dans aucun journal.
 *
 * Aucune écriture n'est exposée. Il n'existe pas de commande de
 * partitionnement, de formatage, de montage ou d'effacement — ni ici, ni dans
 * le moteur natif.
 */

import { isTauri } from "@/core/platform";

export const DISKS_NATIVE_REQUIRED =
  "L'inventaire des disques interroge le système : il nécessite l'application FourTout " +
  "installée et n'est pas disponible dans l'aperçu navigateur.";

export type Transport = "sata" | "nvme" | "usb" | "mmc" | "virtual" | "unknown";

export const TRANSPORT_LABELS: Record<Transport, string> = {
  sata: "SATA / ATA",
  nvme: "NVMe",
  usb: "USB",
  mmc: "Carte mémoire",
  virtual: "Virtuel",
  unknown: "Inconnu",
};

export interface Volume {
  filesystem: string | null;
  label: string | null;
  uuid: string | null;
  mountPoint: string | null;
  totalBytes: number | null;
  usedBytes: number | null;
  availableBytes: number | null;
  readOnly: boolean;
}

export interface Partition {
  name: string;
  number: number | null;
  size: number;
  offset: number | null;
  kind: string | null;
  guid: string | null;
  boot: boolean;
  volume: Volume | null;
}

export interface Disk {
  name: string;
  path: string;
  model: string | null;
  vendor: string | null;
  size: number;
  transport: Transport;
  removable: boolean;
  readOnly: boolean;
  rotational: boolean | null;
  serial: string | null;
  partitionTable: string | null;
  partitions: Partition[];
  system: boolean;
}

export interface StorageInventory {
  disks: Disk[];
  otherVolumes: Volume[];
  provider: string;
  notes: string[];
}

export interface SmartReport {
  available: boolean;
  provider: string;
  health: string | null;
  temperatureC: number | null;
  powerOnHours: number | null;
  powerCycles: number | null;
  reallocatedSectors: number | null;
  pendingSectors: number | null;
  uncorrectableSectors: number | null;
  percentageUsed: number | null;
  mediaErrors: number | null;
  bytesWritten: number | null;
  notes: string[];
}

async function invokeNative<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri()) throw new Error(DISKS_NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    const message =
      typeof error === "string" ? error : error instanceof Error ? error.message : "";
    throw new Error(message || "L'inventaire a échoué.");
  }
}

export function isDisksAvailable(): boolean {
  return isTauri();
}

/** Dresse l'inventaire des disques, partitions et volumes. */
export function inventory(): Promise<StorageInventory> {
  return invokeNative<StorageInventory>("disks_inventory");
}

/** Interroge la santé d'un disque. Ne lance aucun autotest. */
export function health(device: string): Promise<SmartReport> {
  return invokeNative<SmartReport>("disks_health", { device });
}

/** Nom du fournisseur de santé disponible, ou chaîne vide. */
export function healthProvider(): Promise<string> {
  return invokeNative<string>("disks_health_provider");
}

/* ------------------------------------------------------------------------ */
/* Mise en forme                                                             */
/* ------------------------------------------------------------------------ */

export function formatSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Kio", "Mio", "Gio", "Tio", "Pio"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1).replace(".", ",")} ${units[index]}`;
}

/** Part occupée d'un volume, de 0 à 1. */
export function usedRatio(volume: Volume): number | undefined {
  if (!volume.totalBytes || volume.usedBytes === null || volume.usedBytes === undefined) {
    return undefined;
  }
  return Math.min(1, Math.max(0, volume.usedBytes / volume.totalBytes));
}

/** Nature du support, telle que le système la rapporte. */
export function mediaKind(disk: Disk): string {
  if (disk.rotational === true) return "Disque à plateaux";
  if (disk.rotational === false) return "Mémoire flash";
  return "Nature du support non rapportée";
}

/**
 * Résumé de santé, **avec son contexte**.
 *
 * Réduire un disque à un point vert ou rouge est le raccourci qui rend ces
 * écrans inutiles : « Sain » ne veut rien dire si l'on ignore d'où vient le
 * mot, et un disque sans compteur détaillé n'est pas un disque en bonne santé.
 */
export function healthSummary(report: SmartReport): string {
  if (!report.available) return "Indisponible sur ce système";
  const parts: string[] = [];
  parts.push(report.health ? `Santé rapportée : ${report.health}` : "Santé non rapportée");
  if (report.temperatureC !== null) parts.push(`${report.temperatureC} °C`);
  if (report.percentageUsed !== null) parts.push(`usure ${report.percentageUsed} %`);
  return parts.join(" · ");
}
