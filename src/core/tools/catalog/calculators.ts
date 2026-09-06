import { defineTools, IN, OUT } from "./shared";
import type { ToolDefinition } from "../types";

/**
 * Les convertisseurs d'unités partagent la même page générique : seule la
 * table d'unités change. Ils sont donc déclarés à partir d'un descripteur
 * commun plutôt qu'en recopiant quinze définitions quasi identiques.
 */
interface UnitFamily {
  id: string;
  name: string;
  description: string;
  icon: string;
  keywords: string[];
  aliases: string[];
}

const UNIT_FAMILIES: UnitFamily[] = [
  {
    id: "length",
    name: "Longueurs",
    description: "Mètres, kilomètres, miles, pieds, pouces, milles marins.",
    icon: "Ruler",
    keywords: ["longueur", "distance", "mètre", "km", "miles", "pouces", "pieds", "centimètres"],
    aliases: ["length converter", "cm to inches", "km to miles"],
  },
  {
    id: "weight",
    name: "Poids et masses",
    description: "Grammes, kilos, tonnes, livres, onces.",
    icon: "Weight",
    keywords: ["poids", "masse", "kilo", "gramme", "livre", "once", "tonne", "lbs"],
    aliases: ["weight converter", "kg to lbs", "pounds to kg"],
  },
  {
    id: "temperature",
    name: "Températures",
    description: "Celsius, Fahrenheit, Kelvin.",
    icon: "Thermometer",
    keywords: ["température", "celsius", "fahrenheit", "kelvin", "degrés", "°c", "°f"],
    aliases: ["temperature converter", "celsius to fahrenheit"],
  },
  {
    id: "volume",
    name: "Volumes",
    description: "Litres, millilitres, gallons, pintes, tasses, cuillères.",
    icon: "Beaker",
    keywords: ["volume", "litre", "ml", "gallon", "pinte", "tasse", "cuillère", "recette"],
    aliases: ["volume converter", "cups to ml", "gallons to liters"],
  },
  {
    id: "area",
    name: "Surfaces",
    description: "Mètres carrés, hectares, acres, pieds carrés.",
    icon: "Square",
    keywords: ["surface", "aire", "m2", "mètre carré", "hectare", "acre", "terrain"],
    aliases: ["area converter", "sqft to m2"],
  },
  {
    id: "speed",
    name: "Vitesses",
    description: "km/h, m/s, mph, nœuds.",
    icon: "Gauge",
    keywords: ["vitesse", "km/h", "mph", "m/s", "nœuds", "knots"],
    aliases: ["speed converter", "kmh to mph"],
  },
  {
    id: "pressure",
    name: "Pressions",
    description: "Pascal, bar, PSI, atmosphères, mmHg.",
    icon: "Wind",
    keywords: ["pression", "bar", "psi", "pascal", "atmosphère", "pneu"],
    aliases: ["pressure converter", "bar to psi"],
  },
  {
    id: "energy",
    name: "Énergie",
    description: "Joules, calories, kWh, BTU.",
    icon: "Zap",
    keywords: ["énergie", "joule", "calorie", "kwh", "btu", "kcal"],
    aliases: ["energy converter", "kwh to joules"],
  },
  {
    id: "power",
    name: "Puissance",
    description: "Watts, kilowatts, chevaux.",
    icon: "Plug",
    keywords: ["puissance", "watt", "kw", "kilowatt", "cheval", "chevaux", "cv", "ch", "hp"],
    aliases: ["power converter", "watts to hp", "kw to hp"],
  },
  {
    id: "data",
    name: "Données informatiques",
    description: "Octets, Ko, Mo, Go, To, et leurs équivalents binaires (Kio, Mio).",
    icon: "HardDrive",
    keywords: ["octets", "mo", "go", "to", "mégaoctet", "gigaoctet", "bits", "kio", "mio"],
    aliases: ["data converter", "mb to gb", "bytes converter"],
  },
];

const unitTools: ToolDefinition[] = UNIT_FAMILIES.map((family) => ({
  id: `unit-${family.id}`,
  name: `Convertisseur — ${family.name.toLowerCase()}`,
  description: family.description,
  category: "calculators",
  alsoIn: ["converters"],
  icon: family.icon,
  keywords: ["convertir", "conversion", "unités", ...family.keywords],
  aliases: family.aliases,
  capabilities: ["local"],
  acceptedInputs: [IN.none()],
  outputs: [OUT.none()],
}));

export const calculatorTools = defineTools([
  ...unitTools,
  {
    id: "calc-percentage",
    name: "Calculs de pourcentages",
    description: "Pourcentage d'un nombre, évolution, remise, TVA, part du total.",
    category: "calculators",
    icon: "Percent",
    keywords: [
      "pourcentage", "%", "remise", "réduction", "tva", "augmentation",
      "évolution", "calculer une promo", "hausse", "baisse",
    ],
    aliases: ["percentage calculator", "percent change", "discount calculator"],
    capabilities: ["local"],
    acceptedInputs: [IN.none()],
    outputs: [OUT.none()],
  },
  {
    id: "calc-proportion",
    name: "Règle de trois",
    description: "Résoudre une proportion : si A vaut B, combien vaut C ?",
    category: "calculators",
    icon: "Scale",
    keywords: ["règle de trois", "proportion", "produit en croix", "ratio", "échelle"],
    aliases: ["rule of three", "cross multiplication", "proportion calculator"],
    capabilities: ["local"],
    acceptedInputs: [IN.none()],
    outputs: [OUT.none()],
  },
  {
    id: "calc-date-difference",
    name: "Calculs de dates",
    description: "Nombre de jours entre deux dates, ajouter ou retirer une durée.",
    category: "calculators",
    icon: "CalendarDays",
    keywords: [
      "dates", "jours entre", "combien de jours", "ajouter des jours",
      "jours ouvrés", "échéance", "délai",
    ],
    aliases: ["date calculator", "days between dates", "date difference"],
    capabilities: ["local"],
    acceptedInputs: [IN.none()],
    outputs: [OUT.none()],
  },
  {
    id: "calc-duration",
    name: "Calculs de durées",
    description: "Additionner et soustraire des heures, minutes et secondes.",
    category: "calculators",
    icon: "Timer",
    keywords: ["durée", "heures", "minutes", "additionner des heures", "temps de travail", "hh:mm"],
    aliases: ["duration calculator", "time calculator", "add hours"],
    capabilities: ["local"],
    acceptedInputs: [IN.none()],
    outputs: [OUT.none()],
  },
  {
    id: "calc-age",
    name: "Calculer un âge",
    description: "Âge exact en années, mois et jours à partir d'une date de naissance.",
    category: "calculators",
    icon: "Cake",
    keywords: ["âge", "date de naissance", "quel âge", "anniversaire", "années"],
    aliases: ["age calculator", "how old"],
    capabilities: ["local"],
    acceptedInputs: [IN.none()],
    outputs: [OUT.none()],
  },
  {
    id: "calc-scientific",
    name: "Calculatrice scientifique",
    description: "Opérations avancées : puissances, racines, trigonométrie, logarithmes.",
    category: "calculators",
    icon: "Calculator",
    keywords: [
      "calculatrice", "scientifique", "racine carrée", "puissance",
      "trigonométrie", "logarithme", "sin", "cos", "calcul",
    ],
    aliases: ["scientific calculator", "calculator"],
    capabilities: ["local"],
    acceptedInputs: [IN.none()],
    outputs: [OUT.none()],
  },
  {
    id: "calc-currency",
    name: "Convertisseur de devises",
    description: "Convertir des montants entre devises avec des taux récents.",
    category: "calculators",
    alsoIn: ["converters"],
    icon: "Banknote",
    keywords: ["devises", "euro", "dollar", "change", "taux", "monnaie", "convertir des euros"],
    aliases: ["currency converter", "eur to usd", "exchange rate"],
    capabilities: ["network"],
    acceptedInputs: [IN.none()],
    outputs: [OUT.none()],
    note: "Seul outil de FourTout à nécessiter Internet, uniquement pour récupérer les taux du jour. Les derniers taux connus sont réutilisés hors ligne.",
  },
]);
