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

  it("trouve « Modifier le texte d'un PDF » par ses formulations", () => {
    expect(ids("modifier texte pdf")).toContain("pdf-edit-text");
    expect(ids("changer texte pdf")).toContain("pdf-edit-text");
    expect(ids("corriger texte dans pdf")).toContain("pdf-edit-text");
  });

  it("mène aux outils de parole par des formulations naturelles", () => {
    expect(ids("lire un texte à voix haute")[0]).toBe("text-to-speech");
    expect(ids("faire un mp3 avec mon texte")).toContain("text-to-speech");
    expect(ids("écouter un pdf")[0]).toBe("pdf-to-audio");
    expect(ids("transcrire mp3")[0]).toBe("audio-transcribe");
    expect(ids("faire des sous titres")).toContain("audio-generate-srt");
    expect(ids("txt en audio")).toContain("text-file-to-audio");
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

  it("classe d'abord l'outil dont le nom porte le terme cherché", () => {
    const results = searchTools("pdf", { limit: 5 });
    expect(results[0].tool.category === "pdf" || results[0].tool.alsoIn?.includes("pdf")).toBe(true);
  });
});

describe("recherche de l'outil de récupération de mot de passe", () => {
  it("« mot de passe oublié » trouve la récupération", () => {
    expect(searchTools("mot de passe oublié pdf")[0].tool.id).toBe("pdf-recover-password");
  });

  it("« retrouver le mot de passe d'un pdf » aussi", () => {
    expect(searchTools("retrouver le mot de passe d'un pdf").map((r) => r.tool.id)).toContain(
      "pdf-recover-password",
    );
  });

  it("distingue récupération et déverrouillage à mot de passe connu", () => {
    expect(searchTools("j'ai perdu le mot de passe de mon pdf")[0].tool.id).toBe(
      "pdf-recover-password",
    );
  });
});

/**
 * Recherche des outils Texte, Fichiers et du convertisseur universel.
 *
 * Ces requêtes sont formulées comme un utilisateur les taperait : c'est le
 * seul test qui compte pour un moteur de recherche « en langage courant ».
 */
describe("recherche des outils Texte et Fichiers", () => {
  const found = (query: string) => searchTools(query).map((result) => result.tool.id);

  it.each([
    ["supprimer les doublons", "text-deduplicate"],
    ["lignes en double", "text-deduplicate"],
    ["comparer deux textes", "text-compare"],
    ["voir les différences entre deux versions", "text-compare"],
    ["nettoyer un texte", "text-clean"],
    ["trier des lignes", "text-sort-lines"],
    ["chercher et remplacer", "text-find-replace"],
    ["markdown en html", "markdown-convert"],
    ["encoder une url", "url-encode"],
    ["faux texte", "lorem-ipsum"],
    ["normaliser unicode", "text-unicode-normalize"],
    ["convertir crlf en lf", "text-line-endings"],
    ["extraire le texte d'un word", "docx-extract"],
    ["créer un zip", "archive-create"],
    ["décompresser une archive", "archive-extract"],
    ["dézipper", "archive-extract"],
    ["calculer sha256", "file-hash"],
    ["fichiers en double", "file-find-duplicates"],
    ["diviser un gros fichier", "file-split"],
    ["réassembler un fichier", "file-join"],
    ["renommer 100 fichiers", "file-bulk-rename"],
    ["taille d'un dossier", "folder-size"],
    ["arborescence d'un dossier", "folder-tree"],
    ["informations sur un fichier", "file-info"],
    ["convertir n'importe quel fichier", "universal-converter"],
  ])("« %s » trouve %s", (query, expected) => {
    expect(found(query)).toContain(expected);
  });

  it("place le bon outil en tête pour les requêtes les plus nettes", () => {
    expect(searchTools("supprimer les doublons")[0].tool.id).toBe("text-deduplicate");
    expect(searchTools("comparer deux textes")[0].tool.id).toBe("text-compare");
    expect(searchTools("calculer sha256")[0].tool.id).toBe("file-hash");
    expect(searchTools("arborescence d'un dossier")[0].tool.id).toBe("folder-tree");
  });

  it("distingue les doublons de lignes des doublons de fichiers", () => {
    expect(searchTools("lignes en double")[0].tool.id).toBe("text-deduplicate");
    expect(searchTools("fichiers en double")[0].tool.id).toBe("file-find-duplicates");
  });
});

/**
 * Intelligence documentaire (phase 8).
 *
 * Ces requêtes sont celles avec lesquelles on cherche réellement ces outils :
 * on ne vérifie pas qu'ils sont « trouvables », mais qu'ils arrivent **en
 * tête**. Un outil de niche noyé sous des résultats voisins n'existe pas pour
 * l'utilisateur.
 */
describe("recherche des outils documentaires", () => {
  it.each([
    ["pdf recherchable", "pdf-searchable"],
    ["ocr pdf", "pdf-searchable"],
    ["scanner pdf", "pdf-searchable"],
    ["rendre un pdf recherchable", "pdf-searchable"],
    ["corriger perspective", "document-perspective"],
    ["redresser document", "document-perspective"],
    ["photo de document en biais", "document-perspective"],
    ["nettoyer scan", "scan-clean"],
    ["extraire tableau pdf", "pdf-extract-tables"],
    ["pdf excel", "pdf-extract-tables"],
    ["comparer documents", "document-compare"],
    ["encodage texte", "text-encoding-detect"],
    ["utf16 utf8", "text-encoding-convert"],
    ["latin1 utf8", "text-encoding-convert"],
    ["scans en pdf", "scans-to-pdf"],
  ])("« %s » place %s en tête", (query, expected) => {
    expect(searchTools(query)[0]?.tool.id).toBe(expected);
  });

  it("distingue détection et conversion d'encodage", () => {
    expect(searchTools("detecter l'encodage d'un fichier")[0].tool.id).toBe("text-encoding-detect");
    expect(searchTools("convertir l'encodage en utf8")[0].tool.id).toBe("text-encoding-convert");
  });

  it("distingue la comparaison de documents de celle de textes collés", () => {
    expect(searchTools("comparer deux documents")[0].tool.id).toBe("document-compare");
    expect(searchTools("comparer deux textes")[0].tool.id).toBe("text-compare");
  });

  it("distingue le redressement d'un scan de la correction de perspective", () => {
    // Deux problèmes différents : une page à plat mais penchée, et une photo
    // prise en biais. Les confondre est le piège de cette famille d'outils.
    expect(searchTools("scan penche")[0].tool.id).toBe("scan-clean");
    expect(searchTools("feuille photographiee en biais")[0].tool.id).toBe("document-perspective");
  });
});
