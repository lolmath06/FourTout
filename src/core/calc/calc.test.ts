import { describe, expect, it } from "vitest";
import { evaluateExpression, ExpressionError } from "./expression";
import { percentChange, percentOf, percentShare, ruleOfThree } from "./arithmetic";
import {
  addToDate,
  computeAge,
  dateDifference,
  describeDuration,
  formatDuration,
  parseDateOnly,
  parseDuration,
  toDateOnly,
} from "./datetime";

const value = (input: string, mode: "deg" | "rad" = "deg") =>
  evaluateExpression(input, mode).value;

describe("calculatrice scientifique", () => {
  it("n'évalue jamais la saisie avec le moteur JavaScript", async () => {
    // La garantie centrale : une expression qui serait du JavaScript valide ne
    // doit pas s'exécuter. Sans cela, la calculatrice serait une porte d'entrée
    // vers les commandes natives de l'application.
    expect(() => evaluateExpression("globalThis")).toThrow(ExpressionError);
    expect(() => evaluateExpression("[].constructor")).toThrow(ExpressionError);
    expect(() => evaluateExpression("1;alert(1)")).toThrow(ExpressionError);
    const source = await import("./expression?raw").catch(() => undefined);
    if (source) {
      expect(String((source as { default: string }).default)).not.toMatch(/\beval\(|new Function\(/);
    }
  });

  it("respecte la priorité des opérateurs", () => {
    expect(value("2 + 3 * 4")).toBe(14);
    expect(value("(2 + 3) * 4")).toBe(20);
    expect(value("10 - 2 - 3")).toBe(5);
    expect(value("100 / 5 / 2")).toBe(10);
  });

  it("rend la puissance associative à droite", () => {
    expect(value("2^3^2")).toBe(512);
    expect(value("(2^3)^2")).toBe(64);
    expect(value("-2^2")).toBe(-4);
  });

  it("calcule les fonctions trigonométriques dans le mode choisi", () => {
    expect(value("sin(30)")).toBeCloseTo(0.5, 12);
    expect(value("cos(60)")).toBeCloseTo(0.5, 12);
    expect(value("sin(pi/2)", "rad")).toBeCloseTo(1, 12);
    expect(value("asin(0.5)")).toBeCloseTo(30, 10);
    expect(value("atan(1)")).toBeCloseTo(45, 10);
  });

  it("calcule logarithmes, racines et valeurs absolues", () => {
    expect(value("ln(e)")).toBeCloseTo(1, 12);
    expect(value("log(1000)")).toBeCloseTo(3, 12);
    expect(value("sqrt(144)")).toBe(12);
    expect(value("√16")).toBe(4);
    expect(value("abs(-7)")).toBe(7);
    expect(value("root(27; 3)")).toBeCloseTo(3, 12);
  });

  it("calcule la factorielle et refuse les cas impossibles", () => {
    expect(value("5!")).toBe(120);
    expect(value("0!")).toBe(1);
    expect(() => evaluateExpression("(-1)!")).toThrow(/entier positif/);
    expect(() => evaluateExpression("200!")).toThrow(/jusqu'à 170/);
  });

  it("accepte les symboles réellement tapés ou collés", () => {
    expect(value("3 × 4")).toBe(12);
    expect(value("12 ÷ 4")).toBe(3);
    expect(value("2,5 + 2,5")).toBe(5);
    expect(value("1e3 + 1")).toBe(1001);
    expect(value("π")).toBeCloseTo(Math.PI, 12);
  });

  it("explique l'erreur au lieu de renvoyer NaN", () => {
    expect(() => evaluateExpression("1 / 0")).toThrow(/Division par zéro/);
    expect(() => evaluateExpression("2 +")).toThrow(/incomplète/);
    expect(() => evaluateExpression("(1 + 2")).toThrow(/Parenthèse fermante/);
    expect(() => evaluateExpression("foo(2)")).toThrow(/Fonction inconnue/);
    expect(() => evaluateExpression("sqrt(-1)")).toThrow(/pas un nombre/);
    expect(() => evaluateExpression("")).toThrow(/vide/);
    expect(() => evaluateExpression("2 @ 3")).toThrow(/Caractère inattendu/);
  });

  it("indique la position de l'erreur quand elle est connue", () => {
    try {
      evaluateExpression("1 + @");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ExpressionError);
      expect((error as ExpressionError).position).toBe(4);
    }
  });
});

describe("pourcentages", () => {
  it("calcule les trois modes", () => {
    expect(percentOf(20, 250).value).toBeCloseTo(50, 12);
    expect(percentShare(50, 250).value).toBeCloseTo(20, 12);
    expect(percentChange(200, 250).value).toBeCloseTo(25, 12);
    expect(percentChange(250, 200).value).toBeCloseTo(-20, 12);
  });

  it("gère une variation depuis une valeur négative sans changer de signe", () => {
    // De −100 à −50, c'est une hausse de 50 %, pas une baisse.
    expect(percentChange(-100, -50).value).toBeCloseTo(50, 12);
  });

  it("refuse les cas sans réponse plutôt que de renvoyer l'infini", () => {
    expect(() => percentShare(5, 0)).toThrow(/total doit être non nul/);
    expect(() => percentChange(0, 5)).toThrow(/depuis zéro/);
  });

  it("donne la formule pour que le résultat soit vérifiable", () => {
    expect(percentOf(20, 250).formula).toContain("÷ 100");
    expect(percentChange(200, 250).note).toMatch(/Augmentation/);
  });
});

describe("règle de trois", () => {
  it("résout la proportion", () => {
    expect(ruleOfThree(3, 12, 7).value).toBeCloseTo(28, 12);
    expect(ruleOfThree(100, 45, 250).value).toBeCloseTo(112.5, 12);
  });

  it("refuse une première valeur nulle", () => {
    expect(() => ruleOfThree(0, 5, 10)).toThrow(/ne peut pas être nulle/);
  });
});

describe("lecture des dates", () => {
  it("lit une date locale, pas une date UTC", () => {
    const date = parseDateOnly("2026-03-14");
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(2);
    expect(date?.getDate()).toBe(14);
    expect(toDateOnly(date as Date)).toBe("2026-03-14");
  });

  it("refuse une date qui n'existe pas", () => {
    expect(parseDateOnly("2026-02-30")).toBeUndefined();
    expect(parseDateOnly("2026-13-01")).toBeUndefined();
    expect(parseDateOnly("14/03/2026")).toBeUndefined();
    // 2024 est bissextile, 2026 ne l'est pas.
    expect(parseDateOnly("2024-02-29")).toBeDefined();
    expect(parseDateOnly("2026-02-29")).toBeUndefined();
  });
});

describe("différence entre deux dates", () => {
  it("compte les jours calendaires", () => {
    const diff = dateDifference(new Date(2026, 0, 1), new Date(2026, 11, 31));
    expect(diff.days).toBe(364);
    expect(diff.weeks).toBe(52);
    expect(diff.remainingDays).toBe(0);
  });

  it("exprime aussi la différence en années, mois et jours", () => {
    const diff = dateDifference(new Date(1990, 4, 15), new Date(2026, 8, 5));
    expect(diff.years).toBe(36);
    expect(diff.months).toBe(3);
    expect(diff.daysAfterMonths).toBe(21);
  });

  it("garde le signe quand les dates sont inversées", () => {
    const diff = dateDifference(new Date(2026, 8, 5), new Date(2026, 8, 1));
    expect(diff.days).toBe(-4);
    expect(diff.years).toBe(0);
    expect(diff.daysAfterMonths).toBe(-4);
  });

  it("compte les jours ouvrés bornes comprises", () => {
    // Lundi 2 mars 2026 → vendredi 6 mars 2026.
    const diff = dateDifference(new Date(2026, 2, 2), new Date(2026, 2, 6));
    expect(diff.businessDays).toBe(5);
    // Une semaine pleine, samedi et dimanche exclus.
    expect(dateDifference(new Date(2026, 2, 2), new Date(2026, 2, 8)).businessDays).toBe(5);
  });

  it("n'est pas faussé par un changement d'heure", () => {
    // Passage à l'heure d'été en France : nuit du 28 au 29 mars 2026.
    const diff = dateDifference(new Date(2026, 2, 28), new Date(2026, 2, 30));
    expect(diff.days).toBe(2);
  });
});

describe("ajout d'une durée calendaire", () => {
  it("ajoute des jours et des semaines", () => {
    expect(toDateOnly(addToDate(new Date(2026, 0, 30), 5, "days"))).toBe("2026-02-04");
    expect(toDateOnly(addToDate(new Date(2026, 0, 1), 2, "weeks"))).toBe("2026-01-15");
  });

  it("respecte le calendrier pour les mois et les années", () => {
    // 31 janvier + 1 mois : fin février, jamais le 3 mars.
    expect(toDateOnly(addToDate(new Date(2026, 0, 31), 1, "months"))).toBe("2026-02-28");
    expect(toDateOnly(addToDate(new Date(2024, 0, 31), 1, "months"))).toBe("2024-02-29");
    expect(toDateOnly(addToDate(new Date(2024, 1, 29), 1, "years"))).toBe("2025-02-28");
    expect(toDateOnly(addToDate(new Date(2026, 0, 15), 12, "months"))).toBe("2027-01-15");
  });

  it("recule aussi bien qu'il avance", () => {
    expect(toDateOnly(addToDate(new Date(2026, 2, 31), -1, "months"))).toBe("2026-02-28");
    expect(toDateOnly(addToDate(new Date(2026, 0, 10), -1, "years"))).toBe("2025-01-10");
  });
});

describe("âge", () => {
  it("donne années, mois et jours", () => {
    const age = computeAge(new Date(1990, 4, 15), new Date(2026, 8, 5));
    expect(age.years).toBe(36);
    expect(age.months).toBe(3);
    expect(age.days).toBe(21);
    expect(age.totalDays).toBe(13262);
  });

  it("ne compte pas une année d'avance la veille de l'anniversaire", () => {
    expect(computeAge(new Date(2000, 8, 6), new Date(2026, 8, 5)).years).toBe(25);
    expect(computeAge(new Date(2000, 8, 5), new Date(2026, 8, 5)).years).toBe(26);
  });

  it("traite le 29 février comme l'état civil", () => {
    const age = computeAge(new Date(2004, 1, 29), new Date(2026, 5, 1));
    expect(age.years).toBe(22);
    // 2027 n'est pas bissextile : l'anniversaire tombe le 1er mars.
    expect(toDateOnly(age.nextBirthday)).toBe("2027-03-01");
    // 2028 est bissextile : le 29 février existe.
    expect(toDateOnly(computeAge(new Date(2004, 1, 29), new Date(2027, 5, 1)).nextBirthday)).toBe(
      "2028-02-29",
    );
  });

  it("refuse une naissance dans le futur", () => {
    expect(() => computeAge(new Date(2030, 0, 1), new Date(2026, 0, 1))).toThrow(/postérieure/);
  });
});

describe("durées", () => {
  it("lit les écritures réellement utilisées", () => {
    expect(parseDuration("01:30:00")).toBe(5400);
    expect(parseDuration("1:30")).toBe(5400);
    expect(parseDuration("1h30")).toBe(5400);
    expect(parseDuration("90m")).toBe(5400);
    expect(parseDuration("90")).toBe(5400);
    expect(parseDuration("45s")).toBe(45);
    expect(parseDuration("2h15min30s")).toBe(8130);
    expect(parseDuration("-0:30")).toBe(-1800);
  });

  it("refuse ce qui n'est pas une durée", () => {
    expect(parseDuration("")).toBeUndefined();
    expect(parseDuration("abc")).toBeUndefined();
    expect(parseDuration("1:2:3:4")).toBeUndefined();
    expect(parseDuration("1::2")).toBeUndefined();
  });

  it("formate sans borner les heures à 24", () => {
    expect(formatDuration(5400)).toBe("01:30:00");
    expect(formatDuration(360_000)).toBe("100:00:00");
    expect(formatDuration(-90)).toBe("-00:01:30");
  });

  it("décompose un total dans toutes les unités utiles", () => {
    const total = describeDuration(90_061);
    expect(total.formatted).toBe("25:01:01");
    expect(total.days).toBeCloseTo(1.042, 3);
    expect(total.hours).toBeCloseTo(25.017, 3);
    expect(total.minutes).toBeCloseTo(1501.02, 2);
    expect(total.human).toBe("1 j 1 h 1 min 1 s");
  });
});
