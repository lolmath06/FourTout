import { describe, expect, it } from "vitest";
import { computeInterest, InterestError } from "./interest";

const round = (value: number, digits = 2) =>
  Math.round(value * 10 ** digits) / 10 ** digits;

describe("intérêts simples", () => {
  it("donne 1 100 € pour 1 000 € à 5 % sur 2 ans", () => {
    const result = computeInterest({
      mode: "simple",
      principal: 1000,
      annualRatePercent: 5,
      years: 2,
    });
    expect(round(result.total)).toBe(1100);
    expect(round(result.interest)).toBe(100);
    expect(result.invested).toBe(1000);
  });

  it("reste proportionnel à la durée", () => {
    const un = computeInterest({ mode: "simple", principal: 1000, annualRatePercent: 5, years: 1 });
    const dix = computeInterest({
      mode: "simple",
      principal: 1000,
      annualRatePercent: 5,
      years: 10,
    });
    expect(round(un.interest)).toBe(50);
    expect(round(dix.interest)).toBe(500);
  });

  it("rend le capital intact à taux nul ou durée nulle", () => {
    const sansTaux = computeInterest({
      mode: "simple",
      principal: 1000,
      annualRatePercent: 0,
      years: 5,
    });
    expect(round(sansTaux.total)).toBe(1000);
    expect(round(sansTaux.interest)).toBe(0);

    const sansDuree = computeInterest({
      mode: "simple",
      principal: 1000,
      annualRatePercent: 5,
      years: 0,
    });
    expect(round(sansDuree.total)).toBe(1000);
  });

  it("détaille chaque année", () => {
    const result = computeInterest({
      mode: "simple",
      principal: 1000,
      annualRatePercent: 5,
      years: 3,
    });
    expect(result.schedule).toHaveLength(3);
    expect(round(result.schedule[0].balance)).toBe(1050);
    expect(round(result.schedule[2].balance)).toBe(1150);
  });
});

describe("intérêts composés", () => {
  it("donne 1 102,50 € pour 1 000 € à 5 % sur 2 ans, capitalisés annuellement", () => {
    const result = computeInterest({
      mode: "compound",
      principal: 1000,
      annualRatePercent: 5,
      years: 2,
      frequency: "annual",
    });
    expect(round(result.total)).toBe(1102.5);
    expect(round(result.interest)).toBe(102.5);
    expect(round(result.effectiveAnnualRatePercent, 4)).toBe(5);
  });

  it("rapporte davantage quand on capitalise plus souvent", () => {
    const base = { mode: "compound" as const, principal: 1000, annualRatePercent: 5, years: 2 };
    const annuel = computeInterest({ ...base, frequency: "annual" }).total;
    const mensuel = computeInterest({ ...base, frequency: "monthly" }).total;
    const quotidien = computeInterest({ ...base, frequency: "daily" }).total;
    expect(mensuel).toBeGreaterThan(annuel);
    expect(quotidien).toBeGreaterThan(mensuel);
    // 1000 × (1 + 0,05/12)^24, calculé indépendamment.
    expect(round(mensuel)).toBe(1104.94);
  });

  it("donne le taux annuel effectif de la capitalisation mensuelle", () => {
    const result = computeInterest({
      mode: "compound",
      principal: 1000,
      annualRatePercent: 5,
      years: 1,
      frequency: "monthly",
    });
    // (1 + 0,05/12)^12 − 1 = 5,1162 %
    expect(round(result.effectiveAnnualRatePercent, 4)).toBe(5.1162);
  });

  it("n'arrondit pas à chaque période", () => {
    // Arrondir au centime à chaque mois pendant vingt ans décalerait le
    // résultat ; on vérifie la valeur exacte de la formule.
    const result = computeInterest({
      mode: "compound",
      principal: 10_000,
      annualRatePercent: 4,
      years: 20,
      frequency: "monthly",
    });
    const expected = 10_000 * Math.pow(1 + 0.04 / 12, 240);
    expect(result.total).toBeCloseTo(expected, 8);
    expect(round(result.total)).toBe(22_225.82);
  });

  it("rend le capital intact à taux nul", () => {
    const result = computeInterest({
      mode: "compound",
      principal: 1000,
      annualRatePercent: 0,
      years: 10,
      frequency: "monthly",
    });
    expect(round(result.total)).toBe(1000);
    expect(round(result.interest)).toBe(0);
  });

  it("accepte un taux négatif sans produire de NaN", () => {
    const result = computeInterest({
      mode: "compound",
      principal: 1000,
      annualRatePercent: -2,
      years: 3,
      frequency: "annual",
    });
    expect(Number.isFinite(result.total)).toBe(true);
    expect(result.total).toBeLessThan(1000);
    expect(round(result.total)).toBe(941.19);
  });
});

describe("versements réguliers", () => {
  it("ajoute la valeur acquise d'une suite de versements", () => {
    const result = computeInterest({
      mode: "compound",
      principal: 0,
      annualRatePercent: 6,
      years: 1,
      frequency: "monthly",
      contribution: 100,
    });
    // 100 × ((1 + 0,005)^12 − 1) / 0,005, calculé indépendamment.
    const expected = 100 * ((Math.pow(1.005, 12) - 1) / 0.005);
    expect(result.total).toBeCloseTo(expected, 8);
    expect(result.invested).toBe(1200);
    expect(round(result.interest)).toBe(round(expected - 1200));
  });

  it("ne divise pas par zéro quand le taux est nul", () => {
    const result = computeInterest({
      mode: "compound",
      principal: 0,
      annualRatePercent: 0,
      years: 2,
      frequency: "monthly",
      contribution: 50,
    });
    expect(result.total).toBe(1200);
    expect(result.interest).toBe(0);
  });

  it("fait travailler chaque versement simple le temps qui lui reste", () => {
    const result = computeInterest({
      mode: "simple",
      principal: 0,
      annualRatePercent: 12,
      years: 1,
      frequency: "monthly",
      contribution: 100,
    });
    // Somme des intérêts de douze versements, du 11/12 d'année au 0 : 66 €.
    expect(result.invested).toBe(1200);
    expect(round(result.interest)).toBe(66);
  });
});

describe("intérêts — entrées refusées", () => {
  it("refuse un capital négatif", () => {
    expect(() =>
      computeInterest({ mode: "simple", principal: -100, annualRatePercent: 5, years: 1 }),
    ).toThrow(InterestError);
  });

  it("refuse une durée négative ou démesurée", () => {
    expect(() =>
      computeInterest({ mode: "simple", principal: 100, annualRatePercent: 5, years: -1 }),
    ).toThrow(/positif/);
    expect(() =>
      computeInterest({ mode: "simple", principal: 100, annualRatePercent: 5, years: 500 }),
    ).toThrow(/200 ans/);
  });

  it("refuse un versement négatif", () => {
    expect(() =>
      computeInterest({
        mode: "compound",
        principal: 100,
        annualRatePercent: 5,
        years: 1,
        contribution: -10,
      }),
    ).toThrow(/positif/);
  });

  it("refuse un calcul sans rien à faire fructifier", () => {
    expect(() =>
      computeInterest({ mode: "compound", principal: 0, annualRatePercent: 5, years: 1 }),
    ).toThrow(/rien à faire fructifier/);
  });

  it("limite le tableau annuel", () => {
    const result = computeInterest({
      mode: "compound",
      principal: 1000,
      annualRatePercent: 3,
      years: 150,
      frequency: "annual",
    });
    expect(result.schedule).toHaveLength(100);
    // Le calcul, lui, porte bien sur 150 ans.
    expect(result.total).toBeCloseTo(1000 * Math.pow(1.03, 150), 6);
  });
});
