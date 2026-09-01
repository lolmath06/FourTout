// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import {
  extractPages,
  mergePdfs,
  removePages,
  reorderPages,
  rotatePages,
  splitPdf,
  normalizeAngle,
} from "./pages";
import { imagesToPdf, fitInside, detectImageFormat, PAGE_SIZES } from "./imagesToPdf";
import { addPageNumbers, addWatermark, formatPageNumber } from "./annotate";
import { readMetadata, writeMetadata, splitKeywords } from "./metadata";
import { protectPdf, unlockPdf } from "./protect";
import { extractText, joinPages, textToFile } from "./extractText";
import { pdfToImages, renderThumbnail } from "./toImages";
import { PdfError } from "../errors";
import { inspectPdf, looksLikePdf } from "../document";
import { openWithPdfJs } from "../pdfjs";
import { setRasterBackend } from "../raster/types";
import { nodeRasterBackend, configurePdfJsForNode } from "@/test/nodeRaster";
import {
  buildPdf,
  buildPng,
  buildSource,
  pageCountOf,
  readPageLabels,
} from "@/test/pdfFixtures";

beforeAll(() => {
  configurePdfJsForNode();
  setRasterBackend(nodeRasterBackend);
});

describe("fusion", () => {
  it("additionne les pages dans l'ordre fourni", async () => {
    const a = await buildSource("un.pdf", { pageCount: 1, labels: ["ALPHA"] });
    const b = await buildSource("deux.pdf", { pageCount: 3 });

    const merged = await mergePdfs([a, b]);

    expect(await pageCountOf(merged.bytes)).toBe(4);
    expect(await readPageLabels(merged.bytes)).toEqual(["ALPHA", "PAGE 1", "PAGE 2", "PAGE 3"]);
    expect(merged.name).toBe("un-fusionne.pdf");
  });

  it("respecte un ordre inversé", async () => {
    const a = await buildSource("un.pdf", { pageCount: 1, labels: ["ALPHA"] });
    const b = await buildSource("deux.pdf", { pageCount: 1, labels: ["BETA"] });

    const merged = await mergePdfs([b, a]);
    expect(await readPageLabels(merged.bytes)).toEqual(["BETA", "ALPHA"]);
  });

  it("refuse un seul fichier", async () => {
    const a = await buildSource("un.pdf");
    await expect(mergePdfs([a])).rejects.toMatchObject({ code: "not-enough-files" });
  });

  it("signale un fichier qui n'est pas un PDF", async () => {
    const a = await buildSource("un.pdf");
    const faux = { name: "faux.pdf", bytes: new TextEncoder().encode("ceci n'est pas un pdf") };
    await expect(mergePdfs([a, faux])).rejects.toMatchObject({ code: "not-a-pdf" });
  });

  it("signale un fichier vide", async () => {
    const a = await buildSource("un.pdf");
    await expect(
      mergePdfs([a, { name: "vide.pdf", bytes: new Uint8Array(0) }]),
    ).rejects.toMatchObject({ code: "corrupted" });
  });

  it("laisse les fichiers sources intacts", async () => {
    const a = await buildSource("un.pdf", { pageCount: 2 });
    const b = await buildSource("deux.pdf", { pageCount: 2 });
    const copyA = a.bytes.slice();

    await mergePdfs([a, b]);
    expect(a.bytes).toEqual(copyA);
  });
});

describe("découpage", () => {
  it("produit un fichier par page", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 3 });
    const outputs = await splitPdf(source, { mode: "each-page" });

    expect(outputs).toHaveLength(3);
    for (const [index, output] of outputs.entries()) {
      expect(await pageCountOf(output.bytes)).toBe(1);
      expect(await readPageLabels(output.bytes)).toEqual([`PAGE ${index + 1}`]);
    }
    expect(outputs.map((o) => o.name)).toEqual([
      "doc-page-01.pdf",
      "doc-page-02.pdf",
      "doc-page-03.pdf",
    ]);
  });

  it("produit un fichier par groupe de pages", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 6 });
    const outputs = await splitPdf(source, {
      mode: "groups",
      groups: [
        [1, 2, 3],
        [4, 5],
        [6],
      ],
    });

    expect(outputs.map((o) => o.name)).toEqual([
      "doc-pages-1-3.pdf",
      "doc-pages-4-5.pdf",
      "doc-pages-6.pdf",
    ]);
    expect(await Promise.all(outputs.map((o) => pageCountOf(o.bytes)))).toEqual([3, 2, 1]);
    expect(await readPageLabels(outputs[1].bytes)).toEqual(["PAGE 4", "PAGE 5"]);
  });
});

describe("extraction de pages", () => {
  it("garde uniquement les pages demandées", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 5 });
    const output = await extractPages(source, [1, 3]);

    expect(await pageCountOf(output.bytes)).toBe(2);
    expect(await readPageLabels(output.bytes)).toEqual(["PAGE 1", "PAGE 3"]);
  });

  it("respecte l'ordre demandé", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 5 });
    const output = await extractPages(source, [4, 2]);
    expect(await readPageLabels(output.bytes)).toEqual(["PAGE 4", "PAGE 2"]);
  });

  it("refuse une page inexistante", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 3 });
    await expect(extractPages(source, [5])).rejects.toMatchObject({
      code: "page-out-of-range",
    });
  });
});

describe("suppression de pages", () => {
  it("retire les pages et conserve l'ordre", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 10 });
    const output = await removePages(source, [2, 5, 6, 7]);

    expect(await pageCountOf(output.bytes)).toBe(6);
    expect(await readPageLabels(output.bytes)).toEqual([
      "PAGE 1",
      "PAGE 3",
      "PAGE 4",
      "PAGE 8",
      "PAGE 9",
      "PAGE 10",
    ]);
  });

  it("refuse de vider entièrement le document", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 3 });
    await expect(removePages(source, [1, 2, 3])).rejects.toMatchObject({
      code: "would-remove-all-pages",
    });
  });
});

describe("réorganisation", () => {
  it("écrit réellement le nouvel ordre", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 4 });
    const output = await reorderPages(source, [4, 1, 3, 2]);

    expect(await readPageLabels(output.bytes)).toEqual([
      "PAGE 4",
      "PAGE 1",
      "PAGE 3",
      "PAGE 2",
    ]);
  });

  it("refuse un ordre incomplet ou avec doublon", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 4 });
    await expect(reorderPages(source, [1, 2, 3])).rejects.toMatchObject({
      code: "invalid-range",
    });
    await expect(reorderPages(source, [1, 1, 3, 4])).rejects.toMatchObject({
      code: "invalid-range",
    });
  });
});

describe("rotation", () => {
  it("écrit la rotation dans le document", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 3 });
    const output = await rotatePages(source, { angle: 90 });

    const document = await PDFDocument.load(output.bytes);
    expect(document.getPages().map((page) => page.getRotation().angle)).toEqual([90, 90, 90]);
  });

  it("ne fait pivoter que les pages choisies", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 3 });
    const output = await rotatePages(source, { angle: 180, pages: [2] });

    const document = await PDFDocument.load(output.bytes);
    expect(document.getPages().map((page) => page.getRotation().angle)).toEqual([0, 180, 0]);
  });

  it("cumule avec la rotation déjà présente", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 1 });
    const once = await rotatePages(source, { angle: 90 });
    const twice = await rotatePages({ name: "doc.pdf", bytes: once.bytes }, { angle: 270 });

    const document = await PDFDocument.load(twice.bytes);
    expect(document.getPage(0).getRotation().angle).toBe(0);
  });

  it("normalise les angles", () => {
    expect(normalizeAngle(450)).toBe(90);
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(360)).toBe(0);
  });
});

describe("images vers PDF", () => {
  it("crée une page par image", async () => {
    const images = [
      { name: "rouge.png", bytes: await buildPng(40, 30, [255, 0, 0]) },
      { name: "vert.png", bytes: await buildPng(40, 30, [0, 255, 0]) },
    ];
    const output = await imagesToPdf(images, { mode: "fit-image" });

    expect(await pageCountOf(output.bytes)).toBe(2);
    const document = await PDFDocument.load(output.bytes);
    expect(document.getPage(0).getSize()).toEqual({ width: 40, height: 30 });
  });

  it("place l'image sur une page A4 sans la déformer", async () => {
    const images = [{ name: "large.png", bytes: await buildPng(200, 100, [10, 20, 30]) }];
    const output = await imagesToPdf(images, { mode: "a4-portrait" });

    const document = await PDFDocument.load(output.bytes);
    const size = document.getPage(0).getSize();
    expect(size.width).toBeCloseTo(PAGE_SIZES.a4Portrait.width, 1);
    expect(size.height).toBeCloseTo(PAGE_SIZES.a4Portrait.height, 1);
  });

  it("conserve le ratio", () => {
    expect(fitInside({ width: 200, height: 100 }, { width: 50, height: 50 })).toEqual({
      width: 50,
      height: 25,
    });
    expect(fitInside({ width: 100, height: 400 }, { width: 100, height: 100 })).toEqual({
      width: 25,
      height: 100,
    });
  });

  it("reconnaît le format réel d'une image", async () => {
    expect(detectImageFormat(await buildPng(4, 4, [0, 0, 0]))).toBe("png");
    expect(detectImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(detectImageFormat(new TextEncoder().encode("GIF89a"))).toBe("other");
  });

  it("refuse une liste vide", async () => {
    await expect(imagesToPdf([], { mode: "fit-image" })).rejects.toBeInstanceOf(PdfError);
  });
});

describe("filigrane", () => {
  it("ajoute le texte sur toutes les pages", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 2 });
    const output = await addWatermark(source, {
      text: "CONFIDENTIEL",
      fontSize: 30,
      opacity: 0.3,
      placement: "diagonal",
    });

    const labels = await readPageLabels(output.bytes);
    expect(labels[0]).toContain("CONFIDENTIEL");
    expect(labels[1]).toContain("CONFIDENTIEL");
    expect(labels[0]).toContain("PAGE 1");
  });

  it("n'ajoute le texte qu'aux pages choisies", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 3 });
    const output = await addWatermark(source, {
      text: "BROUILLON",
      fontSize: 24,
      opacity: 0.4,
      placement: "center",
      pages: [2],
    });

    const labels = await readPageLabels(output.bytes);
    expect(labels[0]).not.toContain("BROUILLON");
    expect(labels[1]).toContain("BROUILLON");
    expect(labels[2]).not.toContain("BROUILLON");
  });

  it("refuse un texte vide", async () => {
    const source = await buildSource("doc.pdf");
    await expect(
      addWatermark(source, { text: "  ", fontSize: 20, opacity: 0.5, placement: "center" }),
    ).rejects.toBeInstanceOf(PdfError);
  });
});

describe("numérotation", () => {
  it("écrit un numéro sur chaque page", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 3 });
    const output = await addPageNumbers(source, {
      startAt: 1,
      position: "bottom-center",
      format: "plain",
    });

    const labels = await readPageLabels(output.bytes);
    expect(labels[0]).toContain("1");
    expect(labels[2]).toContain("3");
  });

  it("respecte le numéro de départ et le format", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 2 });
    const output = await addPageNumbers(source, {
      startAt: 5,
      position: "bottom-right",
      format: "page-n",
    });

    const labels = await readPageLabels(output.bytes);
    expect(labels[0]).toContain("Page 5");
    expect(labels[1]).toContain("Page 6");
  });

  it("compose les libellés attendus", () => {
    expect(formatPageNumber(3, 12, "plain")).toBe("3");
    expect(formatPageNumber(3, 12, "page-n")).toBe("Page 3");
    expect(formatPageNumber(3, 12, "n-of-total")).toBe("3 / 12");
  });
});

describe("métadonnées", () => {
  it("relit ce qui a été écrit", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 1 });
    const output = await writeMetadata(source, {
      title: "Rapport annuel",
      author: "Service qualité",
      subject: "Bilan 2026",
      keywords: "rapport, bilan",
    });

    const metadata = await readMetadata({ name: "out.pdf", bytes: output.bytes });
    expect(metadata.title).toBe("Rapport annuel");
    expect(metadata.author).toBe("Service qualité");
    expect(metadata.subject).toBe("Bilan 2026");
    expect(metadata.keywords).toBe("rapport, bilan");
    expect(metadata.modificationDate).toBeInstanceOf(Date);
  });

  it("ne touche pas aux champs non fournis", async () => {
    const source = await buildSource("doc.pdf", { title: "Titre initial", author: "Auteur initial" });
    const output = await writeMetadata(source, { title: "Nouveau titre" });

    const metadata = await readMetadata({ name: "out.pdf", bytes: output.bytes });
    expect(metadata.title).toBe("Nouveau titre");
    expect(metadata.author).toBe("Auteur initial");
  });

  it("permet d'effacer un champ avec une chaîne vide", async () => {
    const source = await buildSource("doc.pdf", { author: "À retirer" });
    const output = await writeMetadata(source, { author: "" });

    const metadata = await readMetadata({ name: "out.pdf", bytes: output.bytes });
    expect(metadata.author).toBeUndefined();
  });

  it("découpe les mots-clés", () => {
    expect(splitKeywords("un, deux ;trois ")).toEqual(["un", "deux", "trois"]);
    expect(splitKeywords("  ")).toEqual([]);
  });
});

describe("protection par mot de passe", () => {
  it("produit un document réellement chiffré", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 2 });
    const output = await protectPdf(source, { userPassword: "fourtout" });

    const info = await inspectPdf({ name: "protege.pdf", bytes: output.bytes });
    expect(info.encrypted).toBe(true);
    expect(output.name).toBe("doc-protege.pdf");
  });

  it("est lisible par pdf.js, implémentation indépendante", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 1, labels: ["SECRET"] });
    const output = await protectPdf(source, { userPassword: "fourtout" });

    const document = await openWithPdfJs(
      { name: "protege.pdf", bytes: output.bytes },
      { password: "fourtout" },
    );
    const content = await (await document.getPage(1)).getTextContent();
    expect(content.items.map((i) => ("str" in i ? i.str : "")).join("")).toBe("SECRET");
    await document.loadingTask?.destroy();
  });

  it("refuse l'ouverture sans mot de passe", async () => {
    const source = await buildSource("doc.pdf");
    const output = await protectPdf(source, { userPassword: "fourtout" });

    await expect(
      openWithPdfJs({ name: "p.pdf", bytes: output.bytes }),
    ).rejects.toMatchObject({ code: "encrypted" });
  });

  it("signale un mot de passe incorrect", async () => {
    const source = await buildSource("doc.pdf");
    const output = await protectPdf(source, { userPassword: "fourtout" });

    await expect(
      unlockPdf({ name: "p.pdf", bytes: output.bytes }, "mauvais"),
    ).rejects.toMatchObject({ code: "wrong-password" });
  });

  it("refuse un mot de passe vide", async () => {
    const source = await buildSource("doc.pdf");
    await expect(protectPdf(source, { userPassword: "" })).rejects.toBeInstanceOf(PdfError);
  });
});

describe("déverrouillage", () => {
  it("produit une copie ouvrable sans mot de passe", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 3 });
    const protectedPdf = await protectPdf(source, { userPassword: "fourtout" });

    const unlocked = await unlockPdf(
      { name: "doc-protege.pdf", bytes: protectedPdf.bytes },
      "fourtout",
    );

    const info = await inspectPdf({ name: "u.pdf", bytes: unlocked.bytes });
    expect(info.encrypted).toBe(false);
    expect(info.pageCount).toBe(3);
    expect(await readPageLabels(unlocked.bytes)).toEqual(["PAGE 1", "PAGE 2", "PAGE 3"]);
  });

  it("refuse un document qui n'est pas protégé", async () => {
    const source = await buildSource("doc.pdf");
    await expect(unlockPdf(source, "fourtout")).rejects.toMatchObject({
      code: "invalid-range",
    });
  });
});

describe("extraction de texte", () => {
  it("récupère le texte page par page", async () => {
    const source = await buildSource("doc.pdf", {
      pageCount: 2,
      labels: ["Bonjour le monde", "Deuxieme page"],
    });

    const extracted = await extractText(source);
    expect(extracted.pages).toHaveLength(2);
    expect(extracted.pages[0].text).toBe("Bonjour le monde");
    expect(extracted.pages[1].text).toBe("Deuxieme page");
    expect(extracted.emptyPages).toBe(0);
    expect(extracted.totalCharacters).toBeGreaterThan(20);
  });

  it("signale les pages sans texte plutôt que d'échouer", async () => {
    const document = await PDFDocument.create();
    document.addPage([200, 200]);
    const bytes = await document.save();

    const extracted = await extractText({ name: "vide.pdf", bytes });
    expect(extracted.emptyPages).toBe(1);
    expect(extracted.pages[0].text).toBe("");
  });

  it("produit un fichier texte lisible", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 1, labels: ["Contenu"] });
    const extracted = await extractText(source);
    const file = textToFile(source, extracted);

    expect(file.name).toBe("doc-texte.txt");
    expect(new TextDecoder().decode(file.bytes)).toContain("--- Page 1 ---");
    expect(joinPages(extracted)).toContain("Contenu");
  });
});

describe("PDF vers images", () => {
  it("rend une image par page", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 2, size: [200, 100] });
    const outputs = await pdfToImages(source, { format: "png", dpi: 72 });

    expect(outputs).toHaveLength(2);
    expect(outputs[0].name).toBe("doc-page-01.png");
    expect(outputs[0].mimeType).toBe("image/png");
    expect(outputs[0].bytes.subarray(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  it("applique la résolution demandée", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 1, size: [72, 72] });

    const low = await pdfToImages(source, { format: "png", dpi: 72 });
    const high = await pdfToImages(source, { format: "png", dpi: 216 });
    expect(high[0].bytes.length).toBeGreaterThan(low[0].bytes.length);
  });

  it("produit du JPEG sur demande", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 1 });
    const outputs = await pdfToImages(source, { format: "jpeg", dpi: 96, quality: 0.7 });

    expect(outputs[0].name).toBe("doc-page-01.jpg");
    expect(outputs[0].bytes.subarray(0, 3)).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
  });

  it("ne convertit que les pages demandées", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 4 });
    const outputs = await pdfToImages(source, { format: "png", dpi: 72, pages: [2, 4] });

    expect(outputs.map((o) => o.name)).toEqual(["doc-page-02.png", "doc-page-04.png"]);
  });

  it("produit une miniature", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 1 });
    const thumbnail = await renderThumbnail(source, 1, 80);
    expect(thumbnail?.subarray(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });
});

describe("validation des fichiers", () => {
  it("reconnaît un PDF par son contenu et non par son extension", async () => {
    expect(looksLikePdf(await buildPdf())).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("bonjour"))).toBe(false);
  });

  it("décrit un document lisible", async () => {
    const source = await buildSource("doc.pdf", { pageCount: 3, size: [200, 300] });
    const info = await inspectPdf(source);

    expect(info.pageCount).toBe(3);
    expect(info.encrypted).toBe(false);
    expect(info.firstPageSize).toEqual({ width: 200, height: 300 });
    expect(info.byteLength).toBe(source.bytes.length);
  });

  it("signale un PDF endommagé", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4\nceci est tronque");
    await expect(inspectPdf({ name: "casse.pdf", bytes })).rejects.toBeInstanceOf(PdfError);
  });
});
