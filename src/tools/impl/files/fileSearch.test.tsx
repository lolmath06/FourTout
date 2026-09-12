import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type * as RouterModule from "react-router-dom";
import type * as NativeModule from "@/core/files/native";
import { FileSearchTool } from "./FileSearchTool";
import { toolRegistry } from "@/core/tools/registry";

/**
 * Deux ambiguïtés relevées à la main : des résultats qui restaient affichés
 * après modification des critères, et deux champs de date qui semblaient déjà
 * remplis alors qu'aucun filtre n'était actif.
 */
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof RouterModule>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});

const searchFiles = vi.fn();

vi.mock("@/core/files/native", async () => {
  const actual = await vi.importActual<typeof NativeModule>("@/core/files/native");
  return {
    ...actual,
    isFilesEngineAvailable: () => true,
    searchFiles: (query: unknown) => searchFiles(query),
  };
});

vi.mock("@/components/files/PathPicker", () => ({
  PathPicker: ({
    label,
    onChange,
  }: {
    label: string;
    onChange: (paths: string[]) => void;
  }) => (
    <button type="button" data-testid="picker" onClick={() => onChange(["/essai/arbre"])}>
      {label}
    </button>
  ),
}));

const REPORT = {
  root: "/essai/arbre",
  hits: [
    {
      path: "/essai/arbre/notes.txt",
      relative: "notes.txt",
      name: "notes.txt",
      size: 64,
      modified: 1,
      extension: "txt",
      reason: "Correspond : nom.",
      line: null,
      excerpt: null,
      matches: 0,
      encoding: null,
    },
  ],
  scannedFiles: 13,
  scannedDirectories: 3,
  readFiles: 0,
  binarySkipped: 0,
  tooLarge: 0,
  truncated: false,
  warnings: [],
};

function renderTool() {
  return render(
    <MemoryRouter>
      <FileSearchTool tool={toolRegistry.get("file-search")!} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  searchFiles.mockReset();
  searchFiles.mockResolvedValue(REPORT);
});

describe("filtre de date", () => {
  it("est désactivé tant qu'on ne l'allume pas", async () => {
    const user = userEvent.setup();
    renderTool();
    await user.click(screen.getByTestId("picker"));

    // Les deux champs existent mais sont inertes : impossible de croire qu'un
    // filtre de date est en place.
    expect(screen.getByLabelText("Modifié après le")).toBeDisabled();
    expect(screen.getByLabelText("Modifié avant le")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /^Rechercher$/i }));
    await waitFor(() => expect(searchFiles).toHaveBeenCalled());
    const query = searchFiles.mock.calls[0][0] as { modifiedAfter: unknown; modifiedBefore: unknown };
    expect(query.modifiedAfter).toBeNull();
    expect(query.modifiedBefore).toBeNull();
  });

  it("n'entre dans la requête qu'une fois activé et renseigné", async () => {
    const user = userEvent.setup();
    renderTool();
    await user.click(screen.getByTestId("picker"));
    await user.click(screen.getByRole("checkbox", { name: /Limiter à une période/i }));

    const after = screen.getByLabelText("Modifié après le");
    expect(after).toBeEnabled();
    await user.type(after, "2026-01-15");

    await user.click(screen.getByRole("button", { name: /^Rechercher$/i }));
    await waitFor(() => expect(searchFiles).toHaveBeenCalled());
    const query = searchFiles.mock.calls[0][0] as { modifiedAfter: number | null };
    expect(query.modifiedAfter).toBe(Date.parse("2026-01-15"));
  });
});

describe("résultats périmés", () => {
  it("prévient dès qu'un critère change après une recherche", async () => {
    const user = userEvent.setup();
    renderTool();
    await user.click(screen.getByTestId("picker"));
    await user.click(screen.getByRole("button", { name: /^Rechercher$/i }));

    await screen.findByTestId("search-results");
    expect(screen.queryByTestId("search-stale")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Le nom contient"), "facture");

    // Les résultats restent lisibles, mais ils ne prétendent plus correspondre
    // aux champs affichés.
    const warning = await screen.findByTestId("search-stale");
    expect(warning).toHaveTextContent(/relancez la recherche/i);
    expect(screen.getByText(/Résultats de la recherche précédente/i)).toBeInTheDocument();
    expect(screen.getAllByText("notes.txt").length).toBeGreaterThan(0);
  });

  it("cesse de prévenir une fois la recherche relancée", async () => {
    const user = userEvent.setup();
    renderTool();
    await user.click(screen.getByTestId("picker"));
    await user.click(screen.getByRole("button", { name: /^Rechercher$/i }));
    await screen.findByTestId("search-results");

    await user.type(screen.getByLabelText("Le nom contient"), "facture");
    await screen.findByTestId("search-stale");

    await user.click(screen.getByRole("button", { name: /^Rechercher$/i }));
    await waitFor(() => expect(screen.queryByTestId("search-stale")).not.toBeInTheDocument());
  });
});
