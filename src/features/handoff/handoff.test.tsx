import { describe, expect, it } from "vitest";
import { HANDOFF_TARGETS, handoffTargetIds, specialistFor } from "./targets";
import { toolRegistry } from "@/core/tools/registry";
import { implementedToolIds } from "@/tools/implementations";

/**
 * Un lien qui ne mène nulle part est pire qu'aucun lien : il promet une suite
 * et livre une page vide. Ces tests verrouillent les deux conditions d'un
 * relais valable — l'outil visé existe, et il est réellement branché.
 */
describe("passages de relais des outils Fichiers", () => {
  it("ne vise que des outils du registre", () => {
    for (const id of handoffTargetIds()) {
      expect(toolRegistry.get(id), `outil inconnu : ${id}`).toBeDefined();
    }
  });

  it("ne vise que des outils réellement implémentés", () => {
    const implemented = new Set(implementedToolIds());
    for (const id of handoffTargetIds()) {
      expect(implemented.has(id), `outil non branché : ${id}`).toBe(true);
    }
  });

  it("propose un spécialiste cohérent avec la famille détectée", () => {
    // C'est le contenu qui décide, jamais l'extension : un PNG déguisé en
    // « .jpg » doit mener au convertisseur d'image.
    expect(specialistFor("image", "png")).toBe(HANDOFF_TARGETS.imageConvert);
    expect(specialistFor("audio", "mp3")).toBe(HANDOFF_TARGETS.audioConvert);
    expect(specialistFor("video", "mp4")).toBe(HANDOFF_TARGETS.videoConvert);
    expect(specialistFor("document", "pdf")).toBe(HANDOFF_TARGETS.pdfMetadata);

    // Une archive mène à son inspecteur…
    expect(specialistFor("archive", "zip")).toBe(HANDOFF_TARGETS.archiveInspect);
    expect(specialistFor("archive", "7z")).toBe(HANDOFF_TARGETS.archiveInspect);
    // …sauf un flux, qui n'a pas de table des matières à inspecter.
    expect(specialistFor("archive", "gz")).toBe(HANDOFF_TARGETS.decompress);
    expect(specialistFor("archive", "xz")).toBe(HANDOFF_TARGETS.decompress);

    // Et sur un contenu qu'aucun outil ne traite mieux qu'un autre, on ne
    // propose rien plutôt que de proposer au hasard.
    expect(specialistFor("unknown", "inconnu")).toBeUndefined();
    expect(specialistFor("data", "sqlite")).toBeUndefined();
  });

  it("n'a aucune cible en double sous deux noms différents", () => {
    const values = Object.values(HANDOFF_TARGETS);
    expect(new Set(values).size).toBe(values.length);
  });
});
