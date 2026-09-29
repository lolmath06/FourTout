import { isTauri } from "@/core/platform";
import { appStore, type KeyValueStore } from "@/core/storage";

/**
 * Taux de change.
 *
 * C'est le **seul** outil de FourTout qui a besoin d'Internet, et il est traité
 * comme tel :
 *
 *  - il ne porte pas la capacité « local » dans le catalogue, et affiche un
 *    avertissement réseau comme n'importe quel outil connecté ;
 *  - la requête part de la couche native, jamais de la WebView : la politique
 *    de sécurité de contenu de l'application reste fermée ;
 *  - **aucun taux n'est jamais inventé.** Sans connexion, on affiche le dernier
 *    relevé connu *avec sa date* ; sans relevé du tout, on le dit et on
 *    n'affiche aucun chiffre.
 */

export interface RateSnapshot {
  /** Date de publication annoncée par la source, `AAAA-MM-JJ`. */
  date: string;
  /** Devise de référence : l'euro pour la BCE. */
  base: string;
  /** Combien d'unités de chaque devise vaut **une** unité de la base. */
  rates: [string, number][];
  source: string;
  sourceUrl: string;
  /** Horodatage de la récupération, en millisecondes. */
  fetchedAt: number;
}

export type RateOrigin = "network" | "cache";

export interface RateResult {
  snapshot: RateSnapshot;
  origin: RateOrigin;
  /** Renseigné quand le réseau a échoué et qu'on retombe sur le cache. */
  warning?: string;
}

const CACHE_KEY = "currency-rates";

/** Au-delà, on retente le réseau ; la BCE publie une fois par jour ouvré. */
const FRESH_FOR_MS = 6 * 60 * 60 * 1000;

export class CurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CurrencyError";
  }
}

/** Noms français des devises publiées par la BCE. */
export const CURRENCY_NAMES: Record<string, string> = {
  EUR: "euro",
  USD: "dollar américain",
  JPY: "yen japonais",
  BGN: "lev bulgare",
  CZK: "couronne tchèque",
  DKK: "couronne danoise",
  GBP: "livre sterling",
  HUF: "forint hongrois",
  PLN: "zloty polonais",
  RON: "leu roumain",
  SEK: "couronne suédoise",
  CHF: "franc suisse",
  ISK: "couronne islandaise",
  NOK: "couronne norvégienne",
  TRY: "livre turque",
  AUD: "dollar australien",
  BRL: "réal brésilien",
  CAD: "dollar canadien",
  CNY: "yuan chinois",
  HKD: "dollar de Hong Kong",
  IDR: "roupie indonésienne",
  ILS: "shekel israélien",
  INR: "roupie indienne",
  KRW: "won sud-coréen",
  MXN: "peso mexicain",
  MYR: "ringgit malaisien",
  NZD: "dollar néo-zélandais",
  PHP: "peso philippin",
  SGD: "dollar de Singapour",
  THB: "baht thaïlandais",
  ZAR: "rand sud-africain",
};

export function currencyLabel(code: string): string {
  const name = CURRENCY_NAMES[code];
  return name ? `${code} — ${name}` : code;
}

/** Relevé mémorisé, ou `undefined` si aucun n'a jamais été téléchargé. */
export function cachedRates(store: KeyValueStore = appStore): RateSnapshot | undefined {
  const raw = store.get<RateSnapshot | null>(CACHE_KEY, null);
  if (!raw || !Array.isArray(raw.rates) || raw.rates.length === 0) return undefined;
  return raw;
}

export function storeRates(snapshot: RateSnapshot, store: KeyValueStore = appStore): void {
  store.set(CACHE_KEY, snapshot);
}

export function clearRates(store: KeyValueStore = appStore): void {
  store.remove(CACHE_KEY);
}

async function fetchFromNetwork(): Promise<RateSnapshot> {
  if (!isTauri()) {
    throw new CurrencyError(
      "Les taux de change sont téléchargés par l'application installée : l'aperçu navigateur " +
        "ne peut pas les récupérer.",
    );
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<Omit<RateSnapshot, "fetchedAt">>("currency_rates");
  return { ...raw, fetchedAt: Date.now() };
}

/**
 * Renvoie des taux utilisables, et **dit toujours d'où ils viennent**.
 *
 * `force` ignore la fraîcheur du cache : c'est le bouton « Actualiser ».
 */
export async function loadRates(
  options: { force?: boolean; store?: KeyValueStore } = {},
): Promise<RateResult> {
  const store = options.store ?? appStore;
  const cached = cachedRates(store);
  const fresh = cached !== undefined && Date.now() - cached.fetchedAt < FRESH_FOR_MS;

  if (fresh && !options.force) {
    return { snapshot: cached, origin: "cache" };
  }

  try {
    const snapshot = await fetchFromNetwork();
    storeRates(snapshot, store);
    return { snapshot, origin: "network" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Téléchargement impossible.";
    if (cached) {
      return {
        snapshot: cached,
        origin: "cache",
        warning: `Taux non actualisés (${message}) — affichage du dernier relevé connu.`,
      };
    }
    // Aucun relevé n'a jamais été téléchargé : on ne montre aucun chiffre.
    throw new CurrencyError(
      `${message} Aucun taux n'a jamais été téléchargé sur cet appareil : FourTout ne peut ` +
        "afficher aucune conversion tant qu'une connexion n'a pas été possible au moins une fois.",
    );
  }
}

/**
 * Convertit un montant d'une devise à l'autre.
 *
 * Les taux sont exprimés par rapport à la base : on repasse donc par la base,
 * exactement comme le moteur d'unités.
 */
export function convertCurrency(
  amount: number,
  from: string,
  to: string,
  snapshot: RateSnapshot,
): number {
  const table = new Map(snapshot.rates);
  const fromRate = table.get(from);
  const toRate = table.get(to);
  if (fromRate === undefined) throw new CurrencyError(`Devise inconnue dans ce relevé : ${from}.`);
  if (toRate === undefined) throw new CurrencyError(`Devise inconnue dans ce relevé : ${to}.`);
  return (amount / fromRate) * toRate;
}

/** Taux unitaire affiché sous le résultat : « 1 EUR = 1,1622 USD ». */
export function unitRate(from: string, to: string, snapshot: RateSnapshot): number {
  return convertCurrency(1, from, to, snapshot);
}

/** Âge d'un relevé, en français. */
export function describeAge(snapshot: RateSnapshot, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(`${snapshot.date}T00:00:00`).getTime()) / 86_400_000);
  if (Number.isNaN(days)) return `relevé du ${snapshot.date}`;
  if (days <= 0) return `relevé du jour (${snapshot.date})`;
  if (days === 1) return `relevé d'hier (${snapshot.date})`;
  return `relevé du ${snapshot.date}, il y a ${days} jours`;
}

export const CURRENCY_NOTE =
  "Taux de référence de la Banque centrale européenne, publiés chaque jour ouvré vers 16 h. " +
  "Ce sont des taux indicatifs : ils ne tiennent compte ni des frais, ni des marges appliquées " +
  "par votre banque ou votre bureau de change.";
