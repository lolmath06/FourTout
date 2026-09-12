import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type * as RouterModule from "react-router-dom";
import { FilePreviewTool } from "./FilePreviewTool";
import { toolRegistry } from "@/core/tools/registry";
import { clearHandoff, peekHandoff } from "@/features/handoff/store";
import { HANDOFF_TARGETS } from "@/features/handoff/targets";
import type * as NativeModule from "@/core/files/native";
import type * as PdfDocumentModule from "@/core/pdf/document";
import type * as PdfImagesModule from "@/core/pdf/operations/toImages";

/**
 * L'aperçu avait deux défauts reproduits à la main : une image détectée mais
 * jamais affichée, et un PDF renvoyant vers « ouvrez-le ailleurs ». Ces tests
 * verrouillent l'inverse — que les octets arrivent bien à l'écran, et que le
 * type employé pour les afficher soit le **type réel**, pas celui du nom.
 */
const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof RouterModule>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

const fileInfo = vi.fn();
const readBytes = vi.fn();
const readHex = vi.fn();
const listArchive = vi.fn();

vi.mock("@/core/files/native", async () => {
  const actual = await vi.importActual<typeof NativeModule>("@/core/files/native");
  return {
    ...actual,
    isFilesEngineAvailable: () => true,
    fileInfo: (path: string) => fileInfo(path),
    readBytes: (path: string, max: number) => readBytes(path, max),
    readHex: (path: string, offset: number, length: number) => readHex(path, offset, length),
    listArchive: (path: string) => listArchive(path),
  };
});

const inspectPdf = vi.fn();
vi.mock("@/core/pdf/document", async () => {
  const actual = await vi.importActual<typeof PdfDocumentModule>("@/core/pdf/document");
  return { ...actual, inspectPdf: (source: unknown) => inspectPdf(source) };
});

const renderPageForEditor = vi.fn();
vi.mock("@/core/pdf/operations/toImages", async () => {
  const actual = await vi.importActual<typeof PdfImagesModule>(
    "@/core/pdf/operations/toImages",
  );
  return {
    ...actual,
    renderPageForEditor: (...args: unknown[]) => renderPageForEditor(...args),
  };
});

/** Les octets d'un PNG minimal mais valide. */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function info(overrides: Record<string, unknown>) {
  return {
    path: "/dossier/fichier",
    name: "fichier",
    extension: "",
    size: 4096,
    isDir: false,
    isSymlink: false,
    readOnly: false,
    modified: 0,
    created: 0,
    accessed: 0,
    mime: "application/octet-stream",
    magic: "inconnu",
    magicLabel: "Inconnu",
    family: "unknown",
    extensionMatches: true,
    looksLikeText: false,
    ...overrides,
  };
}

function renderPreview() {
  return render(
    <MemoryRouter>
      <FilePreviewTool tool={toolRegistry.get("file-preview")!} />
    </MemoryRouter>,
  );
}

/** Les objets binaires n'existent pas dans jsdom : on les rend observables. */
const created: { type: string }[] = [];

beforeEach(() => {
  navigate.mockReset();
  clearHandoff();
  created.length = 0;
  fileInfo.mockReset();
  readBytes.mockReset();
  readHex.mockReset();
  listArchive.mockReset();
  inspectPdf.mockReset();
  renderPageForEditor.mockReset();

  URL.createObjectURL = vi.fn((blob: Blob) => {
    created.push({ type: blob.type });
    return `blob:essai-${created.length}`;
  }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
});

/**
 * L'aperçu se déclenche seul quand le fichier vient d'un autre outil : c'est
 * le chemin que suit réellement l'utilisateur qui clique « Prévisualiser »
 * depuis l'inspecteur, et celui que ces tests empruntent.
 */
describe("aperçu ouvert depuis un autre outil", () => {
  async function openWith(path: string) {
    const { setHandoff } = await import("@/features/handoff/store");
    setHandoff({ toolId: "file-preview", paths: [path] });
    renderPreview();
  }

  it("rend l'image et construit l'objet binaire avec le type détecté", async () => {
    fileInfo.mockResolvedValue(
      info({
        path: "/f/wrong-extension.jpg",
        name: "wrong-extension.jpg",
        extension: "jpg",
        magic: "png",
        magicLabel: "Image PNG",
        family: "image",
        extensionMatches: false,
      }),
    );
    readBytes.mockResolvedValue(PNG_BYTES);

    await openWith("/f/wrong-extension.jpg");

    const image = await screen.findByTestId("preview-image-element");
    expect(image).toHaveAttribute("src", expect.stringContaining("blob:"));
    // Le type de l'objet binaire vient de la signature, pas de l'extension :
    // étiqueter des octets PNG en « image/jpeg » les empêcherait de s'afficher.
    expect(created[0].type).toBe("image/png");
    expect(await screen.findByText(/ne correspond pas au contenu/i)).toBeInTheDocument();
  });

  it("rend la première page d'un PDF avec le moteur de FourTout", async () => {
    fileInfo.mockResolvedValue(
      info({
        path: "/f/sample.pdf",
        name: "sample.pdf",
        extension: "pdf",
        magic: "pdf",
        magicLabel: "Document PDF",
        family: "document",
        mime: "application/pdf",
      }),
    );
    readBytes.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
    inspectPdf.mockResolvedValue({ pageCount: 3, encrypted: false, byteLength: 5 });
    renderPageForEditor.mockResolvedValue({
      png: new Uint8Array([1, 2, 3]),
      widthPx: 600,
      heightPx: 800,
      widthPts: 595,
      heightPts: 842,
    });

    await openWith("/f/sample.pdf");

    // La page est réellement rendue — pas un message disant d'aller ailleurs.
    expect(await screen.findByTestId("preview-pdf-page")).toBeInTheDocument();
    expect(renderPageForEditor).toHaveBeenCalled();
    expect(screen.getByText(/page 1 sur 3/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/aperçu intégré n'est pas disponible/i),
      "l'ancien message de renoncement ne doit plus exister",
    ).not.toBeInTheDocument();
  });

  it("passe à la page suivante d'un PDF de plusieurs pages", async () => {
    const user = userEvent.setup();
    fileInfo.mockResolvedValue(
      info({
        path: "/f/sample.pdf",
        name: "sample.pdf",
        extension: "pdf",
        magic: "pdf",
        magicLabel: "Document PDF",
        family: "document",
      }),
    );
    readBytes.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    inspectPdf.mockResolvedValue({ pageCount: 2, encrypted: false, byteLength: 4 });
    renderPageForEditor.mockResolvedValue({
      png: new Uint8Array([1]),
      widthPx: 10,
      heightPx: 10,
      widthPts: 10,
      heightPts: 10,
    });

    await openWith("/f/sample.pdf");
    await screen.findByTestId("preview-pdf-page");

    await user.click(screen.getByRole("button", { name: "Page suivante" }));
    await waitFor(() => expect(screen.getByText(/page 2 sur 2/i)).toBeInTheDocument());
    expect(renderPageForEditor).toHaveBeenCalledWith(expect.anything(), 2, 900);
  });

  it("ouvre l'outil spécialisé avec le fichier déjà transmis", async () => {
    const user = userEvent.setup();
    fileInfo.mockResolvedValue(
      info({
        path: "/f/archive.zip",
        name: "archive.zip",
        extension: "zip",
        magic: "zip",
        magicLabel: "Conteneur ZIP",
        family: "archive",
      }),
    );
    listArchive.mockResolvedValue({
      format: "zip",
      entries: [{ name: "a.txt", size: 3, compressedSize: 3, isDir: false, rejected: null }],
      files: 1,
      totalSize: 3,
      archiveSize: 100,
      rejected: 0,
      suspicious: false,
      encrypted: false,
    });

    await openWith("/f/archive.zip");
    await screen.findByTestId("preview-archive");

    await user.click(screen.getByTestId(`open-tool-${HANDOFF_TARGETS.archiveInspect}`));

    expect(navigate).toHaveBeenCalledWith(`/tools/t/${HANDOFF_TARGETS.archiveInspect}`);
    // Et le fichier voyage avec : l'outil visé n'ouvrira pas un écran vide.
    expect(peekHandoff(HANDOFF_TARGETS.archiveInspect)?.paths).toEqual(["/f/archive.zip"]);
  });
});
