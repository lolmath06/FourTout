import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { FileDropZone } from "./FileDropZone";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { toolRegistry } from "@/core/tools/registry";
import { useNotifications } from "@/features/notifications/store";

function Harness({ toolId }: { toolId: string }) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  return (
    <FileDropZone
      constraints={constraintsForTool(toolRegistry.get(toolId)!)}
      files={files}
      onChange={setFiles}
    />
  );
}

const makeFile = (name: string, size = 2048) =>
  new File([new Uint8Array(size)], name, { type: "application/pdf" });

beforeEach(() => useNotifications.getState().clear());

describe("zone de dépôt de fichiers", () => {
  it("affiche l'invitation, sans redire le rappel de confidentialité", () => {
    render(<Harness toolId="pdf-merge" />);
    expect(screen.getByText("Déposez vos fichiers ici")).toBeInTheDocument();
    // Depuis la passe visuelle, le rappel « traitement local » n'est écrit
    // qu'une seule fois par écran, en pied de page d'outil : trois répétitions
    // du même bandeau ne rendaient pas la promesse plus crédible.
    expect(screen.queryByText(/vos fichiers restent sur votre appareil/i)).not.toBeInTheDocument();
  });

  it("accepte des fichiers via l'explorateur et affiche nom, type et taille", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness toolId="pdf-merge" />);
    const input = container.querySelector("input[type=file]") as HTMLInputElement;

    await user.upload(input, [makeFile("rapport.pdf"), makeFile("annexe.pdf")]);

    expect(screen.getByText("rapport.pdf")).toBeInTheDocument();
    expect(screen.getByText("annexe.pdf")).toBeInTheDocument();
    expect(screen.getAllByText("pdf")).toHaveLength(2);
    // Le calcul est en 1024 : le libellé l'est aussi.
    expect(screen.getAllByText("2,00 Kio")).toHaveLength(2);
  });

  it("limite à un fichier un outil qui n'est pas par lots", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness toolId="pdf-split" />);
    const input = container.querySelector("input[type=file]") as HTMLInputElement;

    await user.upload(input, [makeFile("a.pdf"), makeFile("b.pdf")]);

    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    expect(screen.queryByText("b.pdf")).not.toBeInTheDocument();
  });

  it("prévient plutôt que d'ignorer un fichier au mauvais format", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness toolId="pdf-merge" />);
    const input = container.querySelector("input[type=file]") as HTMLInputElement;

    // `accept` filtre déjà côté explorateur : on contourne pour tester le refus.
    input.removeAttribute("accept");
    await user.upload(input, new File(["x"], "photo.png", { type: "image/png" }));

    expect(screen.queryByText("photo.png")).not.toBeInTheDocument();
    const notices = useNotifications.getState().notices;
    expect(notices[0].kind).toBe("warning");
    expect(notices[0].description).toContain(".png");
  });

  it("retire un fichier de la sélection", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness toolId="pdf-merge" />);
    const input = container.querySelector("input[type=file]") as HTMLInputElement;

    await user.upload(input, makeFile("rapport.pdf"));
    await user.click(screen.getByRole("button", { name: "Retirer rapport.pdf" }));

    expect(screen.queryByText("rapport.pdf")).not.toBeInTheDocument();
  });

  it("accepte un dépôt par glisser-déposer", async () => {
    render(<Harness toolId="pdf-merge" />);
    const zone = screen.getByText("Déposez vos fichiers ici").closest("label")!;

    const dataTransfer = {
      files: [makeFile("glisse.pdf")],
      items: [],
      types: ["Files"],
    };
    // userEvent ne simule pas le glisser-déposer de fichiers : on émet l'événement.
    const drop = new Event("drop", { bubbles: true });
    Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
    act(() => {
      zone.dispatchEvent(drop);
    });

    expect(await screen.findByText("glisse.pdf")).toBeInTheDocument();
  });

  it("n'impose aucun filtre quand l'outil accepte tout", () => {
    const { container } = render(<Harness toolId="file-hash" />);
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    expect(input.hasAttribute("accept")).toBe(false);
    expect(input.multiple).toBe(true);
  });
});
