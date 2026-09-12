import { describe, expect, it } from "vitest";
import { searchTools } from "./search";
import { toolRegistry } from "./registry";
import { conversionsFor } from "@/core/convert/graph";
import { implementedToolIds } from "@/tools/implementations";
import { handoffTargetIds, HANDOFF_TARGETS } from "@/features/handoff/targets";

/**
 * Les outils de la phase 10 sont-ils réellement trouvables ?
 *
 * Un outil qui existe mais qu'on n'atteint qu'en connaissant son nom exact n'a
 * pas été livré. Chaque formulation ci-dessous est une façon dont on cherche
 * réellement ces fonctions — en français courant, en jargon, et en anglais.
 */
const ids = (query: string) => searchTools(query).map((result) => result.tool.id);

const PHASE_10_TOOLS = [
  "image-compare",
  "image-contact-sheet",
  "color-picker",
  "audio-channels",
  "audio-metadata",
  "media-info",
  "video-frame-rate",
  "subtitle-edit",
];

describe("catalogue de la phase 10", () => {
  it("enregistre et implémente chaque nouvel outil", () => {
    const implemented = new Set(implementedToolIds());
    for (const id of PHASE_10_TOOLS) {
      expect(toolRegistry.get(id), `absent du registre : ${id}`).toBeDefined();
      expect(implemented.has(id), `implémentation manquante : ${id}`).toBe(true);
    }
  });

  it("ne laisse aucun relais pointer dans le vide", () => {
    const implemented = new Set(implementedToolIds());
    for (const id of handoffTargetIds()) {
      expect(toolRegistry.get(id), `relais mort : ${id}`).toBeDefined();
      expect(implemented.has(id), `relais sans implémentation : ${id}`).toBe(true);
    }
    // Les relais ajoutés par la phase 10 sont bien ceux qu'on croit.
    expect(HANDOFF_TARGETS.mediaInspect).toBe("media-info");
    expect(HANDOFF_TARGETS.videoFrameRate).toBe("video-frame-rate");
    expect(HANDOFF_TARGETS.subtitleEdit).toBe("subtitle-edit");
  });
});

describe("recherche des outils de la phase 10", () => {
  it("mène à la comparaison d'images", () => {
    expect(ids("comparer images")).toContain("image-compare");
    expect(ids("image diff")).toContain("image-compare");
    expect(ids("pixel diff")).toContain("image-compare");
    expect(ids("psnr")).toContain("image-compare");
    expect(ids("ssim")).toContain("image-compare");
    expect(ids("difference entre deux photos")).toContain("image-compare");
  });

  it("mène à la planche-contact", () => {
    expect(ids("planche contact")).toContain("image-contact-sheet");
    expect(ids("contact sheet")).toContain("image-contact-sheet");
    expect(ids("plusieurs images sur une page")).toContain("image-contact-sheet");
  });

  it("mène à l'outil couleur par ses trois usages", () => {
    expect(ids("pipette couleur")).toContain("color-picker");
    expect(ids("rgb hex")).toContain("color-picker");
    expect(ids("hsl")).toContain("color-picker");
    expect(ids("contraste wcag")).toContain("color-picker");
    expect(ids("couleurs dominantes")).toContain("color-picker");
  });

  it("mène aux outils audio", () => {
    expect(ids("mono stereo")).toContain("audio-channels");
    expect(ids("canaux audio")).toContain("audio-channels");
    expect(ids("metadata audio")).toEqual(
      expect.arrayContaining([expect.stringMatching(/^(audio-metadata|media-info)$/)]),
    );
    expect(ids("tags mp3")).toContain("audio-metadata");
  });

  it("mène à l'inspecteur de média", () => {
    expect(ids("metadata video")).toContain("media-info");
    expect(ids("informations media")).toContain("media-info");
    expect(ids("ffprobe")).toContain("media-info");
  });

  it("mène au changement de cadence", () => {
    expect(ids("fps video")).toContain("video-frame-rate");
    expect(ids("changer fps")).toContain("video-frame-rate");
    expect(ids("images par seconde")).toContain("video-frame-rate");
  });

  it("mène à l'éditeur de sous-titres", () => {
    expect(ids("srt vtt")).toContain("subtitle-edit");
    expect(ids("decaler sous titres")).toContain("subtitle-edit");
    expect(ids("fusionner sous titres")).toContain("subtitle-edit");
    expect(ids("reparer srt")).toContain("subtitle-edit");
    expect(ids("sous titres desynchronises")).toContain("subtitle-edit");
  });
});

describe("convertisseur universel", () => {
  it("propose la conversion entre SRT et WebVTT", () => {
    expect(conversionsFor("srt").map((target) => target.to)).toContain("vtt");
    expect(conversionsFor("vtt").map((target) => target.to)).toContain("srt");
    expect(conversionsFor("srt").find((target) => target.to === "vtt")?.toolId).toBe("subtitle-edit");
  });

  it("laisse la conversion audio à l'outil qui en fait son métier", () => {
    // « Convertir les canaux » produit les mêmes formats qu'il accepte : il
    // n'ouvre aucune route nouvelle, et n'a donc rien à faire dans le graphe —
    // il n'y ajouterait que du bruit devant la conversion audio proprement dite.
    const routes = conversionsFor("mp3");
    expect(routes.find((target) => target.to === "wav")?.toolId).toBe("audio-convert");
    expect(routes.map((target) => target.toolId)).not.toContain("audio-channels");
  });

  it("n'y fait pas figurer ce qui n'est pas une conversion", () => {
    // Comparer deux images, lire des métadonnées ou calculer un contraste ne
    // transforment rien : ces outils n'ont pas leur place dans le graphe.
    const everywhere = ["png", "jpg", "mp4", "mp3", "wav"].flatMap((extension) =>
      conversionsFor(extension).map((target) => target.toolId),
    );
    expect(everywhere).not.toContain("image-compare");
    expect(everywhere).not.toContain("media-info");
    expect(everywhere).not.toContain("color-picker");
    expect(everywhere).not.toContain("image-contact-sheet");
  });
});
