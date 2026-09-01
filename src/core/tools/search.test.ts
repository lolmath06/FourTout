import { describe, expect, it } from "vitest";
import { normalize, searchTools, tokenize } from "./search";

const ids = (query: string, options?: Parameters<typeof searchTools>[1]) =>
  searchTools(query, options).map((result) => result.tool.id);

describe("normalisation", () => {
  it("retire accents et ponctuation", () => {
    expect(normalize("Réduire la TAILLE d'un PDF !")).toBe("reduire la taille d un pdf");
  });

  it("écarte les mots vides", () => {
    expect(tokenize("je veux réduire la taille d'un pdf")).toEqual([
      "reduire",
      "taille",
      "pdf",
    ]);
  });
});

describe("recherche par mot-clé", () => {
  it("trouve les outils PDF avec « pdf »", () => {
    const results = ids("pdf");
    expect(results).toContain("pdf-merge");
    expect(results).toContain("pdf-compress");
    expect(results.length).toBeGreaterThan(5);
  });

  it("trouve un outil par son nom", () => {
    expect(ids("fusionner des pdf")[0]).toBe("pdf-merge");
  });

  it("propose toutes les fusions quand le mot seul est ambigu", () => {
    const results = ids("fusionner");
    expect(results).toEqual(expect.arrayContaining(["pdf-merge", "audio-merge", "video-merge"]));
  });

  it("trouve un outil par un alias anglais", () => {
    expect(ids("unzip")).toContain("archive-extract");
    expect(ids("word count")).toContain("text-statistics");
  });

  it("tolère les accents manquants", () => {
    expect(ids("reduire taille pdf")[0]).toBe("pdf-compress");
    expect(ids("compresser video")[0]).toBe("video-compress");
  });
});

describe("recherche en langage courant", () => {
  it("« réduire taille pdf » propose la compression PDF en premier", () => {
    expect(ids("réduire taille pdf")[0]).toBe("pdf-compress");
  });

  it("« je veux réduire la taille d'un pdf » aussi", () => {
    expect(ids("je veux réduire la taille d'un pdf")[0]).toBe("pdf-compress");
  });

  it("« transformer un gif en vidéo » propose GIF vers vidéo", () => {
    expect(ids("transformer un gif en vidéo")[0]).toBe("gif-to-video");
  });

  it("distingue le sens de la conversion", () => {
    expect(ids("vidéo en gif")[0]).toBe("video-to-gif");
    expect(ids("gif en vidéo")[0]).toBe("gif-to-video");
  });

  it("« convertir cette image en webp » propose la conversion d'image", () => {
    expect(ids("convertir cette image en webp")[0]).toBe("image-convert");
  });

  it("« extraire le son d'une vidéo » propose l'extraction audio", () => {
    expect(ids("extraire le son d'une vidéo")[0]).toBe("video-extract-audio");
  });

  it("« mon pdf est trop lourd » propose la compression PDF", () => {
    expect(ids("mon pdf est trop lourd")).toContain("pdf-compress");
  });

  it("« enlever les métadonnées d'une photo » propose le nettoyage EXIF", () => {
    expect(ids("enlever les métadonnées d'une photo")[0]).toBe("image-metadata-strip");
  });
});

describe("absence de faux positifs", () => {
  it("ne renvoie rien pour une demande hors périmètre", () => {
    expect(ids("envoyer un fax à ma banque")).toEqual([]);
    expect(ids("commander une pizza margherita")).toEqual([]);
    expect(ids("zzzzzz")).toEqual([]);
  });

  it("n'invente pas d'outil pour une fonctionnalité absente du catalogue", () => {
    expect(ids("miner des bitcoins")).toEqual([]);
  });
});

describe("filtres", () => {
  it("restreint à une catégorie", () => {
    const results = searchTools("convertir", { category: "audio" });
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      const inCategory =
        result.tool.category === "audio" || result.tool.alsoIn?.includes("audio");
      expect(inCategory).toBe(true);
    }
  });

  it("restreint à un statut", () => {
    const results = searchTools("", { status: "available", limit: 500 });
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) expect(result.tool.status).toBe("available");
  });

  it("renvoie le catalogue filtré quand la requête est vide", () => {
    expect(searchTools("", { limit: 500 }).length).toBeGreaterThan(100);
  });

  it("respecte la limite demandée", () => {
    expect(searchTools("pdf", { limit: 3 })).toHaveLength(3);
  });
});

describe("recherche des outils PDF de la phase 2", () => {
  const first = (query: string) => ids(query)[0];

  it("« assembler deux pdf » trouve la fusion", () => {
    expect(first("assembler deux pdf")).toBe("pdf-merge");
  });

  it("« enlever page 3 » trouve la suppression de pages", () => {
    expect(ids("enlever page 3")).toContain("pdf-remove-pages");
  });

  it("« tourner page pdf » trouve la rotation", () => {
    expect(first("tourner page pdf")).toBe("pdf-rotate");
  });

  it("« convertir pdf en png » trouve PDF vers images", () => {
    expect(first("convertir pdf en png")).toBe("pdf-to-images");
  });

  it("« mettre mot de passe pdf » trouve la protection", () => {
    expect(first("mettre mot de passe pdf")).toBe("pdf-protect");
  });

  it("« découper un pdf » trouve la séparation", () => {
    expect(ids("découper un pdf")).toContain("pdf-split");
  });

  it("« filigrane confidentiel » trouve le filigrane", () => {
    expect(first("filigrane confidentiel")).toBe("pdf-watermark");
  });

  it("« numéroter les pages » trouve la numérotation", () => {
    expect(first("numéroter les pages")).toBe("pdf-page-numbers");
  });

  it("distingue protéger et déverrouiller", () => {
    expect(first("enlever le mot de passe d'un pdf")).toBe("pdf-unlock");
  });

  it("classe les outils disponibles avant ceux encore prévus", () => {
    const results = searchTools("pdf", { limit: 5 });
    expect(results[0].tool.status).toBe("available");
  });
});
