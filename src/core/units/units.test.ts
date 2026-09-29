import { describe, expect, it } from "vitest";
import {
  convert,
  DIMENSIONS,
  dimension,
  formatNumber,
  formatWithGrouping,
  parseNumber,
  type DimensionId,
} from "./index";

/** Tolérance relative : on compare des flottants, pas des entiers. */
const close = (actual: number, expected: number, epsilon = 1e-9) =>
  expect(Math.abs(actual - expected) / Math.max(1, Math.abs(expected))).toBeLessThan(epsilon);

describe("intégrité du moteur d'unités", () => {
  it("déclare des unités cohérentes dans chaque dimension", () => {
    for (const dim of DIMENSIONS) {
      const ids = dim.units.map((u) => u.id);
      expect(new Set(ids).size, `${dim.id} : identifiants dupliqués`).toBe(ids.length);
      expect(ids, `${dim.id} : unité de référence absente`).toContain(dim.base);
      for (const id of dim.defaults) {
        expect(ids, `${dim.id} : défaut inconnu ${id}`).toContain(id);
      }
      for (const u of dim.units) {
        const affine = u.toBase !== undefined && u.fromBase !== undefined;
        expect(affine || typeof u.factor === "number", `${dim.id}/${u.id}`).toBe(true);
      }
    }
  });

  it("revient exactement au point de départ en convertissant dans les deux sens", () => {
    for (const dim of DIMENSIONS) {
      for (const from of dim.units) {
        for (const to of dim.units) {
          const back = convert(convert(42.5, dim.id, from.id, to.id), dim.id, to.id, from.id);
          close(back, 42.5, 1e-9);
        }
      }
    }
  });

  it("laisse une conversion vers la même unité strictement inchangée", () => {
    for (const dim of DIMENSIONS) {
      for (const u of dim.units) {
        expect(convert(7, dim.id, u.id, u.id)).toBeCloseTo(7, 12);
      }
    }
  });

  it("refuse une unité inconnue plutôt que de renvoyer un chiffre faux", () => {
    expect(() => convert(1, "length", "m", "parsec")).toThrow(/Unité inconnue/);
    expect(() => dimension("distance" as DimensionId)).toThrow(/Dimension inconnue/);
  });
});

describe("longueurs", () => {
  it("applique les définitions exactes", () => {
    close(convert(1, "length", "in", "mm"), 25.4);
    close(convert(1, "length", "ft", "m"), 0.3048);
    close(convert(1, "length", "mi", "km"), 1.609344);
    close(convert(1, "length", "nmi", "m"), 1852);
  });

  it("convertit un cas du quotidien", () => {
    close(convert(100, "length", "km", "mi"), 100 / 1.609344, 1e-12);
  });
});

describe("masses", () => {
  it("applique la livre avoirdupois exacte", () => {
    close(convert(1, "mass", "lb", "kg"), 0.45359237);
    close(convert(1, "mass", "oz", "g"), 28.349523125);
    close(convert(1, "mass", "st", "kg"), 6.35029318);
  });

  it("convertit 70 kg en livres", () => {
    close(convert(70, "mass", "kg", "lb"), 154.32358352941432, 1e-12);
  });
});

describe("températures", () => {
  it("gère le décalage d'origine, pas seulement un facteur", () => {
    expect(convert(0, "temperature", "C", "F")).toBeCloseTo(32, 10);
    expect(convert(100, "temperature", "C", "F")).toBeCloseTo(212, 10);
    expect(convert(-40, "temperature", "C", "F")).toBeCloseTo(-40, 10);
    expect(convert(0, "temperature", "C", "K")).toBeCloseTo(273.15, 10);
    expect(convert(98.6, "temperature", "F", "C")).toBeCloseTo(37, 10);
    expect(convert(0, "temperature", "K", "C")).toBeCloseTo(-273.15, 10);
  });
});

describe("volumes", () => {
  it("distingue le gallon US du gallon impérial", () => {
    close(convert(1, "volume", "gal", "L"), 3.785411784);
    close(convert(1, "volume", "galimp", "L"), 4.54609);
    close(convert(1, "volume", "floz", "mL"), 29.5735295625);
    close(convert(1, "volume", "cup", "mL"), 236.5882365);
    close(convert(1, "volume", "m3", "L"), 1000);
  });
});

describe("surfaces", () => {
  it("applique l'acre et l'hectare", () => {
    close(convert(1, "area", "ha", "m2"), 10_000);
    close(convert(1, "area", "ac", "m2"), 4046.8564224);
    close(convert(1, "area", "ft2", "m2"), 0.09290304);
    close(convert(1, "area", "km2", "ha"), 100);
  });
});

describe("vitesses", () => {
  it("convertit les vitesses usuelles", () => {
    close(convert(100, "speed", "kmh", "mph"), 100 / 1.609344, 1e-12);
    close(convert(1, "speed", "kn", "kmh"), 1.852);
    close(convert(3.6, "speed", "kmh", "m/s"), 1);
  });
});

describe("pressions", () => {
  it("applique les définitions officielles", () => {
    close(convert(1, "pressure", "bar", "Pa"), 100_000);
    close(convert(1, "pressure", "atm", "Pa"), 101_325);
    close(convert(1, "pressure", "psi", "Pa"), 6894.757293168361, 1e-9);
    close(convert(1, "pressure", "mmHg", "Pa"), 133.322387415);
    // Un pneu de voiture : 2,2 bar ≈ 31,9 psi.
    close(convert(2.2, "pressure", "bar", "psi"), 31.9083, 1e-4);
  });
});

describe("énergie", () => {
  it("distingue la calorie et le BTU", () => {
    close(convert(1, "energy", "kWh", "J"), 3_600_000);
    close(convert(1, "energy", "kcal", "kJ"), 4.184);
    close(convert(1, "energy", "BTU", "J"), 1055.05585262);
    close(convert(1, "energy", "Wh", "J"), 3600);
  });
});

describe("puissance", () => {
  it("distingue le horsepower mécanique du cheval-vapeur métrique", () => {
    close(convert(1, "power", "hp", "W"), 745.6998715822702, 1e-12);
    close(convert(1, "power", "ch", "W"), 735.49875);
    // 100 ch métriques ≈ 73,5 kW : la valeur d'une carte grise.
    close(convert(100, "power", "ch", "kW"), 73.549875);
  });
});

describe("données informatiques", () => {
  it("ne confond jamais les préfixes décimaux et binaires", () => {
    expect(convert(1, "data", "GB", "MB")).toBeCloseTo(1000, 9);
    expect(convert(1, "data", "GiB", "MiB")).toBeCloseTo(1024, 9);
    close(convert(1, "data", "GiB", "GB"), 1.073741824);
    close(convert(1, "data", "TB", "TiB"), 0.9094947017729282, 1e-12);
    expect(convert(1, "data", "B", "bit")).toBeCloseTo(8, 12);
  });
});

describe("mise en forme et lecture des nombres", () => {
  it("ne laisse jamais traîner un artefact flottant", () => {
    expect(formatNumber(convert(1, "length", "m", "m"))).toBe("1");
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(1.5)).toBe("1.5");
    expect(formatNumber(0)).toBe("0");
  });

  it("bascule en notation scientifique seulement quand c'est illisible", () => {
    expect(formatNumber(1e-12)).toContain("e-");
    expect(formatNumber(1e20)).toContain("e+");
    expect(formatNumber(1234.5)).toBe("1234.5");
  });

  it("groupe les milliers à la française", () => {
    // Espace fine insécable, le séparateur français, et virgule décimale.
    expect(formatWithGrouping(1234567.89)).toBe("1\u202f234\u202f567,89");
    expect(formatWithGrouping(999)).toBe("999");
  });

  it("accepte la virgule et les espaces des saisies réelles", () => {
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber("1 234,56")).toBe(1234.56);
    expect(parseNumber(" 42 ")).toBe(42);
    expect(parseNumber("-3,5")).toBe(-3.5);
    expect(parseNumber("")).toBeUndefined();
    expect(parseNumber("abc")).toBeUndefined();
  });
});
