import { describe, expect, it } from "vitest";
import { toolRegistry } from "@/core/tools/registry";
import { implementedToolIds } from "@/tools/implementations";
import { constraintsForTool, validateSelection } from "@/core/files";

/**
 * Cohérence de la catégorie Vidéo.
 *
 * Un outil annoncé « Disponible » qui n'accepterait pas ses propres fichiers,
 * ou qui n'aurait pas d'implémentation, serait un faux bouton. Ces vérifications
 * relient donc le catalogue, la table des implémentations et la validation des
 * fichiers déposés — les trois endroits qui pourraient diverger.
 */

const videoTools = toolRegistry.byCategoryId("video");
const implemented = new Set(implementedToolIds());

const fakeFile = (name: string, type: string) => new File([new Uint8Array([0, 1, 2, 3])], name, { type });

describe("catégorie Vidéo", () => {
  it("branche une implémentation derrière chaque outil vidéo", () => {
    for (const tool of videoTools) {
      expect(implemented.has(tool.id), `implémentation manquante : ${tool.id}`).toBe(true);
    }
  });

  it("couvre l'ensemble des opérations attendues de la suite", () => {
    const ids = new Set([
      ...videoTools.map((tool) => tool.id),
      // L'extraction audio vit dans la catégorie Audio et reste découvrable ici.
      ...toolRegistry.byCategoryId("audio").map((tool) => tool.id),
    ]);
    for (const id of [
      "video-convert", "video-compress", "video-resolution", "video-trim", "video-merge",
      "video-crop", "video-rotate", "video-speed", "video-remove-audio", "video-replace-audio",
      "video-volume", "video-add-subtitles", "video-burn-subtitles", "video-extract-subtitles",
      "video-generate-subtitles", "video-extract-audio", "video-to-gif", "gif-to-video",
      "video-extract-frame", "video-batch",
    ]) {
      expect(ids.has(id), `outil manquant dans la suite vidéo : ${id}`).toBe(true);
    }
  });

  it("accepte réellement un MP4 partout où une vidéo est demandée", () => {
    for (const tool of videoTools) {
      if (!tool.acceptedInputs.some((input) => input.kind === "video")) continue;
      const { accepted, rejected } = validateSelection(
        [fakeFile("clip.mp4", "video/mp4")],
        constraintsForTool(tool),
      );
      expect(accepted, `${tool.id} refuse un MP4`).toHaveLength(1);
      expect(rejected).toHaveLength(0);
    }
  });

  it("accepte un fichier de sous-titres là où l'outil en réclame un", () => {
    for (const id of ["video-add-subtitles", "video-burn-subtitles"]) {
      const tool = toolRegistry.get(id)!;
      const { accepted } = validateSelection(
        [fakeFile("clip.mp4", "video/mp4"), fakeFile("sous-titres.srt", "text/plain")],
        { ...constraintsForTool(tool), maxFiles: undefined },
      );
      expect(accepted.map((file) => file.extension), `${id}`).toEqual(["mp4", "srt"]);
    }
  });

  it("accepte la paire vidéo + audio du remplacement de bande son", () => {
    const tool = toolRegistry.get("video-replace-audio")!;
    const { accepted, rejected } = validateSelection(
      [fakeFile("clip.mp4", "video/mp4"), fakeFile("musique.mp3", "audio/mpeg")],
      { ...constraintsForTool(tool), maxFiles: undefined },
    );
    expect(accepted.map((file) => file.kind)).toEqual(["video", "audio"]);
    expect(rejected).toHaveLength(0);
  });

  it("garde chaque outil vidéo local, et déclare FFmpeg dès qu'il touche à une vidéo", () => {
    for (const tool of videoTools) {
      expect(tool.capabilities, `${tool.id}`).toContain("local");
      expect(tool.capabilities).not.toContain("network");

      // La catégorie accueille aussi des outils qui accompagnent la vidéo sans
      // la manipuler — l'éditeur de sous-titres ne lit que du texte et tourne
      // entièrement en TypeScript. Exiger le moteur embarqué de tous les outils
      // de la rubrique reviendrait à annoncer une dépendance qui n'existe pas.
      const touchesVideo = tool.acceptedInputs.some((input) => input.kind === "video");
      if (touchesVideo) expect(tool.capabilities, `${tool.id}`).toContain("needs-sidecar");
    }
  });
});
