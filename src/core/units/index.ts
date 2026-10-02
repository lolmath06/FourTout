/**
 * Moteur d'unités unique.
 *
 * Les dix cartes « Convertisseur — … » du catalogue sont dix points d'entrée
 * sur **un seul** moteur : une dimension déclare ses unités et le facteur qui
 * les relie à son unité de référence, et la conversion est toujours la même
 * division suivie d'une multiplication. Écrire dix moteurs aurait garanti dix
 * façons différentes d'arrondir et dix jeux de facteurs à maintenir.
 *
 * Deux règles tenues partout :
 *  - les facteurs sont **exacts** quand la définition l'est (le pouce vaut
 *    25,4 mm par définition, pas 25,400051) ;
 *  - la température est le seul cas affine (décalage d'origine) : elle passe
 *    par des fonctions dédiées plutôt que par un facteur, sans quoi 0 °C
 *    vaudrait 0 °F.
 */

import { localizeNumberString, localized, numberSeparators, t } from "@/i18n";
export type DimensionId =
  | "length"
  | "mass"
  | "temperature"
  | "volume"
  | "area"
  | "speed"
  | "pressure"
  | "energy"
  | "power"
  | "data";

export interface UnitDefinition {
  id: string;
  /** Symbole affiché : « km/h », « °C », « GiB ». */
  symbol: string;
  /** Nom complet, utilisé dans les listes déroulantes. */
  name: string;
  /**
   * Combien d'unités de référence vaut **une** unité. Absent pour les unités
   * affines, qui déclarent `toBase`/`fromBase`.
   */
  factor?: number;
  toBase?: (value: number) => number;
  fromBase?: (value: number) => number;
  /** Précision d'usage : les systèmes coutumiers méritent une note. */
  note?: string;
}

export interface Dimension {
  id: DimensionId;
  name: string;
  /** Unité de référence interne : toutes les conversions y passent. */
  base: string;
  units: UnitDefinition[];
  /** Unités proposées par défaut à l'ouverture de l'outil. */
  defaults: [string, string];
}

/* Facteurs exacts par définition internationale (accord de 1959 pour le pouce). */
const INCH_M = 0.0254;
const FOOT_M = INCH_M * 12;
const YARD_M = FOOT_M * 3;
const MILE_M = FOOT_M * 5280;
const NAUTICAL_MILE_M = 1852;
const POUND_KG = 0.45359237;
const OUNCE_KG = POUND_KG / 16;
/** Gallon US liquide : 231 pouces cubes, exactement. */
const GALLON_US_L = (231 * INCH_M ** 3 * 1000) / 1;
/** Gallon impérial : 4,54609 L, exactement (loi britannique de 1985). */
const GALLON_IMP_L = 4.54609;
/** Calorie thermochimique, celle des tables de nutrition. */
const CALORIE_J = 4.184;
/** BTU (International Table), la définition la plus courante. */
const BTU_J = 1055.05585262;

export const DIMENSIONS: Dimension[] = localized(() => [
  {
    id: "length",
    name: t("Longueurs"),
    base: "m",
    defaults: ["km", "mi"],
    units: [
      { id: "mm", symbol: "mm", name: t("millimètre"), factor: 0.001 },
      { id: "cm", symbol: "cm", name: t("centimètre"), factor: 0.01 },
      { id: "m", symbol: "m", name: t("mètre"), factor: 1 },
      { id: "km", symbol: "km", name: t("kilomètre"), factor: 1000 },
      { id: "in", symbol: "in", name: "pouce", factor: INCH_M },
      { id: "ft", symbol: "ft", name: "pied", factor: FOOT_M },
      { id: "yd", symbol: "yd", name: "yard", factor: YARD_M },
      { id: "mi", symbol: "mi", name: "mile", factor: MILE_M },
      {
        id: "nmi",
        symbol: "nmi",
        name: t("mille marin"),
        factor: NAUTICAL_MILE_M,
        note: t("1 852 m exactement"),
      },
    ],
  },
  {
    id: "mass",
    name: t("Poids et masses"),
    base: "kg",
    defaults: ["kg", "lb"],
    units: [
      { id: "mg", symbol: "mg", name: "milligramme", factor: 1e-6 },
      { id: "g", symbol: "g", name: "gramme", factor: 0.001 },
      { id: "kg", symbol: "kg", name: "kilogramme", factor: 1 },
      { id: "t", symbol: "t", name: "tonne", factor: 1000 },
      { id: "oz", symbol: "oz", name: "once", factor: OUNCE_KG, note: t("once avoirdupois") },
      { id: "lb", symbol: "lb", name: "livre", factor: POUND_KG },
      { id: "st", symbol: "st", name: "stone", factor: POUND_KG * 14 },
    ],
  },
  {
    id: "temperature",
    name: t("Températures"),
    base: "K",
    defaults: ["C", "F"],
    units: [
      {
        id: "C",
        symbol: "°C",
        name: t("degré Celsius"),
        toBase: (v) => v + 273.15,
        fromBase: (v) => v - 273.15,
      },
      {
        id: "F",
        symbol: "°F",
        name: t("degré Fahrenheit"),
        toBase: (v) => ((v - 32) * 5) / 9 + 273.15,
        fromBase: (v) => ((v - 273.15) * 9) / 5 + 32,
      },
      { id: "K", symbol: "K", name: "kelvin", toBase: (v) => v, fromBase: (v) => v },
    ],
  },
  {
    id: "volume",
    name: t("Volumes"),
    base: "L",
    defaults: ["L", "gal"],
    units: [
      { id: "mL", symbol: "mL", name: "millilitre", factor: 0.001 },
      { id: "cL", symbol: "cL", name: "centilitre", factor: 0.01 },
      { id: "L", symbol: "L", name: "litre", factor: 1 },
      { id: "m3", symbol: "m³", name: t("mètre cube"), factor: 1000 },
      { id: "tsp", symbol: "tsp", name: t("cuillère à café (US)"), factor: GALLON_US_L / 768 },
      { id: "tbsp", symbol: "tbsp", name: t("cuillère à soupe (US)"), factor: GALLON_US_L / 256 },
      { id: "floz", symbol: "fl oz", name: t("once liquide (US)"), factor: GALLON_US_L / 128 },
      { id: "cup", symbol: "cup", name: t("tasse (US)"), factor: GALLON_US_L / 16 },
      { id: "pt", symbol: "pt", name: t("pinte (US)"), factor: GALLON_US_L / 8 },
      { id: "gal", symbol: "gal", name: t("gallon (US)"), factor: GALLON_US_L, note: t("231 in³") },
      {
        id: "galimp",
        symbol: "gal imp",
        name: t("gallon (impérial)"),
        factor: GALLON_IMP_L,
        note: "4,546 09 L",
      },
    ],
  },
  {
    id: "area",
    name: t("Surfaces"),
    base: "m2",
    defaults: ["m2", "ft2"],
    units: [
      { id: "mm2", symbol: "mm²", name: t("millimètre carré"), factor: 1e-6 },
      { id: "cm2", symbol: "cm²", name: t("centimètre carré"), factor: 1e-4 },
      { id: "m2", symbol: "m²", name: t("mètre carré"), factor: 1 },
      { id: "ha", symbol: "ha", name: "hectare", factor: 10_000 },
      { id: "km2", symbol: "km²", name: t("kilomètre carré"), factor: 1e6 },
      { id: "in2", symbol: "in²", name: t("pouce carré"), factor: INCH_M ** 2 },
      { id: "ft2", symbol: "ft²", name: t("pied carré"), factor: FOOT_M ** 2 },
      { id: "ac", symbol: "ac", name: "acre", factor: FOOT_M ** 2 * 43_560, note: t("43 560 ft²") },
    ],
  },
  {
    id: "speed",
    name: t("Vitesses"),
    base: "m/s",
    defaults: ["kmh", "mph"],
    units: [
      { id: "m/s", symbol: "m/s", name: t("mètre par seconde"), factor: 1 },
      { id: "kmh", symbol: "km/h", name: t("kilomètre par heure"), factor: 1000 / 3600 },
      { id: "mph", symbol: "mph", name: t("mile par heure"), factor: MILE_M / 3600 },
      { id: "kn", symbol: "kn", name: t("nœud"), factor: NAUTICAL_MILE_M / 3600 },
    ],
  },
  {
    id: "pressure",
    name: t("Pressions"),
    base: "Pa",
    defaults: ["bar", "psi"],
    units: [
      { id: "Pa", symbol: "Pa", name: "pascal", factor: 1 },
      { id: "hPa", symbol: "hPa", name: "hectopascal", factor: 100 },
      { id: "kPa", symbol: "kPa", name: "kilopascal", factor: 1000 },
      { id: "bar", symbol: "bar", name: "bar", factor: 100_000 },
      { id: "atm", symbol: "atm", name: t("atmosphère"), factor: 101_325, note: t("101 325 Pa") },
      { id: "psi", symbol: "psi", name: t("livre par pouce carré"), factor: (POUND_KG * 9.80665) / INCH_M ** 2 },
      { id: "mmHg", symbol: "mmHg", name: t("millimètre de mercure"), factor: 133.322_387_415 },
    ],
  },
  {
    id: "energy",
    name: t("Énergie"),
    base: "J",
    defaults: ["kWh", "kJ"],
    units: [
      { id: "J", symbol: "J", name: "joule", factor: 1 },
      { id: "kJ", symbol: "kJ", name: "kilojoule", factor: 1000 },
      { id: "Wh", symbol: "Wh", name: "wattheure", factor: 3600 },
      { id: "kWh", symbol: "kWh", name: "kilowattheure", factor: 3_600_000 },
      { id: "cal", symbol: "cal", name: "calorie", factor: CALORIE_J, note: t("calorie thermochimique") },
      { id: "kcal", symbol: "kcal", name: "kilocalorie", factor: CALORIE_J * 1000 },
      { id: "BTU", symbol: "BTU", name: t("British thermal unit"), factor: BTU_J, note: "BTU (IT)" },
    ],
  },
  {
    id: "power",
    name: t("Puissance"),
    base: "W",
    defaults: ["kW", "hp"],
    units: [
      { id: "W", symbol: "W", name: "watt", factor: 1 },
      { id: "kW", symbol: "kW", name: "kilowatt", factor: 1000 },
      { id: "MW", symbol: "MW", name: t("mégawatt"), factor: 1e6 },
      {
        id: "hp",
        symbol: "hp",
        name: t("horsepower (mécanique)"),
        factor: 745.6998715822702,
        note: t("550 ft·lbf/s"),
      },
      {
        id: "ch",
        symbol: "ch",
        name: t("cheval-vapeur (métrique)"),
        factor: 735.498_75,
        note: t("75 kgf·m/s — le « ch » des cartes grises"),
      },
    ],
  },
  {
    id: "data",
    name: t("Données informatiques"),
    base: "B",
    defaults: ["GB", "GiB"],
    units: [
      { id: "bit", symbol: "bit", name: "bit", factor: 1 / 8 },
      { id: "B", symbol: "o", name: "octet", factor: 1 },
      { id: "kB", symbol: "ko", name: "kilooctet", factor: 1e3, note: t("1 000 octets") },
      { id: "MB", symbol: "Mo", name: t("mégaoctet"), factor: 1e6 },
      { id: "GB", symbol: "Go", name: "gigaoctet", factor: 1e9 },
      { id: "TB", symbol: "To", name: t("téraoctet"), factor: 1e12 },
      { id: "KiB", symbol: "Kio", name: "kibioctet", factor: 1024, note: t("1 024 octets") },
      { id: "MiB", symbol: "Mio", name: t("mébioctet"), factor: 1024 ** 2 },
      { id: "GiB", symbol: "Gio", name: "gibioctet", factor: 1024 ** 3 },
      { id: "TiB", symbol: "Tio", name: t("tébioctet"), factor: 1024 ** 4 },
    ],
  },
]);

// Recherche dans la liste localisée : le libellé suit la langue affichée.
const BY_ID = { get: (id: string) => DIMENSIONS.find((dimension) => dimension.id === id) };

export function dimension(id: DimensionId): Dimension {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Dimension inconnue : ${id}`);
  return found;
}

export function unit(dimensionId: DimensionId, unitId: string): UnitDefinition {
  const found = dimension(dimensionId).units.find((u) => u.id === unitId);
  if (!found) throw new Error(t("Unité inconnue : {dimensionId}/{unitId}", { dimensionId, unitId }));
  return found;
}

/** Conversion d'une unité vers une autre, dans la même dimension. */
export function convert(
  value: number,
  dimensionId: DimensionId,
  fromId: string,
  toId: string,
): number {
  const from = unit(dimensionId, fromId);
  const to = unit(dimensionId, toId);
  const base = from.toBase ? from.toBase(value) : value * (from.factor ?? 1);
  return to.fromBase ? to.fromBase(base) : base / (to.factor ?? 1);
}

/**
 * Mise en forme d'un résultat.
 *
 * Un convertisseur qui affiche « 1.0000000000000002 » perd la confiance de
 * l'utilisateur. On coupe donc au nombre de chiffres significatifs demandé,
 * on retire les zéros inutiles, et on bascule en notation scientifique
 * seulement quand le nombre décimal deviendrait illisible.
 */
export function formatNumber(value: number, significantDigits = 10): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude >= 1e15 || magnitude < 1e-9) {
    return value.toExponential(Math.min(significantDigits - 1, 8)).replace(/e([+-])(\d)$/, "e$10$2");
  }
  const rounded = Number(value.toPrecision(significantDigits));
  // `toPrecision` peut repartir en notation exponentielle : on repasse par une
  // écriture décimale tant qu'elle reste lisible.
  const decimals = Math.max(0, significantDigits - Math.floor(Math.log10(magnitude)) - 1);
  return trimZeros(rounded.toFixed(Math.min(decimals, 12)));
}

function trimZeros(text: string): string {
  if (!text.includes(".")) return text;
  return text.replace(/\.?0+$/, "");
}

/**
 * Sépare les milliers pour la lecture, à la manière de la langue affichée :
 * « 1 234 567,89 » en français, « 1,234,567.89 » en anglais.
 */
export function formatWithGrouping(value: number, significantDigits = 10): string {
  const plain = formatNumber(value, significantDigits);
  if (plain.includes("e") || plain === "—") return plain;
  return localizeNumberString(plain);
}

/**
 * Lecture d'un nombre saisi à la main.
 *
 * L'utilisateur français tape « 1,5 » et colle parfois « 1 234,56 » : refuser
 * ces formes ferait passer l'outil pour cassé.
 */
export function parseNumber(input: string): number | undefined {
  let cleaned = input.trim().replace(/[\s\u00a0\u202f']/g, "");
  if (cleaned.length === 0) return undefined;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  if (hasComma && hasDot) {
    // « 1 234,56 » collé en « 1.234,56 », ou « 1,234.56 » : le dernier
    // séparateur est la virgule décimale, l'autre groupe les milliers.
    const decimal = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".") ? "," : ".";
    cleaned = cleaned.split(decimal === "," ? "." : ",").join("").replace(",", ".");
  } else if (hasComma) {
    // Une virgule seule est décimale (« 1,5 »), sauf dans une langue à point
    // décimal quand elle groupe visiblement des milliers (« 1,234,567 »).
    const grouping =
      numberSeparators().decimal === "." && /^-?\d{1,3}(,\d{3})+$/.test(cleaned);
    cleaned = grouping ? cleaned.replace(/,/g, "") : cleaned.replace(",", ".");
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}
