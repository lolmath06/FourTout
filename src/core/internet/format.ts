import { formatDecimal, formatDecimalSize, t } from "@/i18n";

/**
 * Mises en forme et analyses propres aux outils Internet : débits, durées,
 * instants saisis à la main, tailles visées.
 */

/** « 94,3 Mb/s » — mégabits par seconde décimaux, l'unité des opérateurs. */
export function formatMbps(mbps: number | null | undefined): string {
  if (mbps === null || mbps === undefined || !Number.isFinite(mbps)) return "—";
  const digits = mbps >= 100 ? 0 : mbps >= 10 ? 1 : 2;
  return t("{value} Mb/s", { value: formatDecimal(mbps, digits) });
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  return t("{value} ms", { value: formatDecimal(ms, ms >= 100 ? 0 : 1) });
}

/** Octets par seconde → texte (« 3,2 Mo/s »). */
export function formatTransferRate(bytesPerSecond: number): string {
  return t("{value}/s", { value: formatDecimalSize(bytesPerSecond) });
}

/** 3725 → « 1:02:05 », 65 → « 1:05 ». */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const fraction = seconds - whole;
  const tail = fraction >= 0.05 ? `.${Math.round(fraction * 10)}` : "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}${tail}` : `${minutes}:${pad(secs)}${tail}`;
}

/**
 * Lit un instant saisi : « 90 », « 1:30 », « 01:02:03 », « 1:30.5 ». Rend `null`
 * pour ce qui n'est pas un instant plausible plutôt que de deviner.
 */
export function parseTimecode(text: string): number | null {
  const clean = text.trim().replace(",", ".");
  if (!clean || !/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(clean)) return null;
  const parts = clean.split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.length > 1 && parts.slice(1).some((p) => p >= 60)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export type SizeUnit = "kb" | "mb" | "gb";

const UNIT_BYTES: Record<SizeUnit, number> = { kb: 1_000, mb: 1_000_000, gb: 1_000_000_000 };

/**
 * Taille visée → octets. Les unités sont décimales (1 Mo = 1 000 000 octets) :
 * les limites d'envoi se comptent souvent en Mio, et viser le décimal garde de
 * la marge plutôt que d'en retirer.
 */
export function targetBytes(value: number, unit: SizeUnit): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const bytes = Math.round(value * UNIT_BYTES[unit]);
  return bytes >= 1_000 ? bytes : null;
}

/** Suggestion de nom : titre ou segment d'URL, sans extension ni caractère interdit. */
export function suggestStem(name: string): string {
  const cleaned = Array.from(name, (c) => (c < " " || "\\/:*?\"<>|".includes(c) ? " " : c))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return cleaned.slice(0, 120).trim() || "media";
}

/** L'adresse a-t-elle l'allure d'une URL web ? Contrôle de confort, pas de sécurité. */
export function looksLikeWebUrl(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}
