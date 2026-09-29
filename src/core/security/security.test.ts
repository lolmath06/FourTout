import { describe, expect, it } from "vitest";
import {
  alphabetFor,
  crackTime,
  DEFAULT_OPTIONS,
  entropyBits,
  evaluatePassword,
  generatePassphrase,
  generatePassword,
  generatePasswords,
  humanDuration,
  MAX_COUNT,
  MAX_LENGTH,
  MIN_LENGTH,
  passphraseEntropy,
  PasswordError,
  WORDLIST,
} from "./password";
import {
  convertCurrency,
  currencyLabel,
  describeAge,
  loadRates,
  storeRates,
  unitRate,
  type RateSnapshot,
} from "@/core/currency";
import { MemoryStore } from "@/core/storage";

describe("génération de mots de passe", () => {
  it("respecte la longueur demandée, dans les bornes", () => {
    expect(generatePassword({ ...DEFAULT_OPTIONS, length: 32 })).toHaveLength(32);
    expect(generatePassword({ ...DEFAULT_OPTIONS, length: 1 })).toHaveLength(MIN_LENGTH);
    expect(generatePassword({ ...DEFAULT_OPTIONS, length: 999 })).toHaveLength(MAX_LENGTH);
  });

  it("inclut réellement chaque famille cochée", () => {
    // Un générateur qui annonce « symboles » sans en garantir un fait rejeter
    // le mot de passe par le service auquel il est destiné.
    for (let i = 0; i < 50; i += 1) {
      const password = generatePassword({ ...DEFAULT_OPTIONS, length: 8 });
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^A-Za-z0-9]/);
    }
  });

  it("n'utilise que l'alphabet demandé", () => {
    const options = {
      ...DEFAULT_OPTIONS,
      length: 40,
      uppercase: false,
      symbols: false,
    };
    const alphabet = new Set(alphabetFor(options));
    for (const char of generatePassword(options)) expect(alphabet.has(char)).toBe(true);
  });

  it("écarte les caractères ambigus quand on le demande", () => {
    const options = { ...DEFAULT_OPTIONS, length: 60, excludeAmbiguous: true };
    for (let i = 0; i < 20; i += 1) {
      expect(generatePassword(options)).not.toMatch(/[Il1O0o|`'"{}[\]()/\\;:,.<>~^]/);
    }
  });

  it("produit des mots de passe différents à chaque appel", () => {
    const list = generatePasswords({ ...DEFAULT_OPTIONS, length: 24 }, 50);
    expect(new Set(list).size).toBe(50);
  });

  it("borne la quantité", () => {
    expect(generatePasswords(DEFAULT_OPTIONS, 1000)).toHaveLength(MAX_COUNT);
    expect(generatePasswords(DEFAULT_OPTIONS, 0)).toHaveLength(1);
  });

  it("refuse une configuration sans aucun caractère", () => {
    expect(() =>
      generatePassword({
        length: 12,
        lowercase: false,
        uppercase: false,
        digits: false,
        symbols: false,
        excludeAmbiguous: false,
      }),
    ).toThrow(PasswordError);
  });

  it("répartit les caractères sans biais visible", () => {
    // Un tirage modulo naïf favorise le début de l'alphabet. Sur 4 000 chiffres,
    // l'écart entre le chiffre le plus et le moins fréquent doit rester modeste.
    const options = {
      ...DEFAULT_OPTIONS,
      length: 40,
      lowercase: false,
      uppercase: false,
      symbols: false,
    };
    const counts = new Map<string, number>();
    for (let i = 0; i < 100; i += 1) {
      for (const char of generatePassword(options)) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }
    const values = [...counts.values()];
    expect(counts.size).toBe(10);
    expect(Math.max(...values) / Math.min(...values)).toBeLessThan(1.5);
  });
});

describe("entropie", () => {
  it("se calcule sur la taille réelle de l'alphabet", () => {
    expect(entropyBits(64, 10)).toBeCloseTo(60, 9);
    expect(entropyBits(1, 10)).toBe(0);
    expect(entropyBits(94, 0)).toBe(0);
  });

  it("annonce l'entropie d'une phrase sur la vraie liste", () => {
    const expected = Math.log2(WORDLIST.length) * 5;
    expect(passphraseEntropy(5, false)).toBeCloseTo(expected, 9);
    expect(passphraseEntropy(5, true)).toBeCloseTo(expected + Math.log2(10), 9);
  });

  it("traduit l'entropie en durée lisible", () => {
    expect(humanDuration(0.2)).toBe("moins d'une seconde");
    expect(humanDuration(90)).toContain("minute");
    expect(humanDuration(3600 * 30)).toContain("jour");
    expect(crackTime(128)).toContain("millénaire");
  });
});

describe("phrases secrètes", () => {
  it("assemble des mots de la liste embarquée", () => {
    const phrase = generatePassphrase({
      words: 5,
      separator: "-",
      capitalize: false,
      appendDigit: false,
    });
    const words = phrase.split("-");
    expect(words).toHaveLength(5);
    for (const word of words) expect(WORDLIST).toContain(word);
  });

  it("respecte le séparateur, la capitalisation et le chiffre final", () => {
    const phrase = generatePassphrase({
      words: 4,
      separator: ".",
      capitalize: true,
      appendDigit: true,
    });
    expect(phrase).toMatch(/^[A-Z][a-z]+(\.[A-Z][a-z]+){3}\d$/);
  });

  it("n'embarque que des mots sans accent ni caractère ambigu", () => {
    for (const word of WORDLIST) expect(word).toMatch(/^[a-z]{2,12}$/);
    expect(new Set(WORDLIST).size).toBe(WORDLIST.length);
    // Une liste trop courte donnerait une entropie annoncée mensongère.
    expect(WORDLIST.length).toBeGreaterThanOrEqual(200);
  });
});

describe("évaluation de la robustesse", () => {
  it("distingue un mot de passe évident d'un mot de passe solide", async () => {
    const weak = await evaluatePassword("azerty123");
    const strong = await evaluatePassword(generatePassword({ ...DEFAULT_OPTIONS, length: 24 }));
    expect(weak.score).toBeLessThanOrEqual(1);
    expect(strong.score).toBe(4);
    expect(strong.guesses).toBeGreaterThan(weak.guesses);
  });

  it("nomme les motifs qui affaiblissent le mot de passe", async () => {
    const result = await evaluatePassword("motdepasse2024");
    expect(result.patterns.length).toBeGreaterThan(0);
    expect(result.crackTime.length).toBeGreaterThan(0);
    expect(result.label).toBeTruthy();
  });

  it("prévient sur un mot de passe court", async () => {
    const result = await evaluatePassword("Ab3$xy");
    expect(result.warnings.join(" ")).toMatch(/12 caractères/);
  });

  it("refuse une entrée vide plutôt que de renvoyer un score", async () => {
    await expect(evaluatePassword("")).rejects.toThrow(PasswordError);
  });
});

/* ------------------------------------------------------------------------ */

const SNAPSHOT: RateSnapshot = {
  date: "2026-09-04",
  base: "EUR",
  rates: [
    ["EUR", 1],
    ["USD", 1.1622],
    ["GBP", 0.85898],
    ["JPY", 181.59],
  ],
  source: "Banque centrale européenne",
  sourceUrl: "https://example.invalid",
  fetchedAt: Date.parse("2026-09-04T16:00:00Z"),
};

describe("conversion de devises", () => {
  it("convertit en passant par la devise de référence", () => {
    expect(convertCurrency(100, "EUR", "USD", SNAPSHOT)).toBeCloseTo(116.22, 9);
    expect(convertCurrency(116.22, "USD", "EUR", SNAPSHOT)).toBeCloseTo(100, 9);
    // Deux devises non-euro passent bien par l'euro.
    expect(convertCurrency(1, "USD", "GBP", SNAPSHOT)).toBeCloseTo(0.85898 / 1.1622, 12);
  });

  it("fait un aller-retour exact", () => {
    const there = convertCurrency(1234.56, "GBP", "JPY", SNAPSHOT);
    expect(convertCurrency(there, "JPY", "GBP", SNAPSHOT)).toBeCloseTo(1234.56, 8);
  });

  it("refuse une devise absente du relevé plutôt que d'inventer un taux", () => {
    expect(() => convertCurrency(1, "EUR", "XYZ", SNAPSHOT)).toThrow(/Devise inconnue/);
    expect(() => convertCurrency(1, "XYZ", "EUR", SNAPSHOT)).toThrow(/Devise inconnue/);
  });

  it("affiche le taux unitaire", () => {
    expect(unitRate("EUR", "USD", SNAPSHOT)).toBeCloseTo(1.1622, 9);
  });

  it("nomme les devises en français", () => {
    expect(currencyLabel("USD")).toBe("USD — dollar américain");
    expect(currencyLabel("XYZ")).toBe("XYZ");
  });

  it("date le relevé", () => {
    expect(describeAge(SNAPSHOT, new Date("2026-09-04T18:00:00"))).toContain("du jour");
    expect(describeAge(SNAPSHOT, new Date("2026-09-05T18:00:00"))).toContain("hier");
    expect(describeAge(SNAPSHOT, new Date("2026-09-10T18:00:00"))).toContain("6 jours");
  });
});

describe("taux hors ligne", () => {
  it("retombe sur le dernier relevé connu, en le datant", async () => {
    const store = new MemoryStore();
    // Relevé ancien, pour forcer une tentative réseau qui échouera hors Tauri.
    storeRates({ ...SNAPSHOT, fetchedAt: Date.parse("2020-01-01T00:00:00Z") }, store);

    const result = await loadRates({ store });
    expect(result.origin).toBe("cache");
    expect(result.warning).toMatch(/dernier relevé connu/);
    expect(result.snapshot.date).toBe("2026-09-04");
  });

  it("n'invente aucun taux quand rien n'a jamais été téléchargé", async () => {
    await expect(loadRates({ store: new MemoryStore() })).rejects.toThrow(
      /Aucun taux n'a jamais été téléchargé/,
    );
  });

  it("sert le cache sans réseau tant qu'il est frais", async () => {
    const store = new MemoryStore();
    storeRates({ ...SNAPSHOT, fetchedAt: Date.now() }, store);
    const result = await loadRates({ store });
    expect(result.origin).toBe("cache");
    expect(result.warning).toBeUndefined();
  });
});
