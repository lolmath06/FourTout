import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type * as RouterModule from "react-router-dom";
import type * as NativeModule from "@/core/files/native";
import { ArchiveInspectTool } from "./ArchiveInspectTool";
import { toolRegistry } from "@/core/tools/registry";
import { clearHandoff, setHandoff } from "@/features/handoff/store";

/**
 * Deux points étaient en cause : un champ « mot de passe » affiché devant des
 * formats qui n'ont aucun chiffrement, et le verdict nuancé du TAR — qu'il ne
 * faut surtout pas perdre.
 */
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof RouterModule>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});

const listArchive = vi.fn();
const testArchive = vi.fn();

vi.mock("@/core/files/native", async () => {
  const actual = await vi.importActual<typeof NativeModule>("@/core/files/native");
  return {
    ...actual,
    isFilesEngineAvailable: () => true,
    listArchive: (path: string) => listArchive(path),
    testArchive: (path: string, password: string | null) => testArchive(path, password),
  };
});

function listing(overrides: Record<string, unknown> = {}) {
  return {
    format: "zip",
    entries: [{ name: "a.txt", size: 3, compressedSize: 3, isDir: false, rejected: null }],
    files: 1,
    totalSize: 3,
    archiveSize: 120,
    rejected: 0,
    suspicious: false,
    encrypted: false,
    ...overrides,
  };
}

function renderTool(toolId: string, path: string) {
  setHandoff({ toolId, paths: [path] });
  return render(
    <MemoryRouter>
      <ArchiveInspectTool tool={toolRegistry.get(toolId)!} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  clearHandoff();
  listArchive.mockReset();
  testArchive.mockReset();
});

describe("champ de mot de passe", () => {
  it("n'apparaît pas pour un TAR, qui n'a aucun chiffrement", async () => {
    listArchive.mockResolvedValue(listing({ format: "tar" }));
    renderTool("archive-test", "/f/archive-sample.tar");

    await waitFor(() => expect(listArchive).toHaveBeenCalled());
    expect(screen.queryByLabelText(/mot de passe/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cette archive est protégée/i)).not.toBeInTheDocument();
  });

  it("n'apparaît pas d'emblée pour un ZIP non chiffré, mais reste atteignable", async () => {
    const user = userEvent.setup();
    listArchive.mockResolvedValue(listing({ encrypted: false }));
    renderTool("archive-test", "/f/archive-sample.zip");

    await waitFor(() => expect(listArchive).toHaveBeenCalled());
    expect(screen.queryByLabelText(/^mot de passe$/i)).not.toBeInTheDocument();

    // L'utilisateur qui sait que son archive est protégée peut le dire.
    await user.click(screen.getByRole("button", { name: /Cette archive est protégée/i }));
    expect(await screen.findByLabelText(/^mot de passe$/i)).toBeInTheDocument();
  });

  it("apparaît d'office quand l'en-tête annonce des entrées chiffrées", async () => {
    listArchive.mockResolvedValue(listing({ encrypted: true }));
    renderTool("archive-test", "/f/protege.zip");

    expect(await screen.findByLabelText(/^mot de passe$/i)).toBeInTheDocument();
  });
});

describe("verdict d'un TAR", () => {
  it("dit valide, et dit aussitôt ce que ce « valide » ne prouve pas", async () => {
    const user = userEvent.setup();
    listArchive.mockResolvedValue(listing({ format: "tar" }));
    testArchive.mockResolvedValue({
      path: "/f/archive-sample.tar",
      format: "TAR",
      verdict: "valid",
      checked: 4,
      bytes: 204_897,
      failures: [],
      detail:
        "4 entrée(s) lue(s) intégralement, 204897 octets. Structure et en-têtes conformes. Attention : le format TAR ne porte aucune somme de contrôle du contenu — une altération des données d'un fichier y est indétectable.",
    });

    renderTool("archive-test", "/f/archive-sample.tar");
    await user.click(screen.getByRole("button", { name: /Tester l'intégrité/i }));

    const report = await screen.findByTestId("archive-integrity");
    expect(report).toHaveTextContent("Archive valide");
    expect(report).toHaveTextContent("4");
    // La nuance est le cœur du verdict : elle ne doit pas disparaître d'une
    // refonte d'affichage.
    expect(report).toHaveTextContent(/aucune somme de contrôle du contenu/i);
  });
});

describe("relais depuis l'inspection", () => {
  it("propose l'extraction avec l'archive déjà transmise", async () => {
    const user = userEvent.setup();
    listArchive.mockResolvedValue(listing());
    renderTool("archive-inspect", "/f/archive-sample.zip");

    await user.click(screen.getByRole("button", { name: /Inspecter l'archive/i }));
    await screen.findByTestId("archive-entries");

    const relay = await screen.findByTestId("archive-handoffs");
    expect(relay).toBeInTheDocument();
    const { peekHandoff } = await import("@/features/handoff/store");
    await user.click(screen.getByTestId("open-tool-archive-extract"));
    expect(peekHandoff("archive-extract")?.paths).toEqual(["/f/archive-sample.zip"]);
  });
});
