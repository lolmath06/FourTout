import { describe, expect, it } from "vitest";
import {
  countTomlComments,
  formatToml,
  tomlToJson,
  TomlFormatError,
  validateToml,
} from "./toml";

const RICH = `# Configuration d'exemple
titre = "FourTout — été"
description = """
Une description
sur deux lignes.
"""
version = 2
actif = true
ratio = 1.5
sortie = 1979-05-27T07:32:00Z
jour = 1979-05-27

[serveur]
hote = "127.0.0.1"
ports = [8000, 8001, 8002]

[serveur.limites]
requetes = 100

[[journal]]
niveau = "info"

[[journal]]
niveau = "erreur"
`;

describe("TOML — validation", () => {
  it("accepte un document riche", () => {
    const result = validateToml(RICH);
    expect(result.valid).toBe(true);
    expect(result.summary?.topLevelKeys).toBe(7);
    expect(result.summary?.tables).toBe(2);
    expect(result.summary?.arraysOfTables).toBe(1);
    expect(result.summary?.dates).toBe(2);
    expect(result.summary?.depth).toBe(2);
  });

  it("situe une clé dupliquée", () => {
    const result = validateToml('a = 1\na = 2\n');
    expect(result.valid).toBe(false);
    expect(result.problem?.position).toEqual({ line: 2, column: 1 });
    expect(result.problem?.message).not.toMatch(/^Invalid TOML document/);
    expect(result.problem?.message.length).toBeGreaterThan(0);
  });

  it("situe un tableau jamais refermé", () => {
    const result = validateToml("ports = [8000, 8001\n");
    expect(result.valid).toBe(false);
    expect(result.problem?.position?.line).toBe(1);
    expect(result.problem?.excerpt).toContain("ports");
  });

  it("refuse une valeur qui n'est pas un type TOML", () => {
    const result = validateToml("actif = oui\n");
    expect(result.valid).toBe(false);
    expect(result.problem?.position).toBeDefined();
  });

  it("ne rend jamais une trace d'exécution brute", () => {
    const result = validateToml("[table\n");
    expect(result.valid).toBe(false);
    expect(result.problem?.message).not.toContain("at Object.");
    expect(result.problem?.message).not.toContain("node_modules");
  });
});

describe("TOML — formatage", () => {
  it("conserve la signification de chaque type", () => {
    const formatted = formatToml(RICH);
    const before = validateToml(RICH);
    const after = validateToml(formatted);
    expect(after.valid).toBe(true);
    // Le document reformaté décrit exactement les mêmes données.
    expect(tomlToJson(formatted)).toBe(tomlToJson(RICH));
    expect(after.summary).toEqual(before.summary);
  });

  it("est idempotent", () => {
    const once = formatToml(RICH);
    expect(formatToml(once)).toBe(once);
  });

  it("garde tables, tableaux de tables et dates", () => {
    const formatted = formatToml(RICH);
    expect(formatted).toContain("[serveur]");
    expect(formatted).toContain("[serveur.limites]");
    expect(formatted).toContain("[[journal]]");
    expect(formatted).toContain("1979-05-27");
    expect(formatted).toContain("ports = [ 8000, 8001, 8002 ]");
  });

  it("perd les commentaires, et c'est mesurable", () => {
    // La limitation est réelle : le test la constate au lieu de la masquer.
    expect(countTomlComments(RICH)).toBe(1);
    expect(formatToml(RICH)).not.toContain("# Configuration d'exemple");
    expect(countTomlComments(formatToml(RICH))).toBe(0);
  });

  it("ne compte pas un dièse à l'intérieur d'une chaîne multiligne", () => {
    const document = 'texte = """\n# ceci n\'est pas un commentaire\n"""\n# celui-ci en est un\n';
    expect(countTomlComments(document)).toBe(1);
  });

  it("refuse de reformater un document invalide", () => {
    expect(() => formatToml("a = 1\na = 2\n")).toThrow(TomlFormatError);
    try {
      formatToml("a = 1\na = 2\n");
    } catch (error) {
      expect((error as TomlFormatError).problem.position?.line).toBe(2);
    }
  });

  it("conserve les caractères accentués et les chaînes multilignes", () => {
    const formatted = formatToml(RICH);
    expect(formatted).toContain("FourTout — été");
    expect(tomlToJson(formatted)).toContain("sur deux lignes");
  });
});
