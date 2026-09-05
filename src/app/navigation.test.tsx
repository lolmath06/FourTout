import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { routes } from "./routes";
import { useFavorites } from "@/features/favorites/store";
import { useRecents } from "@/features/recents/store";
import { useNotifications } from "@/features/notifications/store";

function renderApp(initialPath = "/") {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  return { router, ...render(<RouterProvider router={router} />) };
}

beforeEach(() => {
  window.localStorage.clear();
  useFavorites.getState().clear();
  useRecents.getState().clear();
  useNotifications.getState().clear();
});

describe("navigation principale", () => {
  it("affiche l'accueil et sa zone d'intention", () => {
    renderApp();
    expect(screen.getByRole("heading", { name: "Que voulez-vous faire ?" })).toBeInTheDocument();
    expect(screen.getByTestId("home-intent-input")).toBeInTheDocument();
  });

  it("navigue de l'accueil vers la page Outils", async () => {
    const user = userEvent.setup();
    const { router } = renderApp();

    await user.click(screen.getByRole("link", { name: /^Outils$/ }));
    expect(router.state.location.pathname).toBe("/tools");
    expect(await screen.findByRole("heading", { name: "Outils" })).toBeInTheDocument();
  });

  it("entre dans la catégorie PDF et affiche ses outils", async () => {
    const user = userEvent.setup();
    const { router } = renderApp("/tools");

    await user.click(screen.getByTestId("category-tile-pdf"));
    expect(router.state.location.pathname).toBe("/tools/pdf");

    expect(await screen.findByRole("heading", { name: "PDF" })).toBeInTheDocument();
    expect(screen.getByTestId("tool-row-pdf-merge")).toBeInTheDocument();
    expect(screen.getByTestId("tool-row-pdf-compress")).toBeInTheDocument();
  });

  it("ouvre la page d'un outil non implémenté", async () => {
    renderApp("/tools/t/universal-converter");

    expect(
      await screen.findByRole("heading", { name: /convertisseur universel/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Bientôt")).toBeInTheDocument();
    expect(screen.getByText("Cet outil arrive prochainement")).toBeInTheDocument();
    expect(screen.getByText(/vos fichiers restent sur votre appareil/i)).toBeInTheDocument();
  });

  it("ouvre un outil PDF réellement implémenté", async () => {
    renderApp("/tools/t/pdf-compress");

    expect(await screen.findByRole("heading", { name: "Compresser un PDF" })).toBeInTheDocument();
    expect(screen.getByText("Disponible")).toBeInTheDocument();
    expect(await screen.findByText("Déposez votre PDF ici")).toBeInTheDocument();
    expect(screen.queryByText("Cet outil arrive prochainement")).not.toBeInTheDocument();
  });

  it("ouvre la page d'un outil implémenté", async () => {
    renderApp("/tools/t/base64");
    expect(await screen.findByRole("button", { name: "Encoder" })).toBeInTheDocument();
  });

  it("redirige vers Outils pour un identifiant d'outil inconnu", () => {
    const { router } = renderApp("/tools/t/outil-inexistant");
    expect(router.state.location.pathname).toBe("/tools");
  });

  it("affiche une page 404 pour une route inconnue", () => {
    renderApp("/route/inexistante");
    expect(screen.getByText("Page introuvable")).toBeInTheDocument();
  });
});

describe("recherche depuis la page Outils", () => {
  it("trouve « Compresser un PDF » avec « réduire taille pdf »", async () => {
    const user = userEvent.setup();
    renderApp("/tools");

    await user.type(
      screen.getByPlaceholderText(/Rechercher : /),
      "réduire taille pdf",
    );

    const first = await screen.findByTestId("tool-row-pdf-compress");
    expect(first).toBeInTheDocument();
    expect(within(first).getByText("Compresser un PDF")).toBeInTheDocument();
  });

  it("indique clairement qu'aucun outil ne correspond", async () => {
    const user = userEvent.setup();
    renderApp("/tools");

    await user.type(screen.getByPlaceholderText(/Rechercher : /), "commander une pizza");
    expect(await screen.findByText("Aucun outil ne correspond")).toBeInTheDocument();
  });
});

describe("assistant d'accueil", () => {
  it("propose le bon outil pour « transformer gif en vidéo »", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.type(screen.getByTestId("home-intent-input"), "transformer gif en vidéo");

    const results = await screen.findByTestId("intent-results");
    const rows = within(results).getAllByTestId(/^tool-row-/);
    expect(rows[0]).toHaveAttribute("data-testid", "tool-row-gif-to-video");
  });

  it("ouvre l'outil proposé au clic", async () => {
    const user = userEvent.setup();
    const { router } = renderApp();

    await user.type(screen.getByTestId("home-intent-input"), "transformer gif en vidéo");
    await user.click(await screen.findByTestId("tool-row-gif-to-video"));

    expect(router.state.location.pathname).toBe("/tools/t/gif-to-video");
  });

  it("n'invente rien quand l'outil n'existe pas", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.type(screen.getByTestId("home-intent-input"), "envoyer un fax à ma banque");

    expect(await screen.findByText("Aucun outil ne correspond")).toBeInTheDocument();
    expect(screen.queryByTestId(/^tool-row-/)).not.toBeInTheDocument();
  });
});

describe("favoris et récents dans l'application", () => {
  it("ajoute un favori depuis la page d'un outil et le retrouve dans Favoris", async () => {
    const user = userEvent.setup();
    const { router } = renderApp("/tools/t/pdf-compress");

    await user.click(await screen.findByRole("button", { name: "Ajouter aux favoris" }));
    expect(useFavorites.getState().ids).toEqual(["pdf-compress"]);

    // Le favori est bien écrit dans le stockage qui survit au redémarrage.
    expect(window.localStorage.getItem("fourtout:favorites")).toContain("pdf-compress");

    await user.click(screen.getByRole("link", { name: /Favoris/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/favorites"));
    expect(await screen.findByTestId("tool-row-pdf-compress")).toBeInTheDocument();
  });

  it("enregistre les outils ouverts dans les récents", async () => {
    const user = userEvent.setup();
    const { router } = renderApp("/tools/t/pdf-merge");
    await screen.findByRole("heading", { name: "Fusionner des PDF" });

    await user.click(screen.getByRole("link", { name: /Récents/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/recents"));

    expect(await screen.findByTestId("tool-row-pdf-merge")).toBeInTheDocument();
    expect(useRecents.getState().entries[0].toolId).toBe("pdf-merge");
  });

  it("affiche un état vide utile quand il n'y a aucun favori", async () => {
    renderApp("/favorites");
    expect(await screen.findByText("Aucun favori pour l'instant")).toBeInTheDocument();
  });
});
