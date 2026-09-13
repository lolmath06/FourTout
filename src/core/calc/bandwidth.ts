/**
 * Bande passante et temps de transfert.
 *
 * Tout le sujet tient dans deux confusions, et l'outil n'a d'intérêt que s'il
 * les tient à distance :
 *
 * 1. **Bits et octets.** Un débit s'annonce en bits par seconde (« 1 Gb/s »),
 *    une taille de fichier se lit en octets (« 1 Go »). Le facteur 8 entre les
 *    deux explique à lui seul pourquoi une fibre « 1 gigabit » ne télécharge pas
 *    un gigaoctet par seconde.
 * 2. **1000 et 1024.** Les préfixes SI (ko, Mo, Go) valent 1000, les préfixes
 *    binaires IEC (Kio, Mio, Gio) valent 1024. L'écart atteint 7 % au gigaoctet
 *    et 10 % au téraoctet.
 *
 * Chaque unité porte donc ici son facteur explicite, et jamais une abréviation
 * ambiguë : `Mb/s` et `MB/s` ne s'écrivent pas de la même façon parce qu'elles
 * ne désignent pas la même chose.
 *
 * Tous les calculs internes se font **en bits**, en nombres à virgule flottante
 * IEEE 754 dont la plage entière exacte (2^53 bits ≈ 1 Pio) couvre largement les
 * volumes visés.
 */

export type UnitSystem = "si" | "iec";
export type UnitBasis = "bit" | "byte";

export interface DataUnit {
  id: string;
  /** Abréviation affichée, sans ambiguïté possible. */
  label: string;
  /** Nombre de bits que vaut une unité. */
  bits: number;
  system: UnitSystem;
  basis: UnitBasis;
}

const SI = 1000;
const IEC = 1024;

/** Unités de **taille**. */
export const SIZE_UNITS: DataUnit[] = [
  { id: "bit", label: "bit", bits: 1, system: "si", basis: "bit" },
  { id: "kbit", label: "kbit", bits: SI, system: "si", basis: "bit" },
  { id: "Mbit", label: "Mbit", bits: SI ** 2, system: "si", basis: "bit" },
  { id: "Gbit", label: "Gbit", bits: SI ** 3, system: "si", basis: "bit" },
  { id: "Tbit", label: "Tbit", bits: SI ** 4, system: "si", basis: "bit" },

  { id: "Kibit", label: "Kibit", bits: IEC, system: "iec", basis: "bit" },
  { id: "Mibit", label: "Mibit", bits: IEC ** 2, system: "iec", basis: "bit" },
  { id: "Gibit", label: "Gibit", bits: IEC ** 3, system: "iec", basis: "bit" },
  { id: "Tibit", label: "Tibit", bits: IEC ** 4, system: "iec", basis: "bit" },

  { id: "B", label: "o (octet)", bits: 8, system: "si", basis: "byte" },
  { id: "kB", label: "ko (10³)", bits: 8 * SI, system: "si", basis: "byte" },
  { id: "MB", label: "Mo (10⁶)", bits: 8 * SI ** 2, system: "si", basis: "byte" },
  { id: "GB", label: "Go (10⁹)", bits: 8 * SI ** 3, system: "si", basis: "byte" },
  { id: "TB", label: "To (10¹²)", bits: 8 * SI ** 4, system: "si", basis: "byte" },

  { id: "KiB", label: "Kio (2¹⁰)", bits: 8 * IEC, system: "iec", basis: "byte" },
  { id: "MiB", label: "Mio (2²⁰)", bits: 8 * IEC ** 2, system: "iec", basis: "byte" },
  { id: "GiB", label: "Gio (2³⁰)", bits: 8 * IEC ** 3, system: "iec", basis: "byte" },
  { id: "TiB", label: "Tio (2⁴⁰)", bits: 8 * IEC ** 4, system: "iec", basis: "byte" },
];

/** Unités de **débit** : les mêmes, par seconde. */
export const RATE_UNITS: DataUnit[] = SIZE_UNITS.map((unit) => ({
  ...unit,
  id: `${unit.id}/s`,
  label: unit.basis === "bit" ? `${unit.label}/s` : `${unit.label.split(" ")[0]}/s`,
}));

const SIZE_BY_ID = new Map(SIZE_UNITS.map((unit) => [unit.id, unit]));
const RATE_BY_ID = new Map(RATE_UNITS.map((unit) => [unit.id, unit]));

export function sizeUnit(id: string): DataUnit {
  const unit = SIZE_BY_ID.get(id);
  if (!unit) throw new BandwidthError(`Unité de taille inconnue : « ${id} ».`);
  return unit;
}

export function rateUnit(id: string): DataUnit {
  const unit = RATE_BY_ID.get(id);
  if (!unit) throw new BandwidthError(`Unité de débit inconnue : « ${id} ».`);
  return unit;
}

export class BandwidthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BandwidthError";
  }
}

function requirePositive(value: number, what: string, allowZero = false): number {
  if (!Number.isFinite(value)) throw new BandwidthError(`${what} : ce n'est pas un nombre.`);
  if (value < 0) throw new BandwidthError(`${what} ne peut pas être négatif.`);
  if (!allowZero && value === 0) throw new BandwidthError(`${what} ne peut pas être nul.`);
  return value;
}

/** Convertit une quantité exprimée dans une unité vers des bits. */
export function toBits(value: number, unitId: string): number {
  requirePositive(value, "La quantité", true);
  return value * sizeUnit(unitId).bits;
}

/** Convertit des bits vers une unité de taille. */
export function fromBits(bits: number, unitId: string): number {
  return bits / sizeUnit(unitId).bits;
}

/* ------------------------------------------------------------------------ */
/* Débit                                                                     */
/* ------------------------------------------------------------------------ */

export interface RateView {
  unitId: string;
  label: string;
  value: number;
  system: UnitSystem;
  basis: UnitBasis;
}

/** Unités mises en avant : celles qu'on lit réellement sur une facture ou un OS. */
const HIGHLIGHT_RATES = [
  "bit/s",
  "kbit/s",
  "Mbit/s",
  "Gbit/s",
  "Kibit/s",
  "Mibit/s",
  "Gibit/s",
  "B/s",
  "kB/s",
  "MB/s",
  "KiB/s",
  "MiB/s",
  "GiB/s",
];

/** Toutes les lectures d'un même débit, exprimé en bits par seconde. */
export function rateViews(bitsPerSecond: number): RateView[] {
  return HIGHLIGHT_RATES.map((id) => {
    const unit = rateUnit(id);
    return {
      unitId: id,
      label: unit.label,
      value: bitsPerSecond / unit.bits,
      system: unit.system,
      basis: unit.basis,
    };
  });
}

export interface BandwidthResult {
  /** Débit moyen, en bits par seconde. */
  bitsPerSecond: number;
  /** Volume transféré, en bits. */
  bits: number;
  seconds: number;
  views: RateView[];
  /** Unité la plus lisible pour ce débit, en bits par seconde. */
  bestBitRate: RateView;
  /** Unité la plus lisible pour ce débit, en octets par seconde. */
  bestByteRate: RateView;
}

/**
 * Débit moyen d'un transfert : une quantité divisée par une durée.
 *
 * C'est une moyenne arithmétique sur toute la durée, pas un débit instantané :
 * elle inclut donc les creux, les reprises et l'établissement de la connexion.
 */
export function bandwidthFromTransfer(
  size: number,
  sizeUnitId: string,
  seconds: number,
): BandwidthResult {
  requirePositive(size, "La taille");
  requirePositive(seconds, "La durée");
  const bits = toBits(size, sizeUnitId);
  const bitsPerSecond = bits / seconds;
  const views = rateViews(bitsPerSecond);
  return {
    bitsPerSecond,
    bits,
    seconds,
    views,
    bestBitRate: bestView(views, "bit", "si"),
    bestByteRate: bestView(views, "byte", "iec"),
  };
}

/** Choisit l'unité qui donne un nombre entre 1 et 1000, à défaut la plus grande. */
function bestView(views: RateView[], basis: UnitBasis, system: UnitSystem): RateView {
  const family = views.filter((view) => view.basis === basis && view.system === system);
  const readable = family.filter((view) => view.value >= 1 && view.value < 1000);
  // Parmi les lectures « lisibles », la plus petite valeur correspond à la plus
  // grande unité : c'est celle qu'on écrit spontanément. S'il n'y en a aucune
  // (débit minuscule), on retombe sur la plus petite unité, qui évite un 0,000.
  if (readable.length > 0) {
    return readable.reduce((best, view) => (view.value < best.value ? view : best));
  }
  return family.reduce((best, view) => (view.value > best.value ? view : best));
}

/* ------------------------------------------------------------------------ */
/* Temps de transfert                                                        */
/* ------------------------------------------------------------------------ */

export interface DurationParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** Secondes totales, sans arrondi. */
  totalSeconds: number;
}

export interface TransferTimeResult {
  bits: number;
  bitsPerSecond: number;
  duration: DurationParts;
  /** Durée écrite en toutes lettres (« 13 min 20 s »). */
  readable: string;
  /** Vue du débit fourni, pour rappeler ce qui a servi au calcul. */
  rate: RateView;
}

export function splitDuration(totalSeconds: number): DurationParts {
  const whole = Math.floor(totalSeconds);
  return {
    days: Math.floor(whole / 86_400),
    hours: Math.floor((whole % 86_400) / 3600),
    minutes: Math.floor((whole % 3600) / 60),
    // La fraction de seconde reste attachée aux secondes : la tronquer ferait
    // disparaître un transfert de 0,4 s derrière un « 0 s ».
    seconds: whole % 60 + (totalSeconds - whole),
    totalSeconds,
  };
}

function formatSeconds(value: number): string {
  // Deux décimales au plus, mais sans zéro inutile : « 0,4 s », pas « 0,40 s ».
  const rounded = Math.round(value * 100) / 100;
  return `${String(rounded).replace(".", ",")} s`;
}

export function formatDuration(parts: DurationParts): string {
  const chunks: string[] = [];
  if (parts.days > 0) chunks.push(`${parts.days} j`);
  if (parts.hours > 0) chunks.push(`${parts.hours} h`);
  if (parts.minutes > 0) chunks.push(`${parts.minutes} min`);
  if (parts.seconds > 0 || chunks.length === 0) chunks.push(formatSeconds(parts.seconds));
  return chunks.join(" ");
}

/**
 * Durée théorique d'un transfert.
 *
 * « Théorique » au sens strict : taille divisée par débit. Ni l'en-tête des
 * protocoles, ni la latence, ni la congestion, ni le temps d'écriture sur le
 * disque ne sont pris en compte — en pratique, le transfert est toujours plus
 * long que ce nombre.
 */
export function transferTime(
  size: number,
  sizeUnitId: string,
  rate: number,
  rateUnitId: string,
): TransferTimeResult {
  requirePositive(size, "La taille");
  requirePositive(rate, "Le débit");
  const bits = toBits(size, sizeUnitId);
  const unit = rateUnit(rateUnitId);
  const bitsPerSecond = rate * unit.bits;
  const totalSeconds = bits / bitsPerSecond;
  const duration = splitDuration(totalSeconds);
  return {
    bits,
    bitsPerSecond,
    duration,
    readable: formatDuration(duration),
    rate: {
      unitId: unit.id,
      label: unit.label,
      value: rate,
      system: unit.system,
      basis: unit.basis,
    },
  };
}

/** Rappel affiché sous chaque résultat de temps de transfert. */
export const TRANSFER_THEORETICAL_NOTE =
  "Calcul théorique : taille ÷ débit. Il ignore l'en-tête des protocoles (TCP, TLS, HTTP), " +
  "la latence, la congestion du réseau et la vitesse d'écriture du disque. Un transfert réel " +
  "est toujours plus long, de 5 à 20 % dans les cas ordinaires.";

/** Rappel affiché par les deux outils, en tête. */
export const BITS_VERSUS_BYTES_NOTE =
  "1 octet = 8 bits. Les débits s'annoncent en bits par seconde (Mbit/s), les fichiers se " +
  "mesurent en octets (Mo, Mio). Et 1 Mo = 1 000 000 octets quand 1 Mio = 1 048 576 octets.";
