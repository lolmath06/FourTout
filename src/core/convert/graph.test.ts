import { describe, expect, it } from "vitest";
import { buildConversionEdges, conversionsFor, convertibleExtensions, presetForTarget } from "./graph";
import { toolRegistry } from "@/core/tools/registry";
import { implementedToolIds } from "@/tools/implementations";

/**
 * Le convertisseur universel ne doit jamais proposer une conversion qui
 * n'existe pas. Ces tests verrouillent les deux garanties : ce qui est proposé
 * est réellement branché, et ce qui est prévu n'apparaît nulle part.
 */

const targetsFor = (extension: string) => conversionsFor(extension).map((target) => target.to);
const toolsFor = (extension: string) => conversionsFor(extension).map((target) => target.toolId);

describe("dérivation du graphe depuis le registre", () => {
  it("ne retient que des outils réellement implémentés", () => {
    const implemented = new Set(implementedToolIds());
    for (const edge of buildConversionEdges()) {
      expect(implemented.has(edge.toolId), `outil non branché : ${edge.toolId}`).toBe(true);
    }
  });

  it("ne propose jamais un outil « planned »", () => {
    for (const edge of buildConversionEdges()) {
      expect(toolRegistry.get(edge.toolId)?.status).toBe("available");
    }
  });

  it("n'inclut pas le convertisseur universel lui-même", () => {
    expect(buildConversionEdges().map((edge) => edge.toolId)).not.toContain("universal-converter");
  });

  it("ne propose pas de conversion d'un format vers lui-même", () => {
    for (const edge of buildConversionEdges()) {
      expect(edge.from).not.toBe(edge.to);
    }
  });

  it("ne propose qu'un seul outil par format cible", () => {
    const targets = conversionsFor("png").map((target) => target.to);
    expect(new Set(targets).size).toBe(targets.length);
  });
});

describe("conversions proposées par format", () => {
  it("PNG : JPEG, WebP et PDF", () => {
    const targets = targetsFor("png");
    expect(targets).toContain("jpg");
    expect(targets).toContain("webp");
    expect(targets).toContain("pdf");
    expect(toolsFor("png")).toContain("image-convert");
  });

  it("MP4 : autres formats vidéo, GIF, audio et image fixe", () => {
    const targets = targetsFor("mp4");
    expect(targets).toContain("webm");
    expect(targets).toContain("mkv");
    expect(targets).toContain("gif");
    expect(targets).toContain("mp3");
    expect(targets).toContain("png");
    const tools = toolsFor("mp4");
    expect(tools).toContain("video-convert");
    expect(tools).toContain("video-extract-audio");
  });

  it("PDF : images, texte et audio", () => {
    const targets = targetsFor("pdf");
    expect(targets).toContain("png");
    expect(targets).toContain("txt");
    expect(targets.some((target) => ["mp3", "wav"].includes(target))).toBe(true);
    expect(toolsFor("pdf")).toContain("pdf-to-images");
  });

  it("TXT : PDF, audio et HTML", () => {
    const targets = targetsFor("txt");
    expect(targets).toContain("pdf");
    expect(targets).toContain("html");
    expect(targets.some((target) => ["mp3", "wav"].includes(target))).toBe(true);
  });

  it("DOCX : texte, Markdown et HTML", () => {
    const targets = targetsFor("docx");
    expect(targets).toEqual(expect.arrayContaining(["txt", "md", "html"]));
    expect(toolsFor("docx")).toContain("docx-extract");
  });

  it("MP3 : autres formats audio", () => {
    expect(targetsFor("mp3")).toContain("wav");
  });

  it("ignore la casse et le point de l'extension", () => {
    expect(targetsFor("PNG")).toEqual(targetsFor("png"));
    expect(conversionsFor(".png").map((t) => t.to)).toEqual(targetsFor("png"));
  });

  it("ne propose rien pour un format inconnu", () => {
    expect(conversionsFor("xyz")).toEqual([]);
  });

  it("ne propose pas DOCX vers PDF tant que l'outil est prévu et non livré", () => {
    expect(toolsFor("docx")).not.toContain("docx-to-pdf");
    expect(toolRegistry.get("docx-to-pdf")?.status).toBe("planned");
  });
});

describe("relais vers l'outil spécialisé", () => {
  it("transmet le format cible en préréglage", () => {
    const target = conversionsFor("png").find((entry) => entry.to === "webp")!;
    expect(presetForTarget(target)).toEqual({ format: "webp" });
  });

  it("couvre les familles de fichiers courantes", () => {
    const extensions = convertibleExtensions();
    for (const extension of ["png", "jpg", "webp", "pdf", "mp4", "mp3", "wav", "txt", "md", "docx"]) {
      expect(extensions, `aucune conversion depuis ${extension}`).toContain(extension);
    }
  });
});
