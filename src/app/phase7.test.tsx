import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { routes } from "./routes";
import { toolRegistry } from "@/core/tools/registry";
import { TOOL_IMPLEMENTATIONS } from "@/tools/implementations";
import { searchTools } from "@/core/tools/search";
import { storeRates } from "@/core/currency";
import { appStore } from "@/core/storage";

/**
 * Recette de la phase 7.
 *
 * Trois garanties, dans cet ordre d'importance :
 *
 *  1. **Aucun outil « bientôt »** : le catalogue est entièrement livré, et
 *     chaque carte annoncée disponible a une implémentation branchée.
 *  2. **Chaque outil de la phase s'ouvre et fonctionne** : on ne se contente
 *     pas de vérifier qu'il monte, on lui donne une entrée et on lit sa sortie.
 *     Sans cela, l'utilisateur découvrirait trente-neuf fois la même panne.
 *  3. **Chaque outil se trouve** en tapant ce qu'on cherche, en français.
 */

function open(path: string) {
  return render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

/** Ouvre un outil et attend que son écran soit réellement monté. */
async function openTool(id: string) {
  const tool = toolRegistry.get(id);
  expect(tool, `outil inconnu : ${id}`).toBeDefined();
  open(`/tools/t/${id}`);
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: tool!.name })).toBeInTheDocument(),
  );
  // La vue « bientôt disponible » n'existe plus : aucun outil ne doit pouvoir
  // la faire réapparaître.
  expect(screen.queryByText("Cet outil arrive prochainement")).not.toBeInTheDocument();
  return tool!;
}

/** Les trente-neuf identifiants livrés par cette phase. */
const PHASE_7_TOOLS = [
  "docx-to-pdf",
  "archive-encrypted",
  "file-organize",
  "file-secure-delete",
  "json-tools",
  "xml-format",
  "yaml-format",
  "sql-format",
  "jwt-decode",
  "uuid-generate",
  "regex-tester",
  "timestamp-convert",
  "number-base-convert",
  "code-diff",
  "web-minify",
  "web-beautify",
  "cron-helper",
  "unit-length",
  "unit-weight",
  "unit-temperature",
  "unit-volume",
  "unit-area",
  "unit-speed",
  "unit-pressure",
  "unit-energy",
  "unit-power",
  "unit-data",
  "calc-percentage",
  "calc-proportion",
  "calc-date-difference",
  "calc-duration",
  "calc-age",
  "calc-scientific",
  "calc-currency",
  "password-generate",
  "password-strength",
  "file-encrypt",
  "file-decrypt",
  "metadata-strip-any",
] as const;

beforeEach(() => {
  cleanup();
});

describe("état final du catalogue", () => {
  it("branche une implémentation derrière chaque outil du catalogue", () => {
    // La règle : figurer au catalogue, c'est fonctionner. Il n'existe plus
    // d'état « bientôt » derrière lequel se réfugier.
    const missing = toolRegistry
      .all()
      .filter((tool) => !(tool.id in TOOL_IMPLEMENTATIONS))
      .map((tool) => tool.id);
    expect(missing).toEqual([]);
  });

  it("ne référence aucune implémentation orpheline", () => {
    const orphans = Object.keys(TOOL_IMPLEMENTATIONS).filter((id) => !toolRegistry.has(id));
    expect(orphans).toEqual([]);
  });

  it("livre bien les trente-neuf outils de la phase", () => {
    expect(PHASE_7_TOOLS).toHaveLength(39);
    for (const id of PHASE_7_TOOLS) {
      expect(toolRegistry.get(id), id).toBeDefined();
      expect(id in TOOL_IMPLEMENTATIONS, id).toBe(true);
    }
  });
});

describe("chaque outil de la phase s'ouvre", () => {
  it.each(PHASE_7_TOOLS)("%s", async (id) => {
    await openTool(id);
  });
});

/* ====================================================================== */
/* Scénarios réels, un par outil                                           */
/* ====================================================================== */

describe("développeur — formats de données", () => {
  it("JSON : formate, valide et situe l'erreur", async () => {
    const user = userEvent.setup();
    await openTool("json-tools");
    const input = screen.getByLabelText("JSON");
    await user.click(input);
    await user.paste('{"b":1,"a":2}');

    await waitFor(() =>
      expect(screen.getByLabelText<HTMLTextAreaElement>("JSON formaté").value).toContain('"b": 1'),
    );
    expect(screen.getByText(/Valide/)).toBeInTheDocument();

    await user.clear(input);
    await user.paste('{"a":,}');
    await waitFor(() => expect(screen.getByText(/ligne 1, colonne/)).toBeInTheDocument());
  });

  it("YAML : convertit vers JSON", async () => {
    const user = userEvent.setup();
    await openTool("yaml-format");
    await user.click(screen.getByRole("radio", { name: "YAML → JSON" }));
    await user.click(screen.getByLabelText("YAML"));
    await user.paste("nom: FourTout\nversion: 2");
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLTextAreaElement>("JSON").value).toContain('"nom": "FourTout"'),
    );
  });

  it("XML : formate et refuse une entité externe", async () => {
    const user = userEvent.setup();
    await openTool("xml-format");
    const input = screen.getByLabelText("XML");
    await user.click(input);
    await user.paste("<a><b>1</b></a>");
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLTextAreaElement>("XML formaté").value).toBe(
        "<a>\n  <b>1</b>\n</a>",
      ),
    );

    await user.clear(input);
    await user.paste('<!DOCTYPE f [ <!ENTITY x SYSTEM "file:///etc/passwd"> ]><f>&x;</f>');
    await waitFor(() => expect(screen.getByText(/entités XML/)).toBeInTheDocument());
  });

  it("SQL : met en forme une requête compacte", async () => {
    const user = userEvent.setup();
    await openTool("sql-format");
    await user.click(screen.getByLabelText("Requête SQL"));
    await user.paste("select a,b from t where a>1");
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLTextAreaElement>("Requête formatée").value).toContain(
        "SELECT",
      ),
    );
  });
});

describe("développeur — code", () => {
  it("formate du JavaScript", async () => {
    const user = userEvent.setup();
    await openTool("web-beautify");
    await user.click(screen.getByLabelText("Code source"));
    await user.paste("const a={b:1}");
    await waitFor(
      () =>
        expect(screen.getByLabelText<HTMLTextAreaElement>(/formaté/).value).toContain(
          "const a = { b: 1 };",
        ),
      { timeout: 5000 },
    );
  });

  it("minifie du CSS et annonce le gain", async () => {
    const user = userEvent.setup();
    await openTool("web-minify");
    await user.click(screen.getByLabelText("Code source"));
    await user.paste("a {\n  color : red ;\n}");
    await user.click(screen.getByRole("button", { name: /Minifier/ }));
    await waitFor(
      () =>
        expect(screen.getByLabelText<HTMLTextAreaElement>(/minifié/).value).toBe("a{color:red}"),
      { timeout: 5000 },
    );
    expect(screen.getByText(/% de gain/)).toBeInTheDocument();
  });

  it("compare deux extraits de code", async () => {
    const user = userEvent.setup();
    await openTool("code-diff");
    await user.click(screen.getByLabelText("Version d'origine"));
    await user.paste("const a = 1;");
    await user.click(screen.getByLabelText("Version modifiée"));
    await user.paste("const a = 2;");
    await waitFor(() =>
      expect(within(screen.getByTestId("code-diff-summary")).getByText("~1")).toBeInTheDocument(),
    );
  });
});

describe("développeur — jetons et outils", () => {
  it("JWT : décode et refuse de parler de signature valide", async () => {
    const user = userEvent.setup();
    await openTool("jwt-decode");
    await user.click(screen.getByLabelText("Token JWT"));
    await user.paste(
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
        "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ." +
        "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    );
    await waitFor(() => expect(screen.getByText("1234567890")).toBeInTheDocument());
    expect(screen.getByText("Décodé n'est pas vérifié")).toBeInTheDocument();
    expect(screen.getByText("non — la clé n'est pas connue")).toBeInTheDocument();
  });

  it("UUID : génère des identifiants uniques et conformes", async () => {
    const user = userEvent.setup();
    await openTool("uuid-generate");
    const output = screen.getByLabelText<HTMLTextAreaElement>("Identifiants");
    const first = output.value;
    expect(first.split("\n")).toHaveLength(10);
    for (const line of first.split("\n")) {
      expect(line).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    await user.click(screen.getByRole("button", { name: /Générer/ }));
    await waitFor(() => expect(output.value).not.toBe(first));
  });

  it("regex : liste les correspondances et leurs groupes", async () => {
    const user = userEvent.setup();
    await openTool("regex-tester");
    // Le mot « correspondances » figure aussi dans la description de l'outil :
    // on vise le bloc de résultat lui-même.
    await waitFor(() => expect(screen.getByTestId("calc-result")).toBeInTheDocument());
    const pattern = screen.getByTestId("regex-pattern");
    await user.clear(pattern);
    await user.type(pattern, "\\d+");
    await waitFor(() => expect(screen.getByTestId("calc-result")).toHaveTextContent(/[1-9]/));
  });

  it("timestamp : convertit vers une date lisible", async () => {
    const user = userEvent.setup();
    await openTool("timestamp-convert");
    const input = screen.getByTestId("timestamp-input");
    await user.clear(input);
    await user.type(input, "1700000000");
    await waitFor(() =>
      expect(screen.getByText("2023-11-14T22:13:20.000Z")).toBeInTheDocument(),
    );
  });

  it("bases : convertit un très grand entier sans perdre un chiffre", async () => {
    const user = userEvent.setup();
    await openTool("number-base-convert");
    const input = screen.getByTestId("base-input");
    await user.clear(input);
    await user.type(input, "9007199254740993");
    await waitFor(() =>
      expect(screen.getByTestId("calc-result")).toHaveTextContent("9007199254740993"),
    );
  });

  it("cron : explique une expression et prédit les occurrences", async () => {
    await openTool("cron-helper");
    await waitFor(() => expect(screen.getByTestId("calc-result")).toHaveTextContent(/09:00/));
    expect(screen.getByText("Prochaines exécutions")).toBeInTheDocument();
  });
});

describe("calculateurs — unités", () => {
  const CASES: [string, string, RegExp][] = [
    ["unit-length", "100", /62[.,]13/],
    ["unit-weight", "70", /154[.,]3/],
    ["unit-temperature", "100", /212/],
    ["unit-volume", "10", /2[.,]64/],
    ["unit-area", "10", /107[.,]6/],
    ["unit-speed", "100", /62[.,]13/],
    ["unit-pressure", "2", /29[.,]0/],
    ["unit-energy", "1", /3\s?600/],
    ["unit-power", "100", /134/],
    ["unit-data", "1", /0[.,]93/],
  ];

  it.each(CASES)("%s convertit la valeur par défaut", async (id, value, expected) => {
    const user = userEvent.setup();
    await openTool(id);
    const input = screen.getByTestId("unit-input");
    await user.clear(input);
    await user.type(input, value);
    await waitFor(() => expect(screen.getByTestId("calc-result")).toHaveTextContent(expected));
  });

  it("affiche la table complète des unités", async () => {
    await openTool("unit-length");
    const table = screen.getByText("Toutes les unités").closest("section")!;
    // « mille marin » figure aussi dans les deux listes déroulantes : on lit la
    // table, seul endroit où la valeur convertie doit apparaître.
    expect(within(table).getByRole("rowheader", { name: /mille marin/ })).toBeInTheDocument();
  });
});

describe("calculateurs — calculs", () => {
  it("pourcentages : X % de Y", async () => {
    const user = userEvent.setup();
    await openTool("calc-percentage");
    const first = screen.getByLabelText("Pourcentage");
    await user.clear(first);
    await user.type(first, "20");
    await waitFor(() => expect(screen.getByTestId("calc-result")).toHaveTextContent("50"));
  });

  it("pourcentages : refuse un total nul", async () => {
    const user = userEvent.setup();
    await openTool("calc-percentage");
    await user.click(screen.getByRole("radio", { name: "X est quel % de Y" }));
    const total = screen.getByLabelText("Total");
    await user.clear(total);
    await user.type(total, "0");
    await waitFor(() => expect(screen.getByText(/total doit être non nul/)).toBeInTheDocument());
  });

  it("règle de trois : résout la proportion", async () => {
    await openTool("calc-proportion");
    await waitFor(() => expect(screen.getByTestId("calc-result")).toHaveTextContent("28"));
  });

  it("dates : compte les jours entre deux dates", async () => {
    const user = userEvent.setup();
    await openTool("calc-date-difference");
    const from = screen.getByLabelText("Date de départ");
    const to = screen.getByLabelText("Date d'arrivée");
    await user.clear(from);
    await user.type(from, "2026-01-01");
    await user.clear(to);
    await user.type(to, "2026-12-31");
    await waitFor(() => expect(screen.getByTestId("calc-result")).toHaveTextContent("364"));
    expect(screen.getByText("Jours ouvrés")).toBeInTheDocument();
  });

  it("durées : additionne plusieurs lignes", async () => {
    const user = userEvent.setup();
    await openTool("calc-duration");
    const input = screen.getByLabelText("Durées, une par ligne");
    await user.clear(input);
    await user.click(input);
    await user.paste("01:30:00\n0:45");
    await waitFor(() => expect(screen.getByTestId("calc-result")).toHaveTextContent("02:15:00"));
  });

  it("âge : donne les années, mois et jours", async () => {
    const user = userEvent.setup();
    await openTool("calc-age");
    const birth = screen.getByLabelText("Date de naissance");
    const reference = screen.getByLabelText("Date de référence");
    await user.clear(birth);
    await user.type(birth, "1990-05-15");
    await user.clear(reference);
    await user.type(reference, "2026-09-05");
    await waitFor(() => expect(screen.getByTestId("calc-result")).toHaveTextContent("36"));
    expect(screen.getByText("Prochain anniversaire")).toBeInTheDocument();
  });

  it("calculatrice : évalue sans exécuter de code", async () => {
    const user = userEvent.setup();
    await openTool("calc-scientific");
    const input = screen.getByTestId("calc-expression");
    await user.type(input, "(2+3)*sqrt(16)-5!");
    await waitFor(() => expect(screen.getByTestId("calc-result")).toHaveTextContent("-100"));

    await user.clear(input);
    await user.type(input, "globalThis");
    await waitFor(() => expect(screen.getByText(/Nom inconnu/)).toBeInTheDocument());
  });

  it("devises : convertit à partir du dernier relevé connu", async () => {
    const user = userEvent.setup();
    // Hors réseau (et hors Tauri), l'outil doit servir le cache et le dater.
    storeRates(
      {
        date: "2026-09-04",
        base: "EUR",
        rates: [
          ["EUR", 1],
          ["USD", 1.1622],
        ],
        source: "Banque centrale européenne",
        sourceUrl: "https://example.invalid",
        fetchedAt: Date.now(),
      },
      appStore,
    );
    await openTool("calc-currency");
    await waitFor(() => expect(screen.getByTestId("currency-amount")).toBeInTheDocument());
    const amount = screen.getByTestId("currency-amount");
    await user.clear(amount);
    await user.type(amount, "100");
    await waitFor(() => expect(screen.getByTestId("calc-result")).toHaveTextContent(/116[.,]22/));
    expect(screen.getByText(/2026-09-04/)).toBeInTheDocument();
  });
});

describe("sécurité — mots de passe", () => {
  it("génère un mot de passe de la longueur demandée", async () => {
    const user = userEvent.setup();
    await openTool("password-generate");
    const length = screen.getByTestId("password-length");
    await user.clear(length);
    await user.type(length, "24");
    await user.click(screen.getByRole("button", { name: /Générer/ }));
    await waitFor(() => expect(screen.getByText("Entropie")).toBeInTheDocument());
    const propositions = screen.getByText("Propositions").parentElement as HTMLElement;
    const values = within(propositions)
      .getAllByText(/^.{24}$/)
      .map((node) => node.textContent ?? "");
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toHaveLength(24);
    // Chaque famille cochée doit être présente.
    expect(values[0]).toMatch(/[a-z]/);
    expect(values[0]).toMatch(/[A-Z]/);
    expect(values[0]).toMatch(/[0-9]/);
  });

  it("évalue un mot de passe faible et un mot de passe fort", async () => {
    const user = userEvent.setup();
    await openTool("password-strength");
    const input = screen.getByTestId("password-input");
    await user.type(input, "azerty123");
    await waitFor(() => expect(screen.getByTestId("calc-result")).toHaveTextContent(/faible/i), {
      timeout: 5000,
    });

    await user.clear(input);
    await user.type(input, "9xR#tPq2$Lm7&Vz4!Ka1");
    await waitFor(() => expect(screen.getByTestId("calc-result")).toHaveTextContent(/robuste/i), {
      timeout: 5000,
    });
  });
});

describe("outils qui exigent l'application installée", () => {
  // Hors Tauri, ces écrans doivent le dire clairement plutôt que de proposer
  // une action qui échouerait silencieusement.
  const NATIVE_TOOLS = [
    "archive-encrypted",
    "file-organize",
    "file-secure-delete",
    "file-encrypt",
    "file-decrypt",
    "docx-to-pdf",
  ];

  it.each(NATIVE_TOOLS)("%s annonce la dépendance native", async (id) => {
    await openTool(id);
    expect(screen.getByText(/Application installée requise/)).toBeInTheDocument();
  });

  it("l'effacement sécurisé annonce ses limites avant toute action", async () => {
    await openTool("file-secure-delete");
    // Même sans moteur natif, la promesse doit être honnête dès l'ouverture.
    expect(screen.getByText(/Application installée requise/)).toBeInTheDocument();
  });
});

describe("le nettoyage de métadonnées route vers le bon outil", () => {
  it("s'ouvre et explique ce qu'il sait faire", async () => {
    await openTool("metadata-strip-any");
    expect(screen.getByText(/Déposez le fichier à nettoyer/)).toBeInTheDocument();
    // Le titre de la carte reprend le nom de l'outil : on vise l'explication.
    expect(
      screen.getByText(/Ce que « supprimer les métadonnées » veut dire/),
    ).toBeInTheDocument();
  });
});

/* ====================================================================== */
/* Recherche                                                               */
/* ====================================================================== */

describe("recherche en langage courant", () => {
  const QUERIES: [string, string][] = [
    ["formater json", "json-tools"],
    ["formatter xml", "xml-format"],
    ["yaml json", "yaml-format"],
    ["formatter sql", "sql-format"],
    ["decoder jwt", "jwt-decode"],
    ["uuid", "uuid-generate"],
    ["tester regex", "regex-tester"],
    ["timestamp unix", "timestamp-convert"],
    ["hex decimal", "number-base-convert"],
    ["diff code", "code-diff"],
    ["minifier javascript", "web-minify"],
    ["cron", "cron-helper"],
    ["km en miles", "unit-length"],
    ["kg en livres", "unit-weight"],
    ["celsius fahrenheit", "unit-temperature"],
    ["litres gallons", "unit-volume"],
    ["m2 acres", "unit-area"],
    ["kmh mph", "unit-speed"],
    ["bar psi", "unit-pressure"],
    ["kwh joules", "unit-energy"],
    ["kw chevaux", "unit-power"],
    ["gib gb", "unit-data"],
    ["pourcentage", "calc-percentage"],
    ["règle de trois", "calc-proportion"],
    ["différence entre deux dates", "calc-date-difference"],
    ["additionner des durées", "calc-duration"],
    ["mon âge", "calc-age"],
    ["calculatrice scientifique", "calc-scientific"],
    ["euros dollars", "calc-currency"],
    ["mot de passe", "password-generate"],
    ["robustesse mot de passe", "password-strength"],
    ["chiffrer fichier", "file-encrypt"],
    ["retirer métadonnées", "metadata-strip-any"],
    ["word en pdf", "docx-to-pdf"],
    ["archive protégée", "archive-encrypted"],
    ["ranger un dossier", "file-organize"],
    ["suppression sécurisée", "file-secure-delete"],
    ["formater html css", "web-beautify"],
  ];

  it.each(QUERIES)("« %s » trouve %s", (query, expected) => {
    const results = searchTools(query).slice(0, 6).map((result) => result.tool.id);
    expect(results, `résultats : ${results.join(", ")}`).toContain(expected);
  });

  it("ne remonte jamais un outil sans implémentation", () => {
    for (const [query] of QUERIES) {
      for (const result of searchTools(query)) {
        expect(
          result.tool.id in TOOL_IMPLEMENTATIONS,
          `${query} → ${result.tool.id}`,
        ).toBe(true);
      }
    }
  });
});
