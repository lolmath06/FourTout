import { describe, expect, it } from "vitest";
import { reorderByInsertion } from "./pageReorder";

describe("réordonnancement par insertion", () => {
  it("déplace la dernière page en tête (5 devant 1)", () => {
    // Ordre [1,2,3,4,5], saisir la page 5 (index 4), insérer devant index 0.
    expect(reorderByInsertion([1, 2, 3, 4, 5], 4, 0)).toEqual([5, 1, 2, 3, 4]);
  });

  it("déplace une page vers la fin", () => {
    // [1,2,3,4,5], saisir page 1 (index 0), insérer en fin (insertBefore 5).
    expect(reorderByInsertion([1, 2, 3, 4, 5], 0, 5)).toEqual([2, 3, 4, 5, 1]);
  });

  it("corrige le décalage quand la source précède la cible", () => {
    // [1,2,3,4], déplacer index 1 (=2) devant index 3 → [1,3,2,4].
    expect(reorderByInsertion([1, 2, 3, 4], 1, 3)).toEqual([1, 3, 2, 4]);
  });

  it("laisse l'ordre inchangé si l'on relâche à la même place", () => {
    expect(reorderByInsertion([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
    expect(reorderByInsertion([1, 2, 3], 1, 2)).toEqual([1, 2, 3]);
  });

  it("insère au milieu", () => {
    expect(reorderByInsertion(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });
});
