import { currentIntlLocale, currentLocale } from "./runtime";

/**
 * Mise en forme selon la langue affichée : nombres, dates, durées relatives,
 * tri, tailles de fichiers.
 *
 * Ces fonctions ne changent que l'**affichage** : les valeurs et les calculs
 * restent identiques quelle que soit la langue. La langue ne décide pas non
 * plus du système d'unités (métrique, impérial) : ce sont deux réglages
 * distincts.
 */

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const collators = new Map<string, Intl.Collator>();

function cached<T>(map: Map<string, T>, key: string, make: () => T): T {
  let value = map.get(key);
  if (!value) {
    value = make();
    map.set(key, value);
  }
  return value;
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  if (!Number.isFinite(value)) return "—";
  const locale = currentIntlLocale();
  return cached(numberFormats, `${locale}|${JSON.stringify(options ?? {})}`, () =>
    new Intl.NumberFormat(locale, options),
  ).format(value);
}

/** Nombre avec un nombre fixe de décimales. */
export function formatDecimal(value: number, decimals: number): string {
  return formatNumber(value, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatPercent(ratio: number, maximumFractionDigits = 1): string {
  return formatNumber(ratio, { style: "percent", maximumFractionDigits });
}

export function formatDate(
  value: Date | number | string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "long" },
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const locale = currentIntlLocale();
  return cached(dateFormats, `${locale}|${JSON.stringify(options)}`, () =>
    new Intl.DateTimeFormat(locale, options),
  ).format(date);
}

/** Date et heure, forme courte : le défaut de `toLocaleString()`. */
export function formatDateTime(
  value: Date | number | string,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  },
): string {
  return formatDate(value, options);
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** « il y a 3 minutes », « in 2 days »… */
export function formatRelativeTime(value: Date | number, now: Date | number = Date.now()): string {
  const seconds = (Number(value) - Number(now)) / 1000;
  const locale = currentIntlLocale();
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size || unit === "second") {
      return format.format(Math.round(seconds / size), unit);
    }
  }
  return format.format(0, "second");
}

/** Comparaison de textes pour un tri dans l'ordre de la langue affichée. */
export function compareText(a: string, b: string): number {
  const locale = currentIntlLocale();
  return cached(collators, locale, () => new Intl.Collator(locale, { numeric: true })).compare(
    a,
    b,
  );
}

/** Séparateurs décimal et de milliers de la langue affichée. */
export function numberSeparators(): { decimal: string; group: string } {
  const parts = cached(numberFormats, `${currentIntlLocale()}|separators`, () =>
    new Intl.NumberFormat(currentIntlLocale()),
  ).formatToParts(12345.6);
  return {
    decimal: parts.find((part) => part.type === "decimal")?.value ?? ".",
    group: parts.find((part) => part.type === "group")?.value ?? ",",
  };
}

/**
 * Remet dans la forme de la langue un nombre déjà écrit en notation
 * informatique (« 12345.678 ») : séparateur décimal et groupement des milliers.
 * Les écritures scientifiques (« 1e-9 ») sont laissées telles quelles.
 */
export function localizeNumberString(plain: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(plain)) return plain;
  const { decimal, group } = numberSeparators();
  const negative = plain.startsWith("-");
  const [integer, fraction] = (negative ? plain.slice(1) : plain).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${negative ? "-" : ""}${grouped}${fraction ? decimal + fraction : ""}`;
}

/**
 * Symboles des tailles de fichiers.
 *
 * Le français écrit l'octet « o » (Kio, Mo) ; les autres langues de FourTout
 * emploient le symbole international « B » (KiB, MB), compris partout.
 */
interface ByteSymbols {
  byte: string;
  iec: string[];
  si: string[];
}

const FRENCH_BYTES: ByteSymbols = {
  byte: "o",
  iec: ["Kio", "Mio", "Gio", "Tio", "Pio"],
  si: ["ko", "Mo", "Go", "To", "Po"],
};
const INTERNATIONAL_BYTES: ByteSymbols = {
  byte: "B",
  iec: ["KiB", "MiB", "GiB", "TiB", "PiB"],
  si: ["kB", "MB", "GB", "TB", "PB"],
};

export function byteSymbols(): ByteSymbols {
  return currentLocale() === "fr" ? FRENCH_BYTES : INTERNATIONAL_BYTES;
}

/**
 * Taille en multiples binaires (1024), avec la précision demandée par palier.
 * `decimals(value)` reçoit la valeur dans l'unité retenue.
 */
export function formatBinarySize(
  bytes: number,
  decimals: (value: number) => number = (value) => (value < 10 ? 2 : value < 100 ? 1 : 0),
  maxUnit = 3,
): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const symbols = byteSymbols();
  if (bytes < 1024) return `${bytes} ${symbols.byte}`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < Math.min(maxUnit, symbols.iec.length - 1)) {
    value /= 1024;
    unit += 1;
  }
  return `${formatDecimal(value, decimals(value))} ${symbols.iec[unit]}`;
}

/** Taille en multiples décimaux (1000) : tailles de téléchargement, débits. */
export function formatDecimalSize(bytes: number, decimals: (value: number) => number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const symbols = byteSymbols();
  if (bytes < 1000) return `${bytes} ${symbols.byte}`;
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < symbols.si.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${formatDecimal(value, decimals(value))} ${symbols.si[unit]}`;
}
