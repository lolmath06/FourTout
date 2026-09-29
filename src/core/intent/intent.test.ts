import { beforeEach, describe, expect, it } from "vitest";
import {
  DeterministicIntentResolver,
  registerIntentResolver,
  resetIntentResolvers,
  resolveToolIntent,
  resolveToolIntentSync,
} from "./index";
import type { IntentResolver, IntentResult } from "./types";
import { toolRegistry } from "../tools/registry";

describe("résolveur d'intention déterministe", () => {
  const resolver = new DeterministicIntentResolver();

  it("désigne un outil pour une demande claire", () => {
    const result = resolver.resolveSync("je veux réduire la taille d'un pdf");
    expect(result.outcome).toBe("match");
    expect(result.candidates[0].tool.id).toBe("pdf-compress");
    expect(result.resolver).toBe("deterministic");
  });

  it("signale l'ambiguïté plutôt que de trancher au hasard", () => {
    const result = resolver.resolveSync("fusionner");
    expect(result.outcome).toBe("ambiguous");
    expect(result.candidates.length).toBeGreaterThan(1);
  });

  it("dit explicitement quand rien ne correspond", () => {
    const result = resolver.resolveSync("commander une pizza");
    expect(result.outcome).toBe("no-match");
    expect(result.candidates).toEqual([]);
    expect(result.message).toContain("Aucun outil");
  });

  it("traite une requête vide sans erreur", () => {
    expect(resolver.resolveSync("   ").outcome).toBe("no-match");
  });

  it("ne renvoie que des outils réellement présents au registre", () => {
    const result = resolver.resolveSync("convertir une image en webp");
    for (const candidate of result.candidates) {
      expect(toolRegistry.has(candidate.tool.id)).toBe(true);
    }
  });

  it("attribue une confiance décroissante", () => {
    const result = resolver.resolveSync("pdf");
    const confidences = result.candidates.map((c) => c.confidence);
    expect(confidences).toEqual([...confidences].sort((a, b) => b - a));
    expect(confidences[0]).toBeGreaterThan(0);
    expect(confidences[0]).toBeLessThanOrEqual(1);
  });
});

describe("chaîne de résolveurs", () => {
  beforeEach(() => resetIntentResolvers());

  it("utilise le résolveur déterministe par défaut", async () => {
    const result = await resolveToolIntent("gif en vidéo");
    expect(result.resolver).toBe("deterministic");
    expect(result.candidates[0].tool.id).toBe("gif-to-video");
  });

  it("laisse un résolveur prioritaire prendre la main", async () => {
    const stub: IntentResolver = {
      id: "stub-llm",
      isAvailable: () => true,
      resolve: async (query): Promise<IntentResult> => ({
        query,
        outcome: "match",
        resolver: "stub-llm",
        candidates: [
          { tool: toolRegistry.get("pdf-merge")!, confidence: 1, reason: "test" },
        ],
      }),
    };
    registerIntentResolver(stub);
    const result = await resolveToolIntent("peu importe");
    expect(result.resolver).toBe("stub-llm");
  });

  it("retombe sur le déterministe si le résolveur prioritaire ne trouve rien", async () => {
    const silent: IntentResolver = {
      id: "stub-silent",
      isAvailable: () => true,
      resolve: async (query) => ({
        query,
        outcome: "no-match" as const,
        resolver: "stub-silent",
        candidates: [],
      }),
    };
    registerIntentResolver(silent);
    const result = await resolveToolIntent("réduire la taille d'un pdf");
    expect(result.resolver).toBe("deterministic");
    expect(result.candidates[0].tool.id).toBe("pdf-compress");
  });

  it("ignore un résolveur indisponible", async () => {
    const offline: IntentResolver = {
      id: "stub-offline",
      isAvailable: () => false,
      resolve: async () => {
        throw new Error("ne doit jamais être appelé");
      },
    };
    registerIntentResolver(offline);
    const result = await resolveToolIntent("pdf");
    expect(result.resolver).toBe("deterministic");
  });

  it("expose une variante synchrone toujours déterministe", () => {
    expect(resolveToolIntentSync("gif en vidéo").resolver).toBe("deterministic");
  });
});
