import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { toolRegistry } from "@/core/tools/registry";
import { setRasterBackend } from "@/core/pdf/raster/types";
import { nodeRasterBackend } from "@/test/nodeRaster";
import { ImageCompareTool } from "./image/ImageCompareTool";
import { SubtitleEditTool } from "./text/SubtitleEditTool";

/**
 * Retirer un fichier déjà déposé ne doit jamais casser l'écran.
 *
 * Le défaut corrigé ici rendait l'application entièrement noire : un état
 * dérivé d'un fichier (canvas décodé, document analysé) est produit par un
 * effet, donc il survit **un rendu de plus** que le fichier dont il vient.
 * Pendant ce rendu, la condition d'affichage était encore vraie alors que
 * `files[1]` n'existait plus, et `files[1].name` levait une TypeError. Aucune
 * frontière d'erreur ne couvrant l'arbre, React démontait la racine : écran
 * noir, sans retour possible.
 *
 * Ces tests montent les vrais composants et cliquent réellement sur la croix.
 * Une simple vérification de source ne les aurait pas attrapés.
 */
const DIR = join(process.cwd(), "test-assets", "generated");

function fixtureFile(name: string, type: string): File {
  const bytes = new Uint8Array(readFileSync(join(DIR, name)));
  const file = new File([bytes], name, { type });
  // jsdom n'implémente pas `Blob.arrayBuffer`.
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => bytes.buffer.slice(0) as ArrayBuffer,
  });
  return file;
}

const renderTool = (id: string, Component: (props: { tool: never }) => React.ReactNode) =>
  render(
    <MemoryRouter>
      <Component tool={toolRegistry.get(id)! as never} />
    </MemoryRouter>,
  );

const fileInputs = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));

/** Bouton de retrait de la ligne qui porte ce nom de fichier. */
function removeButtonFor(name: string): HTMLElement {
  const entry = screen.getAllByText(name).find((node) => node.closest("li, [data-file-entry]"));
  const row = entry?.closest("li, [data-file-entry]") ?? entry?.parentElement;
  if (!row) throw new Error(`Ligne introuvable pour ${name}`);
  return within(row as HTMLElement).getByRole("button", { name: /retirer|supprimer|enlever/i });
}

/**
 * Une exception levée pendant le rendu passerait par `console.error` avant de
 * démonter la racine : on la transforme en échec de test explicite, sans quoi
 * l'écran noir se lirait ici comme un simple « élément introuvable ».
 */
function failOnRenderError() {
  const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
    const text = args.map(String).join(" ");
    if (/Cannot read propert|is not a function|The above error/.test(text)) {
      throw new Error(`Erreur de rendu pendant le retrait : ${text}`);
    }
  });
  return spy;
}

describe("retrait d'un fichier — comparaison d'images", () => {
  beforeAll(() => {
    setRasterBackend(nodeRasterBackend);
  });

  it("garde A quand on retire B, et oublie le résultat devenu caduc", async () => {
    const user = userEvent.setup();
    failOnRenderError();
    renderTool("image-compare", ImageCompareTool);

    const [inputA, inputB] = fileInputs();
    await user.upload(inputA, fixtureFile("image-reference.png", "image/png"));
    await user.upload(inputB, fixtureFile("image-heavy-change.png", "image/png"));

    await waitFor(() => expect(screen.getByRole("button", { name: /Comparer/ })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /Comparer/ }));
    await waitFor(() => expect(screen.getByText("Pixels différents")).toBeInTheDocument());

    await user.click(removeButtonFor("image-heavy-change.png"));

    // A survit, le constat disparaît, et l'écran redemande une image B.
    await waitFor(() => expect(screen.queryByText("Pixels différents")).not.toBeInTheDocument());
    expect(screen.getAllByText("image-reference.png").length).toBeGreaterThan(0);
    expect(screen.getByText(/Il manque la seconde image/)).toBeInTheDocument();
  });

  it("garde B quand on retire A", async () => {
    const user = userEvent.setup();
    failOnRenderError();
    renderTool("image-compare", ImageCompareTool);

    const [inputA, inputB] = fileInputs();
    await user.upload(inputA, fixtureFile("image-reference.png", "image/png"));
    await user.upload(inputB, fixtureFile("image-identical.png", "image/png"));

    await waitFor(() => expect(screen.getByRole("button", { name: /Comparer/ })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /Comparer/ }));
    await waitFor(() => expect(screen.getByText("Pixels différents")).toBeInTheDocument());

    await user.click(removeButtonFor("image-reference.png"));

    await waitFor(() => expect(screen.queryByText("Pixels différents")).not.toBeInTheDocument());
    expect(screen.getAllByText("image-identical.png").length).toBeGreaterThan(0);
  });

  it("accepte de remplacer B seul, sans toucher à A", async () => {
    const user = userEvent.setup();
    failOnRenderError();
    renderTool("image-compare", ImageCompareTool);

    const [inputA, inputB] = fileInputs();
    await user.upload(inputA, fixtureFile("image-reference.png", "image/png"));
    await user.upload(inputB, fixtureFile("image-identical.png", "image/png"));
    // Le nom paraît deux fois une fois l'image lue — dans la liste de
    // l'emplacement, et sous l'aperçu — d'où `getAllByText`.
    await waitFor(() => expect(screen.getAllByText("image-identical.png").length).toBeGreaterThan(0));

    await user.upload(fileInputs()[1], fixtureFile("image-heavy-change.png", "image/png"));

    await waitFor(() => expect(screen.getAllByText("image-heavy-change.png").length).toBeGreaterThan(0));
    expect(screen.getAllByText("image-reference.png").length).toBeGreaterThan(0);
    expect(screen.queryByText("image-identical.png")).not.toBeInTheDocument();
  });
});

describe("retrait d'un fichier — sous-titres", () => {
  it("revient à l'écran initial quand le dernier fichier est retiré", async () => {
    const user = userEvent.setup();
    failOnRenderError();
    renderTool("subtitle-edit", SubtitleEditTool);

    await user.upload(fileInputs()[0], fixtureFile("subtitle-sample.srt", "text/plain"));
    await waitFor(() => expect(screen.getByText(/SRT, 3 répliques/)).toBeInTheDocument());

    await user.click(removeButtonFor("subtitle-sample.srt"));

    await waitFor(() => expect(screen.queryByText(/SRT, 3 répliques/)).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Produire le fichier/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Anomalies relevées/)).not.toBeInTheDocument();
  });

  it("laisse le premier fichier utilisable quand on retire le second d'une fusion", async () => {
    const user = userEvent.setup();
    failOnRenderError();
    renderTool("subtitle-edit", SubtitleEditTool);

    await user.click(screen.getByRole("radio", { name: "Fusionner" }));
    await user.upload(fileInputs()[0], [
      fixtureFile("subtitle-sample.srt", "text/plain"),
      fixtureFile("subtitle-second.srt", "text/plain"),
    ]);
    await waitFor(() => expect(screen.getAllByText(/subtitle-second\.srt/).length).toBeGreaterThan(0));

    await user.click(removeButtonFor("subtitle-second.srt"));

    await waitFor(() => expect(screen.getByText(/Il manque le second fichier/)).toBeInTheDocument());
    expect(screen.getByText(/SRT, 3 répliques/)).toBeInTheDocument();
  });
});
