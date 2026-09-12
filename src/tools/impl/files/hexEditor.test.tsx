import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type * as RouterModule from "react-router-dom";
import type * as NativeModule from "@/core/files/native";
import { HexEditorTool } from "./HexEditorTool";
import { toolRegistry } from "@/core/tools/registry";
import { clearHandoff, setHandoff } from "@/features/handoff/store";

/**
 * Trois défauts avaient été relevés à la main sur l'éditeur hexadécimal : une
 * recherche qui semblait limitée à la fenêtre affichée, un surlignage réduit au
 * premier octet de la séquence, et un éditeur d'octet trop loin pour être vu.
 * Ces tests verrouillent les trois corrections.
 */
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof RouterModule>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});

/** Fichier d'essai : deux occurrences de DE AD BE EF, loin l'une de l'autre. */
const FILE_SIZE = 4096;
const FIRST = 0x108;
const SECOND = 0x0a04; // dans une autre fenêtre de 512 octets
const PATTERN = [0xde, 0xad, 0xbe, 0xef];

function bytesAt(offset: number, length: number): number[] {
  const window: number[] = [];
  for (let index = 0; index < length && offset + index < FILE_SIZE; index += 1) {
    const absolute = offset + index;
    const inFirst = absolute >= FIRST && absolute < FIRST + 4;
    const inSecond = absolute >= SECOND && absolute < SECOND + 4;
    if (inFirst) window.push(PATTERN[absolute - FIRST]);
    else if (inSecond) window.push(PATTERN[absolute - SECOND]);
    else window.push(absolute % 251);
  }
  return window;
}

const readHex = vi.fn();
const findAllHex = vi.fn();

vi.mock("@/core/files/native", async () => {
  const actual = await vi.importActual<typeof NativeModule>("@/core/files/native");
  return {
    ...actual,
    isFilesEngineAvailable: () => true,
    readHex: (path: string, offset: number, length: number) => readHex(path, offset, length),
    findAllHex: (path: string, pattern: number[], limit: number) =>
      findAllHex(path, pattern, limit),
  };
});

function renderEditor() {
  setHandoff({ toolId: "file-hex-edit", paths: ["/f/hex-pattern.bin"] });
  return render(
    <MemoryRouter>
      <HexEditorTool tool={toolRegistry.get("file-hex-edit")!} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  clearHandoff();
  readHex.mockReset();
  findAllHex.mockReset();
  readHex.mockImplementation(async (path: string, offset: number, length: number) => ({
    path,
    offset,
    fileSize: FILE_SIZE,
    bytes: bytesAt(offset, length),
  }));
  findAllHex.mockResolvedValue([FIRST, SECOND]);
});

async function search(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.type(screen.getByLabelText("Séquence recherchée"), value);
  await user.click(screen.getByRole("button", { name: /Chercher dans tout le fichier/i }));
}

describe("recherche hexadécimale", () => {
  it("porte sur tout le fichier, pas sur la fenêtre affichée", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByTestId("hex-view");

    await search(user, "DE AD BE EF");

    // Le moteur est appelé avec le fichier entier ; aucun décalage de fenêtre
    // n'entre dans la requête.
    await waitFor(() => expect(findAllHex).toHaveBeenCalled());
    expect(findAllHex).toHaveBeenCalledWith("/f/hex-pattern.bin", PATTERN, expect.any(Number));
  });

  it("annonce le rang et le total des occurrences", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByTestId("hex-view");

    await search(user, "DE AD BE EF");

    const banner = await screen.findByTestId("hex-occurrences");
    expect(banner).toHaveTextContent("Occurrence");
    expect(banner).toHaveTextContent("1");
    expect(banner).toHaveTextContent("2");
  });

  it("surligne les quatre octets de la séquence, pas seulement le premier", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByTestId("hex-view");

    await search(user, "DE AD BE EF");
    await screen.findByTestId("hex-occurrences");

    for (let index = 0; index < 4; index += 1) {
      const byte = await screen.findByTestId(`hex-byte-${FIRST + index}`);
      expect(byte, `octet ${index} de la séquence`).toHaveAttribute("data-matched", "true");
    }
    // L'octet qui précède la séquence, lui, ne l'est pas.
    expect(screen.getByTestId(`hex-byte-${FIRST - 1}`)).not.toHaveAttribute("data-matched");
  });

  it("charge la fenêtre qui contient l'occurrence suivante", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByTestId("hex-view");

    await search(user, "DE AD BE EF");
    await screen.findByTestId("hex-occurrences");

    readHex.mockClear();
    await user.click(screen.getByRole("button", { name: "Occurrence suivante" }));

    // La seconde occurrence est hors de la fenêtre affichée : elle doit être
    // chargée, et surlignée une fois là.
    await waitFor(() => expect(readHex).toHaveBeenCalled());
    const requested = readHex.mock.calls.at(-1)?.[1] as number;
    expect(requested).toBeLessThanOrEqual(SECOND);
    expect(requested + 512).toBeGreaterThan(SECOND);
    expect(await screen.findByTestId(`hex-byte-${SECOND}`)).toHaveAttribute("data-matched", "true");
  });

  it("cherche du texte tel quel en mode Texte", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByTestId("hex-view");

    await user.click(screen.getByRole("radio", { name: "Texte" }));
    await search(user, "DEAD");

    // « DEAD » en mode Texte, ce sont quatre caractères — pas deux octets.
    expect(findAllHex).toHaveBeenCalledWith(
      "/f/hex-pattern.bin",
      [0x44, 0x45, 0x41, 0x44],
      expect.any(Number),
    );
    expect(screen.getByText(/sera cherché comme une suite de caractères/i)).toBeInTheDocument();
  });
});

describe("édition d'un octet", () => {
  it("invite à cliquer, puis ouvre l'éditeur au-dessus de la table", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByTestId("hex-view");

    expect(screen.getByText(/Cliquez sur un octet pour le modifier/i)).toBeInTheDocument();
    expect(screen.queryByTestId("hex-byte-editor")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("hex-byte-16"));

    const editor = await screen.findByTestId("hex-byte-editor");
    expect(editor).toBeInTheDocument();
    // L'éditeur précède la table dans le document : il tombe sous les yeux.
    const view = screen.getByTestId("hex-view");
    expect(editor.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByLabelText("Valeur décimale de l'octet")).toHaveValue("16");
  });

  it("signale une modification et sait la rétablir", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByTestId("hex-view");

    await user.click(screen.getByTestId("hex-byte-16"));
    const field = screen.getByLabelText("Valeur hexadécimale de l'octet");
    await user.clear(field);
    await user.type(field, "FF");

    expect(await screen.findByText(/1 octet\(s\) modifié\(s\)/i)).toBeInTheDocument();
    expect(screen.getByText(/valeur d'origine 10/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rétablir" }));
    await waitFor(() =>
      expect(screen.queryByText(/1 octet\(s\) modifié\(s\)/i)).not.toBeInTheDocument(),
    );
  });
});
