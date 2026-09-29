import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type * as RouterModule from "react-router-dom";
import { UniversalConverterTool } from "./UniversalConverterTool";
import { toolRegistry } from "@/core/tools/registry";
import { clearHandoff, peekHandoff } from "@/features/handoff/store";

/**
 * Le convertisseur universel est un aiguilleur : ce qui doit être vérifié,
 * c'est qu'il propose exactement ce qui existe, et qu'un clic ouvre le bon
 * outil avec le fichier et le format déjà en place.
 */
const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof RouterModule>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

function renderConverter() {
  return render(
    <MemoryRouter>
      <UniversalConverterTool tool={toolRegistry.get("universal-converter")!} />
    </MemoryRouter>,
  );
}

async function drop(name: string, type: string) {
  const user = userEvent.setup();
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, new File([new Uint8Array([1, 2, 3])], name, { type }));
}

beforeEach(() => {
  navigate.mockReset();
  clearHandoff();
});

describe("convertisseur universel", () => {
  it("décrit le fichier déposé", async () => {
    renderConverter();
    await drop("photo.png", "image/png");
    const detection = await screen.findByTestId("converter-detection");
    expect(detection).toHaveTextContent("PNG");
    expect(detection).toHaveTextContent("photo.png");
  });

  it("propose JPEG, WebP et PDF pour un PNG", async () => {
    renderConverter();
    await drop("photo.png", "image/png");
    expect(await screen.findByTestId("convert-to-jpg")).toBeInTheDocument();
    expect(screen.getByTestId("convert-to-webp")).toBeInTheDocument();
    expect(screen.getByTestId("convert-to-pdf")).toBeInTheDocument();
  });

  it("propose vidéo, GIF, audio et image fixe pour un MP4", async () => {
    renderConverter();
    await drop("clip.mp4", "video/mp4");
    expect(await screen.findByTestId("convert-to-webm")).toBeInTheDocument();
    expect(screen.getByTestId("convert-to-gif")).toBeInTheDocument();
    expect(screen.getByTestId("convert-to-mp3")).toBeInTheDocument();
    expect(screen.getByTestId("convert-to-png")).toBeInTheDocument();
  });

  it("ouvre l'outil spécialisé avec le fichier et le format préremplis", async () => {
    const user = userEvent.setup();
    renderConverter();
    await drop("photo.png", "image/png");

    await user.click(await screen.findByTestId("convert-to-webp"));

    expect(navigate).toHaveBeenCalledWith("/tools/t/image-convert");
    const handoff = peekHandoff("image-convert");
    expect(handoff?.preset).toEqual({ format: "webp" });
    expect(handoff?.files?.[0]?.name).toBe("photo.png");
  });

  it("ne propose, pour un format inconnu, que ce qui marche vraiment dessus", async () => {
    renderConverter();
    await drop("archive.xyz", "application/octet-stream");

    // Aucun convertisseur d'image ni de document ne sait quoi faire d'un
    // « .xyz ». La compression d'un fichier seul, elle, ne regarde pas le
    // format de son entrée : la proposer est exact, la taire serait une
    // omission.
    expect(await screen.findByTestId("convert-to-gz")).toBeInTheDocument();
    expect(screen.getByTestId("convert-to-xz")).toBeInTheDocument();
    expect(screen.queryByTestId("convert-to-png")).not.toBeInTheDocument();
    expect(screen.queryByTestId("convert-to-pdf")).not.toBeInTheDocument();
  });
});
