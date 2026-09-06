/**
 * Calculs de dates, de durées et d'âge.
 *
 * Le piège de ce domaine est toujours le même : traiter un mois comme
 * « 30 jours » ou une année comme « 365 jours ». Un logiciel qui répond
 * « 30 jours » quand on ajoute un mois au 31 janvier est faux. Toutes les
 * opérations calendaires passent donc par les champs de date (année, mois,
 * jour), jamais par une arithmétique en millisecondes.
 *
 * Les dates sont manipulées en **heure locale** : c'est ce que l'utilisateur
 * saisit et ce qu'il lit sur son calendrier.
 */

const MS_PER_DAY = 86_400_000;

/** Découpe une date `AAAA-MM-JJ` sans passer par le parseur (qui lirait UTC). */
export function parseDateOnly(input: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!match) return undefined;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  // Rejette le 31 février, que `Date` glisserait silencieusement au 2 ou 3 mars.
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return undefined;
  }
  return date;
}

/** `AAAA-MM-JJ` en heure locale, pour remplir un `<input type="date">`. */
export function toDateOnly(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Minuit local du jour d'une date, pour comparer des jours et non des instants. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export interface DateDifference {
  /** Différence en jours calendaires, signée. */
  days: number;
  weeks: number;
  remainingDays: number;
  /** Différence en années, mois et jours, comme on la dit à l'oral. */
  years: number;
  months: number;
  daysAfterMonths: number;
  /** Jours ouvrés (lundi au vendredi) entre les deux dates, bornes comprises. */
  businessDays: number;
  /** Renseignées seulement quand les deux dates portent une heure. */
  totalHours?: number;
  totalMinutes?: number;
}

/**
 * Différence entre deux dates.
 *
 * Les jours calendaires sont comptés sur les dates ramenées à minuit : sans
 * cela, un changement d'heure d'été ferait apparaître ou disparaître un jour.
 */
export function dateDifference(from: Date, to: Date, withTime = false): DateDifference {
  const a = startOfDay(from);
  const b = startOfDay(to);
  const days = Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
  const sign = days < 0 ? -1 : 1;
  const absoluteDays = Math.abs(days);

  const [early, late] = days < 0 ? [to, from] : [from, to];
  const calendar = calendarSpan(startOfDay(early), startOfDay(late));

  // `-1 * 0` vaut `-0` en JavaScript, et s'affiche « -0 » : on le neutralise.
  const signed = (magnitude: number) => sign * magnitude || 0;

  const result: DateDifference = {
    days,
    weeks: signed(Math.floor(absoluteDays / 7)),
    remainingDays: signed(absoluteDays % 7),
    years: signed(calendar.years),
    months: signed(calendar.months),
    daysAfterMonths: signed(calendar.days),
    businessDays: signed(countBusinessDays(startOfDay(early), startOfDay(late))),
  };

  if (withTime) {
    const totalMs = to.getTime() - from.getTime();
    result.totalHours = totalMs / 3_600_000;
    result.totalMinutes = totalMs / 60_000;
  }
  return result;
}

/** Années, mois et jours pleins entre deux dates, `early` ≤ `late`. */
function calendarSpan(early: Date, late: Date): { years: number; months: number; days: number } {
  let years = late.getFullYear() - early.getFullYear();
  let months = late.getMonth() - early.getMonth();
  let days = late.getDate() - early.getDate();

  if (days < 0) {
    months -= 1;
    // Nombre de jours du mois qui précède la date d'arrivée : c'est lui qui
    // sert de report, pas une constante de 30 ou 31.
    days += daysInMonth(late.getFullYear(), late.getMonth() - 1);
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days };
}

/** Jours ouvrés (lundi–vendredi), bornes comprises, `early` ≤ `late`. */
function countBusinessDays(early: Date, late: Date): number {
  let count = 0;
  const cursor = new Date(early);
  while (cursor.getTime() <= late.getTime()) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

export function daysInMonth(year: number, monthIndex: number): number {
  // `monthIndex` peut valoir -1 ou 12 : `Date` normalise l'année pour nous.
  return new Date(year, monthIndex + 1, 0).getDate();
}

export type DateUnit = "days" | "weeks" | "months" | "years";

/**
 * Ajoute (ou retire) une durée calendaire à une date.
 *
 * Le 31 janvier + 1 mois donne le 28 (ou 29) février, jamais le 3 mars :
 * c'est la convention de tous les tableurs et de toutes les bibliothèques de
 * dates sérieuses, et c'est ce que l'utilisateur attend.
 */
export function addToDate(date: Date, amount: number, unit: DateUnit): Date {
  const result = new Date(date.getTime());
  if (unit === "days") {
    result.setDate(result.getDate() + amount);
    return result;
  }
  if (unit === "weeks") {
    result.setDate(result.getDate() + amount * 7);
    return result;
  }
  const monthsToAdd = unit === "years" ? amount * 12 : amount;
  const targetMonth = result.getMonth() + monthsToAdd;
  const targetYear = result.getFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const day = Math.min(result.getDate(), daysInMonth(targetYear, normalizedMonth));
  return new Date(
    targetYear,
    normalizedMonth,
    day,
    result.getHours(),
    result.getMinutes(),
    result.getSeconds(),
  );
}

export interface AgeResult {
  years: number;
  months: number;
  days: number;
  totalDays: number;
  totalWeeks: number;
  /** Prochain anniversaire et nombre de jours qui en séparent. */
  nextBirthday: Date;
  daysUntilNextBirthday: number;
}

/**
 * Âge à une date de référence.
 *
 * Le 29 février est traité comme le veut l'état civil français : une personne
 * née un 29 février fête son anniversaire le 1er mars les années communes.
 */
export function computeAge(birth: Date, reference: Date): AgeResult {
  const from = startOfDay(birth);
  const to = startOfDay(reference);
  if (from.getTime() > to.getTime()) {
    throw new RangeError("La date de naissance est postérieure à la date de référence.");
  }

  const span = calendarSpan(from, to);
  const totalDays = Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
  const nextBirthday = nextAnniversary(from, to);

  return {
    years: span.years,
    months: span.months,
    days: span.days,
    totalDays,
    totalWeeks: Math.floor(totalDays / 7),
    nextBirthday,
    daysUntilNextBirthday: Math.round((nextBirthday.getTime() - to.getTime()) / MS_PER_DAY),
  };
}

function nextAnniversary(birth: Date, reference: Date): Date {
  const isLeapDay = birth.getMonth() === 1 && birth.getDate() === 29;
  for (let year = reference.getFullYear(); year <= reference.getFullYear() + 4; year += 1) {
    const day = isLeapDay && daysInMonth(year, 1) < 29 ? 1 : birth.getDate();
    const month = isLeapDay && daysInMonth(year, 1) < 29 ? 2 : birth.getMonth();
    const candidate = new Date(year, month, day);
    if (candidate.getTime() > reference.getTime()) return candidate;
  }
  /* c8 ignore next — inatteignable : une année sur quatre au plus est bissextile. */
  return new Date(reference.getFullYear() + 1, birth.getMonth(), birth.getDate());
}

/* ------------------------------------------------------------------------ */
/* Durées                                                                    */
/* ------------------------------------------------------------------------ */

export interface Duration {
  /** Total en secondes, signé. */
  seconds: number;
}

/**
 * Lit une durée écrite `hh:mm:ss`, `mm:ss`, `1h30`, `90m`, `45s` ou `1:30:00`.
 *
 * Un outil de durées qui n'accepte qu'une seule écriture oblige l'utilisateur
 * à reformater ses données à la main : autant lui demander de calculer.
 */
export function parseDuration(input: string): number | undefined {
  const text = input.trim().toLowerCase().replace(/\s+/g, "");
  if (text.length === 0) return undefined;

  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const sign = negative ? -1 : 1;

  if (body.includes(":")) {
    const parts = body.split(":");
    if (parts.length > 3 || parts.some((part) => part.length === 0 || !/^\d+([.,]\d+)?$/.test(part))) {
      return undefined;
    }
    const numbers = parts.map((part) => Number(part.replace(",", ".")));
    // « 12:30 » se lit mm:ss quand il n'y a que deux champs ? Non : dans un
    // calcul de durées, deux champs se lisent toujours hh:mm, comme sur une
    // horloge. Trois champs se lisent hh:mm:ss.
    const [h, m, s] = numbers.length === 3 ? numbers : [numbers[0], numbers[1], 0];
    return sign * (h * 3600 + m * 60 + s);
  }

  // « 1h30 » est l'écriture la plus courante en français : les minutes y sont
  // nues. On les explicite avant d'analyser, plutôt que de rejeter la saisie.
  const explicit = body.replace(/(\d+)h(\d+)(?![a-z0-9])/, "$1h$2m");
  const unitPattern = /(\d+(?:[.,]\d+)?)(h|min|m|s)/g;
  let total = 0;
  let matched = false;
  let match: RegExpExecArray | null;
  while ((match = unitPattern.exec(explicit)) !== null) {
    matched = true;
    const value = Number(match[1].replace(",", "."));
    const unit = match[2];
    total += unit === "h" ? value * 3600 : unit === "s" ? value : value * 60;
  }
  if (matched && explicit.replace(unitPattern, "").length === 0) return sign * total;

  // Un nombre nu se lit en minutes : c'est l'unité de la vie courante.
  if (/^\d+(?:[.,]\d+)?$/.test(body)) return sign * Number(body.replace(",", ".")) * 60;
  return undefined;
}

/** `hh:mm:ss`, avec les heures non bornées à 24. */
export function formatDuration(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  const absolute = Math.abs(Math.round(totalSeconds));
  const hours = Math.floor(absolute / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  const seconds = absolute % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${sign}${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export interface DurationBreakdown {
  seconds: number;
  minutes: number;
  hours: number;
  days: number;
  formatted: string;
  human: string;
}

export function describeDuration(totalSeconds: number): DurationBreakdown {
  const absolute = Math.abs(totalSeconds);
  const days = Math.floor(absolute / 86_400);
  const hours = Math.floor((absolute % 86_400) / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  const seconds = Math.round(absolute % 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} j`);
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} s`);
  return {
    seconds: totalSeconds,
    minutes: totalSeconds / 60,
    hours: totalSeconds / 3600,
    days: totalSeconds / 86_400,
    formatted: formatDuration(totalSeconds),
    human: `${totalSeconds < 0 ? "− " : ""}${parts.join(" ")}`,
  };
}
