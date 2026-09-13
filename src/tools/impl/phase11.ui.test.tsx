import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { toolRegistry } from "@/core/tools/registry";
import { TomlTool } from "./dev/TomlTool";
import { Base32Tool } from "./dev/Base32Tool";
import { TimezoneTool } from "./calculators/TimezoneTool";
import { BandwidthTool, TransferTimeTool } from "./calculators/BandwidthTools";
import { InterestTool } from "./calculators/InterestTool";
import { PingTool } from "./network/PingTool";
import { PortCheckTool } from "./network/PortCheckTool";
import { LanDiscoveryTool } from "./network/LanDiscoveryTool";
import { SqliteExplorerTool } from "./dev/SqliteExplorerTool";

/**
 * Ce que les écrans de la phase 11 doivent garantir.
 *
 * Les outils purement TypeScript sont exercés sur les vraies fixtures. Les
 * outils natifs — explorateur SQLite, sondes réseau — ne peuvent pas travailler
 * hors de l'application : ce qu'on vérifie alors, c'est qu'ils le **disent**,
 * au lieu d'afficher un écran vide ou, pire, un résultat inventé.
 */
const DIR = join(process.cwd(), "test-assets", "generated");

const fixture = (name: string) => readFileSync(join(DIR, name), "utf8");

function renderTool(id: string, Component: (props: { tool: never }) => React.ReactNode) {
  const tool = toolRegistry.get(id);
  expect(tool, `outil absent du catalogue : ${id}`).toBeDefined();
  return render(
    <MemoryRouter>
      <Component tool={tool as never} />
    </MemoryRouter>,
  );
}

/** Colle un texte dans une zone, sans passer par la frappe caractère à caractère. */
async function paste(user: ReturnType<typeof userEvent.setup>, label: string, text: string) {
  await user.click(screen.getByLabelText(label));
  await user.paste(text);
}

describe("TOML", () => {
  it("valide la fixture valide et décrit ce qu'elle contient", async () => {
    const user = userEvent.setup();
    renderTool("toml-format", TomlTool);
    await paste(user, "Document TOML", fixture("sample-valid.toml"));

    const summary = await screen.findByText(/Document valide/);
    // Le récapitulatif est composé de plusieurs fragments : on lit la ligne
    // entière plutôt que d'espérer qu'un morceau tombe dans un seul nœud.
    expect(summary.textContent).toMatch(/2 tables/);
    expect(summary.textContent).toMatch(/1 tableau de tables/);
    expect(summary.textContent).toMatch(/3 dates/);
  });

  it("situe l'erreur de la fixture invalide, sans trace d'exécution", async () => {
    const user = userEvent.setup();
    renderTool("toml-format", TomlTool);
    await paste(user, "Document TOML", fixture("sample-invalid.toml"));

    // La clé « port » est définie deux fois, ligne 4.
    await waitFor(() =>
      expect(screen.getByText(/Ligne 4, colonne 1/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/node_modules/)).not.toBeInTheDocument();
  });

  it("annonce la perte des commentaires avant de reformater, et la chiffre", async () => {
    const user = userEvent.setup();
    renderTool("toml-format", TomlTool);
    await paste(user, "Document TOML", fixture("sample-comments.toml"));
    await user.click(screen.getByRole("radio", { name: "Reformater" }));

    await waitFor(() =>
      expect(screen.getByText("Le reformatage perd les commentaires")).toBeInTheDocument(),
    );
    // Cinq lignes de commentaire dans la fixture : l'avertissement le dit.
    expect(screen.getByText("5")).toBeInTheDocument();

    const output = screen.getByLabelText<HTMLTextAreaElement>("TOML reformaté");
    expect(output.value).toContain('titre = "FourTout"');
    expect(output.value).not.toContain("# Configuration de FourTout");
    // La valeur qui *contenait* un dièse, elle, est intacte.
    expect(output.value).toContain("# ceci reste du texte");
  });
});

describe("Base32", () => {
  it("reproduit le vecteur de la RFC 4648", async () => {
    const user = userEvent.setup();
    renderTool("base32", Base32Tool);
    await paste(user, "Texte", "foobar");

    await waitFor(() =>
      expect(screen.getByLabelText<HTMLTextAreaElement>("Base32").value).toBe("MZXW6YTBOI======"),
    );
  });

  it("décode en sens inverse", async () => {
    const user = userEvent.setup();
    renderTool("base32", Base32Tool);
    await user.click(screen.getByRole("radio", { name: "Base32 → Texte" }));
    await paste(user, "Base32", "MZXW6YTBOI======");

    await waitFor(() =>
      expect(screen.getByLabelText<HTMLTextAreaElement>("Texte").value).toBe("foobar"),
    );
  });

  it("explique un Base32 impossible au lieu de rendre n'importe quoi", async () => {
    const user = userEvent.setup();
    renderTool("base32", Base32Tool);
    await user.click(screen.getByRole("radio", { name: "Base32 → Texte" }));
    await paste(user, "Base32", "MZX");

    await waitFor(() => expect(screen.getByText(/Longueur impossible/)).toBeInTheDocument());
  });
});

describe("fuseaux horaires", () => {
  it("convertit une heure d'hiver de Paris vers New York", async () => {
    const user = userEvent.setup();
    renderTool("calc-timezone", TimezoneTool);

    const date = screen.getByLabelText("Date");
    await user.clear(date);
    await user.type(date, "2026-01-15");
    const time = screen.getByLabelText("Heure");
    await user.clear(time);
    await user.type(time, "14:30");

    await user.click(screen.getByLabelText("Fuseau de départ"));
    await user.paste("paris");
    await user.click(await screen.findByRole("button", { name: /Paris/ }));

    await waitFor(() =>
      expect(screen.getByText("2026-01-15T13:30:00.000Z")).toBeInTheDocument(),
    );
    expect(screen.getByText(/UTC\+01:00/)).toBeInTheDocument();
  });

  it("refuse de choisir à notre place quand l'heure existe deux fois", async () => {
    const user = userEvent.setup();
    renderTool("calc-timezone", TimezoneTool);

    const date = screen.getByLabelText("Date");
    await user.clear(date);
    await user.type(date, "2026-10-25");
    const time = screen.getByLabelText("Heure");
    await user.clear(time);
    await user.type(time, "02:30");

    await user.click(screen.getByLabelText("Fuseau de départ"));
    await user.paste("paris");
    await user.click(await screen.findByRole("button", { name: /Paris/ }));

    await waitFor(() =>
      expect(screen.getByText("Cette heure existe deux fois")).toBeInTheDocument(),
    );
    // Les deux lectures sont affichées, pas une seule choisie en silence.
    expect(screen.getByText("Occurrence retenue")).toBeInTheDocument();
    expect(screen.getByText("Autre occurrence possible")).toBeInTheDocument();
  });

  it("signale une heure qui n'a jamais existé", async () => {
    const user = userEvent.setup();
    renderTool("calc-timezone", TimezoneTool);

    const date = screen.getByLabelText("Date");
    await user.clear(date);
    await user.type(date, "2026-03-29");
    const time = screen.getByLabelText("Heure");
    await user.clear(time);
    await user.type(time, "02:30");

    await user.click(screen.getByLabelText("Fuseau de départ"));
    await user.paste("paris");
    await user.click(await screen.findByRole("button", { name: /Paris/ }));

    await waitFor(() =>
      expect(screen.getByText("Cette heure n'existe pas")).toBeInTheDocument(),
    );
  });
});

describe("bande passante et temps de transfert", () => {
  it("donne 1 Gibit/s pour 1 Gio en 8 secondes", async () => {
    renderTool("calc-bandwidth", BandwidthTool);
    // Les valeurs par défaut sont exactement ce cas.
    await waitFor(() => expect(screen.getByTestId("calc-result")).toHaveTextContent("1"));
    expect(screen.getByText("Gibit/s")).toBeInTheDocument();
    expect(screen.getByText(/128 Mio\/s/)).toBeInTheDocument();
  });

  it("donne 13 min 20 s pour 100 Gio à 1 Gibit/s", async () => {
    renderTool("calc-transfer-time", TransferTimeTool);
    await waitFor(() =>
      expect(screen.getByTestId("calc-result")).toHaveTextContent("13 min 20 s"),
    );
    expect(screen.getByText("Durée théorique")).toBeInTheDocument();
  });

  it("refuse une durée nulle au lieu d'afficher l'infini", async () => {
    const user = userEvent.setup();
    renderTool("calc-bandwidth", BandwidthTool);
    const duration = screen.getByLabelText("Durée en secondes");
    await user.clear(duration);
    await user.type(duration, "0");

    await waitFor(() => expect(screen.getByText(/ne peut pas être nul/)).toBeInTheDocument());
  });
});

describe("intérêts", () => {
  it("donne 1 102,50 € pour 1 000 € à 5 % sur 2 ans, capitalisés annuellement", async () => {
    renderTool("calc-interest", InterestTool);
    await waitFor(() =>
      expect(screen.getByTestId("calc-result").textContent?.replace(/\s/g, " ")).toMatch(
        /1 102,50/,
      ),
    );
    expect(screen.getByText("Outil mathématique")).toBeInTheDocument();
  });

  it("donne 1 100 € en intérêt simple sur les mêmes nombres", async () => {
    const user = userEvent.setup();
    renderTool("calc-interest", InterestTool);
    await user.click(screen.getByRole("radio", { name: /Simple/ }));

    await waitFor(() =>
      expect(screen.getByTestId("calc-result").textContent?.replace(/\s/g, " ")).toMatch(
        /1 100,00/,
      ),
    );
  });
});

describe("outils natifs hors application", () => {
  it("l'explorateur SQLite dit qu'il lui faut l'application, et reste en lecture seule", () => {
    renderTool("sqlite-explorer", SqliteExplorerTool);
    expect(screen.getByText("Lecture seule, garantie par le moteur")).toBeInTheDocument();
    expect(screen.getByText(/nécessite l'application FourTout installée/)).toBeInTheDocument();
  });

  it("le ping annonce sa dépendance sans rien mesurer", () => {
    renderTool("network-ping", PingTool);
    expect(screen.getByText(/ouvrent de vraies connexions/)).toBeInTheDocument();
    // Aucun résultat n'est affiché tant que rien n'a été envoyé.
    expect(screen.queryByText("Résultat")).not.toBeInTheDocument();
  });

  it("le test de ports affiche ses limites avant tout lancement", () => {
    renderTool("network-ports", PortCheckTool);
    expect(screen.getByText("Un outil de diagnostic, pas un scanner")).toBeInTheDocument();
    const note = screen.getByText(/256 ports au maximum par lancement/);
    expect(note.textContent).toMatch(/1-65535/);
  });

  it("la découverte réseau ne sonde rien au chargement", () => {
    renderTool("network-lan", LanDiscoveryTool);
    // Ni plage, ni résultat : l'écran attend une interface et une confirmation.
    expect(screen.queryByText("Ce qui sera examiné")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lancer la découverte/ })).not.toBeInTheDocument();
  });
});
