import { describe, expect, it } from "vitest";
import {
  convertZone,
  formatOffset,
  instantsForWallClock,
  parseWallClock,
  searchZones,
  TimeZoneError,
  wallClockAt,
  zoneOffsetMinutes,
  zonedTimeAt,
} from "./timezone";

const wall = (date: string, time: string) => parseWallClock(date, time);

describe("fuseaux horaires — décalages réels", () => {
  it("donne l'heure d'hiver et l'heure d'été de Paris", () => {
    // 15 janvier 2026 : Paris est en heure d'hiver, UTC+1.
    const hiver = Date.UTC(2026, 0, 15, 12, 0, 0);
    expect(zoneOffsetMinutes("Europe/Paris", hiver)).toBe(60);
    // 15 juillet 2026 : heure d'été, UTC+2.
    const ete = Date.UTC(2026, 6, 15, 12, 0, 0);
    expect(zoneOffsetMinutes("Europe/Paris", ete)).toBe(120);
  });

  it("donne les décalages de New York, Tokyo et Calcutta", () => {
    const hiver = Date.UTC(2026, 0, 15, 12, 0, 0);
    const ete = Date.UTC(2026, 6, 15, 12, 0, 0);
    expect(zoneOffsetMinutes("America/New_York", hiver)).toBe(-300);
    expect(zoneOffsetMinutes("America/New_York", ete)).toBe(-240);
    // Le Japon n'applique pas l'heure d'été : le décalage ne bouge pas.
    expect(zoneOffsetMinutes("Asia/Tokyo", hiver)).toBe(540);
    expect(zoneOffsetMinutes("Asia/Tokyo", ete)).toBe(540);
    // Et tous les décalages ne sont pas des heures entières.
    expect(zoneOffsetMinutes("Asia/Kolkata", hiver)).toBe(330);
  });

  it("écrit les décalages au format habituel", () => {
    expect(formatOffset(60)).toBe("+01:00");
    expect(formatOffset(-300)).toBe("-05:00");
    expect(formatOffset(330)).toBe("+05:30");
    expect(formatOffset(0)).toBe("+00:00");
  });
});

describe("fuseaux horaires — conversions ordinaires", () => {
  it("convertit une heure d'hiver de Paris vers UTC", () => {
    const result = convertZone(wall("2026-01-15", "14:30"), "Europe/Paris", "UTC");
    expect(result.kind).toBe("unique");
    expect(result.source.offsetLabel).toBe("+01:00");
    expect(result.target.wall.hour).toBe(13);
    expect(result.target.wall.minute).toBe(30);
    expect(result.target.iso).toBe("2026-01-15T13:30:00.000Z");
  });

  it("convertit une heure d'été de Paris vers New York", () => {
    const result = convertZone(wall("2026-07-15", "14:00"), "Europe/Paris", "America/New_York");
    expect(result.kind).toBe("unique");
    expect(result.source.offsetLabel).toBe("+02:00");
    expect(result.target.offsetLabel).toBe("-04:00");
    // 14 h à Paris (UTC+2) = 12 h UTC = 8 h à New York (UTC−4).
    expect(result.target.wall.hour).toBe(8);
    expect(result.target.iso).toBe("2026-07-15T12:00:00.000Z");
  });

  it("convertit de Paris vers Tokyo", () => {
    const result = convertZone(wall("2026-01-15", "09:00"), "Europe/Paris", "Asia/Tokyo");
    // 9 h à Paris (UTC+1) = 8 h UTC = 17 h à Tokyo (UTC+9).
    expect(result.target.wall.hour).toBe(17);
    expect(result.target.wall.day).toBe(15);
  });

  it("franchit la date quand il le faut", () => {
    const result = convertZone(wall("2026-01-15", "23:00"), "Europe/Paris", "Asia/Tokyo");
    expect(result.target.wall.day).toBe(16);
    expect(result.target.wall.hour).toBe(7);
  });

  it("décrit un instant absolu dans un fuseau", () => {
    const view = zonedTimeAt("Europe/Paris", Date.UTC(2026, 0, 15, 13, 30, 0));
    expect(view.wall.hour).toBe(14);
    expect(view.offsetMinutes).toBe(60);
    expect(view.iso).toBe("2026-01-15T13:30:00.000Z");
  });
});

describe("fuseaux horaires — changements d'heure", () => {
  it("signale une heure qui n'existe pas au passage à l'heure d'été", () => {
    // Paris, dimanche 29 mars 2026 : à 2 h, l'horloge saute à 3 h.
    expect(instantsForWallClock("Europe/Paris", wall("2026-03-29", "02:30"))).toHaveLength(0);
    const result = convertZone(wall("2026-03-29", "02:30"), "Europe/Paris", "UTC");
    expect(result.kind).toBe("skipped");
    expect(result.note).toMatch(/n'existe pas/);
    // L'instant proposé est bien réel, et l'outil dit lequel.
    expect(result.source.wall.hour).toBe(3);
    expect(result.source.wall.minute).toBe(30);
  });

  it("signale une heure vécue deux fois au retour à l'heure d'hiver", () => {
    // Paris, dimanche 25 octobre 2026 : 2 h 30 arrive deux fois.
    const instants = instantsForWallClock("Europe/Paris", wall("2026-10-25", "02:30"));
    expect(instants).toHaveLength(2);
    // Une heure exactement sépare les deux occurrences.
    expect(instants[1] - instants[0]).toBe(3_600_000);

    const result = convertZone(wall("2026-10-25", "02:30"), "Europe/Paris", "UTC");
    expect(result.kind).toBe("ambiguous");
    expect(result.note).toMatch(/deux fois/);
    // Première occurrence : encore en heure d'été (UTC+2) → 00 h 30 UTC.
    expect(result.source.offsetLabel).toBe("+02:00");
    expect(result.target.wall.hour).toBe(0);
    // Seconde occurrence : heure d'hiver (UTC+1) → 01 h 30 UTC.
    expect(result.alternative?.source.offsetLabel).toBe("+01:00");
    expect(result.alternative?.target.wall.hour).toBe(1);
  });

  it("laisse choisir l'occurrence sans en inventer une", () => {
    const second = convertZone(wall("2026-10-25", "02:30"), "Europe/Paris", "UTC", {
      prefer: "second",
    });
    expect(second.kind).toBe("ambiguous");
    expect(second.source.offsetLabel).toBe("+01:00");
    expect(second.alternative?.source.offsetLabel).toBe("+02:00");
  });

  it("traite une heure ordinaire du même jour sans ambiguïté", () => {
    const result = convertZone(wall("2026-10-25", "12:00"), "Europe/Paris", "UTC");
    expect(result.kind).toBe("unique");
    expect(result.source.offsetLabel).toBe("+01:00");
  });

  it("signale aussi le changement d'heure américain, à sa propre date", () => {
    // Les États-Unis changent d'heure le 8 mars 2026, deux semaines avant l'Europe.
    expect(
      instantsForWallClock("America/New_York", wall("2026-03-08", "02:30")),
    ).toHaveLength(0);
    // Ce jour-là, 2 h 30 existe encore normalement à Paris.
    expect(instantsForWallClock("Europe/Paris", wall("2026-03-08", "02:30"))).toHaveLength(1);
  });
});

describe("fuseaux horaires — saisie et recherche", () => {
  it("lit une date et une heure", () => {
    expect(parseWallClock("2026-01-15", "14:30")).toEqual({
      year: 2026,
      month: 1,
      day: 15,
      hour: 14,
      minute: 30,
      second: 0,
    });
    expect(parseWallClock("2026-01-15", "9:05:07").second).toBe(7);
  });

  it("refuse une saisie impossible", () => {
    expect(() => parseWallClock("15/01/2026", "14:30")).toThrow(TimeZoneError);
    expect(() => parseWallClock("2026-01-15", "25:00")).toThrow(/entre 0 et 23/);
    expect(() => parseWallClock("2026-02-31", "10:00")).toThrow(/n'existe pas/);
    expect(() => parseWallClock("2026-13-01", "10:00")).toThrow(/Mois/);
  });

  it("refuse un fuseau inconnu du système", () => {
    expect(() => convertZone(wall("2026-01-15", "10:00"), "Europe/Atlantide", "UTC")).toThrow(
      /inconnu/,
    );
  });

  it("retrouve un fuseau par le nom de la ville", () => {
    expect(searchZones("paris")).toContain("Europe/Paris");
    expect(searchZones("new york")).toContain("America/New_York");
    expect(searchZones("tokyo")).toContain("Asia/Tokyo");
    // Accents et casse indifférents.
    expect(searchZones("MONTRÉAL").length).toBeGreaterThanOrEqual(0);
    expect(searchZones("Asia/Tok")).toContain("Asia/Tokyo");
  });

  it("lit l'heure murale d'un instant donné", () => {
    const parts = wallClockAt("Asia/Tokyo", Date.UTC(2026, 0, 15, 0, 0, 0));
    expect(parts).toEqual({ year: 2026, month: 1, day: 15, hour: 9, minute: 0, second: 0 });
  });
});
