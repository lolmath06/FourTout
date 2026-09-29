import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PdfRecoverPasswordTool } from "./PdfRecoverPasswordTool";
import { toolRegistry } from "@/core/tools/registry";

describe("interface de récupération de mot de passe", () => {
  const tool = toolRegistry.get("pdf-recover-password")!;

  it("affiche l'avertissement d'usage obligatoire", () => {
    render(<PdfRecoverPasswordTool tool={tool} />);
    expect(
      screen.getByText(/uniquement sur un document auquel vous êtes autorisé à accéder/i),
    ).toBeInTheDocument();
  });

  it("indique que le moteur natif est requis hors application", () => {
    render(<PdfRecoverPasswordTool tool={tool} />);
    expect(screen.getByText(/moteur natif de FourTout/i)).toBeInTheDocument();
  });

  it("propose la zone de dépôt du PDF protégé", () => {
    render(<PdfRecoverPasswordTool tool={tool} />);
    expect(screen.getByText("Déposez le PDF protégé")).toBeInTheDocument();
  });
});
