import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type * as RouterModule from "react-router-dom";
import type * as NativeModule from "@/core/files/native";
import { ChecksumManifestTool } from "./ChecksumManifestTool";
import { toolRegistry } from "@/core/tools/registry";
import { clearHandoff } from "@/features/handoff/store";

/**
 * Deux choses avaient été signalées : on ne savait pas quoi mettre dans
 * lequel des deux champs de la vérification, et créer un manifeste ne menait
 * nulle part. Ces tests verrouillent les explications et le relais.
 */
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof RouterModule>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});

const createManifest = vi.fn();
const verifyManifest = vi.fn();
const pickSavePath = vi.fn();

vi.mock("@/core/files/native", async () => {
  const actual = await vi.importActual<typeof NativeModule>("@/core/files/native");
  return {
    ...actual,
    isFilesEngineAvailable: () => true,
    createManifest: (request: unknown) => createManifest(request),
    verifyManifest: (manifest: string, root: string) => verifyManifest(manifest, root),
    pickSavePath: (name: string) => pickSavePath(name),
  };
});

/** Le sélecteur natif est court-circuité : on écrit dans l'état du composant. */
vi.mock("@/components/files/PathPicker", () => ({
  PathPicker: ({
    label,
    paths,
    onChange,
  }: {
    label: string;
    paths: string[];
    onChange: (paths: string[]) => void;
  }) => (
    <button type="button" data-testid={`picker:${label}`} onClick={() => onChange(["/essai/racine"])}>
      {label} — {paths.join(", ") || "vide"}
    </button>
  ),
}));

function renderTool(toolId: string) {
  return render(
    <MemoryRouter>
      <ChecksumManifestTool tool={toolRegistry.get(toolId)!} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  clearHandoff();
  createManifest.mockReset();
  verifyManifest.mockReset();
  pickSavePath.mockReset();
});

describe("création d'un manifeste", () => {
  it("propose un nom de fichier prévisible et affiche où il a été écrit", async () => {
    const user = userEvent.setup();
    pickSavePath.mockResolvedValue("/essai/checksums.sha256");
    createManifest.mockResolvedValue({
      output: "/essai/checksums.sha256",
      algorithm: "SHA-256",
      entries: [],
      files: 4,
      bytes: 2048,
      errors: [],
      legacyWarning: null,
    });

    renderTool("checksum-manifest");
    await user.click(screen.getByTestId("picker:1. Dossier à inventorier"));
    await user.click(screen.getByRole("button", { name: /Créer le manifeste/i }));

    // Le nom proposé n'oblige pas à comprendre qu'on demande un chemin de
    // sortie : la boîte d'enregistrement du système s'en charge.
    await waitFor(() => expect(pickSavePath).toHaveBeenCalledWith("checksums.sha256"));
    expect(await screen.findByText("/essai/checksums.sha256")).toBeInTheDocument();
    expect(screen.getByText(/Manifeste enregistré/i)).toBeInTheDocument();
  });

  it("enchaîne sur la vérification, manifeste et racine déjà en place", async () => {
    const user = userEvent.setup();
    pickSavePath.mockResolvedValue("/essai/checksums.sha256");
    createManifest.mockResolvedValue({
      output: "/essai/checksums.sha256",
      algorithm: "SHA-256",
      entries: [],
      files: 4,
      bytes: 2048,
      errors: [],
      legacyWarning: null,
    });
    verifyManifest.mockResolvedValue({
      manifest: "/essai/checksums.sha256",
      root: "/essai/racine",
      algorithm: "SHA-256",
      results: [],
      ok: 4,
      mismatched: 0,
      missing: 0,
      unreadable: 0,
      refused: 0,
      legacyWarning: null,
    });

    renderTool("checksum-manifest");
    await user.click(screen.getByTestId("picker:1. Dossier à inventorier"));
    await user.click(screen.getByRole("button", { name: /Créer le manifeste/i }));
    await screen.findByTestId("manifest-handoff");

    await user.click(screen.getByRole("button", { name: /Vérifier ce manifeste/i }));

    // On est passé au mode Vérifier, et les deux champs sont remplis : rien à
    // resélectionner à la main.
    const manifestPicker = await screen.findByTestId("picker:1. Le fichier de checksums");
    expect(manifestPicker).toHaveTextContent("/essai/checksums.sha256");
    expect(screen.getByTestId("picker:2. Le dossier contenant les fichiers")).toHaveTextContent(
      "/essai/racine",
    );

    await user.click(screen.getByRole("button", { name: /^Vérifier$/i }));
    await waitFor(() =>
      expect(verifyManifest).toHaveBeenCalledWith("/essai/checksums.sha256", "/essai/racine"),
    );
  });
});

describe("vérification d'un manifeste", () => {
  it("explique comment les deux champs se combinent", () => {
    renderTool("checksum-verify");
    expect(screen.getByText(/Comment ces deux champs se combinent/i)).toBeInTheDocument();
    // L'exemple montre le mécanisme plutôt que de le décrire : un chemin
    // relatif, une racine, et le chemin absolu qui en résulte.
    expect(screen.getAllByText(/docs\/readme\.txt/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("/home/vous/projet/docs/readme.txt")).toBeInTheDocument();
    expect(screen.getByTestId("picker:1. Le fichier de checksums")).toBeInTheDocument();
    expect(screen.getByTestId("picker:2. Le dossier contenant les fichiers")).toBeInTheDocument();
  });
});
