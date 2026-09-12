import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { toolRegistry } from "@/core/tools/registry";
import { constraintsForTool, validateSelection } from "@/core/files";
import { SubtitleEditTool } from "./text/SubtitleEditTool";

/**
 * Ce que l'interface de la phase 10 doit garantir, éprouvé sur les vraies
 * fixtures.
 *
 * Les outils média sont fermés hors Tauri : ils ne sont pas rendus ici. En
 * revanche l'éditeur de sous-titres est entièrement en TypeScript, donc
 * exerçable tel quel — et c'est justement lui dont le comportement est le plus
 * facile à casser en silence.
 */
const DIR = join(process.cwd(), "test-assets", "generated");

function fixtureFile(name: string, type = "text/plain"): File {
  const bytes = new Uint8Array(readFileSync(join(DIR, name)));
  const file = new File([bytes], name, { type });
  // jsdom n'implémente pas `Blob.arrayBuffer` : sans ce complément, tout outil
  // qui lit réellement les octets d'un dépôt échoue ici pour une raison qui
  // n'a rien à voir avec son comportement.
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => bytes.buffer.slice(0) as ArrayBuffer,
  });
  return file;
}

const renderTool = (id: string, Component: (props: { tool: never }) => React.ReactNode) => {
  const tool = toolRegistry.get(id)!;
  return render(
    <MemoryRouter>
      <Component tool={tool as never} />
    </MemoryRouter>,
  );
};

describe("éditeur de sous-titres", () => {
  it("lit un SRT déposé et annonce ce qu'il contient", async () => {
    const user = userEvent.setup();
    renderTool("subtitle-edit", SubtitleEditTool);

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, fixtureFile("subtitle-sample.srt"));

    await waitFor(() =>
      expect(screen.getByText(/subtitle-sample\.srt — SRT, 3 répliques/)).toBeInTheDocument(),
    );
    // Le tableau d'aperçu montre les horodatages réels, pas des approximations.
    expect(screen.getByText("00:00:01.000")).toBeInTheDocument();
    expect(screen.getByText("00:00:12.000")).toBeInTheDocument();
    expect(screen.getByText(/Première réplique, accentuée\./)).toBeInTheDocument();
  });

  it("signale les anomalies d'un fichier abîmé sans les corriger d'office", async () => {
    const user = userEvent.setup();
    renderTool("subtitle-edit", SubtitleEditTool);

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, fixtureFile("subtitle-broken.srt"));

    await waitFor(() =>
      expect(screen.getByText(/Anomalies relevées à la lecture/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/La fin précède le début/)).toBeInTheDocument();
    expect(screen.getByText(/Réplique sans texte/)).toBeInTheDocument();
  });

  it("annonce l'encodage quand le fichier ne vient pas d'UTF-8", async () => {
    const user = userEvent.setup();
    renderTool("subtitle-edit", SubtitleEditTool);

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, fixtureFile("subtitle-windows.srt"));

    await waitFor(() => expect(screen.getByText(/réécrit en UTF-8/)).toBeInTheDocument());
    expect(screen.getByText(/Réplique accentuée à l'ancienne\./)).toBeInTheDocument();
  });
});

describe("acceptation des fichiers des nouveaux outils", () => {
  it("l'éditeur de sous-titres accepte .srt et .vtt, et refuse le reste", () => {
    const tool = toolRegistry.get("subtitle-edit")!;
    const { accepted, rejected } = validateSelection(
      [
        fixtureFile("subtitle-sample.srt"),
        fixtureFile("subtitle-sample.vtt", "text/vtt"),
        new File(["x"], "photo.png", { type: "image/png" }),
      ],
      { ...constraintsForTool(tool), maxFiles: undefined },
    );
    expect(accepted.map((file) => file.extension)).toEqual(["srt", "vtt"]);
    expect(rejected).toHaveLength(1);
  });

  it("la comparaison d'images accepte bien deux images", () => {
    const tool = toolRegistry.get("image-compare")!;
    const { accepted, rejected } = validateSelection(
      [fixtureFile("image-reference.png", "image/png"), fixtureFile("image-identical.png", "image/png")],
      { ...constraintsForTool(tool), maxFiles: 2 },
    );
    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(0);
  });

  it("l'inspecteur média accepte aussi bien l'audio que la vidéo", () => {
    const tool = toolRegistry.get("media-info")!;
    const { accepted } = validateSelection(
      [fixtureFile("audio-mono.wav", "audio/wav")],
      constraintsForTool(tool),
    );
    expect(accepted).toHaveLength(1);
    expect(toolRegistry.acceptingExtension("mp4").map((entry) => entry.id)).toContain("media-info");
    expect(toolRegistry.acceptingExtension("mp3").map((entry) => entry.id)).toContain("media-info");
  });
});

describe("gardes de source", () => {
  const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf-8");

  it("la pipette convertit les coordonnées au lieu de lire l'aperçu réduit", () => {
    const source = read("src/tools/impl/image/ColorInspectTool.tsx");
    // Le piège classique : échantillonner `source.preview`, redimensionné à
    // 1200 px, donne une couleur qui n'est celle d'aucun pixel du fichier.
    expect(source).toContain("imageCoordinates");
    expect(source).toContain("source.full?.getPixels()");
    expect(source).not.toContain("source.preview?.getPixels()");
  });

  it("la comparaison n'aligne jamais deux images sans choix explicite", () => {
    const source = read("src/tools/impl/image/ImageCompareTool.tsx");
    expect(source).toContain("needsChoice");
    expect(source).toContain("disabled={needsChoice");
  });
});
