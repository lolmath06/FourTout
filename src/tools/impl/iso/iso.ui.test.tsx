import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { toolRegistry } from "@/core/tools/registry";

/**
 * Les trois outils ISO : ce qu'ils demandent au moteur natif, et ce qu'ils
 * montrent de la réponse. Le sélecteur de chemins (boîte de dialogue native)
 * est remplacé par un bouton ; le moteur natif par des doublures.
 */
const native = vi.hoisted(() => ({
  inspectIso: vi.fn(),
  createIso: vi.fn(),
  extractIso: vi.fn(),
  folderStats: vi.fn(),
  pickSavePath: vi.fn(),
  pickDirectory: vi.fn(),
}));

vi.mock("@/components/files/PathPicker", () => ({
  PathPicker: ({ mode, onChange, label }: { mode: string; onChange: (paths: string[]) => void; label?: string }) => (
    <button type="button" onClick={() => onChange([mode === "directory" ? "/home/u/Photos de vacances" : "/home/u/disque.iso"])}>
      {label ?? "choisir"}
    </button>
  ),
}));
vi.mock("@/components/files/useNativeAction", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/components/files/useNativeAction");
  return { ...actual, isNativeAvailable: () => true };
});
vi.mock("@/core/internet/native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/core/internet/native");
  return { ...actual, inspectIso: native.inspectIso, createIso: native.createIso, extractIso: native.extractIso };
});
vi.mock("@/core/files/native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/core/files/native");
  return { ...actual, folderStats: native.folderStats, pickSavePath: native.pickSavePath, pickDirectory: native.pickDirectory };
});

import { IsoCreateTool } from "./IsoCreateTool";
import { IsoInspectTool } from "./IsoInspectTool";
import { IsoExtractTool } from "./IsoExtractTool";

function mount(id: string, Component: (props: { tool: never }) => React.ReactNode) {
  const tool = toolRegistry.get(id);
  expect(tool, id).toBeDefined();
  return render(
    <MemoryRouter>
      <Component tool={tool as never} />
    </MemoryRouter>,
  );
}

const entry = (path: string, isDir = false, size = 10) => ({ path, name: path.split("/").pop()!, isDir, size, modified: 1_704_164_645, symlink: false });
const INFO = {
  path: "/home/u/disque.iso", fileSize: 4_194_304, label: "MON_VOLUME", systemId: "LINUX", publisher: "", preparer: "", application: "FourTout",
  created: 1_704_164_645, modified: 1_704_164_645, volumeBytes: 4_194_304, features: ["iso9660", "joliet", "rock-ridge", "el-torito"], tree: "rock-ridge",
  entries: [entry("docs", true, 0), entry("docs/a.txt", false, 5000), entry("readme.txt", false, 17)], files: 2, directories: 1, totalBytes: 5017,
  truncated: false, hybridMbr: true, gpt: false, warnings: [],
  boot: { platforms: ["bios", "efi"], catalogLba: 20, validationOk: true, idString: "", entries: [
    { bootable: true, media: "no-emulation", loadSegment: 0, systemType: 0, sectors: 4, loadLba: 30, path: "boot/loader.img" },
  ] },
};

beforeEach(() => {
  for (const fn of Object.values(native)) fn.mockReset();
  native.pickSavePath.mockResolvedValue("/home/u/Photos de vacances.iso");
  native.pickDirectory.mockResolvedValue("/home/u/sortie");
});

describe("Inspecter une image ISO", () => {
  it("lit l'image dès sa sélection, et montre volume, systèmes de fichiers et démarrage", async () => {
    const user = userEvent.setup();
    native.inspectIso.mockResolvedValue(INFO);
    mount("iso-inspect", IsoInspectTool);
    expect(native.inspectIso).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Choisissez une image ISO/ }));
    const info = await screen.findByTestId("iso-info");
    expect(native.inspectIso.mock.calls[0][0]).toBe("/home/u/disque.iso");
    expect(info).toHaveTextContent("MON_VOLUME");
    expect(screen.getByTestId("iso-features")).toHaveTextContent(/ISO 9660.*Joliet.*Rock Ridge.*El Torito/);
    const boot = screen.getByTestId("iso-boot");
    expect(boot).toHaveTextContent(/BIOS/);
    expect(boot).toHaveTextContent(/UEFI/);
    expect(boot).toHaveTextContent("boot/loader.img");
    expect(boot).toHaveTextContent(/somme de contrôle valide/);
    // L'arborescence est listée, avec les tailles.
    const tree = screen.getByTestId("iso-tree");
    expect(within(tree).getByText("a.txt")).toBeInTheDocument();
  });

  it("copie les métadonnées et le chemin d'une entrée choisie", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    native.inspectIso.mockResolvedValue(INFO);
    mount("iso-inspect", IsoInspectTool);
    await user.click(screen.getByRole("button", { name: /Choisissez une image ISO/ }));
    await screen.findByTestId("iso-info");

    await user.click(screen.getByRole("button", { name: /Copier les métadonnées/ }));
    expect(writeText).toHaveBeenCalled();
    expect(writeText.mock.calls[0][0]).toMatch(/MON_VOLUME/);
    expect(writeText.mock.calls[0][0]).toMatch(/boot\/loader\.img/);

    await user.click(screen.getByText("a.txt"));
    await user.click(screen.getByRole("button", { name: /Copier le chemin/ }));
    expect(writeText).toHaveBeenLastCalledWith("docs/a.txt");
  });

  it("dit qu'une image de données n'est pas amorçable et signale une image corrompue", async () => {
    const user = userEvent.setup();
    native.inspectIso.mockResolvedValueOnce({ ...INFO, boot: null, features: ["iso9660"], hybridMbr: false });
    mount("iso-inspect", IsoInspectTool);
    await user.click(screen.getByRole("button", { name: /Choisissez une image ISO/ }));
    expect(await screen.findByText(/c'est une image de données/)).toBeInTheDocument();
  });

  it("affiche l'erreur d'une image illisible sans rien inventer", async () => {
    const user = userEvent.setup();
    native.inspectIso.mockRejectedValue(new Error("Aucun descripteur de volume ISO 9660 : ce n'est pas une image ISO valide."));
    mount("iso-inspect", IsoInspectTool);
    await user.click(screen.getByRole("button", { name: /Choisissez une image ISO/ }));
    expect(await screen.findByText(/n'est pas une image ISO valide/)).toBeInTheDocument();
    expect(screen.queryByTestId("iso-info")).not.toBeInTheDocument();
  });
});

describe("Créer une image ISO", () => {
  it("estime la taille, propose le nom du dossier et crée vers l'emplacement choisi", async () => {
    const user = userEvent.setup();
    native.folderStats.mockResolvedValue({ totalBytes: 12_000_000, files: 40, directories: 6, largest: [{ path: "x", name: "x", size: 5000 }], symlinks: 0, byExtension: [], children: [], unreadable: [], path: "" });
    native.createIso.mockResolvedValue({ path: "/home/u/Photos de vacances.iso", files: 40, directories: 6, dataBytes: 12_000_000, imageBytes: 12_100_000, label: "PHOTOS_DE_VACANCES", warnings: ["nom trop long pour Rock Ridge : x"], warningCount: 1 });
    mount("iso-create", IsoCreateTool);
    await user.click(screen.getByRole("button", { name: /Choisissez le dossier/ }));
    await waitFor(() => expect(screen.getByTestId("stat-grid")).toHaveTextContent(/12/));
    expect(screen.getByDisplayValue("Photos de vacances")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Créer l'image…/ }));
    await waitFor(() => expect(native.createIso).toHaveBeenCalled());
    const [params] = native.createIso.mock.calls[0];
    expect(params).toMatchObject({ source: "/home/u/Photos de vacances", output: "/home/u/Photos de vacances.iso", joliet: true, rockRidge: true, label: "Photos de vacances" });
    expect(await screen.findByText("Image créée")).toBeInTheDocument();
    // Les noms qui n'ont pas pu être conservés sont signalés, pas passés sous silence.
    expect(screen.getByText(/nom trop long pour Rock Ridge/)).toBeInTheDocument();
    // L'image n'est jamais présentée comme amorçable.
    expect(screen.getByText(/n'est pas amorçable/)).toBeInTheDocument();
  });

  it("n'écrit rien si l'utilisateur annule le choix de l'emplacement", async () => {
    const user = userEvent.setup();
    native.folderStats.mockResolvedValue({ totalBytes: 1, files: 1, directories: 0, largest: [], symlinks: 0, byExtension: [], children: [], unreadable: [], path: "" });
    native.pickSavePath.mockResolvedValue(undefined);
    mount("iso-create", IsoCreateTool);
    await user.click(screen.getByRole("button", { name: /Choisissez le dossier/ }));
    await user.click(await screen.findByRole("button", { name: /Créer l'image…/ }));
    expect(native.createIso).not.toHaveBeenCalled();
  });
});

describe("Extraire une image ISO", () => {
  it("extrait tout par défaut, ou seulement la sélection cochée", async () => {
    const user = userEvent.setup();
    native.inspectIso.mockResolvedValue(INFO);
    native.extractIso.mockResolvedValue({ destination: "/home/u/sortie/disque", extracted: 1, skipped: ["../../evil — chemin hors du dossier de destination"], bytes: 5000 });
    mount("iso-extract", IsoExtractTool);
    await user.click(screen.getByRole("button", { name: /Choisissez une image ISO/ }));
    await screen.findByText("Tout sera extrait");

    await user.click(screen.getByRole("checkbox", { name: "docs/a.txt" }));
    expect(screen.getByText(/1 éléments sélectionnés/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Choisir le dossier de destination/ }));
    await user.click(screen.getByRole("button", { name: /Extraire la sélection/ }));

    await waitFor(() => expect(native.extractIso).toHaveBeenCalled());
    const [params] = native.extractIso.mock.calls[0];
    expect(params).toMatchObject({ path: "/home/u/disque.iso", selection: ["docs/a.txt"], overwrite: false, destination: "/home/u/sortie/disque" });
    // Les entrées refusées par sécurité sont listées.
    expect(await screen.findByText(/entrée refusée par sécurité/)).toBeInTheDocument();
    expect(screen.getByText(/evil/)).toBeInTheDocument();
  });

  it("sans coche, toute l'image est extraite, sans écraser", async () => {
    const user = userEvent.setup();
    native.inspectIso.mockResolvedValue(INFO);
    native.extractIso.mockResolvedValue({ destination: "/home/u/disque", extracted: 2, skipped: [], bytes: 5017 });
    mount("iso-extract", IsoExtractTool);
    await user.click(screen.getByRole("button", { name: /Choisissez une image ISO/ }));
    await screen.findByText("Tout sera extrait");
    await user.click(screen.getByRole("button", { name: /Extraire l'image/ }));
    await waitFor(() => expect(native.extractIso).toHaveBeenCalled());
    expect(native.extractIso.mock.calls[0][0]).toMatchObject({ selection: [], overwrite: false });
  });
});
