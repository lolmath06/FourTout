/**
 * Conversion d'heure entre fuseaux horaires.
 *
 * Un fuseau horaire n'est pas un décalage. « Paris = UTC+1 » est faux la moitié
 * de l'année, et « New York = UTC−5 » est faux à des dates qui ne sont pas les
 * mêmes que celles de Paris. Une table de décalages figée produit donc des
 * résultats justes en janvier et faux en juillet — c'est la raison pour laquelle
 * ce module n'en contient aucune et interroge la base IANA du système, via
 * `Intl`, à la date demandée.
 *
 * Deux conséquences que l'interface doit montrer, et qu'un convertisseur naïf
 * escamote :
 *
 * - Au passage à l'heure d'été, une heure locale **n'existe pas** (à Paris, le
 *   dernier dimanche de mars, il n'est jamais 2 h 30).
 * - Au retour à l'heure d'hiver, une heure locale **existe deux fois** (le
 *   dernier dimanche d'octobre, 2 h 30 arrive une fois en heure d'été et une
 *   fois en heure d'hiver).
 *
 * Choisir silencieusement l'une des deux serait rendre un résultat faux une fois
 * sur deux, sans le dire.
 */

/** Champs d'une heure murale, tels qu'un formulaire les fournit. */
export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Une heure murale dans un fuseau, rattachée à un instant précis. */
export interface ZonedTime {
  zone: string;
  wall: WallClock;
  /** Instant absolu correspondant, en millisecondes depuis l'époque Unix. */
  epochMs: number;
  /** Décalage par rapport à UTC, en minutes (positif à l'est). */
  offsetMinutes: number;
  /** Décalage écrit `+01:00`. */
  offsetLabel: string;
  /** Abréviation locale du fuseau à cette date (« CET », « GMT+5:30 »…). */
  abbreviation: string;
  /** Heure lisible, dans la langue de l'application. */
  readable: string;
  /** Instant en ISO 8601 UTC. */
  iso: string;
}

export type ConversionKind =
  /** Cas ordinaire : une heure murale, un instant. */
  | "unique"
  /** Heure murale inexistante (passage à l'heure d'été). */
  | "skipped"
  /** Heure murale vécue deux fois (retour à l'heure d'hiver). */
  | "ambiguous";

export interface ZoneConversion {
  kind: ConversionKind;
  source: ZonedTime;
  target: ZonedTime;
  /**
   * Seconde lecture possible quand `kind` vaut `ambiguous` : même heure murale
   * de départ, autre instant, donc autre heure d'arrivée.
   */
  alternative?: { source: ZonedTime; target: ZonedTime };
  /** Explication à afficher telle quelle lorsque le cas n'est pas ordinaire. */
  note?: string;
}

export class TimeZoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeZoneError";
  }
}

/* ------------------------------------------------------------------------ */
/* Accès à la base IANA                                                      */
/* ------------------------------------------------------------------------ */

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(zone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      throw new TimeZoneError(`Fuseau horaire inconnu du système : « ${zone} ».`);
    }
    partsFormatters.set(zone, formatter);
  }
  return formatter;
}

/** Vrai si le système connaît cet identifiant de fuseau. */
export function isKnownZone(zone: string): boolean {
  try {
    partsFormatter(zone);
    return true;
  } catch {
    return false;
  }
}

/** Heure murale observée dans un fuseau à un instant donné. */
export function wallClockAt(zone: string, epochMs: number): WallClock {
  const parts = partsFormatter(zone).formatToParts(new Date(epochMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found ? Number(found.value) : Number.NaN;
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

function wallToUtcMs(wall: WallClock): number {
  // `Date.UTC` traite les années 0–99 comme 1900–1999 : on rétablit la vraie
  // année, sans quoi une date historique serait déplacée d'un siècle.
  const ms = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  if (wall.year >= 0 && wall.year <= 99) {
    const corrected = new Date(ms);
    corrected.setUTCFullYear(wall.year);
    return corrected.getTime();
  }
  return ms;
}

/**
 * Décalage d'un fuseau par rapport à UTC à un instant donné, en minutes.
 *
 * Mesuré, pas tabulé : on demande au système l'heure murale à cet instant et on
 * la compare à UTC.
 */
export function zoneOffsetMinutes(zone: string, epochMs: number): number {
  const wall = wallClockAt(zone, epochMs);
  // Les secondes de l'instant peuvent différer si le décalage n'est pas rond
  // (certains fuseaux historiques ont des secondes) : la division arrondie
  // ramène au décalage en minutes, seule granularité utile ici.
  return Math.round((wallToUtcMs(wall) - epochMs) / 60_000);
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const rest = absolute % 60;
  return `${sign}${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

const abbreviationFormatters = new Map<string, Intl.DateTimeFormat>();

function abbreviationAt(zone: string, epochMs: number): string {
  let formatter = abbreviationFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" });
    abbreviationFormatters.set(zone, formatter);
  }
  const part = formatter.formatToParts(new Date(epochMs)).find((p) => p.type === "timeZoneName");
  return part?.value ?? "";
}

const readableFormatters = new Map<string, Intl.DateTimeFormat>();

function readableAt(zone: string, epochMs: number): string {
  let formatter = readableFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("fr-FR", {
      timeZone: zone,
      dateStyle: "full",
      timeStyle: "medium",
    });
    readableFormatters.set(zone, formatter);
  }
  return formatter.format(new Date(epochMs));
}

function describe(zone: string, epochMs: number): ZonedTime {
  const offsetMinutes = zoneOffsetMinutes(zone, epochMs);
  return {
    zone,
    wall: wallClockAt(zone, epochMs),
    epochMs,
    offsetMinutes,
    offsetLabel: formatOffset(offsetMinutes),
    abbreviation: abbreviationAt(zone, epochMs),
    readable: readableAt(zone, epochMs),
    iso: new Date(epochMs).toISOString(),
  };
}

/** Décrit un instant absolu tel qu'il est vu dans un fuseau. */
export function zonedTimeAt(zone: string, epochMs: number): ZonedTime {
  if (!Number.isFinite(epochMs)) throw new TimeZoneError("Instant invalide.");
  return describe(zone, epochMs);
}

const DAY_MS = 86_400_000;

function sameWall(a: WallClock, b: WallClock): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

/**
 * Instants correspondant à une heure murale dans un fuseau.
 *
 * Renvoie zéro instant (heure sautée), un instant (cas ordinaire) ou deux
 * instants (heure répétée), triés du plus ancien au plus récent.
 */
export function instantsForWallClock(zone: string, wall: WallClock): number[] {
  const naive = wallToUtcMs(wall);
  if (!Number.isFinite(naive)) throw new TimeZoneError("Date ou heure invalide.");

  // On essaie les décalages en vigueur la veille et le lendemain, en plus de
  // celui estimé sur place. Autour d'un changement d'heure, ces deux décalages
  // encadrent la transition et donnent les deux lectures possibles ; ailleurs,
  // ils sont identiques et une seule subsiste. Se contenter du décalage estimé
  // sur place ferait disparaître l'une des deux occurrences d'une heure
  // répétée, c'est-à-dire exactement le cas qu'il faut signaler.
  const offsets = new Set([
    zoneOffsetMinutes(zone, naive - DAY_MS),
    zoneOffsetMinutes(zone, naive),
    zoneOffsetMinutes(zone, naive + DAY_MS),
  ]);

  const candidates = new Set<number>();
  for (const offset of offsets) candidates.add(naive - offset * 60_000);

  return [...candidates]
    .filter((epochMs) => sameWall(wallClockAt(zone, epochMs), wall))
    .sort((a, b) => a - b);
}

/* ------------------------------------------------------------------------ */
/* Conversion                                                                */
/* ------------------------------------------------------------------------ */

export interface ConvertOptions {
  /**
   * Face à une heure répétée, quelle occurrence retenir. `first` est la
   * première (encore en heure d'été), `second` la seconde (heure d'hiver).
   * Les deux sont toujours renvoyées : ce réglage ne fait que décider laquelle
   * est mise en avant.
   */
  prefer?: "first" | "second";
}

/** Convertit une heure murale d'un fuseau vers un autre. */
export function convertZone(
  wall: WallClock,
  fromZone: string,
  toZone: string,
  options: ConvertOptions = {},
): ZoneConversion {
  if (!isKnownZone(fromZone)) throw new TimeZoneError(`Fuseau de départ inconnu : « ${fromZone} ».`);
  if (!isKnownZone(toZone)) throw new TimeZoneError(`Fuseau d'arrivée inconnu : « ${toZone} ».`);

  const instants = instantsForWallClock(fromZone, wall);

  if (instants.length === 0) {
    // Heure sautée : l'horloge locale est passée directement par-dessus. On
    // montre l'instant réel qui suit immédiatement la transition, en disant
    // clairement que ce n'est pas l'heure demandée.
    // Le décalage retenu est celui de la veille, c'est-à-dire celui d'avant la
    // transition : l'instant obtenu est donc l'heure demandée « décalée en
    // avant » de la durée du saut, ce que montre un calendrier.
    const naive = wallToUtcMs(wall);
    const shifted = naive - zoneOffsetMinutes(fromZone, naive - DAY_MS) * 60_000;
    const source = describe(fromZone, shifted);
    return {
      kind: "skipped",
      source,
      target: describe(toZone, shifted),
      note:
        `Cette heure n'existe pas à ${fromZone} ce jour-là : l'horloge locale a avancé et ` +
        `est passée directement de l'heure d'hiver à l'heure d'été. L'instant le plus proche ` +
        `est ${source.wall.hour.toString().padStart(2, "0")}:${source.wall.minute
          .toString()
          .padStart(2, "0")} heure locale.`,
    };
  }

  if (instants.length === 1) {
    return {
      kind: "unique",
      source: describe(fromZone, instants[0]),
      target: describe(toZone, instants[0]),
    };
  }

  const [earlier, later] = instants;
  const chosen = options.prefer === "second" ? later : earlier;
  const other = chosen === earlier ? later : earlier;
  const earlierAbbr = abbreviationAt(fromZone, earlier);
  const laterAbbr = abbreviationAt(fromZone, later);
  return {
    kind: "ambiguous",
    source: describe(fromZone, chosen),
    target: describe(toZone, chosen),
    alternative: { source: describe(fromZone, other), target: describe(toZone, other) },
    note:
      `Cette heure est vécue deux fois à ${fromZone} ce jour-là : l'horloge locale a reculé. ` +
      `La première occurrence est en ${earlierAbbr || formatOffset(zoneOffsetMinutes(fromZone, earlier))}, ` +
      `la seconde en ${laterAbbr || formatOffset(zoneOffsetMinutes(fromZone, later))}. ` +
      `Les deux sont affichées : seul le contexte permet de trancher.`,
  };
}

/* ------------------------------------------------------------------------ */
/* Catalogue de fuseaux                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Repli si le moteur ne sait pas énumérer les fuseaux : une liste courte mais
 * représentative, plutôt qu'un sélecteur vide.
 */
const FALLBACK_ZONES = [
  "UTC",
  "Europe/Paris",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Lisbon",
  "Europe/Moscow",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "America/Montreal",
  "Africa/Casablanca",
  "Africa/Abidjan",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Singapore",
  "Australia/Sydney",
  "Pacific/Auckland",
  "Pacific/Honolulu",
];

let cachedZones: string[] | undefined;

/** Tous les identifiants IANA connus du système, triés. */
export function listZones(): string[] {
  if (cachedZones) return cachedZones;
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  let zones: string[];
  try {
    zones = supported ? [...supported("timeZone")] : [...FALLBACK_ZONES];
  } catch {
    zones = [...FALLBACK_ZONES];
  }
  if (!zones.includes("UTC")) zones.push("UTC");
  cachedZones = zones.sort((a, b) => a.localeCompare(b));
  return cachedZones;
}

/** Nom de ville lisible tiré d'un identifiant IANA (`Europe/Paris` → « Paris »). */
export function zoneCity(zone: string): string {
  const last = zone.split("/").pop() ?? zone;
  return last.replace(/_/g, " ");
}

function searchKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Recherche un fuseau par ville ou par identifiant.
 *
 * « paris », « new york », « Asia/Tokyo » et « tokyo » doivent tous aboutir.
 */
export function searchZones(query: string, limit = 20): string[] {
  const needle = searchKey(query);
  const zones = listZones();
  if (needle.length === 0) return zones.slice(0, limit);

  const scored: { zone: string; score: number }[] = [];
  for (const zone of zones) {
    const city = searchKey(zoneCity(zone));
    const full = searchKey(zone);
    let score = 0;
    if (city === needle) score = 100;
    else if (city.startsWith(needle)) score = 80;
    else if (full.startsWith(needle)) score = 60;
    else if (city.includes(needle)) score = 40;
    else if (full.includes(needle)) score = 20;
    if (score > 0) scored.push({ zone, score });
  }
  scored.sort((a, b) => b.score - a.score || a.zone.localeCompare(b.zone));
  return scored.slice(0, limit).map((entry) => entry.zone);
}

/** Fuseau du système, ou UTC si le moteur ne le dit pas. */
export function systemZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/* ------------------------------------------------------------------------ */
/* Entrées et sorties textuelles                                             */
/* ------------------------------------------------------------------------ */

/** Lit `2026-03-29` et `14:30` (ou `14:30:15`) en heure murale. */
export function parseWallClock(date: string, time: string): WallClock {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!dateMatch) throw new TimeZoneError("La date doit être écrite AAAA-MM-JJ.");
  const timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!timeMatch) throw new TimeZoneError("L'heure doit être écrite HH:MM ou HH:MM:SS.");

  const wall: WallClock = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    second: timeMatch[3] ? Number(timeMatch[3]) : 0,
  };
  if (wall.month < 1 || wall.month > 12) throw new TimeZoneError("Mois invalide.");
  if (wall.day < 1 || wall.day > 31) throw new TimeZoneError("Jour invalide.");
  if (wall.hour > 23) throw new TimeZoneError("L'heure doit être comprise entre 0 et 23.");
  if (wall.minute > 59 || wall.second > 59) throw new TimeZoneError("Minutes ou secondes invalides.");

  // Un 31 février passerait les contrôles ci-dessus : c'est le calendrier qui
  // tranche, en comparant la date reconstruite à celle demandée.
  const probe = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  if (probe.getUTCMonth() !== wall.month - 1 || probe.getUTCDate() !== wall.day) {
    throw new TimeZoneError("Cette date n'existe pas dans le calendrier.");
  }
  return wall;
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

export function formatWallDate(wall: WallClock): string {
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}

export function formatWallTime(wall: WallClock, withSeconds = false): string {
  const base = `${pad(wall.hour)}:${pad(wall.minute)}`;
  return withSeconds ? `${base}:${pad(wall.second)}` : base;
}
