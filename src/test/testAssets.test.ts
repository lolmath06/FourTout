// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Le générateur de fixtures est du code comme un autre : s'il produit des
 * fichiers invalides, les essais manuels des prochaines phases partiront sur de
 * mauvaises bases. On l'exécute donc réellement, dans un dossier temporaire.
 */
describe("générateur de test-assets", () => {
  const outDir = join(process.cwd(), "test-assets", "generated");

  beforeAll(() => {
    // Régénère réellement les fixtures avant de les inspecter.
    execFileSync(process.execPath, [join(process.cwd(), "scripts/generate-test-assets.mjs")], {
      stdio: "ignore",
    });
  });

  const read = (name: string) => readFileSync(join(outDir, name));

  it("produit toutes les fixtures attendues", () => {
    const files = readdirSync(outDir);
    for (const name of [
      "sample.txt",
      "sample.json",
      "sample.csv",
      "sample.png",
      "sample.jpg",
      "sample.pdf",
      "corrupted.pdf",
    ]) {
      expect(files, `fixture manquante : ${name}`).toContain(name);
    }
  });

  it("produit un PNG valide de 32×32", () => {
    const png = read("sample.png");
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(png.readUInt32BE(16)).toBe(32);
    expect(png.readUInt32BE(20)).toBe(32);
  });

  it("produit un JPEG structurellement valide", () => {
    const jpeg = read("sample.jpg");
    expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(jpeg.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  });

  it("produit un PDF d'une page avec une table xref cohérente", () => {
    const pdf = read("sample.pdf").toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf).toContain("/Type /Page");

    const startxref = Number(pdf.match(/startxref\n(\d+)/)?.[1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe("xref");
  });

  it("produit un JSON et un CSV exploitables", () => {
    expect(JSON.parse(read("sample.json").toString("utf8")).name).toBe("FourTout");
    expect(read("sample.csv").toString("utf8").split("\n")[0]).toBe("id,nom,categorie,taille_ko");
  });

  it("fournit un fichier volontairement corrompu", () => {
    const corrupted = read("corrupted.pdf").toString("latin1");
    expect(corrupted.startsWith("%PDF")).toBe(true);
    expect(corrupted).not.toContain("%%EOF");
  });

  it("garde les fixtures légères", () => {
    // Aucune fixture n'est versionnée (`test-assets/generated/` est ignoré par
    // Git) : la contrainte porte sur le temps de génération et l'espace disque.
    // `pdf-large-images.pdf` est volontairement lourd — c'est ce qui permet de
    // mesurer un vrai gain de compression.
    // `pdf-large-images.pdf` et `video-large.mp4` sont volontairement lourds —
    // c'est ce qui permet de mesurer un vrai gain de compression. Les autres
    // vidéos et l'audio de remplacement dépassent la limite d'un simple document
    // sans être pour autant démesurés.
    // `large-split.bin` doit peser assez pour produire cinq morceaux de 500 Ko :
    // c'est tout l'intérêt de la fixture de découpage.
    const DELIBERATELY_HEAVY = new Set([
      "pdf-large-images.pdf",
      "video-large.mp4",
      "large-split.bin",
    ]);
    const MEDIA = /\.(mp4|mkv|webm|mov|wav|mp3|gif)$/i;

    // Depuis la phase 6, les fixtures comportent aussi des dossiers
    // (archives à comprimer, doublons, arborescence) : on ne pèse que les
    // fichiers, chacun devant rester léger.
    for (const entry of readdirSync(outDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      const limit = DELIBERATELY_HEAVY.has(name)
        ? 8 * 1024 * 1024
        : MEDIA.test(name)
          ? 2 * 1024 * 1024
          : 512 * 1024;
      expect(read(name).length, `${name} est trop volumineux`).toBeLessThan(limit);
    }
  });
});
