import { describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { routes } from "./routes";
import { APP_TIMEOUT } from "@/test/timeouts";

/**
 * Passe visuelle — garde de non-régression.
 *
 * Le rendu réel des pixels n'est pas vérifiable en jsdom. On verrouille donc
 * ce qui l'est : les écrans représentatifs se montent sans erreur, et les
 * motifs que la passe visuelle a supprimés ne reviennent pas par inadvertance.
 */
const SCREENS: [string, string | RegExp][] = [
  ["/", "Que voulez-vous faire ?"],
  ["/tools", "Outils"],
  ["/tools/t/video-convert", /Convertir une vidéo/],
  ["/tools/t/pdf-compress", /Compresser un PDF/],
  ["/tools/t/image-crop", /Rogner une image/],
  ["/tools/t/text-to-speech", /parole/i],
  ["/tools/t/text-compare", /Comparer deux textes/],
  ["/tools/t/file-find-duplicates", /fichiers en double/i],
  ["/tools/t/universal-converter", /Convertisseur universel/],
  ["/settings", /Paramètres/],
];

function open(path: string) {
  return render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

// Chaque test monte l'application entière et inspecte le rendu réel.
describe("écrans représentatifs après la passe visuelle", { timeout: APP_TIMEOUT }, () => {
  it.each(SCREENS)("%s se monte sans erreur", async (path, heading) => {
    open(path);
    await waitFor(() =>
      expect(screen.getAllByRole("heading", { name: heading }).length).toBeGreaterThan(0),
    );
  });
});

describe("motifs retirés par la passe visuelle", { timeout: APP_TIMEOUT }, () => {
  it("n'affiche plus de marqueur d'état sur un outil disponible", () => {
    open("/tools/t/pdf-merge");
    // « Disponible » est la norme : l'afficher partout n'informait personne.
    expect(screen.queryByText("Disponible")).not.toBeInTheDocument();
    expect(screen.queryByText("Bientôt")).not.toBeInTheDocument();
  });

  it("remplace les pastilles de capacité par une ligne de métadonnées", () => {
    open("/tools/t/video-compress");
    // L'ancien libellé de pastille disparaît au profit d'un mot court…
    expect(screen.queryByText("100 % local")).not.toBeInTheDocument();
    expect(screen.getByTitle("Traitement entièrement local")).toHaveTextContent("Local");
    // …et les propriétés secondaires deviennent des entrées de la même ligne,
    // porteuses d'une explication au survol plutôt que d'une couleur.
    expect(
      screen.getByTitle(/Opération potentiellement longue/),
    ).toHaveTextContent("Peut être long");
    expect(screen.getByTitle(/moteur fourni avec l'application/)).toBeInTheDocument();
  });

  it("n'écrit le rappel « traitement local » qu'une fois par écran", async () => {
    open("/tools/t/pdf-compress");
    // Le rappel était rendu trois fois sur certains écrans (zone de dépôt,
    // ossature de l'outil, pied de page) : la promesse locale se dit une fois.
    await waitFor(() => expect(screen.getByText("Déposez votre PDF ici")).toBeInTheDocument());
    expect(screen.getAllByText(/restent sur votre appareil/i)).toHaveLength(1);
  });

  it("n'annonce plus l'état de développement d'un outil", () => {
    // Un outil présent au catalogue est un outil utilisable : la carte n'a plus
    // à annoncer qu'elle fonctionne. Les marqueurs « Disponible » et
    // « Bientôt » ont disparu de la liste comme de la page d'outil.
    open("/tools/t/pdf-compress");
    expect(screen.queryByText("Bientôt")).not.toBeInTheDocument();
    expect(screen.queryByText("Disponible")).not.toBeInTheDocument();

    cleanup();
    open("/tools");
    expect(screen.queryByText("Bientôt")).not.toBeInTheDocument();
    expect(screen.queryByText("Disponible")).not.toBeInTheDocument();
    // Et plus aucun sélecteur d'état ne subsiste sur la page Outils.
    expect(screen.queryByRole("group", { name: /disponibilité/i })).not.toBeInTheDocument();
  });
});
