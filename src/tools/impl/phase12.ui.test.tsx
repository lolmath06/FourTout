import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { toolRegistry } from "@/core/tools/registry";
import { DiagnosticShell } from "@/components/diagnostics/DiagnosticShell";
import { ImageRepairTool } from "./diagnostics/ImageRepairTool";
import type * as DiagnosticsModule from "@/core/diagnostics/native";
import type { DiagnosticReport } from "@/core/diagnostics/native";

/**
 * Ce que les écrans de diagnostic doivent garantir.
 *
 * Le moteur natif est remplacé ici : ce qu'on éprouve, c'est la manière dont
 * l'écran **raconte** un diagnostic. L'ordre dans lequel il présente les
 * choses est le fond du sujet — ce qui est cassé, ce que cela coûte, et
 * seulement ensuite le bouton.
 */
const inspectFile = vi.fn();
const sha256 = vi.fn();

vi.mock("@/core/diagnostics/native", async (importOriginal) => {
  const original = await importOriginal<typeof DiagnosticsModule>();
  return {
    ...original,
    isDiagnosticsAvailable: () => true,
    inspectFile: (path: string) => inspectFile(path),
    sha256: (path: string) => sha256(path),
  };
});

vi.mock("@/components/files/PathPicker", () => ({
  PathPicker: ({ onChange }: { onChange: (paths: string[]) => void }) => (
    <button type="button" onClick={() => onChange(["/tmp/fixture.zip"])}>
      Choisir un fichier
    </button>
  ),
}));

function report(overrides: Partial<DiagnosticReport> = {}): DiagnosticReport {
  return {
    path: "/tmp/fixture.zip",
    name: "fixture.zip",
    size: 4096,
    extension: "zip",
    detected: "zip",
    detectedLabel: "Archive ZIP",
    extensionMatches: true,
    health: "damaged",
    sha256: "a".repeat(64),
    findings: [
      {
        severity: "info",
        code: "zip.note",
        title: "Quatre en-têtes retrouvés",
        detail: "Le balayage a retrouvé les quatre entrées.",
        repairability: "none",
      },
      {
        severity: "error",
        code: "zip.no-eocd",
        title: "Fin de répertoire central absente",
        detail: "Aucune structure de fin d'archive n'a été trouvée.",
        repairability: "recoverPartial",
      },
      {
        severity: "warning",
        code: "zip.trailing-garbage",
        title: "Données parasites après la fin",
        detail: "Vingt-cinq octets suivent la fin déclarée.",
        repairability: "safeRepair",
      },
    ],
    actions: [
      {
        id: "zip-recover-folder",
        title: "Extraire les entrées récupérables",
        detail: "Chaque entrée est retrouvée par son en-tête local.",
        costs: ["Les entrées dont les données compressées sont tronquées"],
        repairability: "recoverPartial",
        outputExtension: "",
      },
    ],
    details: {},
    ...overrides,
  };
}

async function open(props: Partial<Parameters<typeof DiagnosticShell>[0]> = {}) {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <DiagnosticShell
        label="Fichier"
        hint="Un fichier"
        onAction={async () => ({
          title: "Récupération partielle",
          tone: "warning",
          summary: "3 entrées sur 4 ont pu être récupérées.",
          kept: ["3 entrées vérifiées"],
          lost: ["1 entrée — données tronquées"],
          output: "/tmp/fixture-recuperee",
        })}
        {...props}
      />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("button", { name: "Choisir un fichier" }));
  return user;
}

beforeEach(() => {
  inspectFile.mockReset();
  sha256.mockReset();
  inspectFile.mockResolvedValue(report());
  sha256.mockResolvedValue("a".repeat(64));
});

describe("écran de diagnostic", () => {
  it("montre l'empreinte de la source avant toute opération", async () => {
    await open();
    await waitFor(() => expect(screen.getByText(/fixture\.zip/)).toBeInTheDocument());
    expect(screen.getByText(/Empreinte SHA-256 avant toute opération/)).toBeInTheDocument();
  });

  it("classe les constats du plus grave au plus anodin", async () => {
    await open();
    await waitFor(() =>
      expect(screen.getByText("Fin de répertoire central absente")).toBeInTheDocument(),
    );
    const titles = screen
      .getAllByText(/Fin de répertoire central absente|Données parasites après la fin|Quatre en-têtes retrouvés/)
      .map((node) => node.textContent);
    expect(titles).toEqual([
      "Fin de répertoire central absente",
      "Données parasites après la fin",
      "Quatre en-têtes retrouvés",
    ]);
  });

  it("annonce ce que l'action coûte avant de proposer le bouton", async () => {
    await open();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Extraire les entrées récupérables/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Ce qui sera perdu :")).toBeInTheDocument();
    expect(
      screen.getByText("Les entrées dont les données compressées sont tronquées"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Le fichier d'origine n'est pas modifié/),
    ).toBeInTheDocument();
  });

  it("dit franchement quand il n'a aucune réparation à proposer", async () => {
    inspectFile.mockResolvedValue(report({ actions: [], health: "damaged" }));
    await open();
    await waitFor(() =>
      expect(screen.getByText("Aucune correction automatique")).toBeInTheDocument(),
    );
    expect(screen.getByText(/préfère s'en tenir au diagnostic/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Extraire/ })).not.toBeInTheDocument();
  });

  it("ne dit jamais « réparé » pour une récupération partielle", async () => {
    const user = await open();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Extraire les entrées récupérables/ }),
      ).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: /Extraire les entrées récupérables/ }));

    await waitFor(() =>
      expect(screen.getByText("3 entrées sur 4 ont pu être récupérées.")).toBeInTheDocument(),
    );
    // Le mot employé est « récupération », jamais « réparation » : la nuance
    // est tout ce qui sépare un rapport honnête d'une promesse tenue à moitié.
    expect(screen.getAllByText("Récupération partielle").length).toBeGreaterThan(0);
    expect(screen.getByText("Conservé")).toBeInTheDocument();
    expect(screen.getByText("Perdu")).toBeInTheDocument();
    expect(screen.queryByText(/Réparation réussie/)).not.toBeInTheDocument();
  });

  it("recalcule l'empreinte de la source et l'affiche après l'opération", async () => {
    const user = await open();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Extraire les entrées récupérables/ }),
      ).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: /Extraire les entrées récupérables/ }));

    await waitFor(() =>
      expect(screen.getByText("Fichier source inchangé — vérifié")).toBeInTheDocument(),
    );
    expect(sha256).toHaveBeenCalledWith("/tmp/fixture.zip");
    expect(screen.getByText(/elle est identique/)).toBeInTheDocument();
  });

  it("crie si l'empreinte de la source a changé", async () => {
    sha256.mockResolvedValue("b".repeat(64));
    const user = await open();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Extraire les entrées récupérables/ }),
      ).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: /Extraire les entrées récupérables/ }));

    await waitFor(() =>
      expect(screen.getByText("L'empreinte de la source a changé")).toBeInTheDocument(),
    );
    expect(screen.getByText(/ne devrait jamais arriver/)).toBeInTheDocument();
  });

  it("refuse poliment un fichier qui n'est pas du bon format", async () => {
    inspectFile.mockResolvedValue(
      report({ detected: "png", detectedLabel: "Image PNG", findings: [], actions: [] }),
    );
    await open({
      wrongFormat: (current) =>
        current.detected === "zip" ? undefined : `Ce fichier est du ${current.detectedLabel}.`,
    });
    await waitFor(() =>
      expect(screen.getByText("Ce n'est pas le format de cet outil")).toBeInTheDocument(),
    );
    expect(screen.getByText("Ce fichier est du Image PNG.")).toBeInTheDocument();
    // Aucun bouton d'action sur un format que l'outil ne traite pas.
    expect(screen.queryByText("Ce que FourTout peut faire")).not.toBeInTheDocument();
  });
});

describe("catalogue des écrans de diagnostic", () => {
  it("porte les cinq outils, avec leur note de limites", () => {
    for (const id of ["file-diagnose", "archive-repair", "pdf-repair", "image-repair", "disk-inspect"]) {
      const tool = toolRegistry.get(id);
      expect(tool, id).toBeDefined();
      expect(tool!.note, `note manquante : ${id}`).toBeTruthy();
    }
  });
});

describe("écran « Image endommagée »", () => {
  /**
   * Les deux rapports ci-dessous sont ceux que le moteur natif produit
   * réellement pour les fixtures correspondantes — `actions` comprises. Deux
   * tests d'intégration Rust
   * (`an_image_without_a_single_decodable_pixel_offers_no_action` et
   * `an_image_whose_pixels_survive_keeps_its_action`) verrouillent ce contrat
   * du côté du moteur ; celui-ci vérifie que l'écran l'honore.
   */
  function imageReport(overrides: Partial<DiagnosticReport>): DiagnosticReport {
    return report({
      name: "image.png",
      extension: "png",
      detected: "png",
      detectedLabel: "Image PNG",
      details: {},
      ...overrides,
    });
  }

  const truncated = imageReport({
    name: "image-png-truncated.png",
    health: "damaged",
    findings: [
      {
        severity: "error",
        code: "png.truncated",
        title: "Image tronquée",
        detail: "Le bloc « IDAT » annonce plus d'octets que le fichier n'en contient.",
        repairability: "recoverVisual",
      },
      {
        severity: "error",
        code: "image.no-pixels",
        title: "Le décodeur ne rend aucun pixel",
        detail:
          "FourTout a tenté le nettoyage structurel qu'il sait justifier, puis un nouveau " +
          "décodage : sans résultat. Aucune action n'est donc proposée.",
        repairability: "none",
      },
    ],
    // Le moteur ne produit aucune action : c'est le correctif.
    actions: [],
    details: {
      image: {
        format: "png",
        width: 64,
        height: 48,
        decodes: false,
        decodeError: "Image tronquée",
        chunks: [],
        segments: [],
        trailingBytes: 0,
        endMarker: false,
        brokenAncillary: 0,
        brokenCritical: 0,
        recoverable: false,
        recoveryLossless: false,
      },
    },
  });

  const badCrc = imageReport({
    name: "image-png-bad-crc.png",
    health: "suspicious",
    findings: [
      {
        severity: "warning",
        code: "png.broken-ancillary-chunk",
        title: "Métadonnées altérées",
        detail: "Un bloc auxiliaire porte une somme de contrôle fausse.",
        repairability: "safeRepair",
      },
    ],
    actions: [
      {
        id: "image-recover",
        title: "Réécrire une image saine",
        detail: "Les blocs non conformes sont écartés ; les octets des pixels sont recopiés.",
        costs: ["Les métadonnées portées par les blocs écartés"],
        repairability: "safeRepair",
        outputExtension: "png",
      },
    ],
    details: {
      image: {
        format: "png",
        width: 64,
        height: 48,
        decodes: true,
        decodeError: null,
        chunks: [
          { kind: "IHDR", offset: 8, length: 13, crcValid: true, ancillary: false },
          { kind: "tEXt", offset: 33, length: 15, crcValid: false, ancillary: true },
          { kind: "IDAT", offset: 60, length: 200, crcValid: true, ancillary: false },
        ],
        segments: [],
        trailingBytes: 0,
        endMarker: true,
        brokenAncillary: 1,
        brokenCritical: 0,
        recoverable: true,
        recoveryLossless: true,
      },
    },
  });

  async function mount() {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ImageRepairTool tool={toolRegistry.get("image-repair")!} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Choisir un fichier" }));
    return user;
  }

  it("n'offre aucune récupération quand le décodeur ne rend aucun pixel", async () => {
    inspectFile.mockResolvedValue(truncated);
    await mount();

    await waitFor(() => expect(screen.getByText("Image tronquée")).toBeInTheDocument());
    expect(screen.getByText("Le décodeur ne rend aucun pixel")).toBeInTheDocument();
    expect(screen.getByText(/Le décodeur accepte-t-il le fichier \?/)).toBeInTheDocument();

    // Le bouton contradictoire a disparu — c'est le correctif.
    expect(
      screen.queryByRole("button", { name: /Récupérer les pixels décodables/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Ce que FourTout peut faire")).not.toBeInTheDocument();
    // Et l'écran explique pourquoi, au lieu de se taire.
    expect(screen.getByText("Aucune correction automatique")).toBeInTheDocument();
  });

  it("garde le bouton quand les pixels survivent", async () => {
    inspectFile.mockResolvedValue(badCrc);
    await mount();

    await waitFor(() => expect(screen.getByText("Métadonnées altérées")).toBeInTheDocument());
    expect(screen.getByText("Ce que FourTout peut faire")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Réécrire une image saine/ }),
    ).toBeInTheDocument();
    // Le tableau des blocs montre lequel est fautif.
    expect(screen.getByText("tEXt")).toBeInTheDocument();
    expect(screen.getByText("fausse")).toBeInTheDocument();
  });
});
