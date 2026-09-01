import { describe, expect, it } from "vitest";
import {
  acceptAttribute,
  constraintsForTool,
  extensionOf,
  formatFileSize,
  kindOfExtension,
  validateSelection,
} from "./index";
import { toolRegistry } from "../tools/registry";

const file = (name: string, size = 1024) =>
  new File([new Uint8Array(size)], name, { type: "" });

describe("identification des fichiers", () => {
  it("extrait l'extension", () => {
    expect(extensionOf("rapport.PDF")).toBe("pdf");
    expect(extensionOf("archive.tar.gz")).toBe("gz");
    expect(extensionOf("sans-extension")).toBe("");
    expect(extensionOf(".gitignore")).toBe("");
  });

  it("associe une extension à une famille", () => {
    expect(kindOfExtension("png")).toBe("image");
    expect(kindOfExtension(".MP4")).toBe("video");
    expect(kindOfExtension("inconnue")).toBe("data");
  });

  it("formate les tailles", () => {
    expect(formatFileSize(512)).toBe("512 o");
    expect(formatFileSize(2048)).toBe("2 Ko");
    expect(formatFileSize(1024 * 1024 * 3.5)).toBe("3.5 Mo");
    expect(formatFileSize(-1)).toBe("—");
  });
});

describe("contraintes déduites du registre", () => {
  it("autorise plusieurs fichiers pour un outil par lots", () => {
    const constraints = constraintsForTool(toolRegistry.get("pdf-merge")!);
    expect(constraints.maxFiles).toBeUndefined();
  });

  it("limite à un fichier un outil non batch", () => {
    const constraints = constraintsForTool(toolRegistry.get("pdf-split")!);
    expect(constraints.maxFiles).toBe(1);
  });

  it("écarte les entrées « saisie directe »", () => {
    const constraints = constraintsForTool(toolRegistry.get("base64")!);
    expect(constraints.inputs).toEqual([]);
  });

  it("construit l'attribut accept", () => {
    expect(acceptAttribute([{ kind: "pdf", extensions: ["pdf"] }])).toBe(".pdf");
    expect(acceptAttribute([{ kind: "data", extensions: ["*"] }])).toBeUndefined();
  });
});

describe("validation d'une sélection", () => {
  const pdfOnly = constraintsForTool(toolRegistry.get("pdf-merge")!);

  it("accepte les fichiers du bon type", () => {
    const { accepted, rejected } = validateSelection([file("a.pdf"), file("b.pdf")], pdfOnly);
    expect(accepted.map((f) => f.name)).toEqual(["a.pdf", "b.pdf"]);
    expect(rejected).toEqual([]);
  });

  it("refuse un type non pris en charge en expliquant pourquoi", () => {
    const { accepted, rejected } = validateSelection([file("photo.png")], pdfOnly);
    expect(accepted).toEqual([]);
    expect(rejected[0].reason).toContain(".png");
  });

  it("refuse les fichiers au-delà de la limite", () => {
    const single = constraintsForTool(toolRegistry.get("pdf-split")!);
    const { accepted, rejected } = validateSelection([file("a.pdf"), file("b.pdf")], single);
    expect(accepted).toHaveLength(1);
    expect(rejected[0].reason).toContain("qu'un fichier");
  });

  it("tient compte des fichiers déjà sélectionnés", () => {
    const constraints = { ...pdfOnly, maxFiles: 2 };
    const { accepted, rejected } = validateSelection([file("c.pdf")], constraints, 2);
    expect(accepted).toEqual([]);
    expect(rejected).toHaveLength(1);
  });

  it("refuse un fichier trop volumineux", () => {
    const { rejected } = validateSelection([file("gros.pdf", 4096)], {
      ...pdfOnly,
      maxFileSize: 1024,
    });
    expect(rejected[0].reason).toContain("volumineux");
  });

  it("accepte tout quand l'outil n'impose rien", () => {
    const { accepted } = validateSelection([file("quoi.xyz")], { inputs: [] });
    expect(accepted).toHaveLength(1);
  });
});
